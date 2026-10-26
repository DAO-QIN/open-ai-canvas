package app

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func creationSessionTestService(t *testing.T) (*Service, *gorm.DB, string) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	view, err := s.CreateCreationSession("user", CreateCreationSessionRequest{Title: "咖啡海报", Mode: "text"})
	if err != nil {
		t.Fatal(err)
	}
	return s, db, view.ID
}

func textEntryRequest(operationID string, tasks int) SubmitCreationEntryRequest {
	requests := make([]CreateTaskRequest, 0, tasks)
	for range tasks {
		requests = append(requests, creationTextRequest())
	}
	return SubmitCreationEntryRequest{ClientOperationID: operationID, Type: "text", Prompt: "只输出测试", Config: map[string]any{"model": "text-test"}, Tasks: requests}
}

func countCreationTestTasks(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&model.Task{}).Where("user_id = ?", "user").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}

func requireAppReason(t *testing.T, err error, status int, reason ErrorReason) {
	t.Helper()
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != status || appErr.Reason != reason {
		t.Fatalf("error = %#v, want status %d reason %s", err, status, reason)
	}
}

func TestCreationSessionLifecycle(t *testing.T) {
	s, _, id := creationSessionTestService(t)
	page, err := s.ListCreationSessions("user", "", 0)
	if err != nil || len(page.Sessions) != 1 || page.Sessions[0].ID != id || page.Sessions[0].AgentStatus != model.CreationAgentStatusIdle || page.NextCursor != "" {
		t.Fatalf("list: %+v %v", page, err)
	}
	title, mode, skills := "春日来信", "agent", []string{"poster", "poster", "story"}
	view, err := s.UpdateCreationSession("user", id, UpdateCreationSessionRequest{Title: &title, LastMode: &mode, SkillIDs: &skills})
	if err != nil || view.Title != title || view.LastMode != mode || fmt.Sprint(view.SkillIDs) != "[poster story]" {
		t.Fatalf("update: %+v %v", view, err)
	}
	invalid := "drawing"
	if _, err := s.UpdateCreationSession("user", id, UpdateCreationSessionRequest{LastMode: &invalid}); err == nil {
		t.Fatal("invalid mode accepted")
	}
	_, err = s.CreationSession("other", id)
	requireAppReason(t, err, 404, ReasonCreationSessionNotFound)

	if _, err := s.repo.CreationSession("user", id); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.ClaimCreationSessionRun("user", id, "run-1"); err != nil {
		t.Fatal(err)
	}
	requireAppReason(t, s.DeleteCreationSession("user", id), 409, ReasonCreationSessionBusy)
	if err := s.repo.ReleaseCreationSessionRun("user", id, "run-1"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCreationSession("user", id); err != nil {
		t.Fatal(err)
	}
	_, err = s.CreationSession("user", id)
	requireAppReason(t, err, 404, ReasonCreationSessionNotFound)
	if _, err := s.ListCreationSessions("user", "not-a-cursor!", 0); err == nil {
		t.Fatal("invalid cursor accepted")
	}
}

func TestSubmitCreationEntryCreatesTasksOnceAndRelinksAfterCrash(t *testing.T) {
	s, db, sessionID := creationSessionTestService(t)
	before := countCreationTestTasks(t, db)
	entry, err := s.SubmitCreationEntry("user", sessionID, textEntryRequest("op-1", 2))
	if err != nil {
		t.Fatal(err)
	}
	if entry.Status != model.CreationEntryStatusPending || len(entry.Results) != 2 || entry.CreditsMicrocredits != "200" {
		t.Fatalf("entry: %+v", entry)
	}
	for slot, result := range entry.Results {
		if result.Slot != slot || result.TaskID != creationSlotTaskID("user", entry.ID, slot) || result.Status != model.CreationEntryStatusPending {
			t.Fatalf("slot %d: %+v", slot, result)
		}
	}
	if got := countCreationTestTasks(t, db) - before; got != 2 {
		t.Fatalf("created %d tasks, want 2", got)
	}

	again, err := s.SubmitCreationEntry("user", sessionID, textEntryRequest("op-1", 2))
	if err != nil || again.ID != entry.ID {
		t.Fatalf("resubmit: %+v %v", again, err)
	}
	// 模拟任务已建出、关联尚未写入时进程退出：重试同一操作只补关联，不重复建任务。
	if err := db.Where("entry_id = ?", entry.ID).Delete(&model.CreationEntryTask{}).Error; err != nil {
		t.Fatal(err)
	}
	recovered, err := s.SubmitCreationEntry("user", sessionID, textEntryRequest("op-1", 2))
	if err != nil || recovered.ID != entry.ID || len(recovered.Results) != 2 {
		t.Fatalf("recover: %+v %v", recovered, err)
	}
	if got := countCreationTestTasks(t, db) - before; got != 2 {
		t.Fatalf("retries created %d tasks, want 2", got)
	}
	session, err := s.CreationSession("user", sessionID)
	if err != nil || session.EntryCount != 1 || session.LatestEntryID != entry.ID {
		t.Fatalf("session: %+v %v", session, err)
	}

	if _, err := s.SubmitCreationEntry("user", sessionID, SubmitCreationEntryRequest{ClientOperationID: "op-2", Type: "image", Prompt: "p", Tasks: []CreateTaskRequest{creationTextRequest()}}); err == nil {
		t.Fatal("task type mismatch accepted")
	}
	if _, err := s.SubmitCreationEntry("user", sessionID, SubmitCreationEntryRequest{ClientOperationID: "op-3", Type: "text", Prompt: "p", References: []CreationReference{{Kind: "resource", ResourceID: "foreign"}}, Tasks: []CreateTaskRequest{creationTextRequest()}}); err == nil {
		t.Fatal("foreign reference accepted")
	}
	_, err = s.SubmitCreationEntry("other", sessionID, textEntryRequest("op-4", 1))
	requireAppReason(t, err, 404, ReasonCreationSessionNotFound)
}

func TestSubmitCreationEntryRecordsAdmissionFailure(t *testing.T) {
	s, db, sessionID := creationSessionTestService(t)
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 0).Error; err != nil {
		t.Fatal(err)
	}
	before := countCreationTestTasks(t, db)
	if _, err := s.SubmitCreationEntry("user", sessionID, textEntryRequest("op-poor", 1)); err == nil {
		t.Fatal("submission without credits succeeded")
	}
	page, err := s.ListCreationEntries("user", sessionID, "", 0)
	if err != nil || len(page.Entries) != 1 {
		t.Fatalf("entries: %+v %v", page, err)
	}
	failed := page.Entries[0]
	if failed.Status != model.CreationEntryStatusFailed || len(failed.Results) != 1 || failed.Results[0].TaskID != "" || failed.Results[0].Failure == "" {
		t.Fatalf("failed entry: %+v", failed)
	}
	// 同一操作重放返回原记录，不再尝试建任务。
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 10000).Error; err != nil {
		t.Fatal(err)
	}
	replayed, err := s.SubmitCreationEntry("user", sessionID, textEntryRequest("op-poor", 1))
	if err != nil || replayed.ID != failed.ID || replayed.Status != model.CreationEntryStatusFailed {
		t.Fatalf("replay: %+v %v", replayed, err)
	}
	if got := countCreationTestTasks(t, db) - before; got != 0 {
		t.Fatalf("created %d tasks, want 0", got)
	}
}

