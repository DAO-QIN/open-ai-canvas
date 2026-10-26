package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 首页创作会话的持久化。设计见 docs/design/home-agent.md §5。

var ErrCreationSessionBusy = errors.New("创作会话正在运行，请先停止后再操作")

var ErrCreationEntryOperationConflict = errors.New("该操作编号已用于其他创作会话")

// ErrCreationAgentRequestDuplicate 表示同一会话的 requestId 已写入过；调用方应返回原事件，不再开新轮次。
var ErrCreationAgentRequestDuplicate = errors.New("该消息已提交")

const (
	CreationSessionPageLimit    = 100
	CreationEntryPageLimit      = 100
	CreationAgentEventPageLimit = 500
	CreationAgentSnapshotLimit  = 100
)

// CreationPageCursor 是按 (时间, ID) 倒序翻页的游标。
type CreationPageCursor struct {
	At time.Time
	ID string
}

// CreationSessionPatch 只包含允许用户修改的会话设置；nil 表示不修改。
type CreationSessionPatch struct {
	Title           *string
	LastMode        *string
	AgentModel      *string
	ReasoningEffort *string
	SkillIDsJSON    *string
	CanvasID        *string
}

// CreationAgentEventInput 是待追加的一条公开事件。
type CreationAgentEventInput struct {
	ItemID   string
	Type     string
	RunID    string
	TurnID   string
	DataJSON string
	// RequestID 只用于用户消息去重。
	RequestID string
	// Status 非空时同步写入会话 agent_status（state 事件）。
	Status string
}

func creationPageLimit(limit, fallback, max int) int {
	if limit <= 0 {
		return fallback
	}
	if limit > max {
		return max
	}
	return limit
}

func creationPage[T any](rows []T, limit int, cursor func(T) CreationPageCursor) ([]T, *CreationPageCursor) {
	if len(rows) <= limit {
		return rows, nil
	}
	rows = rows[:limit]
	next := cursor(rows[len(rows)-1])
	return rows, &next
}

// CreateCreationSession 新建创作会话。默认值显式写入，保证返回的结构与数据库一致。
func (r *Repository) CreateCreationSession(session *model.CreationSession) error {
	if session.ID == "" || session.UserID == "" {
		return errors.New("创作会话缺少 ID 或用户")
	}
	if session.Source == "" {
		session.Source = model.CreationSessionSourceServer
	}
	if session.AgentStatus == "" {
		session.AgentStatus = model.CreationAgentStatusIdle
	}
	if session.SkillIDsJSON == "" {
		session.SkillIDsJSON = "[]"
	}
	return r.db.Create(session).Error
}

