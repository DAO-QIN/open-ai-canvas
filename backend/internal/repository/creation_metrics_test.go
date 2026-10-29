package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const creationMetricsTestAutoRefundNote = "系统自动退回：已开启冻结积分自动退回"

// creationMetricsTestNow 落在东八区正午；夹具里一部分时间按 UTC 写入，一部分按 +08:00 写入，
// SQLite 必须按时刻而不是文本比较才能得到同样的结果。
var creationMetricsTestNow = time.Date(2026, 10, 29, 12, 0, 0, 0, time.FixedZone("CST", 8*3600))

func creationMetricsTestQuery(window time.Duration) CreationMetricsQuery {
	now := creationMetricsTestNow
	return CreationMetricsQuery{
		Since: now.Add(-window), Until: now, StuckBefore: now.Add(-30 * time.Minute),
		Surface:         "creation",
		DirectSources:   []string{"create-page", "homepage-agent", "smart-creation-agent"},
		ImageType:       "canvas_image",
		VideoType:       "canvas_video",
		AgentMediaTypes: []string{"canvas_image", "canvas_video", "canvas_audio"},
		ModelOperations: []string{"cloud_agent", "cloud_agent_step", "cloud_agent_context_compaction"},
		FeedbackEvents:  []string{"assistant_delta", "assistant_snapshot", "assistant_message", "generation_task_created", "approval_requested", "user_question"},
		AutoRefundNote:  creationMetricsTestAutoRefundNote,
		RowLimit:        20000,
	}
}

func TestCreationMetricsAggregatesCreationExperience(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		connection, _ := db.DB()
		t.Cleanup(func() { _ = connection.Close() })
		testCreationMetricsAggregates(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		db := openCreationMetricsPostgres(t)
		testCreationMetricsAggregates(t, db)
	})
}

func openCreationMetricsPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
	}
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("creation_metrics_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
		connection, _ := admin.DB()
		_ = connection.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), config)
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	return db
}

type creationMetricsFixtureEvent struct {
	kind    string
	after   time.Duration
	payload map[string]any
}

type creationMetricsFixture struct {
	t  *testing.T
	db *gorm.DB
}

func (f creationMetricsFixture) run(id, userID, surface, status string, createdAt time.Time, events ...creationMetricsFixtureEvent) {
	f.t.Helper()
	if err := f.db.Create(&model.CloudAgentExecution{ID: id, UserID: userID, Surface: surface, Status: status, CreatedAt: createdAt, UpdatedAt: createdAt}).Error; err != nil {
		f.t.Fatal(err)
	}
	for index, event := range events {
		at := createdAt.Add(event.after)
		// 字段顺序与 app.CloudAgentEvent 一致，正文由 encoding/json 紧凑写入。
		body, err := json.Marshal(struct {
			EventID   string         `json:"eventId"`
			RunID     string         `json:"runId"`
			Seq       int            `json:"seq"`
			Type      string         `json:"type"`
			Payload   map[string]any `json:"payload"`
			CreatedAt time.Time      `json:"createdAt"`
		}{fmt.Sprintf("%s:%d", id, index+1), id, index + 1, event.kind, event.payload, at})
		if err != nil {
			f.t.Fatal(err)
		}
		if err := f.db.Create(&model.CloudAgentEventRecord{RunID: id, Sequence: index + 1, UserID: userID, EventJSON: string(body), CreatedAt: at}).Error; err != nil {
			f.t.Fatal(err)
		}
	}
}

func (f creationMetricsFixture) task(task model.Task) {
	f.t.Helper()
	if task.UserID == "" {
		task.UserID = "user-1"
	}
	if err := f.db.Create(&task).Error; err != nil {
		f.t.Fatal(err)
	}
}

func (f creationMetricsFixture) order(order model.BillingOrder) {
	f.t.Helper()
	order.UserID = "user-1"
	order.IdempotencyKey = "creation-metrics:" + order.ID
	if err := f.db.Create(&order).Error; err != nil {
		f.t.Fatal(err)
	}
}

