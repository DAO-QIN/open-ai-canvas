package repository

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// CreationMetricsQuery 描述一次创作体验统计。来源标记、任务类型、Agent 操作名、可见事件类型和
// 自动退回备注都属于业务口径，由 app 层给出；这里只负责按方言查询和汇总，不含阈值或告警。
type CreationMetricsQuery struct {
	// [Since, Until) 是统计窗口：运行与任务按创建时间、自动退回按退回时间落入窗口。
	Since time.Time
	Until time.Time
	// 任务在 StuckBefore 之前就已结束、计费订单却仍占着冻结积分的，计为未退回；不受统计窗口限制。
	StuckBefore time.Time
	Surface     string
	// DirectSources 是创作页直接生成写在 input_json.metadata.source 的来源标记。
	DirectSources   []string
	ImageType       string
	VideoType       string
	AgentMediaTypes []string
	// ModelOperations 是 Agent 模型调用任务的操作名。根任务的 ID 就是运行 ID，
	// 后续步骤与上下文压缩通过 agent_run_id 关联运行。
	ModelOperations []string
	// FeedbackEvents 是用户在创作页能看到的事件类型，每轮取第一条作为首个反馈。
	FeedbackEvents []string
	AutoRefundNote string
	// RowLimit 限制每类明细的读取行数；超出时只统计最近的 RowLimit 行并标记 Truncated。
	RowLimit int
}

// CreationLatency 的分位数取最近秩（不插值），没有样本时为 null。
type CreationLatency struct {
	P50Ms   *int64 `json:"p50Ms"`
	P95Ms   *int64 `json:"p95Ms"`
	Samples int    `json:"samples"`
}

// CreationRunStats 统计创作页 Agent 运行。Cancelled 含用户拒绝审批结束的运行（rejected）；
// FailureRate = Failed / Finished，进行中的运行不进分母。
type CreationRunStats struct {
	Runs          int             `json:"runs"`
	Completed     int             `json:"completed"`
	Failed        int             `json:"failed"`
	Cancelled     int             `json:"cancelled"`
	Finished      int             `json:"finished"`
	FailureRate   float64         `json:"failureRate"`
	FirstFeedback CreationLatency `json:"firstFeedback"`
}

// CreationTaskStats 统计一组生成任务。Finished 是成功、失败与取消之和，FailureRate = Failed / Finished。
type CreationTaskStats struct {
	Count       int             `json:"count"`
	Finished    int             `json:"finished"`
	Failed      int             `json:"failed"`
	FailureRate float64         `json:"failureRate"`
	QueueWait   CreationLatency `json:"queueWait"`
	Total       CreationLatency `json:"total"`
}

type CreationRefundStats struct {
	AutoRefunded int64 `json:"autoRefunded"`
	StuckFrozen  int64 `json:"stuckFrozen"`
}

type CreationMetrics struct {
	Agent            CreationRunStats
	Image            CreationTaskStats
	Video            CreationTaskStats
	AgentMedia       CreationTaskStats
	InteractiveQueue CreationLatency
	Refunds          CreationRefundStats
	Truncated        bool
}

type creationMetricRun struct {
	Status          string
	CreatedAt       time.Time
	FirstFeedbackAt *time.Time
}

type creationMetricTask struct {
	Type        string
	Status      model.TaskStatus
	CreatedAt   time.Time
	StartedAt   *time.Time
	CompletedAt *time.Time
}

// 时间列只按原列读出（不包表达式），SQLite 才会保留 datetime 声明类型并扫描成 time.Time。
const creationMetricTaskColumns = "SELECT tasks.type AS type, tasks.status AS status, tasks.created_at AS created_at, tasks.started_at AS started_at, tasks.completed_at AS completed_at"

