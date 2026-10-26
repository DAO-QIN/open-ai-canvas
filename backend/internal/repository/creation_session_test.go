package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func forEachCreationTestDB(t *testing.T, run func(*testing.T, *Repository, *gorm.DB)) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := openCreationTestDB(t, driver)
			if err := db.AutoMigrate(&model.CreationSession{}, &model.CreationEntry{}, &model.CreationEntryTask{}, &model.CreationAgentEvent{}); err != nil {
				t.Fatal(err)
			}
			run(t, New(db), db)
		})
	}
}

// openCreationTestDB 打开 SQLite 临时库；postgres 需要 CANVAS_TEST_POSTGRES_DSN，并在独立 schema 中运行。
func openCreationTestDB(t *testing.T, driver string) *gorm.DB {
	t.Helper()
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "creation.db") + "?_busy_timeout=5000&_journal_mode=WAL")
	if driver == "postgres" {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("creation_session_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
			conn, _ := admin.DB()
			_ = conn.Close()
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dialector = postgres.Open(parsed.String())
	}
	db, err := gorm.Open(dialector, config)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return db
}

func createTestCreationSession(t *testing.T, repo *Repository, userID, id string, updatedAt time.Time) {
	t.Helper()
	session := model.CreationSession{ID: id, UserID: userID, Title: id, CreatedAt: updatedAt, UpdatedAt: updatedAt}
	if err := repo.CreateCreationSession(&session); err != nil {
		t.Fatal(err)
	}
}

func TestCreationSessionListPagesByActivityAndHidesOthers(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		base := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
		// s3 与 s4 时间相同，检验同一时间按 ID 稳定排序且不重复、不遗漏。
		for index, id := range []string{"s1", "s2", "s3", "s4", "s5"} {
			at := base.Add(time.Duration(index) * time.Minute)
			if id == "s4" {
				at = base.Add(2 * time.Minute)
			}
			createTestCreationSession(t, repo, "user", id, at)
		}
		createTestCreationSession(t, repo, "other", "foreign", base.Add(time.Hour))
		createTestCreationSession(t, repo, "user", "deleted", base.Add(time.Hour))
		if err := repo.SoftDeleteCreationSession("user", "deleted", base.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}

		var got []string
		var cursor *CreationPageCursor
		for page := 0; page < 10; page++ {
			rows, next, err := repo.ListCreationSessions("user", cursor, 2)
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range rows {
				got = append(got, row.ID)
			}
			if next == nil {
				break
			}
			cursor = next
		}
		want := []string{"s5", "s4", "s3", "s2", "s1"}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("sessions = %v, want %v", got, want)
		}
	})
}

func TestCreationSessionRunClaimBlocksDelete(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		now := time.Now()
		createTestCreationSession(t, repo, "user", "session", now)

		if err := repo.ClaimCreationSessionRun("user", "session", "run-1"); err != nil {
			t.Fatal(err)
		}
		if err := repo.ClaimCreationSessionRun("user", "session", "run-1"); err != nil {
			t.Fatalf("same run should claim again: %v", err)
		}
		if err := repo.ClaimCreationSessionRun("user", "session", "run-2"); !errors.Is(err, ErrCreationSessionBusy) {
			t.Fatalf("second run claim = %v, want busy", err)
		}
		if err := repo.ClaimCreationSessionRun("other", "session", "run-3"); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("foreign claim = %v, want not found", err)
		}
		if err := repo.SoftDeleteCreationSession("user", "session", now); !errors.Is(err, ErrCreationSessionBusy) {
			t.Fatalf("delete during run = %v, want busy", err)
		}
		if err := repo.ReleaseCreationSessionRun("user", "session", "run-2"); err != nil {
			t.Fatal(err)
		}
		if session, err := repo.CreationSession("user", "session"); err != nil || session.ActiveRunID != "run-1" {
			t.Fatalf("release by another run changed owner: %+v %v", session, err)
		}
		if err := repo.ReleaseCreationSessionRun("user", "session", "run-1"); err != nil {
			t.Fatal(err)
		}
		if err := repo.SoftDeleteCreationSession("user", "session", now); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.CreationSession("user", "session"); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("deleted session readable: %v", err)
		}
		title := "renamed"
		if err := repo.UpdateCreationSession("user", "session", CreationSessionPatch{Title: &title}); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("update deleted session = %v, want not found", err)
		}
		if exists, err := repo.CreationSessionExists("session"); err != nil || !exists {
			t.Fatalf("deleted session id must stay reserved: %v %v", exists, err)
		}
	})
}