func creationMetricsAt(value time.Time) *time.Time {
	return &value
}

func creationMetricsDirectInput(source string) string {
	return fmt.Sprintf(`{"mode":"image","prompt":"海边的灯塔","metadata":{"source":%q,"conversationId":"conversation","messageId":"message","creationSessionId":"session"}}`, source)
}

func seedCreationMetrics(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.Task{}, &model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	now := creationMetricsTestNow
	f := creationMetricsFixture{t: t, db: db}

	// 创作页运行：首个可见事件分别是流式正文、审批请求和已提交的生成任务。
	// 推理增量、Pi 原始消息增量与上下文读数不算首个反馈。
	f.run("run-fast", "user-1", "creation", "completed", now.Add(-2*time.Hour).UTC(),
		creationMetricsFixtureEvent{kind: "context_pressure", after: 100 * time.Millisecond},
		creationMetricsFixtureEvent{kind: "reasoning_delta", after: 500 * time.Millisecond, payload: map[string]any{"text": "思考"}},
		creationMetricsFixtureEvent{kind: "message_delta", after: 700 * time.Millisecond, payload: map[string]any{"delta": "你好"}},
		creationMetricsFixtureEvent{kind: "assistant_delta", after: 1200 * time.Millisecond, payload: map[string]any{"text": "你好"}},
		creationMetricsFixtureEvent{kind: "assistant_message", after: 3 * time.Second, payload: map[string]any{"text": "你好，开始创作"}},
	)
	f.run("run-approval", "user-1", "creation", "failed", now.Add(-3*time.Hour),
		creationMetricsFixtureEvent{kind: "plan_updated", after: 200 * time.Millisecond, payload: map[string]any{"ops": []any{map[string]any{"type": "add_node"}}}},
		creationMetricsFixtureEvent{kind: "tool_completed", after: time.Second, payload: map[string]any{"result": map[string]any{"type": "assistant_delta_preview"}}},
		creationMetricsFixtureEvent{kind: "approval_requested", after: 4 * time.Second, payload: map[string]any{"approvalId": "approval"}},
	)
	f.run("run-silent", "user-1", "creation", "cancelled", now.Add(-time.Hour),
		creationMetricsFixtureEvent{kind: "context_pressure", after: 100 * time.Millisecond},
	)
	f.run("run-rejected", "user-1", "creation", "rejected", now.Add(-50*time.Minute))
	f.run("run-live", "user-1", "creation", "running", now.Add(-30*time.Minute),
		creationMetricsFixtureEvent{kind: "generation_task_created", after: 2500 * time.Millisecond, payload: map[string]any{"taskId": "media"}},
	)
	f.run("run-canvas", "user-1", "canvas", "completed", now.Add(-time.Hour),
		creationMetricsFixtureEvent{kind: "assistant_delta", after: 100 * time.Millisecond},
	)
	f.run("run-old", "user-1", "creation", "completed", now.Add(-30*time.Hour),
		creationMetricsFixtureEvent{kind: "user_question", after: 9 * time.Second},
	)
	f.run("run-future", "user-1", "creation", "completed", now.Add(time.Hour))

	// 创作页直接生成：只有 project_id、agent_run_id 为空且来源标记属于创作页的任务计入。
	imageOK := now.Add(-2 * time.Hour).UTC()
	f.task(model.Task{ID: "img-ok", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: imageOK, StartedAt: creationMetricsAt(imageOK.Add(500 * time.Millisecond)), CompletedAt: creationMetricsAt(imageOK.Add(10 * time.Second))})
	imageFailed := now.Add(-90 * time.Minute)
	f.task(model.Task{ID: "img-failed", Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: imageFailed, StartedAt: creationMetricsAt(imageFailed.Add(time.Second)), CompletedAt: creationMetricsAt(imageFailed.Add(3 * time.Second))})
	f.task(model.Task{ID: "img-waiting", Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: now.Add(-10 * time.Minute)})
	imageHome := now.Add(-time.Hour)
	f.task(model.Task{ID: "img-homepage", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("homepage-agent"), CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(2 * time.Second)), CompletedAt: creationMetricsAt(imageHome.Add(20 * time.Second))})
	f.task(model.Task{ID: "img-canvas", ProjectID: "canvas-1", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(100 * time.Millisecond)), CompletedAt: creationMetricsAt(imageHome.Add(time.Second))})
	f.task(model.Task{ID: "img-workbench", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("workbench"), CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(100 * time.Millisecond)), CompletedAt: creationMetricsAt(imageHome.Add(time.Second))})
	f.task(model.Task{ID: "text-direct", Type: "canvas_text", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(100 * time.Millisecond)), CompletedAt: creationMetricsAt(imageHome.Add(time.Second))})
	imageOld := now.Add(-48 * time.Hour)
	f.task(model.Task{ID: "img-old", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: imageOld, StartedAt: creationMetricsAt(imageOld.Add(time.Second)), CompletedAt: creationMetricsAt(imageOld.Add(5 * time.Second))})
	if db.Dialector.Name() == "sqlite" {
		// SQLite 先校验 JSON，坏行只会被排除，不会让整条统计失败。
		f.task(model.Task{ID: "img-bad-json", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: "{not json", CreatedAt: imageHome})
	}
	videoOK := now.Add(-3 * time.Hour)
	f.task(model.Task{ID: "vid-ok", Type: "canvas_video", Status: model.TaskStatusSucceeded, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: videoOK, StartedAt: creationMetricsAt(videoOK.Add(3 * time.Second)), CompletedAt: creationMetricsAt(videoOK.Add(time.Minute))})
	videoCancelled := now.Add(-2 * time.Hour)
	f.task(model.Task{ID: "vid-cancelled", Type: "canvas_video", Status: model.TaskStatusCancelled, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: videoCancelled, CompletedAt: creationMetricsAt(videoCancelled.Add(5 * time.Second))})

	// 创作页 Agent 提交的媒体任务；画布运行与其他账号的同名运行不计入。
	mediaImage := now.Add(-2 * time.Hour).Add(2 * time.Second)
	f.task(model.Task{ID: "media-img", AgentRunID: "run-fast", Type: "canvas_image", Status: model.TaskStatusSucceeded, CreatedAt: mediaImage, StartedAt: creationMetricsAt(mediaImage.Add(time.Second)), CompletedAt: creationMetricsAt(mediaImage.Add(15 * time.Second))})
	mediaVideo := now.Add(-3 * time.Hour).Add(5 * time.Second)
	f.task(model.Task{ID: "media-vid", AgentRunID: "run-approval", Type: "canvas_video", Status: model.TaskStatusFailed, CreatedAt: mediaVideo, StartedAt: creationMetricsAt(mediaVideo.Add(4 * time.Second)), CompletedAt: creationMetricsAt(mediaVideo.Add(8 * time.Second))})
	f.task(model.Task{ID: "media-canvas", AgentRunID: "run-canvas", Type: "canvas_image", Status: model.TaskStatusSucceeded, CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(100 * time.Millisecond)), CompletedAt: creationMetricsAt(imageHome.Add(time.Second))})
	f.task(model.Task{ID: "media-foreign", UserID: "user-2", AgentRunID: "run-fast", Type: "canvas_image", Status: model.TaskStatusSucceeded, CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(100 * time.Millisecond)), CompletedAt: creationMetricsAt(imageHome.Add(time.Second))})

	// 模型调用：现行根任务是不进队列的控制面载体；旧版根任务按 ID 关联运行；步骤按 agent_run_id 关联。
	f.task(model.Task{ID: "run-fast", Type: "canvas_text", Operation: "cloud_agent", Status: model.TaskStatusTextReplay, CreatedAt: now.Add(-2 * time.Hour)})
	rootApproval := now.Add(-3 * time.Hour)
	f.task(model.Task{ID: "run-approval", Type: "canvas_text", Operation: "cloud_agent", Status: model.TaskStatusSucceeded, CreatedAt: rootApproval, StartedAt: creationMetricsAt(rootApproval.Add(2 * time.Second)), CompletedAt: creationMetricsAt(rootApproval.Add(3 * time.Second))})
	stepFast := now.Add(-2 * time.Hour).Add(100 * time.Millisecond)
	f.task(model.Task{ID: "step-fast", AgentRunID: "run-fast", Type: "canvas_text", Operation: "cloud_agent_step", Status: model.TaskStatusSucceeded, CreatedAt: stepFast, StartedAt: creationMetricsAt(stepFast.Add(300 * time.Millisecond)), CompletedAt: creationMetricsAt(stepFast.Add(2 * time.Second))})
	compaction := now.Add(-3 * time.Hour).Add(time.Second)
	f.task(model.Task{ID: "compact-approval", AgentRunID: "run-approval", Type: "canvas_text", Operation: "cloud_agent_context_compaction", Status: model.TaskStatusSucceeded, CreatedAt: compaction, StartedAt: creationMetricsAt(compaction.Add(900 * time.Millisecond)), CompletedAt: creationMetricsAt(compaction.Add(2 * time.Second))})
	f.task(model.Task{ID: "step-queued", AgentRunID: "run-live", Type: "canvas_text", Operation: "cloud_agent_step", Status: model.TaskStatusQueued, CreatedAt: now.Add(-time.Minute)})
	f.task(model.Task{ID: "step-canvas", AgentRunID: "run-canvas", Type: "canvas_text", Operation: "cloud_agent_step", Status: model.TaskStatusSucceeded, CreatedAt: imageHome, StartedAt: creationMetricsAt(imageHome.Add(time.Minute)), CompletedAt: creationMetricsAt(imageHome.Add(2 * time.Minute))})

	// 积分退回：自动退回按备注识别（处理记录写失败时退款 error 里仍有备注）。
	f.order(model.BillingOrder{ID: "order-auto", Status: model.BillingStatusRefunded, Error: creationMetricsTestAutoRefundNote, ResolutionNote: creationMetricsTestAutoRefundNote, RefundedAt: creationMetricsAt(now.Add(-time.Hour).UTC())})
	f.order(model.BillingOrder{ID: "order-auto-unrecorded", Status: model.BillingStatusRefunded, Error: creationMetricsTestAutoRefundNote, RefundedAt: creationMetricsAt(now.Add(-2 * time.Hour))})
	f.order(model.BillingOrder{ID: "order-auto-old", Status: model.BillingStatusRefunded, Error: creationMetricsTestAutoRefundNote, ResolutionNote: creationMetricsTestAutoRefundNote, RefundedAt: creationMetricsAt(now.Add(-30 * time.Hour))})
	f.order(model.BillingOrder{ID: "order-manual", Status: model.BillingStatusRefunded, Error: "任务失败", ResolutionNote: "管理员人工退回", RefundedAt: creationMetricsAt(now.Add(-time.Hour))})

	// 冻结未退回：任务结束超过 30 分钟，订单仍是 reserved、running 或 uncertain。
	for _, item := range []struct {
		taskID      string
		taskStatus  model.TaskStatus
		completedAt *time.Time
		orderID     string
		orderStatus model.BillingStatus
	}{
		{"bill-failed-old", model.TaskStatusFailed, creationMetricsAt(now.Add(-45 * time.Minute).UTC()), "order-stuck-reserved", model.BillingStatusReserved},
		{"bill-succeeded-old", model.TaskStatusSucceeded, creationMetricsAt(now.Add(-2 * time.Hour)), "order-stuck-uncertain", model.BillingStatusUncertain},
		{"bill-cancelled-old", model.TaskStatusCancelled, creationMetricsAt(now.Add(-time.Hour)), "order-stuck-running", model.BillingStatusRunning},
		{"bill-failed-recent", model.TaskStatusFailed, creationMetricsAt(now.Add(-10 * time.Minute)), "order-recent", model.BillingStatusReserved},
		{"bill-running", model.TaskStatusRunning, nil, "order-live", model.BillingStatusReserved},
		{"bill-settled", model.TaskStatusSucceeded, creationMetricsAt(now.Add(-3 * time.Hour)), "order-settled", model.BillingStatusSettled},
	} {
		f.task(model.Task{ID: item.taskID, ProjectID: "billing-canvas", Type: "canvas_text", Status: item.taskStatus, CreatedAt: now.Add(-4 * time.Hour), CompletedAt: item.completedAt, BillingOrderID: item.orderID})
		f.order(model.BillingOrder{ID: item.orderID, TaskID: item.taskID, Status: item.orderStatus})
	}
}