// CreationMetrics 汇总创作页的首个反馈、排队、完成耗时、失败率与冻结积分退回情况。只读，
// 每类明细最多读取 RowLimit 行（按创建时间取最近的），分位数在 Go 里按读出的耗时计算。
func (r *Repository) CreationMetrics(q CreationMetricsQuery) (CreationMetrics, error) {
	var result CreationMetrics
	if q.RowLimit <= 0 {
		return result, errors.New("创作体验统计的行数上限必须大于 0")
	}
	runs, runsTruncated, err := r.creationMetricRuns(q)
	if err != nil {
		return result, fmt.Errorf("读取创作页 Agent 运行：%w", err)
	}
	direct, directTruncated, err := r.creationMetricDirectTasks(q)
	if err != nil {
		return result, fmt.Errorf("读取创作页直接生成任务：%w", err)
	}
	media, mediaTruncated, err := r.creationMetricAgentMediaTasks(q)
	if err != nil {
		return result, fmt.Errorf("读取创作页 Agent 媒体任务：%w", err)
	}
	steps, stepsTruncated, err := r.creationMetricModelSteps(q)
	if err != nil {
		return result, fmt.Errorf("读取创作页 Agent 模型调用任务：%w", err)
	}
	if result.Refunds.AutoRefunded, err = r.creationMetricAutoRefunds(q); err != nil {
		return result, fmt.Errorf("统计自动退回订单：%w", err)
	}
	if result.Refunds.StuckFrozen, err = r.creationMetricStuckFrozen(q); err != nil {
		return result, fmt.Errorf("统计未退回的冻结订单：%w", err)
	}
	var images, videos []creationMetricTask
	for _, task := range direct {
		switch task.Type {
		case q.ImageType:
			images = append(images, task)
		case q.VideoType:
			videos = append(videos, task)
		}
	}
	result.Agent = creationRunStats(runs)
	result.Image = creationTaskStats(images, q.Until)
	result.Video = creationTaskStats(videos, q.Until)
	result.AgentMedia = creationTaskStats(media, q.Until)
	queue := make([]int64, 0, len(direct)+len(media)+len(steps))
	for _, group := range [][]creationMetricTask{direct, media, steps} {
		for _, task := range group {
			if wait, ok := creationQueueWait(task, q.Until); ok {
				queue = append(queue, wait)
			}
		}
	}
	result.InteractiveQueue = creationLatency(queue)
	result.Truncated = runsTruncated || directTruncated || mediaTruncated || stepsTruncated
	return result, nil
}

// creationMetricRuns 读窗口内的运行和每轮第一条可见事件。可见事件按 (run_id, sequence) 主键
// 顺序找第一条命中即停，不读整条日志。
func (r *Repository) creationMetricRuns(q CreationMetricsQuery) ([]creationMetricRun, bool, error) {
	dialect := r.creationMetricsDialect()
	created := dialect.instant("r.created_at")
	feedback, args := creationEventTypeFilter("e.event_json", q.FeedbackEvents)
	query := "SELECT r.status AS status, r.created_at AS created_at, fe.created_at AS first_feedback_at" +
		" FROM cloud_agent_executions r" +
		" LEFT JOIN cloud_agent_event_records fe ON fe.run_id = r.id AND fe.sequence = (" +
		"SELECT e.sequence FROM cloud_agent_event_records e WHERE e.run_id = r.id AND " + feedback + " ORDER BY e.sequence LIMIT 1)" +
		" WHERE r.surface = ? AND " + created + " >= ? AND " + created + " < ?" +
		" ORDER BY " + created + " DESC, r.id DESC LIMIT ?"
	args = append(args, q.Surface, dialect.at(q.Since), dialect.at(q.Until), q.RowLimit+1)
	rows := []creationMetricRun{}
	if err := r.db.Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, false, err
	}
	rows, truncated := creationMetricsTrim(rows, q.RowLimit)
	return rows, truncated, nil
}

