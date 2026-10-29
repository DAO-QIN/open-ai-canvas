package repository

import (
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

// 领取顺序：交互任务优先、普通任务排队老化、单用户执行中上限与兜底领取。
// SQLite 必跑；设置 CANVAS_TEST_POSTGRES_DSN 时，同一组场景在隔离 schema 的 PostgreSQL 上再跑一遍。

// claimTestUserCap 对应生产默认 3 个 worker 时调度器传入的上限 ceil(3/2)。
const claimTestUserCap = 2

func forEachTaskClaimDatabase(t *testing.T, run func(t *testing.T, repo *Repository, db *gorm.DB)) {
	t.Helper()
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), config)
		if err != nil {
			t.Fatal(err)
		}
		connection, _ := db.DB()
		t.Cleanup(func() { _ = connection.Close() })
		if err := db.AutoMigrate(&model.Task{}); err != nil {
			t.Fatal(err)
		}
		run(t, New(db), db)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("task_claim_%d", time.Now().UnixNano())
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
		if err := db.AutoMigrate(&model.Task{}); err != nil {
			t.Fatal(err)
		}
		run(t, New(db), db)
	})
}

func createClaimTestTasks(t *testing.T, db *gorm.DB, tasks ...model.Task) {
	t.Helper()
	for index := range tasks {
		if err := db.Create(&tasks[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
}

// claimTestRunningTasks 生成 count 个持有有效租约的执行中任务，模拟该用户已占用的 worker。
func claimTestRunningTasks(userID string, count int, now time.Time) []model.Task {
	tasks := make([]model.Task, 0, count)
	for index := range count {
		tasks = append(tasks, model.Task{
			ID: fmt.Sprintf("%s-running-%d", userID, index), UserID: userID, Type: "canvas_video", Operation: "text_to_video",
			Status: model.TaskStatusRunning, LeaseOwner: fmt.Sprintf("worker-busy-%d", index), LeaseExpiresAt: ptrTime(now.Add(time.Minute)),
			CreatedAt: now.Add(-5 * time.Minute),
		})
	}
	return tasks
}

// assertClaimOrder 反复领取直到没有可领取任务，核对领取顺序；每次领取使用独立 owner，与调度器一致。
func assertClaimOrder(t *testing.T, repo *Repository, options []TaskClaimOptions, want ...string) {
	t.Helper()
	got := make([]string, 0, len(want))
	for attempt := 0; attempt <= len(want); attempt++ {
		owner := fmt.Sprintf("worker-test:%d", attempt)
		claimed, err := repo.ClaimNextTask(owner, time.Minute, options...)
		if err != nil {
			t.Fatal(err)
		}
		if claimed == nil {
			break
		}
		if claimed.Status != model.TaskStatusRunning || claimed.LeaseOwner != owner || claimed.LeaseExpiresAt == nil {
			t.Fatalf("claimed task %s is not leased to %s: %+v", claimed.ID, owner, claimed)
		}
		got = append(got, claimed.ID)
	}
	if !slices.Equal(got, want) {
		t.Fatalf("claim order = %v, want %v", got, want)
	}
}

// 交互任务（Agent 模型调用、创作页直接生成、Agent 对话内的媒体）即使更晚创建，也先于更早排队的普通任务。
func TestClaimNextTaskPrefersNewerInteractiveTask(t *testing.T) {
	submissionID := "creation-submission"
	for _, tc := range []struct {
		name string
		task model.Task
	}{
		{"agent-root", model.Task{Type: "canvas_text", Operation: "cloud_agent"}},
		{"agent-step", model.Task{Type: "canvas_text", Operation: "cloud_agent_step"}},
		{"context-compaction", model.Task{Type: "canvas_text", Operation: "cloud_agent_context_compaction"}},
		{"creation-submission", model.Task{Type: "canvas_image", Operation: "text_to_image", CreationSubmissionID: &submissionID}},
		{"agent-run-media", model.Task{Type: "canvas_video", Operation: "text_to_video", AgentRunID: "agent-run"}},
		// 创作页直接生成走 POST /tasks：没有项目、没有工作台，来源只在 input_json 里。
		{"creation-page-direct", model.Task{Type: "canvas_image", Operation: "text_to_image"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
				now := time.Now()
				interactive := tc.task
				interactive.ID, interactive.UserID, interactive.Status, interactive.CreatedAt = "interactive-newer", "user-a", model.TaskStatusQueued, now.Add(-5*time.Second)
				createClaimTestTasks(t, db,
					model.Task{ID: "canvas-older", UserID: "user-a", ProjectID: "canvas-1", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-45 * time.Second)},
					interactive,
				)
				assertClaimOrder(t, repo, []TaskClaimOptions{{UserRunningCap: claimTestUserCap}}, "interactive-newer", "canvas-older")
			})
		})
	}
}