func testCreationMetricsAggregates(t *testing.T, db *gorm.DB) {
	seedCreationMetrics(t, db)
	repo := New(db)

	day, err := repo.CreationMetrics(creationMetricsTestQuery(24 * time.Hour))
	if err != nil {
		t.Fatalf("CreationMetrics(24h) error = %v", err)
	}
	if day.Truncated {
		t.Fatal("24h metrics unexpectedly truncated")
	}
	// 5 轮在窗口内：画布运行、窗口外与未来的运行都不计；拒绝审批计入取消；进行中的不进失败率分母。
	agent := day.Agent
	if agent.Runs != 5 || agent.Completed != 1 || agent.Failed != 1 || agent.Cancelled != 2 || agent.Finished != 4 || agent.FailureRate != 0.25 {
		t.Fatalf("agent = %+v", agent)
	}
	// 首个反馈：1.2s（流式正文）、4.0s（审批）、2.5s（生成任务）；没有可见事件的两轮不进样本。
	assertCreationLatency(t, "agent.firstFeedback", agent.FirstFeedback, 3, 2500, 4000)

	image := day.Image
	if image.Count != 4 || image.Finished != 3 || image.Failed != 1 || image.FailureRate != 1.0/3 {
		t.Fatalf("image = %+v", image)
	}
	// 排队：0.5s、1s、2s 与仍在排队 10 分钟的任务；总耗时只取已结束的 3s、10s、20s。
	assertCreationLatency(t, "image.queueWait", image.QueueWait, 4, 1000, 600000)
	assertCreationLatency(t, "image.total", image.Total, 3, 10000, 20000)

	video := day.Video
	if video.Count != 2 || video.Finished != 2 || video.Failed != 0 || video.FailureRate != 0 {
		t.Fatalf("video = %+v", video)
	}
	assertCreationLatency(t, "video.queueWait", video.QueueWait, 1, 3000, 3000)
	assertCreationLatency(t, "video.total", video.Total, 2, 5000, 60000)

	media := day.AgentMedia
	if media.Count != 2 || media.Finished != 2 || media.Failed != 1 || media.FailureRate != 0.5 {
		t.Fatalf("agentMedia = %+v", media)
	}
	assertCreationLatency(t, "agentMedia.queueWait", media.QueueWait, 2, 1000, 4000)
	assertCreationLatency(t, "agentMedia.total", media.Total, 2, 8000, 15000)

	// 交互排队合并直接生成、Agent 媒体与模型调用：
	// 300, 500, 900, 1000, 1000, 2000, 2000, 3000, 4000, 60000（排队中的步骤）, 600000（排队中的图片）。
	assertCreationLatency(t, "interactiveQueue", day.InteractiveQueue, 11, 2000, 600000)

	if day.Refunds.AutoRefunded != 2 || day.Refunds.StuckFrozen != 3 {
		t.Fatalf("refunds = %+v", day.Refunds)
	}

	week, err := repo.CreationMetrics(creationMetricsTestQuery(7 * 24 * time.Hour))
	if err != nil {
		t.Fatalf("CreationMetrics(7d) error = %v", err)
	}
	if week.Agent.Runs != 6 || week.Agent.Completed != 2 || week.Agent.Finished != 5 || week.Agent.FailureRate != 0.2 {
		t.Fatalf("7d agent = %+v", week.Agent)
	}
	assertCreationLatency(t, "7d agent.firstFeedback", week.Agent.FirstFeedback, 4, 2500, 9000)
	if week.Image.Count != 5 || week.Image.Finished != 4 {
		t.Fatalf("7d image = %+v", week.Image)
	}
	if week.Refunds.AutoRefunded != 3 || week.Refunds.StuckFrozen != 3 {
		t.Fatalf("7d refunds = %+v", week.Refunds)
	}
}