// creationMetricDirectTasks 读创作页直接生成的图片与视频任务：不属于 Agent、不属于画布，
// 来源标记写在 input_json.metadata.source。
func (r *Repository) creationMetricDirectTasks(q CreationMetricsQuery) ([]creationMetricTask, bool, error) {
	dialect := r.creationMetricsDialect()
	window, args := dialect.taskWindow(q.Since, q.Until)
	query := creationMetricTaskColumns + " FROM tasks WHERE " + window +
		" AND tasks.type IN ? AND COALESCE(tasks.agent_run_id, '') = '' AND COALESCE(tasks.project_id, '') = ''" +
		" AND " + dialect.taskSource() + " IN ?" +
		" ORDER BY " + dialect.taskCreated() + " DESC, tasks.id DESC LIMIT ?"
	args = append(args, creationMetricValues([]string{q.ImageType, q.VideoType}), creationMetricValues(q.DirectSources), q.RowLimit+1)
	return r.creationMetricTasks(query, args, q.RowLimit)
}

// creationMetricAgentMediaTasks 读创作页 Agent 提交的媒体任务（agent_run_id 指向创作页运行）。
func (r *Repository) creationMetricAgentMediaTasks(q CreationMetricsQuery) ([]creationMetricTask, bool, error) {
	dialect := r.creationMetricsDialect()
	window, args := dialect.taskWindow(q.Since, q.Until)
	query := creationMetricTaskColumns + " FROM tasks JOIN cloud_agent_executions a ON a.id = tasks.agent_run_id AND a.user_id = tasks.user_id" +
		" WHERE " + window + " AND a.surface = ? AND tasks.type IN ?" +
		" ORDER BY " + dialect.taskCreated() + " DESC, tasks.id DESC LIMIT ?"
	args = append(args, q.Surface, creationMetricValues(q.AgentMediaTypes), q.RowLimit+1)
	return r.creationMetricTasks(query, args, q.RowLimit)
}

// creationMetricModelSteps 读创作页运行的模型调用任务，只用于交互排队；只取已开始或仍在排队的。
// 现行运行的根任务是不进队列的控制面载体（不会有开始时间），因此不会混进排队样本。
func (r *Repository) creationMetricModelSteps(q CreationMetricsQuery) ([]creationMetricTask, bool, error) {
	dialect := r.creationMetricsDialect()
	window, args := dialect.taskWindow(q.Since, q.Until)
	query := creationMetricTaskColumns + " FROM tasks JOIN cloud_agent_executions a ON a.id = COALESCE(NULLIF(tasks.agent_run_id, ''), tasks.id) AND a.user_id = tasks.user_id" +
		" WHERE " + window + " AND a.surface = ? AND tasks.operation IN ? AND (tasks.started_at IS NOT NULL OR tasks.status = ?)" +
		" ORDER BY " + dialect.taskCreated() + " DESC, tasks.id DESC LIMIT ?"
	args = append(args, q.Surface, creationMetricValues(q.ModelOperations), model.TaskStatusQueued, q.RowLimit+1)
	return r.creationMetricTasks(query, args, q.RowLimit)
}

func (r *Repository) creationMetricTasks(query string, args []any, limit int) ([]creationMetricTask, bool, error) {
	rows := []creationMetricTask{}
	if err := r.db.Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, false, err
	}
	rows, truncated := creationMetricsTrim(rows, limit)
	return rows, truncated, nil
}

// creationMetricAutoRefunds 统计窗口内由自动退回释放的订单。退款写入 error、处理记录写入
// resolution_note，两者任一带自动退回备注即算，处理记录写失败的订单也不会漏计。
func (r *Repository) creationMetricAutoRefunds(q CreationMetricsQuery) (int64, error) {
	if strings.TrimSpace(q.AutoRefundNote) == "" {
		return 0, nil
	}
	dialect := r.creationMetricsDialect()
	refunded := dialect.instant("billing_orders.refunded_at")
	var count int64
	err := r.db.Model(&model.BillingOrder{}).
		Where("billing_orders.status = ? AND (billing_orders.resolution_note = ? OR billing_orders.error = ?)", model.BillingStatusRefunded, q.AutoRefundNote, q.AutoRefundNote).
		Where(refunded+" >= ? AND "+refunded+" < ?", dialect.at(q.Since), dialect.at(q.Until)).
		Count(&count).Error
	return count, err
}