// 普通任务排队满 60 秒后与交互任务同级，同级按创建时间先后，因此不再排在更新的交互任务之后；
// 未满 60 秒的普通任务仍排在交互任务之后。
func TestClaimNextTaskAgesWaitingNormalTask(t *testing.T) {
	forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
		now := time.Now()
		createClaimTestTasks(t, db,
			model.Task{ID: "agent-step-newer", UserID: "user-a", Type: "canvas_text", Operation: "cloud_agent_step", Status: model.TaskStatusQueued, CreatedAt: now.Add(-5 * time.Second)},
			model.Task{ID: "canvas-waited-30s", UserID: "user-a", ProjectID: "canvas-1", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-30 * time.Second)},
			model.Task{ID: "canvas-waited-61s", UserID: "user-a", ProjectID: "canvas-1", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-61 * time.Second)},
		)
		assertClaimOrder(t, repo, nil, "canvas-waited-61s", "agent-step-newer", "canvas-waited-30s")
	})
}

// 工作台任务和没有用户在等的后台任务（Agent 记忆整理）即使没有项目归属，也按普通级排队。
func TestClaimNextTaskKeepsWorkbenchAndBackgroundTasksNormal(t *testing.T) {
	forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
		now := time.Now()
		createClaimTestTasks(t, db,
			model.Task{ID: "workbench-older", UserID: "user-a", WorkbenchKind: "image", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-40 * time.Second)},
			model.Task{ID: "memory-compact-older", UserID: "user-a", Type: "canvas_text", Operation: "agent_memory_compact", Status: model.TaskStatusQueued, CreatedAt: now.Add(-30 * time.Second)},
			model.Task{ID: "creation-direct-newer", UserID: "user-a", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-5 * time.Second)},
		)
		assertClaimOrder(t, repo, nil, "creation-direct-newer", "workbench-older", "memory-compact-older")
	})
}

// 用户 A 已有 cap 个持有有效租约的执行中任务：A 更早排队的任务先让给 B；只剩 A 的任务时仍然领取。
func TestClaimNextTaskUserRunningCapPrefersOtherUsers(t *testing.T) {
	forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
		now := time.Now()
		tasks := claimTestRunningTasks("user-a", claimTestUserCap, now)
		tasks = append(tasks,
			model.Task{ID: "a-queued-older", UserID: "user-a", ProjectID: "canvas-a", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-20 * time.Second)},
			model.Task{ID: "b-queued-newer", UserID: "user-b", ProjectID: "canvas-b", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-10 * time.Second)},
		)
		createClaimTestTasks(t, db, tasks...)
		// 第二次领取时只剩 A 的任务且 A 仍在上限：不带上限的兜底仍领取它，worker 不空等。
		assertClaimOrder(t, repo, []TaskClaimOptions{{UserRunningCap: claimTestUserCap}}, "b-queued-newer", "a-queued-older")
	})
}

// 只有持有有效租约的执行中任务计入上限：转入上游回查（已释放租约）与租约过期的任务都不占名额。
func TestClaimNextTaskUserRunningCapCountsOnlyLiveLeases(t *testing.T) {
	forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
		now := time.Now()
		createClaimTestTasks(t, db,
			model.Task{ID: "a-running", UserID: "user-a", Type: "canvas_video", Operation: "text_to_video", Status: model.TaskStatusRunning, LeaseOwner: "worker-busy", LeaseExpiresAt: ptrTime(now.Add(time.Minute)), CreatedAt: now.Add(-5 * time.Minute)},
			model.Task{ID: "a-provider-poll", UserID: "user-a", Type: "canvas_video", Operation: "text_to_video", Status: model.TaskStatusRunning, NextPollAt: ptrTime(now.Add(time.Minute)), CreatedAt: now.Add(-4 * time.Minute)},
			model.Task{ID: "a-lease-expired", UserID: "user-a", ProjectID: "canvas-a", Type: "canvas_video", Operation: "text_to_video", Status: model.TaskStatusRunning, LeaseOwner: "worker-gone", LeaseExpiresAt: ptrTime(now.Add(-time.Second)), CreatedAt: now.Add(-3 * time.Minute)},
			model.Task{ID: "a-queued", UserID: "user-a", ProjectID: "canvas-a", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-20 * time.Second)},
			model.Task{ID: "b-queued", UserID: "user-b", ProjectID: "canvas-b", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-10 * time.Second)},
		)
		// A 起初只有 1 个有效租约，未达上限：过期任务已排队老化，先被重新领取；之后 A 达到上限，B 先于 A 的排队任务。
		assertClaimOrder(t, repo, []TaskClaimOptions{{UserRunningCap: claimTestUserCap}}, "a-lease-expired", "b-queued", "a-queued")
	})
}