func assertCreationLatency(t *testing.T, name string, got CreationLatency, samples int, p50, p95 int64) {
	t.Helper()
	if got.Samples != samples || got.P50Ms == nil || got.P95Ms == nil || *got.P50Ms != p50 || *got.P95Ms != p95 {
		t.Fatalf("%s = samples:%d p50:%v p95:%v, want samples:%d p50:%d p95:%d", name, got.Samples, creationMetricsValue(got.P50Ms), creationMetricsValue(got.P95Ms), samples, p50, p95)
	}
}

func creationMetricsValue(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func TestCreationMetricsTruncatesToRecentRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.Task{}, &model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	f := creationMetricsFixture{t: t, db: db}
	now := creationMetricsTestNow
	for index, status := range []model.TaskStatus{model.TaskStatusFailed, model.TaskStatusSucceeded, model.TaskStatusSucceeded} {
		createdAt := now.Add(-time.Duration(3-index) * time.Hour)
		f.task(model.Task{ID: fmt.Sprintf("img-%d", index), Type: "canvas_image", Status: status, InputJSON: creationMetricsDirectInput("create-page"), CreatedAt: createdAt, StartedAt: creationMetricsAt(createdAt.Add(time.Second)), CompletedAt: creationMetricsAt(createdAt.Add(2 * time.Second))})
	}
	query := creationMetricsTestQuery(24 * time.Hour)
	query.RowLimit = 2
	metrics, err := New(db).CreationMetrics(query)
	if err != nil {
		t.Fatal(err)
	}
	// 超出上限时保留最近的两条（都成功），最早那条失败任务不再参与统计。
	if !metrics.Truncated || metrics.Image.Count != 2 || metrics.Image.Failed != 0 {
		t.Fatalf("truncated metrics = %+v truncated=%v", metrics.Image, metrics.Truncated)
	}
	query.RowLimit = 0
	if _, err := New(db).CreationMetrics(query); err == nil {
		t.Fatal("zero row limit must be rejected")
	}
}

