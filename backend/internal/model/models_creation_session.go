package model

import "time"

// 首页创作会话。设计见 docs/design/home-agent.md §5。
// 与 creation_runs / creation_submissions（画布创意互动）无关。

const (
	CreationSessionSourceServer      = "server"
	CreationSessionSourceLocalImport = "local_import"
)

// 公开的 Agent 会话状态（docs/design/home-agent.md §4.3）。
const (
	CreationAgentStatusIdle      = "idle"
	CreationAgentStatusReady     = "ready"
	CreationAgentStatusRunning   = "running"
	CreationAgentStatusInput     = "input"
	CreationAgentStatusApproval  = "approval"
	CreationAgentStatusWaiting   = "waiting"
	CreationAgentStatusComposing = "composing"
	CreationAgentStatusStopped   = "stopped"
	CreationAgentStatusError     = "error"
)

const (
	CreationEntryOriginManual = "manual"
	CreationEntryOriginAgent  = "agent"
)

const (
	CreationEntryStatusPending   = "pending"
	CreationEntryStatusRunning   = "running"
	CreationEntryStatusSucceeded = "succeeded"
	CreationEntryStatusPartial   = "partial"
	CreationEntryStatusFailed    = "failed"
	CreationEntryStatusCancelled = "cancelled"
)

// CreationSession 是首页的一段对话，包含普通生成记录和 Agent 时间线。
// DeletedAt 不用 gorm.DeletedAt：自动作用域会让 SQLite → PostgreSQL 搬迁漏掉已删除行，
// 由仓储层显式过滤。
type CreationSession struct {
	ID              string     `json:"id" gorm:"primaryKey;size:36;index:idx_creation_sessions_user_updated,priority:3"`
	UserID          string     `json:"-" gorm:"size:36;not null;index:idx_creation_sessions_user_updated,priority:1"`
	Title           string     `json:"title" gorm:"size:240;not null;default:''"`
	LastMode        string     `json:"lastMode" gorm:"size:16;not null;default:''"`
	AgentStatus     string     `json:"agentStatus" gorm:"size:16;not null;default:'idle'"`
	AgentModel      string     `json:"agentModel" gorm:"size:160;not null;default:''"`
	ReasoningEffort string     `json:"reasoningEffort" gorm:"size:16;not null;default:''"`
	SkillIDsJSON    string     `json:"-" gorm:"type:text;not null;default:'[]'"`
	ActiveRunID     string     `json:"activeRunId,omitempty" gorm:"size:80;not null;default:''"`
	LastSeq         int64      `json:"lastSeq" gorm:"not null;default:0"`
	EntryCount      int        `json:"entryCount" gorm:"not null;default:0"`
	LatestEntryID   string     `json:"latestEntryId,omitempty" gorm:"size:36;not null;default:''"`
	CanvasID        string     `json:"canvasId,omitempty" gorm:"size:80;not null;default:''"`
	Source          string     `json:"source" gorm:"size:16;not null;default:'server'"`
	DeletedAt       *time.Time `json:"-" gorm:"index"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt" gorm:"index:idx_creation_sessions_user_updated,priority:2"`
}

// CreationEntry 是一次生成请求及其结果槽位。普通模式提交或 Agent 方案确认后产生。
// 参考和结果只存稳定定位符（素材 ID、存储键），不存签名 URL。
type CreationEntry struct {
	ID                  string    `json:"id" gorm:"primaryKey;size:36;index:idx_creation_entries_session_created,priority:3"`
	SessionID           string    `json:"sessionId" gorm:"size:36;not null;index:idx_creation_entries_session_created,priority:1;uniqueIndex:idx_creation_entries_proposal,priority:1"`
	UserID              string    `json:"-" gorm:"size:36;not null;index;uniqueIndex:idx_creation_entries_operation,priority:1"`
	Origin              string    `json:"origin" gorm:"size:16;not null"`
	ProposalID          *string   `json:"proposalId,omitempty" gorm:"size:160;uniqueIndex:idx_creation_entries_proposal,priority:2"`
	ClientOperationID   string    `json:"clientOperationId" gorm:"size:80;not null;uniqueIndex:idx_creation_entries_operation,priority:2"`
	RetryOf             string    `json:"retryOf,omitempty" gorm:"size:36;not null;default:''"`
	Type                string    `json:"type" gorm:"size:16;not null"`
	Prompt              string    `json:"prompt" gorm:"type:text;not null"`
	ConfigJSON          string    `json:"-" gorm:"type:text;not null;default:'{}'"`
	ReferencesJSON      string    `json:"-" gorm:"type:text;not null;default:'[]'"`
	CreditsMicrocredits int64     `json:"creditsMicrocredits" gorm:"not null;default:0"`
	Status              string    `json:"status" gorm:"size:16;not null;index"`
	ResultsJSON         string    `json:"-" gorm:"type:text;not null;default:'[]'"`
	HiddenFailed        bool      `json:"hiddenFailed" gorm:"not null;default:false"`
	Revision            int64     `json:"revision" gorm:"not null;default:1"`
	CreatedAt           time.Time `json:"createdAt" gorm:"index:idx_creation_entries_session_created,priority:2"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// CreationEntryTask 关联生成记录与任务：任务完成时按 task_id 反查记录，
// 素材删除前据此检查业务引用。
type CreationEntryTask struct {
	EntryID string `json:"entryId" gorm:"primaryKey;size:36"`
	TaskID  string `json:"taskId" gorm:"primaryKey;size:36;index"`
	Slot    int    `json:"slot" gorm:"not null"`
	UserID  string `json:"-" gorm:"size:36;not null;index"`
}

// CreationAgentEvent 是会话级公开事件，追加写入。同一条内容的后续版本沿用 ItemID，
// Position 取首次出现时的 Seq；快照只取每个 ItemID 的最新一条。
type CreationAgentEvent struct {
	SessionID string    `json:"-" gorm:"primaryKey;size:36;index:idx_creation_agent_events_item,priority:1;uniqueIndex:idx_creation_agent_events_request,priority:1"`
	Seq       int64     `json:"seq" gorm:"primaryKey;autoIncrement:false"`
	ItemID    string    `json:"id" gorm:"size:80;not null;index:idx_creation_agent_events_item,priority:2"`
	Position  int64     `json:"position" gorm:"not null"`
	Type      string    `json:"type" gorm:"size:24;not null"`
	RunID     string    `json:"-" gorm:"size:80;not null;default:''"`
	TurnID    string    `json:"turnId,omitempty" gorm:"size:80;not null;default:''"`
	RequestID *string   `json:"-" gorm:"size:80;uniqueIndex:idx_creation_agent_events_request,priority:2"`
	DataJSON  string    `json:"-" gorm:"type:text;not null"`
	UserID    string    `json:"-" gorm:"size:36;not null;index"`
	CreatedAt time.Time `json:"createdAt"`
}
