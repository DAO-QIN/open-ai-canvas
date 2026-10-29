// 生成任务的持久化：领取、租约续期、Provider 进度与终态写回。
//
// 所有「执行中」写入都带租约校验（taskLeaseWriter）：进程被新执行者接管后，旧执行者的
// 迟到写入会因租约不匹配被丢弃，避免覆盖新结果或重复扣费。

package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) Task(id string) (*model.Task, error) {
	var task model.Task
	if err := r.db.First(&task, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) TaskForUser(userID string, id string) (*model.Task, error) {
	var task model.Task
	if err := r.db.First(&task, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) TaskForUserByIdempotencyKey(userID string, key string) (*model.Task, error) {
	if strings.TrimSpace(key) == "" {
		return nil, nil
	}
	var task model.Task
	err := r.db.First(&task, "user_id = ? AND idempotency_key = ?", userID, key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) ActiveTaskCountForUser(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Task{}).Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error
	return count, err
}

func (r *Repository) ActiveTaskCountForProjectIDs(userID string, projectIDs []string) (int64, error) {
	if len(projectIDs) == 0 {
		return 0, nil
	}
	var count int64
	err := r.db.Model(&model.Task{}).
		Where("user_id = ? AND project_id IN ? AND status IN ?", userID, projectIDs, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
		Count(&count).Error
	return count, err
}

// TaskClaimOptions 是调度器给一次领取的偏好；零值只按优先级排序，不限制单用户并发。
type TaskClaimOptions struct {
	// UserRunningCap 是单个用户持有有效租约的执行中任务上限，<= 0 表示不限制。
	// 达到上限的用户的任务先让其他用户领取；没有其他可领取任务时仍照常领取，worker 不空等。
	// Agent 模型调用不受上限约束，但计入该用户的执行中数量。
	UserRunningCap int
}

// taskClaimAgingStep 是非交互任务的排队老化步长：每等满一个步长，优先级提升一级。
// 目前只有交互（0）和普通（1）两级，普通任务等满一个步长即与交互任务同级，按创建时间先后领取。
const taskClaimAgingStep = time.Minute

// taskClaimAgentModelOperations 与 app 层 cloudAgentModelOperation 同一口径：Agent 根任务（第一步）、
// 后续每一步和上下文压缩调用。repository 不能引用 app 常量；操作名是已落库数据，改名时必须同步这里。
var taskClaimAgentModelOperations = []string{"cloud_agent", "cloud_agent_step", "cloud_agent_context_compaction"}

// taskClaimBackgroundOperations 是没有项目归属、但没有用户在等的后台任务（Agent 记忆整理），不算交互级。
var taskClaimBackgroundOperations = []string{"agent_memory_compact"}

const (
	// 可领取：排队中，或执行中但租约缺失/已过期；且不在等待下一次上游回查。
	taskClaimableCondition = "(status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?))) AND (next_poll_at IS NULL OR next_poll_at <= ?)"
	// 单用户上限只统计持有有效租约的执行中任务；转入上游回查的任务已释放租约，不计数。Agent 模型调用豁免。
	taskClaimUserCapCondition = "(operation IN ? OR user_id NOT IN (SELECT user_id FROM tasks WHERE status = ? AND lease_expires_at > ? AND user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) >= ?))"
	// 有效优先级：Agent 模型调用、创作运行提交（creation_submission_id）、Agent 对话内的媒体（agent_run_id），
	// 以及不属于画布/项目也不属于工作台的任务（创作页直接生成走 POST /tasks，来源只记在 input_json 里）为 0；
	// 其余为 1，排队满一个老化步长后为 0。同级按创建时间先后。老化截止时间是绑定参数，两种数据库共用同一表达式。
	taskClaimPriorityOrder = "CASE WHEN operation IN ? OR COALESCE(creation_submission_id, '') <> '' OR COALESCE(agent_run_id, '') <> '' OR (COALESCE(project_id, '') = '' AND COALESCE(workbench_kind, '') = '' AND operation NOT IN ?) THEN 0 WHEN created_at <= ? THEN 0 ELSE 1 END ASC, created_at ASC"
)

// 任务领取以数据库租约为真相；PostgreSQL 锁行跳过竞争任务，SQLite 继续依赖条件更新保证单实例原子性。
// 设置单用户上限时，先排除已达上限用户的任务挑选；挑不到再不带上限挑一次，有可领取任务就一定领取。
func (r *Repository) ClaimNextTask(owner string, leaseDuration time.Duration, options ...TaskClaimOptions) (*model.Task, error) {
	var option TaskClaimOptions
	if len(options) > 0 {
		option = options[0]
	}
	var task model.Task
	now := time.Now()
	leaseExpiresAt := now.Add(leaseDuration)
	isPostgres := r.Dialect() == "postgres"
	err := r.db.Transaction(func(tx *gorm.DB) error {
		found := false
		for _, userCap := range taskClaimUserCapPasses(option.UserRunningCap) {
			result := taskClaimCandidate(tx, isPostgres, now, userCap).Find(&task)
			if result.Error != nil {
				return result.Error
			}
			if found = result.RowsAffected > 0; found {
				break
			}
		}
		if !found {
			task = model.Task{}
			return nil
		}
		claim := tx.Model(&model.Task{}).Where("id = ?", task.ID)
		if !isPostgres {
			claim = claim.Where(taskClaimableCondition, model.TaskStatusQueued, model.TaskStatusRunning, now, now)
		}
		updated := claim.
			Updates(map[string]any{
				"status": model.TaskStatusRunning,
				// 回查已被上游接收的任务时保留原进度（如“候车 · 前面 N 条”），避免每轮领取时文案来回跳。
				"stage":            gorm.Expr("CASE WHEN provider_request_id <> '' THEN stage ELSE ? END", "后端接管任务"),
				"progress":         gorm.Expr("CASE WHEN provider_request_id <> '' THEN progress ELSE ? END", 15),
				"attempts":         gorm.Expr("attempts + ?", 1),
				"started_at":       gorm.Expr("COALESCE(started_at, ?)", now),
				"lease_owner":      owner,
				"lease_expires_at": leaseExpiresAt,
				"next_poll_at":     nil,
				"updated_at":       now,
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected == 0 {
			task = model.Task{}
			return nil
		}
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err != nil || task.ID == "" {
		return nil, err
	}
	return &task, nil
}

// taskClaimUserCapPasses 返回依次尝试的单用户上限：先带上限挑选，再以 0（不限制）兜底。
func taskClaimUserCapPasses(userCap int) []int {
	if userCap <= 0 {
		return []int{0}
	}
	return []int{userCap, 0}
}

// taskClaimCandidate 构造一次候选查询：可领取条件与可选的单用户上限，按有效优先级、创建时间取第一条。
func taskClaimCandidate(tx *gorm.DB, isPostgres bool, now time.Time, userCap int) *gorm.DB {
	query := tx.Where(taskClaimableCondition, model.TaskStatusQueued, model.TaskStatusRunning, now, now)
	if userCap > 0 {
		query = query.Where(taskClaimUserCapCondition, taskClaimAgentModelOperations, model.TaskStatusRunning, now, userCap)
	}
	query = query.Order(clause.OrderBy{Expression: clause.Expr{
		SQL:  taskClaimPriorityOrder,
		Vars: []any{taskClaimAgentModelOperations, taskClaimBackgroundOperations, now.Add(-taskClaimAgingStep)},
	}}).Limit(1)
	if isPostgres {
		query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
	}
	return query
}

func (r *Repository) RenewTaskLease(id string, owner string, leaseDuration time.Duration) error {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", id, model.TaskStatusRunning, owner, time.Now()).
		Updates(map[string]any{"lease_expires_at": time.Now().Add(leaseDuration), "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("任务租约已失效")
	}
	return nil
}

func (r *Repository) UpdateTaskProviderState(id string, providerRequestID string, pollStage string, nextPollAt *time.Time) error {
	updates := map[string]any{"poll_stage": pollStage, "next_poll_at": nextPollAt, "updated_at": time.Now()}
	if strings.TrimSpace(providerRequestID) != "" {
		updates["provider_request_id"] = strings.TrimSpace(providerRequestID)
	}
	return r.db.Model(&model.Task{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) DeferRunningTaskForProviderPoll(id string, owner string, stage string, delay time.Duration) error {
	now := time.Now()
	result := taskLeaseWriter(r.db.Model(&model.Task{}), owner).
		Where("id = ? AND status = ?", id, model.TaskStatusRunning).
		Updates(map[string]any{
			"stage": stage, "error": "", "completed_at": nil, "next_poll_at": now.Add(delay),
			"lease_owner": "", "lease_expires_at": nil, "updated_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

// 人工恢复仅锁定失败任务；旧 worker 的租约可覆盖，但未过期的人工恢复租约不能并发抢占。
func (r *Repository) ClaimFailedTaskProviderRecovery(id string, userID string, owner string, leaseDuration time.Duration) error {
	now := time.Now()
	query := r.db.Model(&model.Task{}).Where(
		"id = ? AND status = ? AND (lease_owner = '' OR lease_owner NOT LIKE ? OR lease_expires_at IS NULL OR lease_expires_at <= ?)",
		id, model.TaskStatusFailed, "manual-recovery:%", now,
	)
	if strings.TrimSpace(userID) != "" {
		query = query.Where("user_id = ?", userID)
	}
	result := query.Updates(map[string]any{
		"lease_owner":      owner,
		"lease_expires_at": now.Add(leaseDuration),
		"updated_at":       now,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskProviderRecoveryConflict
	}
	return nil
}

func (r *Repository) ReleaseTaskProviderRecovery(id string, owner string) error {
	return r.db.Model(&model.Task{}).
		Where("id = ? AND lease_owner = ?", id, owner).
		Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil, "updated_at": time.Now()}).Error
}

func (r *Repository) UpdateTaskProgress(id string, stage string, progress int) error {
	return r.db.Model(&model.Task{}).Where("id = ? AND status = ?", id, model.TaskStatusRunning).Updates(map[string]any{
		"stage": stage, "progress": progress, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) UpdateTaskProgressForLease(id string, owner string, stage string, progress int) error {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), owner).
		Where("id = ? AND status = ?", id, model.TaskStatusRunning).
		Updates(map[string]any{"stage": stage, "progress": progress, "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

// 无租约任务仅能写无租约记录；有租约的执行者必须仍持有本次领取的有效 owner。
func taskLeaseWriter(db *gorm.DB, owner string) *gorm.DB {
	if owner == "" {
		return db.Where("(lease_owner = '' OR lease_owner IS NULL)")
	}
	return db.Where("lease_owner = ? AND lease_expires_at > ?", owner, time.Now())
}

// UpdateTaskProviderProgress records upstream-reported progress without allowing
// a delayed or out-of-order poll response to move the public percentage backwards.
func (r *Repository) UpdateTaskProviderProgress(id string, progress int) error {
	progress = max(0, min(100, progress))
	return r.db.Model(&model.Task{}).Where("id = ? AND status = ?", id, model.TaskStatusRunning).Updates(map[string]any{
		"stage":      "上游生成中",
		"progress":   gorm.Expr("CASE WHEN progress < ? THEN ? ELSE progress END", progress, progress),
		"updated_at": time.Now(),
	}).Error
}

func (r *Repository) SaveTaskCompletion(task *model.Task, expected model.TaskStatus, results []model.Result) error {
	return r.SaveTaskCompletionWithRegistration(task, expected, results, nil)
}

// Registration and terminal success commit together; a failed asset write leaves
// the task recoverable and never exposes a false success to the canvas.
func (r *Repository) SaveTaskCompletionWithRegistration(task *model.Task, expected model.TaskStatus, results []model.Result, register func(*Repository) error) error {
	return r.Transaction(func(repo *Repository) error {
		// 记在事务里，提交成功后才唤醒等这个任务的一方。
		repo.signalChanged(taskSignalKey(task.ID))
		tx := repo.db
		storedResultJSON := task.ResultJSON
		updated := taskLeaseWriter(tx.Model(&model.Task{}), task.LeaseOwner).
			Where("id = ? AND status = ?", task.ID, expected).
			Select("*").Omit("id", "created_at", "project_id").Updates(task)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		// Canvas deletion may have detached the task while the worker was waiting
		// for its provider. Completion cannot restore that stale association.
		var current model.Task
		if err := tx.Select("project_id").First(&current, "id = ?", task.ID).Error; err != nil {
			return err
		}
		task.ProjectID = current.ProjectID
		for index := range results {
			if err := tx.Create(&results[index]).Error; err != nil {
				return err
			}
		}
		if register != nil {
			if err := register(repo); err != nil {
				return err
			}
			// 版本化资产绑定可能补充结果状态；与任务终态在同一事务保存。
			if task.ResultJSON != storedResultJSON {
				return tx.Model(&model.Task{}).Where("id = ?", task.ID).Update("result_json", task.ResultJSON).Error
			}
		}
		return nil
	})
}

func (r *Repository) UpdateTaskTerminalState(id string, owner string, expected model.TaskStatus, status model.TaskStatus, stage string, errorText string, completedAt time.Time) (bool, error) {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), owner).
		Where("id = ? AND status = ?", id, expected).
		Updates(map[string]any{
			"status": status, "stage": stage, "error": errorText, "completed_at": &completedAt,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": completedAt,
		})
	if result.Error == nil && result.RowsAffected == 1 {
		r.signalChanged(taskSignalKey(id))
	}
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) UpdateTaskTerminalDiagnostic(task *model.Task, completedAt time.Time) (bool, error) {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), task.LeaseOwner).
		Where("id = ? AND status = ?", task.ID, model.TaskStatusRunning).
		Updates(map[string]any{
			"status": task.Status, "stage": task.Stage, "error": task.Error, "completed_at": &completedAt,
			"execution_diagnostic_json": task.ExecutionDiagnosticJSON,
			"cancellation_source":       task.CancellationSource, "cancellation_actor_id": task.CancellationActorID,
			"cancellation_requested_at": task.CancellationRequestedAt,
			"lease_owner":               "", "lease_expires_at": nil, "updated_at": completedAt,
		})
	if result.Error == nil && result.RowsAffected == 1 {
		r.signalChanged(taskSignalKey(task.ID))
	}
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) UpdateTaskExecutionDiagnostic(userID, taskID, diagnosticJSON string) error {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ?", taskID, userID).
		Update("execution_diagnostic_json", diagnosticJSON)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) CancelTaskIfStatus(userID string, id string, expected model.TaskStatus, now time.Time, intents ...model.TaskCancellationIntent) (bool, error) {
	updates := map[string]any{
		"status": model.TaskStatusCancelled, "stage": "任务已取消", "error": "任务已取消", "completed_at": &now,
		"lease_owner": "", "lease_expires_at": nil, "updated_at": now,
	}
	if len(intents) > 0 {
		intent := intents[0]
		diagnostic, err := json.Marshal(intent.Diagnostic)
		if err != nil {
			return false, err
		}
		updates["cancellation_source"], updates["cancellation_actor_id"], updates["cancellation_requested_at"] = intent.Source, intent.ActorID, intent.RequestedAt
		updates["execution_diagnostic_json"] = string(diagnostic)
	}
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, expected).
		Updates(updates)
	if result.Error == nil && result.RowsAffected == 1 {
		r.signalChanged(taskSignalKey(id))
	}
	return result.RowsAffected == 1, result.Error
}

// 上游取消先落库再发请求；条件更新保证并发和重复取消只有一个调用方取得发送权。
func (r *Repository) ClaimTaskProviderCancellation(userID string, id string, now time.Time) error {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ? AND provider_cancel_status = ''", id, userID, model.TaskStatusCancelled).
		Updates(map[string]any{
			"provider_cancel_status":        model.ProviderCancelStatusRequested,
			"provider_cancel_attempts":      1,
			"provider_cancel_requested_at":  &now,
			"provider_cancel_next_check_at": now.Add(15 * time.Second),
			"provider_cancel_error":         "",
			"updated_at":                    now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskProviderCancellationConflict
	}
	return nil
}

func (r *Repository) UpdateTaskProviderCancellation(id string, expected model.ProviderCancelStatus, status model.ProviderCancelStatus, errorText string, nextCheckAt *time.Time, cancelledAt *time.Time) error {
	updates := map[string]any{
		"provider_cancel_status":        status,
		"provider_cancel_error":         errorText,
		"provider_cancel_next_check_at": nextCheckAt,
		"lease_owner":                   "",
		"lease_expires_at":              nil,
		"updated_at":                    time.Now(),
	}
	if cancelledAt != nil {
		updates["provider_cancelled_at"] = cancelledAt
	}
	result := r.db.Model(&model.Task{}).Where("id = ? AND status = ? AND provider_cancel_status = ?", id, model.TaskStatusCancelled, expected).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskProviderCancellationConflict
	}
	return nil
}

// 对账任务同样使用数据库租约，多实例和服务重启后只会有一个 worker 查询同一上游任务。
func (r *Repository) ClaimNextTaskProviderCancellation(owner string, leaseDuration time.Duration) (*model.Task, error) {
	var task model.Task
	now := time.Now()
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"status = ? AND provider_cancel_status = ? AND (provider_cancel_next_check_at IS NULL OR provider_cancel_next_check_at <= ?) AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
			model.TaskStatusCancelled, model.ProviderCancelStatusRequested, now, now,
		).Order("provider_cancel_requested_at asc").Limit(1)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if result := query.Find(&task); result.Error != nil || result.RowsAffected == 0 {
			task = model.Task{}
			return result.Error
		}
		claim := tx.Model(&model.Task{}).Where(
			"id = ? AND status = ? AND provider_cancel_status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
			task.ID, model.TaskStatusCancelled, model.ProviderCancelStatusRequested, now,
		).Updates(map[string]any{
			"lease_owner":              owner,
			"lease_expires_at":         now.Add(leaseDuration),
			"provider_cancel_attempts": gorm.Expr("provider_cancel_attempts + 1"),
			"updated_at":               now,
		})
		if claim.Error != nil || claim.RowsAffected == 0 {
			task = model.Task{}
			return claim.Error
		}
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err != nil || task.ID == "" {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) Tasks(userID string, limit int, projectID string, activeOnly bool) ([]model.Task, error) {
	return r.TasksWithWorkbenchKind(userID, limit, projectID, activeOnly, "")
}

func (r *Repository) TasksWithWorkbenchKind(userID string, limit int, projectID string, activeOnly bool, workbenchKind string) ([]model.Task, error) {
	var tasks []model.Task
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := r.db.Select("id", "user_id", "project_id", "type", "workbench_kind", "status", "stage", "media_stage", "media_recovery_json", "progress", "prompt", "operation", "provider", "model", "input_json", "result_json", "billing_order_id", "provider_request_id", "provider_cancel_status", "provider_cancel_error", "provider_cancel_attempts", "provider_cancel_requested_at", "provider_cancelled_at", "provider_cancel_next_check_at", "attempts", "started_at", "completed_at", "created_at", "updated_at", "agent_run_id", "generation_id", "approval_id", "authorized_charge_microcredits", "execution_diagnostic_json", "cancellation_source", "cancellation_actor_id", "cancellation_requested_at").
		Where("user_id = ?", userID)
	if strings.TrimSpace(projectID) != "" {
		query = query.Where("project_id = ?", strings.TrimSpace(projectID))
	}
	if activeOnly {
		query = query.Where("status IN ?", []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning})
	}
	if workbenchKind != "" {
		taskType := "canvas_" + workbenchKind
		if r.db.Dialector.Name() == "postgres" {
			query = query.Where("(workbench_kind = ? AND type = ?) OR (type = ? AND input_json::jsonb -> 'metadata' ->> 'source' = ? AND input_json::jsonb -> 'metadata' ->> 'workbenchKind' = ?)", workbenchKind, taskType, taskType, "workbench", workbenchKind)
		} else {
			query = query.Where("(workbench_kind = ? AND type = ?) OR (type = ? AND json_extract(input_json, '$.metadata.source') = ? AND json_extract(input_json, '$.metadata.workbenchKind') = ?)", workbenchKind, taskType, taskType, "workbench", workbenchKind)
		}
	}
	err := query.Order("created_at desc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

// SuccessfulWorkflowTasksForProject 返回需要补偿工作流产物的成功任务。
// 不设分页，供项目详情读取时修复浏览器中断造成的历史断点。
func (r *Repository) SuccessfulWorkflowTasksForProject(userID string, projectID string) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Where("user_id = ? AND project_id = ? AND status = ?", userID, projectID, model.TaskStatusSucceeded).
		Order("completed_at asc, created_at asc").Find(&tasks).Error
	return tasks, err
}

func (r *Repository) TaskLogs(userID string, taskID string) ([]model.TaskLog, error) {
	var logs []model.TaskLog
	err := r.db.Order("created_at asc").Find(&logs, "user_id = ? AND task_id = ?", userID, taskID).Error
	return logs, err
}