func TestCreationLatencyUsesNearestRank(t *testing.T) {
	if empty := creationLatency(nil); empty.Samples != 0 || empty.P50Ms != nil || empty.P95Ms != nil {
		t.Fatalf("empty latency = %+v", empty)
	}
	single := creationLatency([]int64{7})
	if single.Samples != 1 || *single.P50Ms != 7 || *single.P95Ms != 7 {
		t.Fatalf("single latency = %+v", single)
	}
	for _, n := range []int{20, 100} {
		values := make([]int64, n)
		for index := range values {
			values[index] = int64(index + 1)
		}
		rand.New(rand.NewSource(int64(n))).Shuffle(len(values), func(i, j int) { values[i], values[j] = values[j], values[i] })
		before := slices.Clone(values)
		latency := creationLatency(values)
		wantP50, wantP95 := int64(n/2), int64(n*95/100)
		if latency.Samples != n || *latency.P50Ms != wantP50 || *latency.P95Ms != wantP95 {
			t.Fatalf("n=%d latency p50=%d p95=%d, want %d %d", n, *latency.P50Ms, *latency.P95Ms, wantP50, wantP95)
		}
		if !slices.Equal(before, values) {
			t.Fatalf("n=%d creationLatency reordered its input", n)
		}
	}
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	if got := creationDurationMs(start, start.Add(-time.Second)); got != 0 {
		t.Fatalf("negative duration = %d, want 0", got)
	}
	if got := creationFailureRate(1, 0); got != 0 {
		t.Fatalf("failure rate without finished samples = %v", got)
	}
}