// Agent 模型调用不受单用户上限约束：A 已达上限时，A 的 Agent 模型调用仍按优先级和创建时间领取；
// A 的其他交互任务（创作页直接生成）照常让给 B，最后由兜底领取。
func TestClaimNextTaskAgentModelStepIgnoresUserRunningCap(t *testing.T) {
	for _, operation := range []string{"cloud_agent", "cloud_agent_step", "cloud_agent_context_compaction"} {
		t.Run(operation, func(t *testing.T) {
			forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
				now := time.Now()
				submissionID := "creation-submission"
				tasks := claimTestRunningTasks("user-a", claimTestUserCap, now)
				tasks = append(tasks,
					model.Task{ID: "a-creation", UserID: "user-a", Type: "canvas_image", Operation: "text_to_image", CreationSubmissionID: &submissionID, Status: model.TaskStatusQueued, CreatedAt: now.Add(-30 * time.Second)},
					model.Task{ID: "a-agent-model", UserID: "user-a", Type: "canvas_text", Operation: operation, Status: model.TaskStatusQueued, CreatedAt: now.Add(-20 * time.Second)},
					model.Task{ID: "b-agent-media", UserID: "user-b", Type: "canvas_video", Operation: "text_to_video", AgentRunID: "agent-run-b", Status: model.TaskStatusQueued, CreatedAt: now.Add(-10 * time.Second)},
				)
				createClaimTestTasks(t, db, tasks...)
				assertClaimOrder(t, repo, []TaskClaimOptions{{UserRunningCap: claimTestUserCap}}, "a-agent-model", "b-agent-media", "a-creation")
			})
		})
	}
}

// 同级内仍按创建时间先来先领（包括租约过期后重新领取的任务）；不传选项的旧调用方与带上限的调度器顺序一致。
func TestClaimNextTaskKeepsFIFOWithinClass(t *testing.T) {
	for _, tc := range []struct {
		name    string
		options []TaskClaimOptions
	}{
		{"no-options", nil},
		{"user-cap", []TaskClaimOptions{{UserRunningCap: claimTestUserCap}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			forEachTaskClaimDatabase(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
				now := time.Now()
				// 插入顺序与创建时间刻意错开，避免靠插入顺序碰巧通过。
				createClaimTestTasks(t, db,
					model.Task{ID: "normal-30s", UserID: "user-a", ProjectID: "canvas-a", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-30 * time.Second)},
					model.Task{ID: "agent-10s", UserID: "user-a", Type: "canvas_text", Operation: "cloud_agent_step", Status: model.TaskStatusQueued, CreatedAt: now.Add(-10 * time.Second)},
					model.Task{ID: "normal-50s", UserID: "user-a", ProjectID: "canvas-a", Type: "canvas_image", Operation: "text_to_image", Status: model.TaskStatusQueued, CreatedAt: now.Add(-50 * time.Second)},
					model.Task{ID: "agent-20s", UserID: "user-a", Type: "canvas_text", Operation: "cloud_agent_step", Status: model.TaskStatusQueued, CreatedAt: now.Add(-20 * time.Second)},
					model.Task{ID: "normal-expired-40s", UserID: "user-a", ProjectID: "canvas-a", Type: "canvas_video", Operation: "text_to_video", Status: model.TaskStatusRunning, LeaseOwner: "worker-gone", LeaseExpiresAt: ptrTime(now.Add(-time.Second)), CreatedAt: now.Add(-40 * time.Second)},
				)
				assertClaimOrder(t, repo, tc.options, "agent-20s", "agent-10s", "normal-50s", "normal-expired-40s", "normal-30s")
			})
		})
	}
}

// 本地没有 PostgreSQL 时也守住锁行语义：候选查询带优先级排序和单用户上限子查询，并以 FOR UPDATE SKIP LOCKED 锁行。
func TestClaimNextTaskPostgresCandidateQueryKeepsSkipLocked(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  "host=localhost user=test dbname=test sslmode=disable",
		PreferSimpleProtocol: true,
	}), &gorm.Config{DisableAutomaticPing: true, DryRun: true, Logger: logger.Discard})
	if err != nil {
		t.Fatalf("open dry-run postgres database: %v", err)
	}
	now := time.Now()
	for _, userCap := range []int{0, claimTestUserCap} {
		statement := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
			var task model.Task
			return taskClaimCandidate(tx, true, now, userCap).Find(&task)
		})
		t.Logf("cap=%d: %s", userCap, statement)
		for _, want := range []string{
			"ORDER BY CASE WHEN operation IN ('cloud_agent','cloud_agent_step','cloud_agent_context_compaction') OR",
			"END ASC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
		} {
			if !strings.Contains(statement, want) {
				t.Fatalf("cap=%d: candidate query lacks %q:\n%s", userCap, want, statement)
			}
		}
		capClause := fmt.Sprintf("HAVING COUNT(*) >= %d", claimTestUserCap)
		if got := strings.Contains(statement, capClause); got != (userCap > 0) {
			t.Fatalf("cap=%d: user cap subquery present=%v:\n%s", userCap, got, statement)
		}
	}
}
