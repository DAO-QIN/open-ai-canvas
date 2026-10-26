package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func creationAgentFixture(t *testing.T) (*Service, *gorm.DB, string, string) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	session, err := s.CreateCreationSession("user", CreateCreationSessionRequest{Title: "首页创作"})
	if err != nil {
		t.Fatal(err)
	}
	previous := &model.CreationEntry{
		ID: "entry-prev", SessionID: session.ID, UserID: "user", Origin: model.CreationEntryOriginManual, ClientOperationID: "op-prev",
		Type: "image", Prompt: "古风英雄定妆照", Status: model.CreationEntryStatusSucceeded,
		ResultsJSON: `[{"slot":0,"status":"succeeded","resources":[{"resourceId":"ref-two","storageKey":"resource:ref-two","mimeType":"image/png"}]}]`,
	}
	if _, _, err := s.repo.CreateCreationEntry(previous, nil); err != nil {
		t.Fatal(err)
	}
	return s, db, session.ID, previous.ID
}

func creationAgentRequest(sessionID, key string) CloudAgentRequest {
	req := agentTestRequest()
	req.CanvasID, req.ContextScope, req.IdempotencyKey = "", nil, key
	req.CreationSessionID = sessionID
	req.PermissionMode = "auto"
	req.Budget.MaxCredits = 100
	req.Budget.MaxGenerationTasks = 2
	return req
}

func creationAgentCall(args map[string]any) cloudAgentCall {
	raw, _ := json.Marshal(args)
	call := cloudAgentCall{ID: "creation-call"}
	call.Function.Name, call.Function.Arguments = cloudAgentCreationMediaToolName, string(raw)
	return call
}

func creationAgentRun(t *testing.T, s *Service, req CloudAgentRequest, parentID string, call cloudAgentCall) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	root, err := s.CreateCloudAgentRun("user", req, parentID)
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{call}
	if err = s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	return run, state
}

func creationVideoArgs(previousEntryID string) map[string]any {
	return map[string]any{
		"mode": "video", "prompt": "@图片1 的英雄在 @图片2 的场景里转身", "channelId": "channel", "channelModelKey": "seedance-test",
		"durationSeconds": 12, "size": "9:16", "title": "英雄转身",
		"references": []map[string]any{{"resourceId": "ref-one"}, {"entryId": previousEntryID, "slot": 0}},
	}
}