// CreationSession 读取本人未删除的会话；不存在时返回 gorm.ErrRecordNotFound。
func (r *Repository) CreationSession(userID, id string) (*model.CreationSession, error) {
	var session model.CreationSession
	if err := r.db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

// CreationSessionExists 判断 ID 是否已被占用（含已删除和其他用户），供本地历史导入去重。
func (r *Repository) CreationSessionExists(id string) (bool, error) {
	var count int64
	err := r.db.Model(&model.CreationSession{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

// ListCreationSessions 按最近活动倒序分页；返回的游标为 nil 表示已读完。
func (r *Repository) ListCreationSessions(userID string, before *CreationPageCursor, limit int) ([]model.CreationSession, *CreationPageCursor, error) {
	limit = creationPageLimit(limit, 20, CreationSessionPageLimit)
	query := r.db.Where("user_id = ? AND deleted_at IS NULL", userID)
	if before != nil {
		query = query.Where("updated_at < ? OR (updated_at = ? AND id < ?)", before.At, before.At, before.ID)
	}
	rows := []model.CreationSession{}
	if err := query.Order("updated_at DESC, id DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	rows, next := creationPage(rows, limit, func(session model.CreationSession) CreationPageCursor {
		return CreationPageCursor{At: session.UpdatedAt, ID: session.ID}
	})
	return rows, next, nil
}

// UpdateCreationSession 修改会话设置。设置变化不算创作活动，不改变列表顺序。
func (r *Repository) UpdateCreationSession(userID, id string, patch CreationSessionPatch) error {
	updates := map[string]any{}
	for column, value := range map[string]*string{
		"title":            patch.Title,
		"last_mode":        patch.LastMode,
		"agent_model":      patch.AgentModel,
		"reasoning_effort": patch.ReasoningEffort,
		"skill_ids_json":   patch.SkillIDsJSON,
		"canvas_id":        patch.CanvasID,
	} {
		if value != nil {
			updates[column] = *value
		}
	}
	if len(updates) == 0 {
		return nil
	}
	result := r.db.Model(&model.CreationSession{}).Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).UpdateColumns(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// SoftDeleteCreationSession 软删除会话，不删除任务、账务和素材。有活跃轮次时返回 ErrCreationSessionBusy。
func (r *Repository) SoftDeleteCreationSession(userID, id string, now time.Time) error {
	result := r.db.Model(&model.CreationSession{}).
		Where("id = ? AND user_id = ? AND deleted_at IS NULL AND active_run_id = ''", id, userID).
		UpdateColumn("deleted_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	if _, err := r.CreationSession(userID, id); err != nil {
		return err
	}
	return ErrCreationSessionBusy
}

// ClaimCreationSessionRun 把 runID 设为会话唯一的活跃轮次；已被其他轮次占用时返回 ErrCreationSessionBusy。
// 同一 runID 重复占用视为成功。
func (r *Repository) ClaimCreationSessionRun(userID, id, runID string) error {
	if runID == "" {
		return errors.New("轮次 ID 不能为空")
	}
	result := r.db.Model(&model.CreationSession{}).
		Where("id = ? AND user_id = ? AND deleted_at IS NULL AND (active_run_id = '' OR active_run_id = ?)", id, userID, runID).
		UpdateColumn("active_run_id", runID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	if _, err := r.CreationSession(userID, id); err != nil {
		return err
	}
	return ErrCreationSessionBusy
}

// ReleaseCreationSessionRun 只释放仍由 runID 占用的会话；已释放或被他人占用时不做任何事。
func (r *Repository) ReleaseCreationSessionRun(userID, id, runID string) error {
	return r.db.Model(&model.CreationSession{}).
		Where("id = ? AND user_id = ? AND active_run_id = ?", id, userID, runID).
		UpdateColumn("active_run_id", "").Error
}

// CreateCreationEntry 写入生成记录与任务关联，并更新会话计数和最新记录。
// 同一用户的 client_operation_id 或同一会话的 proposal_id 已存在时返回原记录与 created=false。
func (r *Repository) CreateCreationEntry(entry *model.CreationEntry, taskIDs []string) (*model.CreationEntry, bool, error) {
	if entry.ID == "" || entry.UserID == "" || entry.SessionID == "" || entry.ClientOperationID == "" {
		return nil, false, errors.New("生成记录缺少 ID、用户、会话或操作编号")
	}
	if entry.ConfigJSON == "" {
		entry.ConfigJSON = "{}"
	}
	if entry.ReferencesJSON == "" {
		entry.ReferencesJSON = "[]"
	}
	if entry.ResultsJSON == "" {
		entry.ResultsJSON = "[]"
	}
	entry.Revision = 1
	var stored *model.CreationEntry
	created := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		existing, err := findCreationEntryDuplicate(tx, entry)
		if err != nil {
			return err
		}
		if existing != nil {
			stored = existing
			return nil
		}
		update := tx.Model(&model.CreationSession{}).
			Where("id = ? AND user_id = ? AND deleted_at IS NULL", entry.SessionID, entry.UserID).
			UpdateColumns(map[string]any{"entry_count": gorm.Expr("entry_count + 1"), "latest_entry_id": entry.ID, "updated_at": time.Now()})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		if len(taskIDs) > 0 {
			links := make([]model.CreationEntryTask, 0, len(taskIDs))
			for slot, taskID := range taskIDs {
				links = append(links, model.CreationEntryTask{EntryID: entry.ID, TaskID: taskID, Slot: slot, UserID: entry.UserID})
			}
			if err := tx.Create(&links).Error; err != nil {
				return err
			}
		}
		stored, created = entry, true
		return nil
	})
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) && !errors.Is(err, ErrCreationEntryOperationConflict) {
		// 并发提交同一操作时，唯一索引让后到者失败；此时返回先到者的记录。
		if existing, findErr := findCreationEntryDuplicate(r.db, entry); findErr == nil && existing != nil {
			return existing, false, nil
		}
	}
	if err != nil {
		return nil, false, err
	}
	return stored, created, nil
}

func findCreationEntryDuplicate(db *gorm.DB, entry *model.CreationEntry) (*model.CreationEntry, error) {
	var existing model.CreationEntry
	err := db.Where("user_id = ? AND client_operation_id = ?", entry.UserID, entry.ClientOperationID).First(&existing).Error
	if err == nil {
		if existing.SessionID != entry.SessionID {
			return nil, ErrCreationEntryOperationConflict
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if entry.ProposalID == nil || *entry.ProposalID == "" {
		return nil, nil
	}
	err = db.Where("session_id = ? AND proposal_id = ? AND user_id = ?", entry.SessionID, *entry.ProposalID, entry.UserID).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return nil, err
}

// CreationEntry 读取本人的生成记录。
func (r *Repository) CreationEntry(userID, id string) (*model.CreationEntry, error) {
	var entry model.CreationEntry
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&entry).Error; err != nil {
		return nil, err
	}
	return &entry, nil
}

// ListCreationEntries 按创建时间倒序分页读取会话内的生成记录；游标为 nil 表示已读完。
func (r *Repository) ListCreationEntries(userID, sessionID string, before *CreationPageCursor, limit int) ([]model.CreationEntry, *CreationPageCursor, error) {
	limit = creationPageLimit(limit, 20, CreationEntryPageLimit)
	query := r.db.Where("session_id = ? AND user_id = ?", sessionID, userID)
	if before != nil {
		query = query.Where("created_at < ? OR (created_at = ? AND id < ?)", before.At, before.At, before.ID)
	}
	rows := []model.CreationEntry{}
	if err := query.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	rows, next := creationPage(rows, limit, func(entry model.CreationEntry) CreationPageCursor {
		return CreationPageCursor{At: entry.CreatedAt, ID: entry.ID}
	})
	return rows, next, nil
}

// CreationEntryTasks 按槽位顺序返回生成记录关联的任务。
func (r *Repository) CreationEntryTasks(userID, entryID string) ([]model.CreationEntryTask, error) {
	rows := []model.CreationEntryTask{}
	err := r.db.Where("entry_id = ? AND user_id = ?", entryID, userID).Order("slot ASC").Find(&rows).Error
	return rows, err
}

// CreationEntryLinksForTask 返回引用该任务的生成记录关联，供任务完成时回写记录状态。
func (r *Repository) CreationEntryLinksForTask(taskID string) ([]model.CreationEntryTask, error) {
	rows := []model.CreationEntryTask{}
	err := r.db.Where("task_id = ?", taskID).Order("entry_id ASC").Find(&rows).Error
	return rows, err
}

// MutateCreationEntry 以修订号做乐观并发：读取记录、交给 fn 修改、按原修订号写回。
// 只写回可变字段（状态、结果、隐藏失败、扣费汇总）；修订号已变化时返回 ErrCreationConflict，调用方重读后重试。
func (r *Repository) MutateCreationEntry(userID, id string, fn func(*model.CreationEntry) error) (*model.CreationEntry, error) {
	entry, err := r.CreationEntry(userID, id)
	if err != nil {
		return nil, err
	}
	revision := entry.Revision
	if err := fn(entry); err != nil {
		return nil, err
	}
	now := time.Now()
	result := r.db.Model(&model.CreationEntry{}).
		Where("id = ? AND user_id = ? AND revision = ?", id, userID, revision).
		UpdateColumns(map[string]any{
			"status":               entry.Status,
			"results_json":         entry.ResultsJSON,
			"hidden_failed":        entry.HiddenFailed,
			"credits_microcredits": entry.CreditsMicrocredits,
			"revision":             revision + 1,
			"updated_at":           now,
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrCreationConflict
	}
	entry.Revision = revision + 1
	entry.UpdatedAt = now
	return entry, nil
}

// AppendCreationAgentEvents 在一个事务里分配会话序号并追加公开事件。
// 同一 ItemID 沿用首次出现时的 position；任一条带的 RequestID 已存在时整批不写，
// 返回原事件与 ErrCreationAgentRequestDuplicate。
func (r *Repository) AppendCreationAgentEvents(userID, sessionID string, inputs []CreationAgentEventInput) ([]model.CreationAgentEvent, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	itemIDs := make([]string, 0, len(inputs))
	status := ""
	for _, input := range inputs {
		if input.ItemID == "" || input.Type == "" || !json.Valid([]byte(input.DataJSON)) {
			return nil, errors.New("公开事件缺少 ID、类型或有效载荷")
		}
		itemIDs = append(itemIDs, input.ItemID)
		if input.Status != "" {
			status = input.Status
		}
	}
	var appended []model.CreationAgentEvent
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if duplicate, err := findCreationAgentRequest(tx, sessionID, inputs); err != nil || duplicate != nil {
			if duplicate != nil {
				appended = []model.CreationAgentEvent{*duplicate}
				return ErrCreationAgentRequestDuplicate
			}
			return err
		}
		now := time.Now()
		updates := map[string]any{"last_seq": gorm.Expr("last_seq + ?", len(inputs)), "updated_at": now}
		if status != "" {
			updates["agent_status"] = status
		}
		result := tx.Model(&model.CreationSession{}).
			Where("id = ? AND user_id = ? AND deleted_at IS NULL", sessionID, userID).
			UpdateColumns(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		var session model.CreationSession
		if err := tx.Select("id", "last_seq").Where("id = ?", sessionID).First(&session).Error; err != nil {
			return err
		}
		positions, err := creationAgentItemPositions(tx, sessionID, itemIDs)
		if err != nil {
			return err
		}
		first := session.LastSeq - int64(len(inputs)) + 1
		rows := make([]model.CreationAgentEvent, 0, len(inputs))
		for index, input := range inputs {
			seq := first + int64(index)
			position, ok := positions[input.ItemID]
			if !ok {
				position = seq
				positions[input.ItemID] = seq
			}
			var requestID *string
			if input.RequestID != "" {
				value := input.RequestID
				requestID = &value
			}
			rows = append(rows, model.CreationAgentEvent{
				SessionID: sessionID, Seq: seq, ItemID: input.ItemID, Position: position, Type: input.Type,
				RunID: input.RunID, TurnID: input.TurnID, RequestID: requestID, DataJSON: input.DataJSON,
				UserID: userID, CreatedAt: now,
			})
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		appended = rows
		return nil
	})
	if errors.Is(err, ErrCreationAgentRequestDuplicate) {
		return appended, err
	}
	if err != nil {
		// 同一 requestId 并发提交时，唯一索引让后到者失败；此时按重复处理。
		if duplicate, findErr := findCreationAgentRequest(r.db, sessionID, inputs); findErr == nil && duplicate != nil {
			return []model.CreationAgentEvent{*duplicate}, ErrCreationAgentRequestDuplicate
		}
		return nil, err
	}
	return appended, nil
}

func findCreationAgentRequest(db *gorm.DB, sessionID string, inputs []CreationAgentEventInput) (*model.CreationAgentEvent, error) {
	for _, input := range inputs {
		if input.RequestID == "" {
			continue
		}
		var existing model.CreationAgentEvent
		err := db.Where("session_id = ? AND request_id = ?", sessionID, input.RequestID).First(&existing).Error
		if err == nil {
			return &existing, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	return nil, nil
}

func creationAgentItemPositions(db *gorm.DB, sessionID string, itemIDs []string) (map[string]int64, error) {
	var rows []struct {
		ItemID   string
		Position int64
	}
	err := db.Model(&model.CreationAgentEvent{}).
		Select("item_id, MIN(position) AS position").
		Where("session_id = ? AND item_id IN ?", sessionID, itemIDs).
		Group("item_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	positions := make(map[string]int64, len(rows))
	for _, row := range rows {
		positions[row.ItemID] = row.Position
	}
	return positions, nil
}

// CreationAgentEventsAfter 按序号升序返回 afterSeq 之后的事件，供 SSE 续读。
func (r *Repository) CreationAgentEventsAfter(userID, sessionID string, afterSeq int64, limit int) ([]model.CreationAgentEvent, error) {
	limit = creationPageLimit(limit, CreationAgentEventPageLimit, CreationAgentEventPageLimit)
	rows := []model.CreationAgentEvent{}
	err := r.db.Where("session_id = ? AND user_id = ? AND seq > ?", sessionID, userID, afterSeq).
		Order("seq ASC").Limit(limit).Find(&rows).Error
	return rows, err
}

// CreationAgentSnapshot 返回每个 ItemID 的最新版本，按 position 升序。
// beforePosition > 0 时只取更早的条目（历史分页）；hasMore 表示还有更早的条目。
func (r *Repository) CreationAgentSnapshot(userID, sessionID string, beforePosition int64, limit int) ([]model.CreationAgentEvent, bool, error) {
	limit = creationPageLimit(limit, CreationAgentSnapshotLimit, CreationAgentSnapshotLimit)
	latest := r.db.Model(&model.CreationAgentEvent{}).
		Select("item_id, MAX(seq) AS seq").
		Where("session_id = ? AND user_id = ?", sessionID, userID).
		Group("item_id")
	query := r.db.Table("creation_agent_events AS e").Select("e.*").
		Joins("JOIN (?) AS latest ON latest.item_id = e.item_id AND latest.seq = e.seq", latest).
		Where("e.session_id = ? AND e.user_id = ?", sessionID, userID)
	if beforePosition > 0 {
		query = query.Where("e.position < ?", beforePosition)
	}
	rows := []model.CreationAgentEvent{}
	if err := query.Order("e.position DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	for left, right := 0, len(rows)-1; left < right; left, right = left+1, right-1 {
		rows[left], rows[right] = rows[right], rows[left]
	}
	return rows, hasMore, nil
}

// PruneCreationAgentEventVersions 删除 olderThan 之前写入、且已被更新版本取代的中间版本。
// 只清理旧数据：在线客户端已越过这些序号，不会因此看到序号缺口；
// 很久后才续读的客户端会遇到缺口并重读快照。
func (r *Repository) PruneCreationAgentEventVersions(userID, sessionID string, olderThan time.Time) (int64, error) {
	latest := r.db.Model(&model.CreationAgentEvent{}).
		Select("MAX(seq)").
		Where("session_id = ?", sessionID).
		Group("item_id")
	result := r.db.Where("session_id = ? AND user_id = ? AND created_at < ? AND seq NOT IN (?)", sessionID, userID, olderThan, latest).
		Delete(&model.CreationAgentEvent{})
	return result.RowsAffected, result.Error
}

// AddCreationEntryTask 关联生成记录槽位与任务；同一关联已存在时视为成功。
func (r *Repository) AddCreationEntryTask(link model.CreationEntryTask) error {
	if link.EntryID == "" || link.TaskID == "" || link.UserID == "" {
		return errors.New("生成记录关联缺少记录、任务或用户")
	}
	var count int64
	if err := r.db.Model(&model.CreationEntryTask{}).Where("entry_id = ? AND task_id = ?", link.EntryID, link.TaskID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if err := r.db.Create(&link).Error; err != nil {
		// 并发写入同一关联时，后到者撞主键；确认已存在即可。
		if countErr := r.db.Model(&model.CreationEntryTask{}).Where("entry_id = ? AND task_id = ?", link.EntryID, link.TaskID).Count(&count).Error; countErr == nil && count > 0 {
			return nil
		}
		return err
	}
	return nil
}

// CreationEntryReferenceDocuments 返回未删除会话中提到任一资源 ID 的生成记录，供资源删除前的引用检查。
func (r *Repository) CreationEntryReferenceDocuments(userID string, resourceIDs []string) ([]ResourceReferenceDocument, error) {
	documents := []ResourceReferenceDocument{}
	if len(resourceIDs) == 0 {
		return documents, nil
	}
	query := r.db.Table("creation_entries AS e").
		Select("e.id, e.prompt, e.references_json, e.results_json").
		Joins("JOIN creation_sessions AS s ON s.id = e.session_id AND s.user_id = e.user_id").
		Where("e.user_id = ? AND s.deleted_at IS NULL", userID)
	if len(resourceIDs) <= 100 {
		conditions := make([]string, 0, len(resourceIDs))
		args := make([]any, 0, len(resourceIDs)*2)
		for _, resourceID := range resourceIDs {
			conditions = append(conditions, "e.references_json LIKE ? OR e.results_json LIKE ?")
			args = append(args, "%"+resourceID+"%", "%"+resourceID+"%")
		}
		query = query.Where(strings.Join(conditions, " OR "), args...)
	}
	var rows []struct {
		ID             string
		Prompt         string
		ReferencesJSON string
		ResultsJSON    string
	}
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		documents = append(documents, ResourceReferenceDocument{Kind: "首页创作记录", ID: row.ID, Title: row.Prompt, PrimaryJSON: row.ReferencesJSON, SecondaryJSON: row.ResultsJSON})
	}
	return documents, nil
}

// SetCreationSessionActivity 把会话最近活动时间改回指定值，供导入历史时保留原有排序。
func (r *Repository) SetCreationSessionActivity(userID, id string, at time.Time) error {
	return r.db.Model(&model.CreationSession{}).
		Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).
		UpdateColumn("updated_at", at).Error
}
