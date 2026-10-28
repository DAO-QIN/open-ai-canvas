package repository

import (
	"time"

	"yingce/backend/internal/model"
)

// CreditUsageRow 是一个本地自然日内、某一账单能力（image/video/audio/text）的积分消耗汇总。
// DayIndex 为 floor((UTC 秒 + 时区偏移秒) / 86400)，由调用方换算为日期。
type CreditUsageRow struct {
	DayIndex          int64
	Capability        string
	TotalMicrocredits int64
	AgentMicrocredits int64
	EntryCount        int64
	AgentEntryCount   int64
}

// 消耗只取 consume 流水：结算时写入的金额已经是最终扣费，预留差额和失败退款
// 另记 refund，不能再相减。账单和任务都是 LEFT JOIN，代理调用等无任务的消耗只计入总量。
// Agent 归属：带 agent_run_id 或 creation_submission_id 的任务，或操作名在调用方给出的
// Agent 操作列表内（口径由 app 层定义，这里只负责查询）。
const (
	creditUsageAgentCondition = "(COALESCE(t.agent_run_id, '') <> '' OR COALESCE(t.creation_submission_id, '') <> '' OR COALESCE(t.operation, '') IN ?)"
	creditUsageCapability     = "COALESCE(o.capability, '')"
	creditUsageSums           = "CAST(COALESCE(SUM(-e.amount_microcredits), 0) AS BIGINT) AS total_microcredits, " +
		"CAST(COALESCE(SUM(CASE WHEN " + creditUsageAgentCondition + " THEN -e.amount_microcredits ELSE 0 END), 0) AS BIGINT) AS agent_microcredits, " +
		"COUNT(*) AS entry_count, " +
		"CAST(COALESCE(SUM(CASE WHEN " + creditUsageAgentCondition + " THEN 1 ELSE 0 END), 0) AS BIGINT) AS agent_entry_count"
	creditUsageSource = " FROM credit_ledger_entries e" +
		" LEFT JOIN billing_orders o ON o.id = e.billing_order_id" +
		" LEFT JOIN tasks t ON t.id = o.task_id" +
		" WHERE e.user_id = ? AND e.type = ? AND e.amount_microcredits < 0 AND "
)

// CreditUsage 汇总用户在 [from, to) 内每个本地自然日、每种账单能力的积分消耗，
// 一次扫描同时支撑日趋势和类型构成；只返回有消耗的组合。
//
// SQLite 把 time.Time 存为带偏移的文本，只能用 unixepoch() 比较时刻，不能比较文本；
// PostgreSQL 直接按 created_at 范围走 (user_id, created_at) 索引。
func (r *Repository) CreditUsage(userID string, from, to time.Time, offsetSeconds int, agentOperations []string) ([]CreditUsageRow, error) {
	if len(agentOperations) == 0 {
		// IN () 在两种方言里都不合法；放一个不会出现的操作名。
		agentOperations = []string{"__no_agent_operation__"}
	}
	dayExpr := "CAST(FLOOR((EXTRACT(EPOCH FROM e.created_at) + CAST(? AS BIGINT)) / 86400) AS BIGINT)"
	rangeExpr := "e.created_at >= ? AND e.created_at < ?"
	rangeArgs := []any{from.UTC(), to.UTC()}
	if r.db.Dialector.Name() == "sqlite" {
		dayExpr = "CAST((unixepoch(e.created_at) + ?) / 86400 AS INTEGER)"
		rangeExpr = "unixepoch(e.created_at) >= ? AND unixepoch(e.created_at) < ?"
		rangeArgs = []any{from.Unix(), to.Unix()}
	}
	query := "SELECT " + dayExpr + " AS day_index, " + creditUsageCapability + " AS capability, " + creditUsageSums + creditUsageSource + rangeExpr +
		" GROUP BY day_index, " + creditUsageCapability + " ORDER BY day_index"
	args := append([]any{offsetSeconds, agentOperations, agentOperations, userID, model.CreditLedgerConsume}, rangeArgs...)
	rows := []CreditUsageRow{}
	if err := r.db.Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}