// creationMetricStuckFrozen 统计任务已结束、订单却仍占着冻结积分的订单。reserved、running、
// uncertain 都还持有预留积分，任务进入终态后应已结算或退回；完成时间缺失时退回到 updated_at。
func (r *Repository) creationMetricStuckFrozen(q CreationMetricsQuery) (int64, error) {
	dialect := r.creationMetricsDialect()
	ended := dialect.instant("COALESCE(tasks.completed_at, tasks.updated_at)")
	var count int64
	err := r.db.Model(&model.BillingOrder{}).
		Joins("JOIN tasks ON tasks.id = billing_orders.task_id").
		Where("billing_orders.status IN ?", []model.BillingStatus{model.BillingStatusReserved, model.BillingStatusRunning, model.BillingStatusUncertain}).
		Where("tasks.status IN ?", []model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled}).
		Where(ended+" < ?", dialect.at(q.StuckBefore)).
		Count(&count).Error
	return count, err
}

// creationMetricsDialect 收拢时间比较与 JSON 取值的方言差异。SQLite 把 time.Time 存成带偏移的
// 文本，文本比较会在不同偏移写入的数据之间错位，只能按 unixepoch() 比较时刻（任务表用已回填的
// created_at_epoch 索引列）；PostgreSQL 直接比较 timestamptz。
type creationMetricsDialect struct {
	sqlite bool
}

func (r *Repository) creationMetricsDialect() creationMetricsDialect {
	return creationMetricsDialect{sqlite: r.db.Dialector.Name() == "sqlite"}
}

func (d creationMetricsDialect) instant(column string) string {
	if d.sqlite {
		return "unixepoch(" + column + ")"
	}
	return column
}

func (d creationMetricsDialect) at(value time.Time) any {
	if d.sqlite {
		return value.Unix()
	}
	return value.UTC()
}

func (d creationMetricsDialect) taskCreated() string {
	if d.sqlite {
		return "tasks.created_at_epoch"
	}
	return "tasks.created_at"
}

func (d creationMetricsDialect) taskWindow(since, until time.Time) (string, []any) {
	created := d.taskCreated()
	return created + " >= ? AND " + created + " < ?", []any{d.at(since), d.at(until)}
}

// taskSource 取 input_json.metadata.source。SQLite 先用 json_valid 挡掉坏行；PostgreSQL 用 json
// 而不是 jsonb，未取用字段里的 \u0000 不会让整条统计失败。任务正文都由服务端序列化写入。
func (d creationMetricsDialect) taskSource() string {
	if d.sqlite {
		return "json_extract(CASE WHEN json_valid(tasks.input_json) THEN tasks.input_json END, '$.metadata.source')"
	}
	return "(NULLIF(tasks.input_json, '')::json -> 'metadata' ->> 'source')"
}

// creationEventTypeFilter 按事件 JSON 的 "type" 字段匹配。事件正文由 encoding/json 紧凑写入，
// 这里用 LIKE 而不是 JSON 函数：两种方言写法一致，个别坏行也不会让整条统计失败。
func creationEventTypeFilter(column string, types []string) (string, []any) {
	if len(types) == 0 {
		return "1 = 0", nil
	}
	conditions := make([]string, 0, len(types))
	args := make([]any, 0, len(types))
	for _, kind := range types {
		conditions = append(conditions, column+" LIKE ? ESCAPE '\\'")
		args = append(args, `%"type":"`+escapeLike(kind)+`"%`)
	}
	return "(" + strings.Join(conditions, " OR ") + ")", args
}

