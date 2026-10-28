package app

import (
	"sort"
	"time"

	"yingce/backend/internal/model"
)

const (
	// CreditUsageWindowDays 是用量看板的统计窗口：截至今天（含）的最近 365 个自然日。
	CreditUsageWindowDays       = 365
	creditUsageMinOffsetMinutes = -12 * 60
	creditUsageMaxOffsetMinutes = 14 * 60
	creditUsageSecondsPerDay    = 86400
)

// creditUsageAgentOperations 是没有 agent_run_id / creation_submission_id、但仍属于 Agent 的任务操作：
// 云端 Agent 主任务、单步模型调用、上下文压缩与记忆压缩。引用各自的常量，改名时口径同步。
var creditUsageAgentOperations = []string{cloudAgentOperation, cloudAgentStepOperation, cloudAgentContextCompactionOperation, cloudAgentMemoryCompactOp}

// CreditUsageDay 是一个本地自然日的消耗；只返回有消耗的日期，前端按窗口补零。
type CreditUsageDay struct {
	Date              string `json:"date"`
	TotalMicrocredits int64  `json:"totalMicrocredits"`
	AgentMicrocredits int64  `json:"agentMicrocredits"`
	Count             int64  `json:"count"`
	AgentCount        int64  `json:"agentCount"`
}

// CreditUsageCategory 是窗口内按生成类型划分的消耗，capability 为 image/video/audio/text/other。
type CreditUsageCategory struct {
	Capability        string `json:"capability"`
	TotalMicrocredits int64  `json:"totalMicrocredits"`
	AgentMicrocredits int64  `json:"agentMicrocredits"`
	Count             int64  `json:"count"`
	AgentCount        int64  `json:"agentCount"`
}

// CreditUsageReport 是当前用户的用量看板数据。From/To 为含首尾的本地日期，
// TimezoneOffset 为请求使用的 UTC 偏移分钟数（东八区为 480）。
type CreditUsageReport struct {
	From           string                `json:"from"`
	To             string                `json:"to"`
	Days           int                   `json:"days"`
	TimezoneOffset int                   `json:"timezoneOffset"`
	Daily          []CreditUsageDay      `json:"daily"`
	Categories     []CreditUsageCategory `json:"categories"`
}

// CreditUsage 汇总当前用户最近 365 个自然日的积分消耗。自然日按浏览器传入的
// UTC 偏移划分，与钱包流水使用同一口径：只统计 consume 流水，不含冻结、退款和收入。
func (s *Service) CreditUsage(user *model.User, timezoneOffsetMinutes int) (*CreditUsageReport, error) {
	return s.creditUsageAt(user, timezoneOffsetMinutes, time.Now())
}

func (s *Service) creditUsageAt(user *model.User, timezoneOffsetMinutes int, now time.Time) (*CreditUsageReport, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	if timezoneOffsetMinutes < creditUsageMinOffsetMinutes || timezoneOffsetMinutes > creditUsageMaxOffsetMinutes {
		return nil, BadAuthRequest("时区偏移需在 -720 到 840 分钟之间")
	}
	offsetSeconds := timezoneOffsetMinutes * 60
	today := floorDivInt64(now.Unix()+int64(offsetSeconds), creditUsageSecondsPerDay)
	firstDay := today - (CreditUsageWindowDays - 1)
	from := time.Unix(firstDay*creditUsageSecondsPerDay-int64(offsetSeconds), 0).UTC()
	to := time.Unix((today+1)*creditUsageSecondsPerDay-int64(offsetSeconds), 0).UTC()

	rows, err := s.repo.CreditUsage(user.ID, from, to, offsetSeconds, creditUsageAgentOperations)
	if err != nil {
		return nil, err
	}

	days := map[int64]*CreditUsageDay{}
	categories := map[string]*CreditUsageCategory{}
	for _, row := range rows {
		// 窗口按时刻过滤，日序号只会落在窗口内；这里再防一次方言换算误差。
		if row.DayIndex < firstDay || row.DayIndex > today || row.TotalMicrocredits <= 0 {
			continue
		}
		day := days[row.DayIndex]
		if day == nil {
			day = &CreditUsageDay{Date: creditUsageDate(row.DayIndex)}
			days[row.DayIndex] = day
		}
		day.TotalMicrocredits += row.TotalMicrocredits
		day.AgentMicrocredits += row.AgentMicrocredits
		day.Count += row.EntryCount
		day.AgentCount += row.AgentEntryCount

		key := creditUsageCapability(row.Capability)
		category := categories[key]
		if category == nil {
			category = &CreditUsageCategory{Capability: key}
			categories[key] = category
		}
		category.TotalMicrocredits += row.TotalMicrocredits
		category.AgentMicrocredits += row.AgentMicrocredits
		category.Count += row.EntryCount
		category.AgentCount += row.AgentEntryCount
	}

	report := &CreditUsageReport{
		From:           creditUsageDate(firstDay),
		To:             creditUsageDate(today),
		Days:           CreditUsageWindowDays,
		TimezoneOffset: timezoneOffsetMinutes,
		Daily:          make([]CreditUsageDay, 0, len(days)),
		Categories:     make([]CreditUsageCategory, 0, len(categories)),
	}
	for _, day := range days {
		report.Daily = append(report.Daily, *day)
	}
	sort.Slice(report.Daily, func(i, j int) bool { return report.Daily[i].Date < report.Daily[j].Date })
	for _, category := range categories {
		report.Categories = append(report.Categories, *category)
	}
	sort.Slice(report.Categories, func(i, j int) bool {
		left, right := report.Categories[i], report.Categories[j]
		if left.TotalMicrocredits != right.TotalMicrocredits {
			return left.TotalMicrocredits > right.TotalMicrocredits
		}
		return left.Capability < right.Capability
	})
	return report, nil
}

func creditUsageCapability(capability string) string {
	switch capability {
	case "image", "video", "audio", "text":
		return capability
	default:
		return "other"
	}
}

func creditUsageDate(dayIndex int64) string {
	return time.Unix(dayIndex*creditUsageSecondsPerDay, 0).UTC().Format("2006-01-02")
}

func floorDivInt64(value, divisor int64) int64 {
	quotient := value / divisor
	if value%divisor != 0 && (value < 0) != (divisor < 0) {
		quotient--
	}
	return quotient
}