func TestUpdateCreationSessionKeepsListOrder(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		at := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
		createTestCreationSession(t, repo, "user", "session", at)
		title, mode := "海报", "agent"
		if err := repo.UpdateCreationSession("user", "session", CreationSessionPatch{Title: &title, LastMode: &mode}); err != nil {
			t.Fatal(err)
		}
		session, err := repo.CreationSession("user", "session")
		if err != nil {
			t.Fatal(err)
		}
		if session.Title != title || session.LastMode != mode || !session.UpdatedAt.Equal(at) {
			t.Fatalf("unexpected session after patch: %+v", session)
		}
	})
}

func TestCreateCreationEntryIsIdempotentAndCounts(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		createTestCreationSession(t, repo, "user", "other-session", time.Now())
		proposal := "proposal-1"
		entry := &model.CreationEntry{ID: "entry-1", SessionID: "session", UserID: "user", Origin: model.CreationEntryOriginAgent, ProposalID: &proposal, ClientOperationID: "op-1", Type: "image", Prompt: "海报", Status: model.CreationEntryStatusPending}
		stored, created, err := repo.CreateCreationEntry(entry, []string{"task-a", "task-b"})
		if err != nil || !created || stored.ID != "entry-1" || stored.Revision != 1 {
			t.Fatalf("first create: %+v %v %v", stored, created, err)
		}

		again := &model.CreationEntry{ID: "entry-2", SessionID: "session", UserID: "user", Origin: model.CreationEntryOriginAgent, ClientOperationID: "op-1", Type: "image", Prompt: "海报", Status: model.CreationEntryStatusPending}
		if stored, created, err = repo.CreateCreationEntry(again, []string{"task-c"}); err != nil || created || stored.ID != "entry-1" {
			t.Fatalf("same operation should return original: %+v %v %v", stored, created, err)
		}
		sameProposal := &model.CreationEntry{ID: "entry-3", SessionID: "session", UserID: "user", Origin: model.CreationEntryOriginAgent, ProposalID: &proposal, ClientOperationID: "op-2", Type: "image", Prompt: "海报", Status: model.CreationEntryStatusPending}
		if stored, created, err = repo.CreateCreationEntry(sameProposal, nil); err != nil || created || stored.ID != "entry-1" {
			t.Fatalf("same proposal should return original: %+v %v %v", stored, created, err)
		}
		elsewhere := &model.CreationEntry{ID: "entry-4", SessionID: "other-session", UserID: "user", Origin: model.CreationEntryOriginManual, ClientOperationID: "op-1", Type: "image", Prompt: "海报", Status: model.CreationEntryStatusPending}
		if _, _, err = repo.CreateCreationEntry(elsewhere, nil); !errors.Is(err, ErrCreationEntryOperationConflict) {
			t.Fatalf("operation reused across sessions = %v, want conflict", err)
		}
		missing := &model.CreationEntry{ID: "entry-5", SessionID: "missing", UserID: "user", Origin: model.CreationEntryOriginManual, ClientOperationID: "op-5", Type: "image", Prompt: "海报", Status: model.CreationEntryStatusPending}
		if _, _, err = repo.CreateCreationEntry(missing, nil); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("entry for missing session = %v, want not found", err)
		}

		session, err := repo.CreationSession("user", "session")
		if err != nil || session.EntryCount != 1 || session.LatestEntryID != "entry-1" {
			t.Fatalf("session counters: %+v %v", session, err)
		}
		tasks, err := repo.CreationEntryTasks("user", "entry-1")
		if err != nil || len(tasks) != 2 || tasks[0].TaskID != "task-a" || tasks[1].Slot != 1 {
			t.Fatalf("entry tasks: %+v %v", tasks, err)
		}
		links, err := repo.CreationEntryLinksForTask("task-b")
		if err != nil || len(links) != 1 || links[0].EntryID != "entry-1" {
			t.Fatalf("task links: %+v %v", links, err)
		}
		if _, err := repo.CreationEntry("other", "entry-1"); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("foreign entry readable: %v", err)
		}
	})
}

func TestListCreationEntriesPagesNewestFirst(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, db *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		base := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
		for index := 0; index < 5; index++ {
			id := fmt.Sprintf("entry-%d", index)
			entry := &model.CreationEntry{ID: id, SessionID: "session", UserID: "user", Origin: model.CreationEntryOriginManual, ClientOperationID: "op-" + id, Type: "image", Prompt: "p", Status: model.CreationEntryStatusPending, CreatedAt: base.Add(time.Duration(index) * time.Minute)}
			if _, _, err := repo.CreateCreationEntry(entry, nil); err != nil {
				t.Fatal(err)
			}
		}
		if err := db.Model(&model.CreationEntry{}).Where("id = ?", "entry-3").UpdateColumn("created_at", base.Add(4*time.Minute)).Error; err != nil {
			t.Fatal(err)
		}
		var got []string
		var cursor *CreationPageCursor
		for page := 0; page < 10; page++ {
			rows, next, err := repo.ListCreationEntries("user", "session", cursor, 2)
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range rows {
				got = append(got, row.ID)
			}
			if next == nil {
				break
			}
			cursor = next
		}
		want := []string{"entry-4", "entry-3", "entry-2", "entry-1", "entry-0"}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("entries = %v, want %v", got, want)
		}
	})
}

