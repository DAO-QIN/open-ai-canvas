package app

import (
	"context"
	"fmt"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 创作体验指标：创作页（/create）用户实际感受到的首个反馈、排队与完成耗时、失败率，
// 以及冻结积分是否按时退回。只读聚合，不新增数据表；口径与告警阈值在这里定义，查询在 repository。
const (
	creationMetricsSurface       = "creation"
	creationMetricsRowLimit      = 20000
	creationMetricsQueryTimeout  = 15 * time.Second
	creationMetricsStuckAfter    = 30 * time.Minute
	creationMetricsFeedbackP95Ms = 5000
	creationMetricsQueueP95Ms    = 10000
	creationMetricsFailureRate   = 0.03
	creationMetricsMinFinished   = 20
)

// creationMetricsDirectSources 与 taskClientContext 判定创作页会话任务的来源标记一致。
var creationMetricsDirectSources = []string{"create-page", "homepage-agent", "smart-creation-agent"}

// creationMetricsFeedbackEvents 是创作页会渲染给用户的第一类 Agent 事件：助手正文（流式增量、
// 快照或整段）、已提交的生成任务、审批请求与提问。推理增量和 Pi 原始 message_delta 不在页面上显示。
var creationMetricsFeedbackEvents = []string{"assistant_delta", "assistant_snapshot", "assistant_message", "generation_task_created", "approval_requested", "user_question"}

type AdminCreationMetrics struct {
	GeneratedAt      time.Time                    `json:"generatedAt"`
	Window           string                       `json:"window"`
	Agent            repository.CreationRunStats  `json:"agent"`
	Image            repository.CreationTaskStats `json:"image"`
	Video            repository.CreationTaskStats `json:"video"`
	AgentMedia       repository.CreationTaskStats `json:"agentMedia"`
	InteractiveQueue repository.CreationLatency   `json:"interactiveQueue"`
	Refunds          AdminCreationRefunds         `json:"refunds"`
	Alerts           []CreationMetricAlert        `json:"alerts"`
	Truncated        bool                         `json:"truncated"`
}

type AdminCreationRefunds struct {
	AutoRefundEnabled bool  `json:"autoRefundEnabled"`
	AutoRefunded      int64 `json:"autoRefunded"`
	StuckFrozen       int64 `json:"stuckFrozen"`
}

// CreationMetricAlert 的 value/threshold 单位随 key：耗时为毫秒，失败率为 0-1 的比例，冻结订单为笔数。
type CreationMetricAlert struct {
	Key       string  `json:"key"`
	Level     string  `json:"level"`
	Title     string  `json:"title"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
}

func (s *Service) AdminCreationMetrics(ctx context.Context, actor *model.User, window string) (*AdminCreationMetrics, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	span, err := creationMetricsSpan(window)
	if err != nil {
		return nil, err
	}
	if window == "" {
		window = "24h"
	}
	setting, err := s.billingAutoRefundSetting()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, creationMetricsQueryTimeout)
	defer cancel()
	now := time.Now()
	metrics, err := s.repo.WithContext(ctx).CreationMetrics(repository.CreationMetricsQuery{
		Since: now.Add(-span), Until: now, StuckBefore: now.Add(-creationMetricsStuckAfter),
		Surface:         creationMetricsSurface,
		DirectSources:   creationMetricsDirectSources,
		ImageType:       "canvas_image",
		VideoType:       "canvas_video",
		AgentMediaTypes: []string{"canvas_image", "canvas_video", "canvas_audio"},
		ModelOperations: []string{cloudAgentOperation, cloudAgentStepOperation, cloudAgentContextCompactionOperation},
		FeedbackEvents:  creationMetricsFeedbackEvents,
		AutoRefundNote:  billingAutoRefundNote,
		RowLimit:        creationMetricsRowLimit,
	})
	if err != nil {
		return nil, err
	}
	result := &AdminCreationMetrics{
		GeneratedAt: now, Window: window,
		Agent: metrics.Agent, Image: metrics.Image, Video: metrics.Video, AgentMedia: metrics.AgentMedia,
		InteractiveQueue: metrics.InteractiveQueue,
		Refunds:          AdminCreationRefunds{AutoRefundEnabled: setting.Enabled, AutoRefunded: metrics.Refunds.AutoRefunded, StuckFrozen: metrics.Refunds.StuckFrozen},
		Truncated:        metrics.Truncated,
	}
	result.Alerts = creationMetricAlerts(result)
	return result, nil
}

func creationMetricsSpan(window string) (time.Duration, error) {
	switch window {
	case "", "24h":
		return 24 * time.Hour, nil
	case "7d":
		return 7 * 24 * time.Hour, nil
	default:
		return 0, BadAuthRequest("统计窗口只支持 24h 或 7d")
	}
}

// creationMetricAlerts 超过阈值为 warning，达到阈值两倍为 critical。失败率只在已结束样本不少于
// 20 时判断；冻结未退回在开启自动退回时为 critical（退回任务本该已处理），未开启时为 warning。
func creationMetricAlerts(metrics *AdminCreationMetrics) []CreationMetricAlert {
	alerts := []CreationMetricAlert{}
	if p95 := metrics.Agent.FirstFeedback.P95Ms; p95 != nil && *p95 > creationMetricsFeedbackP95Ms {
		alerts = append(alerts, creationThresholdAlert("agent_first_feedback_p95", fmt.Sprintf("自动模式首个反馈 P95 为 %.1f 秒，超过 5 秒", float64(*p95)/1000), float64(*p95), creationMetricsFeedbackP95Ms))
	}
	if p95 := metrics.InteractiveQueue.P95Ms; p95 != nil && *p95 > creationMetricsQueueP95Ms {
		alerts = append(alerts, creationThresholdAlert("interactive_queue_p95", fmt.Sprintf("交互任务排队 P95 为 %.1f 秒，超过 10 秒", float64(*p95)/1000), float64(*p95), creationMetricsQueueP95Ms))
	}
	for _, item := range []struct {
		key, label       string
		failed, finished int
		rate             float64
	}{
		{"agent_failure_rate", "自动模式", metrics.Agent.Failed, metrics.Agent.Finished, metrics.Agent.FailureRate},
		{"image_failure_rate", "图片", metrics.Image.Failed, metrics.Image.Finished, metrics.Image.FailureRate},
		{"video_failure_rate", "视频", metrics.Video.Failed, metrics.Video.Finished, metrics.Video.FailureRate},
	} {
		if item.finished < creationMetricsMinFinished || item.rate <= creationMetricsFailureRate {
			continue
		}
		title := fmt.Sprintf("%s失败率 %.1f%%（已结束 %d 个中失败 %d 个），超过 3%%", item.label, item.rate*100, item.finished, item.failed)
		alerts = append(alerts, creationThresholdAlert(item.key, title, item.rate, creationMetricsFailureRate))
	}
	if stuck := metrics.Refunds.StuckFrozen; stuck > 0 {
		alert := CreationMetricAlert{Key: "auto_refund_stuck", Level: "warning", Value: float64(stuck), Threshold: 0,
			Title: fmt.Sprintf("%d 笔订单在任务结束 30 分钟后仍冻结积分，自动退回未开启，需要人工处理", stuck)}
		if metrics.Refunds.AutoRefundEnabled {
			alert.Level = "critical"
			alert.Title = fmt.Sprintf("自动退回没有生效：%d 笔订单在任务结束 30 分钟后仍冻结积分", stuck)
		}
		alerts = append(alerts, alert)
	}
	return alerts
}

func creationThresholdAlert(key, title string, value, threshold float64) CreationMetricAlert {
	level := "warning"
	if value >= threshold*2 {
		level = "critical"
	}
	return CreationMetricAlert{Key: key, Level: level, Title: title, Value: value, Threshold: threshold}
}