func TestCreationAgentMediaApprovalCreatesEntryAndResult(t *testing.T) {
	s, db, sessionID, previousID := creationAgentFixture(t)
	run, state := creationAgentRun(t, s, creationAgentRequest(sessionID, "creation-agent-approve"), "", creationAgentCall(creationVideoArgs(previousID)))
	if run.OutputTarget() != model.CloudAgentTargetCreation || run.CreationSessionID != sessionID || run.CanvasID != "" {
		t.Fatalf("run target not persisted: target=%q session=%q canvas=%q", run.Target, run.CreationSessionID, run.CanvasID)
	}
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("task submitted before approval")
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Status != "waiting_approval" || waiting.Approval == nil {
		t.Fatalf("missing approval: %+v %v", waiting, err)
	}
	if waiting.Approval.Preview.Kind != "creation_generation" || waiting.Approval.Prepared == nil || waiting.Approval.Prepared.Quote.AmountMicrocredits <= 0 {
		t.Fatalf("approval lacks preview or quote: %+v", waiting.Approval)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if state.MediaTaskID == "" || state.CreationEntryID == "" {
		t.Fatalf("approval did not submit task and entry: %s", run.StateJSON)
	}
	taskID, entryID := state.MediaTaskID, state.CreationEntryID
	task, err := s.repo.TaskForUser("user", taskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if task.ProjectID != "" || len(input.ReferenceImages) != 2 || input.ReferenceImages[0].StorageKey != "resource:ref-one" || input.ReferenceImages[1].StorageKey != "resource:ref-two" || input.Config.VideoSeconds != "12" {
		t.Fatalf("lost generation contract: project=%q %+v", task.ProjectID, input)
	}
	entry, err := s.repo.CreationEntry("user", entryID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Origin != model.CreationEntryOriginAgent || entry.ProposalID == nil || *entry.ProposalID != waiting.Approval.ID || entry.SessionID != sessionID || entry.Type != "video" {
		t.Fatalf("wrong entry: %+v", entry)
	}
	links, _ := s.repo.CreationEntryTasks("user", entryID)
	if len(links) != 1 || links[0].TaskID != taskID {
		t.Fatalf("entry not linked to task: %+v", links)
	}
	var references []CreationReference
	_ = json.Unmarshal([]byte(entry.ReferencesJSON), &references)
	if len(references) != 2 || references[1].Kind != "entry_result" || references[1].EntryID != previousID {
		t.Fatalf("entry references lost: %s", entry.ReferencesJSON)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("replay duplicated task: %d", count)
	}
	if err := db.Create(&model.Resource{ID: "output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 720, Height: 1280}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:output","resourceId":"output"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.settleCloudAgentMedia("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if state.MediaTaskID != "" || state.CreationEntryID != "" {
		t.Fatal("media task not released after completion")
	}
	var completion map[string]any
	for _, event := range state.Events {
		if event.Type == "tool_completed" && event.Payload["toolName"] == cloudAgentCreationMediaToolName {
			completion, _ = event.Payload["result"].(map[string]any)
		}
	}
	if completion == nil || completion["entryId"] != entryID || completion["entryStatus"] != model.CreationEntryStatusSucceeded {
		t.Fatalf("completion result missing entry facts: %+v", completion)
	}
	entry, _ = s.repo.CreationEntry("user", entryID)
	if entry.Status != model.CreationEntryStatusSucceeded || !strings.Contains(entry.ResultsJSON, "output") {
		t.Fatalf("entry not reconciled: %+v", entry)
	}
	if len(state.CreationProposals) != 1 || state.CreationProposals[0].Decision != "approve" || state.CreationProposals[0].EntryID != entryID {
		t.Fatalf("proposal decision lost: %+v", state.CreationProposals)
	}
	session, _ := s.repo.CreationSession("user", sessionID)
	if session.EntryCount != 2 || session.LatestEntryID != entryID {
		t.Fatalf("session counters not updated: %+v", session)
	}
}

func TestCreationAgentRejectRecordsProposalAndInheritsIt(t *testing.T) {
	s, db, sessionID, previousID := creationAgentFixture(t)
	run, state := creationAgentRun(t, s, creationAgentRequest(sessionID, "creation-agent-reject"), "", creationAgentCall(creationVideoArgs(previousID)))
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("missing approval: %v", err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "reject", ""); err != nil {
		t.Fatal(err)
	}
	var tasks, entries int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	db.Model(&model.CreationEntry{}).Where("origin = ?", model.CreationEntryOriginAgent).Count(&entries)
	if tasks != 0 || entries != 0 {
		t.Fatalf("rejection created work: tasks=%d entries=%d", tasks, entries)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if run.Status != "rejected" || len(state.CreationProposals) != 1 || state.CreationProposals[0].Decision != "reject" {
		t.Fatalf("rejection not recorded: status=%s %+v", run.Status, state.CreationProposals)
	}
	// 下一轮在同一会话续写：继承被拒方案，且上一轮的会话占用自愈释放。
	child, err := s.CreateCloudAgentRun("user", creationAgentRequest(sessionID, "creation-agent-reject-next"), run.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.CloudAgent("user", child.ID)
	childState, _ := cloudAgentDecode(stored)
	if len(childState.CreationProposals) != 1 || childState.CreationProposals[0].Decision != "reject" {
		t.Fatalf("rejected proposal not inherited: %+v", childState.CreationProposals)
	}
	canonical := childState.Canonical
	if err := s.attachCreationAgentFacts(&canonical, "user", &childState); err != nil {
		t.Fatal(err)
	}
	last := stringField(canonical.Messages[len(canonical.Messages)-1], "content")
	if !strings.HasPrefix(last, cloudAgentRuntimeContextMarker) || !strings.Contains(last, `"decision":"reject"`) || !strings.Contains(last, previousID) {
		t.Fatalf("facts frame lacks proposals or entries: %s", last)
	}
	if len(childState.Canonical.Messages) == len(canonical.Messages) {
		t.Fatal("facts frame leaked into the stored transcript")
	}
}

func TestCreationAgentRequestBoundaries(t *testing.T) {
	s, db, sessionID, _ := creationAgentFixture(t)
	both := creationAgentRequest(sessionID, "creation-agent-both")
	both.CanvasID = "agent-canvas"
	if _, err := s.CreateCloudAgentRun("user", both, ""); err == nil {
		t.Fatal("canvas and creation session bound together")
	}
	stray := agentTestRequest()
	stray.IdempotencyKey = "creation-agent-stray"
	on := true
	stray.AutoContinue = &on
	if _, err := s.CreateCloudAgentRun("user", stray, ""); err == nil {
		t.Fatal("autoContinue accepted outside a creation session")
	}
	if err := db.Create(&model.CreationSession{ID: "foreign-session", UserID: "other", Source: model.CreationSessionSourceServer}).Error; err != nil {
		t.Fatal(err)
	}
	var appErr *AppError
	if _, err := s.CreateCloudAgentRun("user", creationAgentRequest("foreign-session", "creation-agent-foreign"), ""); !errors.As(err, &appErr) || appErr.Status != 404 {
		t.Fatalf("foreign session not rejected as missing: %v", err)
	}
	first, err := s.CreateCloudAgentRun("user", creationAgentRequest(sessionID, "creation-agent-first"), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCloudAgentRun("user", creationAgentRequest(sessionID, "creation-agent-second"), ""); !errors.As(err, &appErr) || appErr.Reason != ReasonCreationSessionBusy {
		t.Fatalf("concurrent run in same session allowed: %v", err)
	}
	if again, err := s.CreateCloudAgentRun("user", creationAgentRequest(sessionID, "creation-agent-first"), ""); err != nil || again.ID != first.ID {
		t.Fatalf("idempotent retry broke on own claim: %v", err)
	}
	if err := s.CancelCloudAgent(t.Context(), "user", first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCloudAgentRun("user", creationAgentRequest(sessionID, "creation-agent-third"), ""); err != nil {
		t.Fatalf("finished run kept the session claimed: %v", err)
	}
}

func TestCreationAgentToolsScopedToSession(t *testing.T) {
	creation := CloudAgentRequest{PermissionMode: "auto", CreationSessionID: "session"}
	names := map[string]bool{}
	for _, tool := range cloudAgentTools(creation) {
		names[stringValue(tool["function"].(map[string]any)["name"])] = true
	}
	if !names[cloudAgentCreationMediaToolName] || !names["creation_read_entries"] || !names["model_list"] || names["generate_media"] || names["canvas_get_state"] {
		t.Fatalf("wrong creation tool scope: %v", names)
	}
	for _, tool := range cloudAgentTools(CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}}) {
		if name := stringValue(tool["function"].(map[string]any)["name"]); strings.HasPrefix(name, "creation_") {
			t.Fatalf("creation tool %s leaked into canvas runs", name)
		}
	}
}

func TestCreationAgentShouldContinueRule(t *testing.T) {
	succeeded := &model.Task{Status: model.TaskStatusSucceeded}
	failed := &model.Task{Status: model.TaskStatusFailed}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CreationSessionID: "s"}}
	state.Plan = []cloudAgentPlanItem{{ID: "1", Title: "生成定妆照", Status: "doing"}}
	if cloudAgentCreationShouldContinue(state, succeeded) {
		t.Fatal("continued with no unstarted plan step")
	}
	state.Plan = append(state.Plan, cloudAgentPlanItem{ID: "2", Title: "生成转身视频", Status: "pending"})
	if !cloudAgentCreationShouldContinue(state, succeeded) {
		t.Fatal("did not continue with remaining plan steps")
	}
	state.Plan = state.Plan[:1]
	if !cloudAgentCreationShouldContinue(state, failed) {
		t.Fatal("failed generation must continue one round to explain")
	}
	off := false
	state.Request.AutoContinue = &off
	if cloudAgentCreationShouldContinue(state, succeeded) {
		t.Fatal("continued with auto-continue turned off")
	}
	if !cloudAgentCreationShouldContinue(&cloudAgentRuntime{}, failed) {
		t.Fatal("canvas runs must keep the existing resume behavior")
	}
}

func TestCreationAgentReadEntries(t *testing.T) {
	s, _, sessionID, previousID := creationAgentFixture(t)
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CreationSessionID: sessionID}}
	call := cloudAgentCall{}
	call.Function.Name, call.Function.Arguments = "creation_read_entries", `{"limit":5}`
	result, err := cloudAgentHandleCreationReadEntries(s.repo, "user", state, call)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if !strings.Contains(string(raw), previousID) || !strings.Contains(string(raw), `"resourceId":"ref-two"`) {
		t.Fatalf("entries not returned: %s", raw)
	}
	call.Function.Arguments = `{"limit":50}`
	if _, err := cloudAgentHandleCreationReadEntries(s.repo, "user", state, call); err == nil {
		t.Fatal("limit bound not enforced")
	}
}