// PostgreSQL 的 SQL 不能用 SQLite 专用的 unixepoch/json_extract/created_at_epoch，
// 时间直接比较 timestamptz，来源标记用 json 运算符读取。
func TestCreationMetricsPostgresSQLUsesInstantComparisons(t *testing.T) {
	capture := &sqlCaptureLogger{}
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  "host=localhost user=test dbname=test sslmode=disable",
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableAutomaticPing:   true,
		DryRun:                 true,
		Logger:                 capture,
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Fatalf("open dry-run postgres database: %v", err)
	}
	repo := New(db)
	query := creationMetricsTestQuery(24 * time.Hour)
	calls := []func() error{
		func() error { _, _, err := repo.creationMetricRuns(query); return err },
		func() error { _, _, err := repo.creationMetricDirectTasks(query); return err },
		func() error { _, _, err := repo.creationMetricAgentMediaTasks(query); return err },
		func() error { _, _, err := repo.creationMetricModelSteps(query); return err },
		func() error { _, err := repo.creationMetricAutoRefunds(query); return err },
		func() error { _, err := repo.creationMetricStuckFrozen(query); return err },
	}
	for index, call := range calls {
		if err := call(); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
			t.Fatalf("query %d error = %v", index, err)
		}
	}
	if len(capture.statements) != len(calls) {
		t.Fatalf("statements = %d, want %d:\n%s", len(capture.statements), len(calls), strings.Join(capture.statements, "\n"))
	}
	for _, statement := range capture.statements {
		for _, forbidden := range []string{"unixepoch", "json_extract", "json_valid", "created_at_epoch"} {
			if strings.Contains(statement, forbidden) {
				t.Fatalf("postgres SQL must not use %s:\n%s", forbidden, statement)
			}
		}
	}
	runs, direct, steps, stuck := capture.statements[0], capture.statements[1], capture.statements[3], capture.statements[5]
	for _, want := range []string{"LEFT JOIN cloud_agent_event_records fe", "ORDER BY e.sequence LIMIT 1", "LIKE", "ESCAPE", "r.surface = 'creation'", "r.created_at >= '2026-10-28 04:00:00", "ORDER BY r.created_at DESC"} {
		if !strings.Contains(runs, want) {
			t.Fatalf("runs SQL missing %q:\n%s", want, runs)
		}
	}
	for _, want := range []string{"(NULLIF(tasks.input_json, '')::json -> 'metadata' ->> 'source') IN ('create-page','homepage-agent','smart-creation-agent')", "tasks.created_at >= '2026-10-28 04:00:00", "tasks.type IN ('canvas_image','canvas_video')"} {
		if !strings.Contains(direct, want) {
			t.Fatalf("direct SQL missing %q:\n%s", want, direct)
		}
	}
	if !strings.Contains(steps, "COALESCE(NULLIF(tasks.agent_run_id, ''), tasks.id)") || !strings.Contains(steps, "tasks.operation IN ('cloud_agent','cloud_agent_step','cloud_agent_context_compaction')") {
		t.Fatalf("model step SQL:\n%s", steps)
	}
	if !strings.Contains(stuck, "COALESCE(tasks.completed_at, tasks.updated_at) < '2026-10-29 03:30:00") || !strings.Contains(stuck, "billing_orders.status IN ('reserved','running','uncertain')") {
		t.Fatalf("stuck SQL:\n%s", stuck)
	}
}