// IN () 在两种方言里都不合法；空口径换成一个不会出现的值，结果为空。
func creationMetricValues(values []string) []string {
	if len(values) == 0 {
		return []string{"__creation_metrics_none__"}
	}
	return values
}

func creationMetricsTrim[T any](rows []T, limit int) ([]T, bool) {
	if len(rows) > limit {
		return rows[:limit], true
	}
	return rows, false
}

func creationRunStats(rows []creationMetricRun) CreationRunStats {
	stats := CreationRunStats{Runs: len(rows)}
	feedback := make([]int64, 0, len(rows))
	for _, row := range rows {
		switch row.Status {
		case "completed":
			stats.Completed++
		case "failed":
			stats.Failed++
		case "cancelled", "rejected":
			stats.Cancelled++
		}
		if row.FirstFeedbackAt != nil {
			feedback = append(feedback, creationDurationMs(row.CreatedAt, *row.FirstFeedbackAt))
		}
	}
	stats.Finished = stats.Completed + stats.Failed + stats.Cancelled
	stats.FailureRate = creationFailureRate(stats.Failed, stats.Finished)
	stats.FirstFeedback = creationLatency(feedback)
	return stats
}

// creationTaskStats 的总耗时只取已结束（成功、失败或取消）的任务：completed_at - created_at。
func creationTaskStats(rows []creationMetricTask, until time.Time) CreationTaskStats {
	stats := CreationTaskStats{Count: len(rows)}
	queue := make([]int64, 0, len(rows))
	total := make([]int64, 0, len(rows))
	for _, row := range rows {
		if wait, ok := creationQueueWait(row, until); ok {
			queue = append(queue, wait)
		}
		if !creationTaskTerminal(row.Status) {
			continue
		}
		stats.Finished++
		if row.Status == model.TaskStatusFailed {
			stats.Failed++
		}
		if row.CompletedAt != nil {
			total = append(total, creationDurationMs(row.CreatedAt, *row.CompletedAt))
		}
	}
	stats.FailureRate = creationFailureRate(stats.Failed, stats.Finished)
	stats.QueueWait = creationLatency(queue)
	stats.Total = creationLatency(total)
	return stats
}

// creationQueueWait 是 started_at - created_at。仍在排队、从未开始的任务按截至统计时刻的等待计入：
// 队列卡住时没有任务开始，只看已开始的任务会让排队告警永远不触发。
func creationQueueWait(task creationMetricTask, until time.Time) (int64, bool) {
	if task.StartedAt != nil {
		return creationDurationMs(task.CreatedAt, *task.StartedAt), true
	}
	if task.Status == model.TaskStatusQueued {
		return creationDurationMs(task.CreatedAt, until), true
	}
	return 0, false
}

func creationTaskTerminal(status model.TaskStatus) bool {
	return status == model.TaskStatusSucceeded || status == model.TaskStatusFailed || status == model.TaskStatusCancelled
}

// creationDurationMs 不返回负数：跨实例时钟偏差可能让开始时间略早于创建时间。
func creationDurationMs(from, to time.Time) int64 {
	return max(to.Sub(from).Milliseconds(), 0)
}

func creationFailureRate(failed, finished int) float64 {
	if finished <= 0 {
		return 0
	}
	return float64(failed) / float64(finished)
}

func creationLatency(values []int64) CreationLatency {
	if len(values) == 0 {
		return CreationLatency{}
	}
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	p50 := creationNearestRank(sorted, 50)
	p95 := creationNearestRank(sorted, 95)
	return CreationLatency{P50Ms: &p50, P95Ms: &p95, Samples: len(sorted)}
}

// creationNearestRank 取第 ceil(percent·n/100) 个样本（从 1 计），结果总是真实出现过的耗时；
// 用整数运算避免 0.95·n 的浮点误差改变秩。
func creationNearestRank(sorted []int64, percent int) int64 {
	rank := (len(sorted)*percent + 99) / 100
	rank = min(max(rank, 1), len(sorted))
	return sorted[rank-1]
}
