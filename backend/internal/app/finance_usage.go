package app

import (
	"slices"
	"sort"
	"strings"
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
// Models 是当天按 (类型, 模型) 的构成，看板查看单日、单周构成时由前端按日期区间合并。
type CreditUsageDay struct {
	Date              string                `json:"date"`
	TotalMicrocredits int64                 `json:"totalMicrocredits"`
	AgentMicrocredits int64                 `json:"agentMicrocredits"`
	Count             int64                 `json:"count"`
	AgentCount        int64                 `json:"agentCount"`
	Models            []CreditUsageDayModel `json:"models"`
}

// CreditUsageDayModel 是某个本地自然日内某个模型在某一生成类型下的消耗，键与 CreditUsageModel 相同；
// 名称只在报告顶层的 Models 里给出，不逐日重复。
type CreditUsageDayModel struct {
	Model             string `json:"model"`
	Capability        string `json:"capability"`
	TotalMicrocredits int64  `json:"totalMicrocredits"`
	AgentMicrocredits int64  `json:"agentMicrocredits"`
	Count             int64  `json:"count"`
	AgentCount        int64  `json:"agentCount"`
}

// CreditUsageCategory 是窗口内按生成类型划分的消耗，capability 为 image/video/audio/text/web_search/other。
type CreditUsageCategory struct {
	Capability        string `json:"capability"`
	TotalMicrocredits int64  `json:"totalMicrocredits"`
	AgentMicrocredits int64  `json:"agentMicrocredits"`
	Count             int64  `json:"count"`
	AgentCount        int64  `json:"agentCount"`
}

// CreditUsageModel 是窗口内某个模型在某一生成类型下的消耗。Model 是账单记录的前台模型编码
// （积分明细里显示的同一个值，不含供应渠道），Name 是该编码当前的显示名称，查不到时为空串。
type CreditUsageModel struct {
	Model             string `json:"model"`
	Name              string `json:"name"`
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
	Models         []CreditUsageModel    `json:"models"`
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
	type modelKey struct{ capability, model string }
	models := map[modelKey]*CreditUsageModel{}
	// SQL 按原始能力与编码分组，归一化（未知能力归 other、编码去空白）后同一天可能有多行落到同一个键。
	dayModels := map[int64]map[modelKey]*CreditUsageDayModel{}
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

		mk := modelKey{capability: key, model: strings.TrimSpace(row.Model)}
		usage := models[mk]
		if usage == nil {
			usage = &CreditUsageModel{Model: mk.model, Capability: key}
			models[mk] = usage
		}
		usage.TotalMicrocredits += row.TotalMicrocredits
		usage.AgentMicrocredits += row.AgentMicrocredits
		usage.Count += row.EntryCount
		usage.AgentCount += row.AgentEntryCount

		byModel := dayModels[row.DayIndex]
		if byModel == nil {
			byModel = map[modelKey]*CreditUsageDayModel{}
			dayModels[row.DayIndex] = byModel
		}
		dayUsage := byModel[mk]
		if dayUsage == nil {
			dayUsage = &CreditUsageDayModel{Model: mk.model, Capability: key}
			byModel[mk] = dayUsage
		}
		dayUsage.TotalMicrocredits += row.TotalMicrocredits
		dayUsage.AgentMicrocredits += row.AgentMicrocredits
		dayUsage.Count += row.EntryCount
		dayUsage.AgentCount += row.AgentEntryCount
	}

	codes := make([]string, 0, len(models))
	for mk := range models {
		if mk.model != "" {
			codes = append(codes, mk.model)
		}
	}
	sort.Strings(codes)
	names, err := s.repo.LogicalModelNamesByCode(slices.Compact(codes))
	if err != nil {
		return nil, err
	}

	report := &CreditUsageReport{
		From:           creditUsageDate(firstDay),
		To:             creditUsageDate(today),
		Days:           CreditUsageWindowDays,
		TimezoneOffset: timezoneOffsetMinutes,
		Daily:          make([]CreditUsageDay, 0, len(days)),
		Categories:     make([]CreditUsageCategory, 0, len(categories)),
		Models:         make([]CreditUsageModel, 0, len(models)),
	}
	for index, day := range days {
		day.Models = make([]CreditUsageDayModel, 0, len(dayModels[index]))
		for _, usage := range dayModels[index] {
			day.Models = append(day.Models, *usage)
		}
		sort.Slice(day.Models, func(i, j int) bool {
			left, right := day.Models[i], day.Models[j]
			if left.TotalMicrocredits != right.TotalMicrocredits {
				return left.TotalMicrocredits > right.TotalMicrocredits
			}
			if left.Capability != right.Capability {
				return left.Capability < right.Capability
			}
			return left.Model < right.Model
		})
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
	for _, usage := range models {
		usage.Name = names[usage.Model]
		if usage.Name == "" && usage.Model == webSearchBillingCode {
			// 联网搜索按次订单不对应前台模型，直接给出显示名称。
			usage.Name = "联网搜索"
		}
		report.Models = append(report.Models, *usage)
	}
	sort.Slice(report.Models, func(i, j int) bool {
		left, right := report.Models[i], report.Models[j]
		if left.TotalMicrocredits != right.TotalMicrocredits {
			return left.TotalMicrocredits > right.TotalMicrocredits
		}
		if left.Capability != right.Capability {
			return left.Capability < right.Capability
		}
		return left.Model < right.Model
	})
	return report, nil
}

func creditUsageCapability(capability string) string {
	switch capability {
	case "image", "video", "audio", "text", webSearchBillingCode:
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