func TestCreationEntryReconcilesClearsAndRetries(t *testing.T) {
	s, db, sessionID := creationSessionTestService(t)
	entry, err := s.SubmitCreationEntry("user", sessionID, textEntryRequest("op-1", 2))
	if err != nil {
		t.Fatal(err)
	}
	first, second := entry.Results[0].TaskID, entry.Results[1].TaskID
	if err := db.Model(&model.Task{}).Where("id = ?", first).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"text","text":"你好"}`}).Error; err != nil {
		t.Fatal(err)
	}
	var secondTask model.Task
	if err := db.First(&secondTask, "id = ?", second).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", second).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游超时"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.BillingOrder{}).Where("id = ?", secondTask.BillingOrderID).Updates(map[string]any{"status": model.BillingStatusRefunded, "refunded_amount_microcredits": 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.syncCreationEntriesForTask("user", second); err != nil {
		t.Fatal(err)
	}
	view, err := s.CreationEntry("user", entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != model.CreationEntryStatusPartial || view.Results[0].Text != "你好" || view.Results[1].Failure != "上游超时" || view.CreditsMicrocredits != "100" {
		t.Fatalf("reconciled: %+v", view)
	}

	cleared, err := s.ClearCreationEntryFailed("user", entry.ID)
	if err != nil || !cleared.HiddenFailed || len(cleared.Results) != 1 || cleared.Results[0].Slot != 0 {
		t.Fatalf("cleared: %+v %v", cleared, err)
	}

	retried, err := s.RetryCreationEntry("user", entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retried.Status != model.CreationEntryStatusPending {
		t.Fatalf("retried status = %s", retried.Status)
	}
	var requeued model.Task
	if err := db.First(&requeued, "id = ?", second).Error; err != nil || requeued.Status != model.TaskStatusQueued {
		t.Fatalf("task not requeued: %+v %v", requeued, err)
	}
	if _, err := s.RetryCreationEntry("user", entry.ID); err == nil {
		t.Fatal("retry without failed slots succeeded")
	}
	_, err = s.CreationEntry("other", entry.ID)
	requireAppReason(t, err, 404, ReasonCreationEntryNotFound)
}

func TestCreationEntryReferencesBlockResourceDeletionUntilSessionDeleted(t *testing.T) {
	s, db, sessionID := creationSessionTestService(t)
	if err := db.Create(&model.Resource{ID: "ref-image", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png"}).Error; err != nil {
		t.Fatal(err)
	}
	request := textEntryRequest("op-ref", 1)
	request.References = []CreationReference{{Kind: "resource", StorageKey: "resource:ref-image", Label: "参考图"}}
	entry, err := s.SubmitCreationEntry("user", sessionID, request)
	if err != nil || len(entry.References) != 1 || entry.References[0].ResourceID != "ref-image" {
		t.Fatalf("entry: %+v %v", entry, err)
	}
	hasEntryReference := func() bool {
		snapshot, err := s.repo.ResourceReferenceSnapshot("user", "", []string{"ref-image"})
		if err != nil {
			t.Fatal(err)
		}
		for _, document := range snapshot.Documents {
			if document.Kind == "首页创作记录" && document.ID == entry.ID && documentReferencesResources(document.PrimaryJSON, map[string]struct{}{"ref-image": {}}) {
				return true
			}
		}
		return false
	}
	if !hasEntryReference() {
		t.Fatal("entry reference missing from resource snapshot")
	}
	if err := s.DeleteCreationSession("user", sessionID); err != nil {
		t.Fatal(err)
	}
	if hasEntryReference() {
		t.Fatal("deleted session still blocks resource deletion")
	}
}

func TestImportCreationSessionsIsIdempotentAndKeepsOrder(t *testing.T) {
	s, db, _ := creationSessionTestService(t)
	task, err := s.CreateTask("user", creationTextRequest())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "old-image", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 800, Height: 600}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreationSession{ID: "taken-by-other", UserID: "other", Title: "x", AgentStatus: model.CreationAgentStatusIdle, SkillIDsJSON: "[]", Source: model.CreationSessionSourceServer}).Error; err != nil {
		t.Fatal(err)
	}
	updatedAt := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	request := ImportCreationSessionsRequest{Sessions: []ImportedCreationSession{
		{ID: "localSession123", Title: "旧对话", UpdatedAt: updatedAt, Messages: []ImportedCreationMessage{
			{ID: "u1", Role: "user", Content: "写一句文案"},
			{ID: "a1", Role: "assistant", Mode: "text", Content: "春天来了", Status: "done"},
			{ID: "u2", Role: "user", Content: "再写一句"},
			{ID: "a2", Role: "assistant", Mode: "text", TaskIDs: []string{task.ID, "foreign-task"}},
			{ID: "a3", Role: "assistant", Mode: "image", ResultStorageKeys: []string{"resource:old-image", "resource:missing"}},
			{ID: "a4", Role: "assistant", Mode: "image"},
		}},
		{ID: "taken-by-other", Title: "冲突", Messages: []ImportedCreationMessage{}},
	}}
	result, err := s.ImportCreationSessions("user", request)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(result.Imported) != "[localSession123]" || len(result.Skipped) != 1 || result.Skipped[0].ID != "taken-by-other" || result.Entries["localSession123"] != 3 {
		t.Fatalf("import result: %+v", result)
	}
	page, err := s.ListCreationEntries("user", "localSession123", "", 0)
	if err != nil || len(page.Entries) != 3 {
		t.Fatalf("entries: %+v %v", page, err)
	}
	byOperation := map[string]CreationEntryView{}
	for _, entry := range page.Entries {
		byOperation[entry.ClientOperationID] = entry
	}
	if text := byOperation["import:localSession123:a1"]; text.Status != model.CreationEntryStatusSucceeded || text.Prompt != "写一句文案" || text.Results[0].Text != "春天来了" {
		t.Fatalf("text entry: %+v", text)
	}
	if linked := byOperation["import:localSession123:a2"]; len(linked.Results) != 1 || linked.Results[0].TaskID != task.ID || linked.Prompt != "再写一句" {
		t.Fatalf("task entry: %+v", linked)
	}
	if image := byOperation["import:localSession123:a3"]; len(image.Results) != 1 || image.Results[0].Resources[0].ResourceID != "old-image" || image.Results[0].Resources[0].Width != 800 {
		t.Fatalf("image entry: %+v", image)
	}
	session, err := s.CreationSession("user", "localSession123")
	if err != nil || !session.UpdatedAt.Equal(updatedAt) || session.EntryCount != 3 {
		t.Fatalf("imported session: %+v %v", session, err)
	}

	again, err := s.ImportCreationSessions("user", request)
	if err != nil || again.Entries["localSession123"] != 0 {
		t.Fatalf("reimport: %+v %v", again, err)
	}
	session, err = s.CreationSession("user", "localSession123")
	if err != nil || session.EntryCount != 3 || !session.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("reimport changed session: %+v %v", session, err)
	}
}

type creationEntrySyncRecorder struct {
	billing *taskTerminalBillingStub
	calls   []string
}

func (r *creationEntrySyncRecorder) syncCreationEntriesForTask(userID, taskID string) error {
	r.calls = append(r.calls, fmt.Sprintf("%s/%s refund=%d settle=%d", userID, taskID, len(r.billing.refund), r.billing.settleCalls))
	return nil
}

func TestTaskTerminalCoordinatorSyncsCreationEntriesAfterBilling(t *testing.T) {
	newCoordinator := func(task *model.Task) (*taskTerminalCoordinator, *creationEntrySyncRecorder) {
		billing := &taskTerminalBillingStub{}
		recorder := &creationEntrySyncRecorder{billing: billing}
		c := newTaskTerminalCoordinatorForTest(&taskTerminalRepositoryStub{task: task}, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
		c.creationEntries = recorder
		return c, recorder
	}

	task := &model.Task{ID: "prep", UserID: "user", BillingOrderID: "order", Status: model.TaskStatusRunning}
	c, recorder := newCoordinator(task)
	_ = c.markPreparationFailure(task, "准备失败", errors.New("bad input"), false, "退款")
	if fmt.Sprint(recorder.calls) != "[user/prep refund=1 settle=0]" {
		t.Fatalf("preparation failure sync: %v", recorder.calls)
	}

	task = &model.Task{ID: "exec", UserID: "user", BillingOrderID: "order", Status: model.TaskStatusRunning}
	c, recorder = newCoordinator(task)
	_ = c.handleExecutionFailure(task, errors.New("upstream failed"), false, false)
	if len(recorder.calls) == 0 || recorder.calls[len(recorder.calls)-1] != "user/exec refund=1 settle=0" {
		t.Fatalf("execution failure sync: %v", recorder.calls)
	}

	task = &model.Task{ID: "ok", UserID: "user", BillingOrderID: "order", Status: model.TaskStatusSucceeded}
	c, recorder = newCoordinator(task)
	_ = c.handleSuccess(task)
	if len(recorder.calls) == 0 || recorder.calls[len(recorder.calls)-1] != "user/ok refund=0 settle=1" {
		t.Fatalf("success sync: %v", recorder.calls)
	}

	task = &model.Task{ID: "cancel", UserID: "user", Status: model.TaskStatusCancelled}
	c, recorder = newCoordinator(task)
	_ = c.handleAlreadyCancelled(*task)
	if fmt.Sprint(recorder.calls) != "[user/cancel refund=0 settle=0]" {
		t.Fatalf("cancel sync: %v", recorder.calls)
	}
}

func TestCreationTaskResourcesCollectsEveryOutputInOrder(t *testing.T) {
	raw := `{"mode":"image","images":[{"storageKey":"resource:first","width":1024,"height":768,"bytes":"2048","mimeType":"image/png"},{"url":"/api/resources/second/file","poster":{"storageKey":"resource:poster"}},{"storageKey":"resource:first"}],"video":{"resourceId":"third","durationMs":4000,"thumbnail":{"storageKey":"resource:thumb"}}}`
	resources := creationTaskResources(raw)
	got := []string{}
	for _, resource := range resources {
		got = append(got, resource.ResourceID)
	}
	if fmt.Sprint(got) != "[first second third]" {
		t.Fatalf("resources = %v", got)
	}
	if resources[0].Width != 1024 || resources[0].Bytes != 2048 || resources[0].StorageKey != "resource:first" || resources[2].DurationMs != 4000 {
		t.Fatalf("metadata = %+v", resources)
	}
	if creationTaskResources("not json") != nil || len(creationTaskResources(`{"mode":"text","text":"x"}`)) != 0 {
		t.Fatal("unexpected resources for non-media result")
	}
}

func TestDeriveCreationEntryStatus(t *testing.T) {
	slot := func(status string) CreationResultSlot { return CreationResultSlot{Status: status} }
	for _, test := range []struct {
		slots []CreationResultSlot
		want  string
	}{
		{nil, model.CreationEntryStatusPending},
		{[]CreationResultSlot{slot("succeeded"), slot("running")}, model.CreationEntryStatusRunning},
		{[]CreationResultSlot{slot("succeeded"), slot("pending")}, model.CreationEntryStatusPending},
		{[]CreationResultSlot{slot("succeeded"), slot("succeeded")}, model.CreationEntryStatusSucceeded},
		{[]CreationResultSlot{slot("succeeded"), slot("failed")}, model.CreationEntryStatusPartial},
		{[]CreationResultSlot{slot("cancelled"), slot("failed")}, model.CreationEntryStatusFailed},
		{[]CreationResultSlot{slot("cancelled")}, model.CreationEntryStatusCancelled},
	} {
		if got := deriveCreationEntryStatus(test.slots); got != test.want {
			t.Fatalf("deriveCreationEntryStatus(%v) = %s, want %s", test.slots, got, test.want)
		}
	}
}