func TestMutateCreationEntryRejectsStaleRevision(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		entry := &model.CreationEntry{ID: "entry", SessionID: "session", UserID: "user", Origin: model.CreationEntryOriginManual, ClientOperationID: "op", Type: "image", Prompt: "p", Status: model.CreationEntryStatusPending}
		if _, _, err := repo.CreateCreationEntry(entry, nil); err != nil {
			t.Fatal(err)
		}
		_, err := repo.MutateCreationEntry("user", "entry", func(stale *model.CreationEntry) error {
			// 另一个任务先完成并写回，使本次读取的修订号过期。
			if _, err := repo.MutateCreationEntry("user", "entry", func(current *model.CreationEntry) error {
				current.Status = model.CreationEntryStatusRunning
				current.ResultsJSON = `[{"slot":0,"status":"running"}]`
				return nil
			}); err != nil {
				return err
			}
			stale.Status = model.CreationEntryStatusSucceeded
			return nil
		})
		if !errors.Is(err, ErrCreationConflict) {
			t.Fatalf("stale write = %v, want conflict", err)
		}
		stored, err := repo.CreationEntry("user", "entry")
		if err != nil || stored.Revision != 2 || stored.Status != model.CreationEntryStatusRunning {
			t.Fatalf("stored entry: %+v %v", stored, err)
		}
		updated, err := repo.MutateCreationEntry("user", "entry", func(current *model.CreationEntry) error {
			current.Status = model.CreationEntryStatusSucceeded
			current.HiddenFailed = true
			return nil
		})
		if err != nil || updated.Revision != 3 || updated.Status != model.CreationEntryStatusSucceeded || !updated.HiddenFailed {
			t.Fatalf("fresh write: %+v %v", updated, err)
		}
	})
}

func TestAppendCreationAgentEventsAssignsSequenceAndPositions(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		events, err := repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{
			{ItemID: "state-1", Type: "state", DataJSON: `{"status":"running"}`, Status: model.CreationAgentStatusRunning},
			{ItemID: "output-a", Type: "output", DataJSON: `{"status":"streaming","text":"你"}`},
			{ItemID: "output-b", Type: "output", DataJSON: `{"status":"completed","text":"b"}`},
		})
		if err != nil || len(events) != 3 || events[0].Seq != 1 || events[2].Seq != 3 {
			t.Fatalf("first append: %+v %v", events, err)
		}
		events, err = repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{
			{ItemID: "output-a", Type: "output", TurnID: "turn-1", DataJSON: `{"status":"completed","text":"你好"}`},
		})
		if err != nil || len(events) != 1 || events[0].Seq != 4 || events[0].Position != 2 {
			t.Fatalf("update keeps position: %+v %v", events, err)
		}
		session, err := repo.CreationSession("user", "session")
		if err != nil || session.LastSeq != 4 || session.AgentStatus != model.CreationAgentStatusRunning {
			t.Fatalf("session after append: %+v %v", session, err)
		}

		items, hasMore, err := repo.CreationAgentSnapshot("user", "session", 0, 0)
		if err != nil || hasMore || len(items) != 3 {
			t.Fatalf("snapshot: %+v %v %v", items, hasMore, err)
		}
		if items[1].ItemID != "output-a" || items[1].Seq != 4 || items[1].DataJSON != `{"status":"completed","text":"你好"}` {
			t.Fatalf("snapshot must hold latest version at original position: %+v", items)
		}
		after, err := repo.CreationAgentEventsAfter("user", "session", 2, 0)
		if err != nil || len(after) != 2 || after[0].Seq != 3 || after[1].Seq != 4 {
			t.Fatalf("events after: %+v %v", after, err)
		}
		if foreign, err := repo.CreationAgentEventsAfter("other", "session", 0, 0); err != nil || len(foreign) != 0 {
			t.Fatalf("foreign events readable: %+v %v", foreign, err)
		}
		if _, err := repo.AppendCreationAgentEvents("other", "session", []CreationAgentEventInput{{ItemID: "x", Type: "state", DataJSON: `{}`}}); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("foreign append = %v, want not found", err)
		}
		if _, err := repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{{ItemID: "x", Type: "state", DataJSON: `{`}}); err == nil {
			t.Fatal("invalid payload must be rejected")
		}
	})
}

func TestAppendCreationAgentEventsDeduplicatesRequest(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		message := []CreationAgentEventInput{{ItemID: "message-1", Type: "message", RequestID: "request-1", DataJSON: `{"role":"user","text":"海报"}`}}
		first, err := repo.AppendCreationAgentEvents("user", "session", message)
		if err != nil || len(first) != 1 {
			t.Fatalf("first message: %+v %v", first, err)
		}
		retry := []CreationAgentEventInput{
			{ItemID: "message-2", Type: "message", RequestID: "request-1", DataJSON: `{"role":"user","text":"海报"}`},
			{ItemID: "state-2", Type: "state", DataJSON: `{"status":"ready"}`, Status: model.CreationAgentStatusReady},
		}
		duplicate, err := repo.AppendCreationAgentEvents("user", "session", retry)
		if !errors.Is(err, ErrCreationAgentRequestDuplicate) || len(duplicate) != 1 || duplicate[0].Seq != first[0].Seq {
			t.Fatalf("duplicate request: %+v %v", duplicate, err)
		}
		session, err := repo.CreationSession("user", "session")
		if err != nil || session.LastSeq != 1 || session.AgentStatus != model.CreationAgentStatusIdle {
			t.Fatalf("duplicate must not write anything: %+v %v", session, err)
		}
	})
}

func TestCreationAgentSnapshotPagesOlderItems(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		for index := 1; index <= 5; index++ {
			input := CreationAgentEventInput{ItemID: fmt.Sprintf("item-%d", index), Type: "message", DataJSON: `{}`}
			if _, err := repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{input}); err != nil {
				t.Fatal(err)
			}
		}
		latest, hasMore, err := repo.CreationAgentSnapshot("user", "session", 0, 2)
		if err != nil || !hasMore || len(latest) != 2 || latest[0].ItemID != "item-4" || latest[1].ItemID != "item-5" {
			t.Fatalf("latest page: %+v %v %v", latest, hasMore, err)
		}
		older, hasMore, err := repo.CreationAgentSnapshot("user", "session", latest[0].Position, 2)
		if err != nil || !hasMore || len(older) != 2 || older[0].ItemID != "item-2" || older[1].ItemID != "item-3" {
			t.Fatalf("older page: %+v %v %v", older, hasMore, err)
		}
		oldest, hasMore, err := repo.CreationAgentSnapshot("user", "session", older[0].Position, 2)
		if err != nil || hasMore || len(oldest) != 1 || oldest[0].ItemID != "item-1" {
			t.Fatalf("oldest page: %+v %v %v", oldest, hasMore, err)
		}
	})
}

func TestPruneCreationAgentEventVersionsKeepsLatest(t *testing.T) {
	forEachCreationTestDB(t, func(t *testing.T, repo *Repository, _ *gorm.DB) {
		createTestCreationSession(t, repo, "user", "session", time.Now())
		for _, text := range []string{"a", "ab", "abc"} {
			input := CreationAgentEventInput{ItemID: "output", Type: "output", DataJSON: fmt.Sprintf(`{"text":%q}`, text)}
			if _, err := repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{input}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{{ItemID: "plan", Type: "plan", DataJSON: `{}`}}); err != nil {
			t.Fatal(err)
		}
		if removed, err := repo.PruneCreationAgentEventVersions("user", "session", time.Now().Add(-time.Hour)); err != nil || removed != 0 {
			t.Fatalf("recent versions must stay: %d %v", removed, err)
		}
		removed, err := repo.PruneCreationAgentEventVersions("user", "session", time.Now().Add(time.Minute))
		if err != nil || removed != 2 {
			t.Fatalf("prune removed %d, err %v", removed, err)
		}
		items, _, err := repo.CreationAgentSnapshot("user", "session", 0, 0)
		if err != nil || len(items) != 2 || items[0].DataJSON != `{"text":"abc"}` || items[0].Position != 1 {
			t.Fatalf("snapshot after prune: %+v %v", items, err)
		}
		next, err := repo.AppendCreationAgentEvents("user", "session", []CreationAgentEventInput{{ItemID: "output", Type: "output", DataJSON: `{"text":"abcd"}`}})
		if err != nil || next[0].Seq != 5 || next[0].Position != 1 {
			t.Fatalf("append after prune: %+v %v", next, err)
		}
	})
}
