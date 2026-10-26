package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func creationAgentSnapshotItems(t *testing.T, s *Service, sessionID string) (*CreationAgentSnapshotView, map[string]map[string]any) {
	t.Helper()
	snapshot, err := s.CreationAgentSnapshot("user", sessionID)
	if err != nil {
		t.Fatal(err)
	}
	items := map[string]map[string]any{}
	for _, item := range snapshot.Items {
		data := map[string]any{}
		if err := json.Unmarshal(item.Data, &data); err != nil {
			t.Fatal(err)
		}
		data["_type"] = item.Type
		items[item.ID] = data
	}
	return snapshot, items
}

func creationAgentMessage(requestID, text string) CreationAgentMessageRequest {
	return CreationAgentMessageRequest{RequestID: requestID, Text: text, ChannelID: "channel", ChannelModelKey: "text-test"}
}

func TestCreationAgentTimelineProjectsProposalLifecycle(t *testing.T) {
	s, db, sessionID, previousID := creationAgentFixture(t)
	run, state := creationAgentRun(t, s, creationAgentRequest(sessionID, "creation-timeline"), "", creationAgentCall(creationVideoArgs(previousID)))
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	snapshot, items := creationAgentSnapshotItems(t, s, sessionID)
	waiting, _ := s.CloudAgentRun("user", run.ID)
	approval := items["approval:"+waiting.Approval.ID]
	if snapshot.Status != model.CreationAgentStatusApproval || approval == nil || approval["status"] != "pending" {
		t.Fatalf("approval not projected: status=%s items=%v", snapshot.Status, items)
	}
	form, _ := approval["form"].(map[string]any)
	if form["type"] != "video" || !strings.Contains(stringValue(form["prompt"]), "转身") || approval["creditsMicrocredits"] == "0" || len(creationMaps(form["references"])) != 2 {
		t.Fatalf("approval card lacks form or quote: %+v", approval)
	}
	if _, err := s.DecideCreationAgentProposal("user", sessionID, waiting.Approval.ID, CreationAgentDecisionRequest{DecisionID: "d1", Approve: true, ExpectedQuote: "1"}); err == nil {
		t.Fatal("stale expected quote accepted")
	}
	decided, err := s.DecideCreationAgentProposal("user", sessionID, waiting.Approval.ID, CreationAgentDecisionRequest{DecisionID: "d1", Approve: true, ExpectedQuote: stringValue(approval["creditsMicrocredits"])})
	if err != nil {
		t.Fatal(err)
	}
	proposal := map[string]any{}
	_ = json.Unmarshal(decided.Proposal.Data, &proposal)
	if proposal["status"] != "submitted" || decided.Entry == nil || proposal["entryId"] != decided.Entry.ID {
		t.Fatalf("decision did not return submitted proposal and entry: %+v %+v", proposal, decided.Entry)
	}
	var appErr *AppError
	if _, err := s.DecideCreationAgentProposal("user", sessionID, waiting.Approval.ID, CreationAgentDecisionRequest{DecisionID: "d2", Approve: true}); !errors.As(err, &appErr) || appErr.Reason != ReasonProposalNotPending {
		t.Fatalf("second decision not rejected: %v", err)
	}
	snapshot, items = creationAgentSnapshotItems(t, s, sessionID)
	if snapshot.Status != model.CreationAgentStatusWaiting || items["entry:"+decided.Entry.ID] == nil {
		t.Fatalf("waiting state or result card missing: %s %v", snapshot.Status, items)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if err := db.Create(&model.Resource{ID: "output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:output","resourceId":"output"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.settleCloudAgentMedia("user", run.ID); err != nil {
		t.Fatal(err)
	}
	_, items = creationAgentSnapshotItems(t, s, sessionID)
	result := items["entry:"+decided.Entry.ID]
	if items["approval:"+waiting.Approval.ID]["status"] != "completed" || result["status"] != model.CreationEntryStatusSucceeded {
		t.Fatalf("completion not projected: approval=%v result=%v", items["approval:"+waiting.Approval.ID], result)
	}
	// 续读：after 之后只返回新事件，序号连续递增。
	events, err := s.CreationAgentEvents("user", sessionID, 0)
	if err != nil {
		t.Fatal(err)
	}
	for index, item := range events.Items {
		if item.Seq != int64(index+1) {
			t.Fatalf("event sequence has a gap at %d: %d", index, item.Seq)
		}
	}
	tail, _ := s.CreationAgentEvents("user", sessionID, events.Items[len(events.Items)-1].Seq)
	if len(tail.Items) != 0 {
		t.Fatalf("after cursor replayed events: %d", len(tail.Items))
	}
}

func TestCreationAgentMessagesDeduplicateAndContinue(t *testing.T) {
	s, _, sessionID, _ := creationAgentFixture(t)
	if _, err := s.SendCreationAgentMessage("user", sessionID, CreationAgentMessageRequest{RequestID: "no-model-request", Text: "你好"}); err == nil {
		t.Fatal("message without a text model accepted")
	}
	first, err := s.SendCreationAgentMessage("user", sessionID, creationAgentMessage("request-first-0001", "做一张古风海报"))
	if err != nil {
		t.Fatal(err)
	}
	if first.RunID == "" || first.Delivered != "run" || first.Seq == 0 {
		t.Fatalf("message not accepted as a run: %+v", first)
	}
	again, err := s.SendCreationAgentMessage("user", sessionID, creationAgentMessage("request-first-0001", "做一张古风海报"))
	if err != nil || !again.Duplicate || again.RunID != first.RunID || again.Seq != first.Seq {
		t.Fatalf("duplicate request not deduplicated: %+v %v", again, err)
	}
	stored, err := s.repo.CloudAgent("user", first.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.CreationSessionID != sessionID || stored.OutputTarget() != model.CloudAgentTargetCreation {
		t.Fatalf("run not bound to session: %+v", stored)
	}
	session, _ := s.repo.CreationSession("user", sessionID)
	if !strings.Contains(session.AgentModel, "text-test") {
		t.Fatalf("model selection not remembered: %q", session.AgentModel)
	}
	// 模拟这一轮以选择题结束：时间线出现问题卡，状态变为等待回答。
	state, _ := cloudAgentDecode(stored)
	if err := s.repo.MutateCloudAgent("user", stored.ID, stored.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.event(stored.ID, "user_question", map[string]any{"phase": "question", "kind": "choice", "question": "海报用什么色调？", "options": []map[string]any{{"id": "warm", "label": "暖色"}, {"id": "cool", "label": "冷色"}}})
		current.Status = "completed"
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	snapshot, items := creationAgentSnapshotItems(t, s, sessionID)
	questionID := "question:" + stored.ID
	if snapshot.Status != model.CreationAgentStatusInput || items[questionID]["status"] != "pending" {
		t.Fatalf("question not projected: %s %v", snapshot.Status, items[questionID])
	}
	answered, err := s.AnswerCreationAgentQuestion("user", sessionID, questionID, CreationAgentAnswerRequest{RequestID: "request-answer-0001", SelectedOptions: []string{"warm"}})
	if err != nil {
		t.Fatal(err)
	}
	child, _ := s.repo.CloudAgent("user", answered.RunID)
	childState, _ := cloudAgentDecode(child)
	if child.ParentID != stored.ID || childState.Request.Prompt != "暖色" {
		t.Fatalf("answer did not continue the session: parent=%q prompt=%q", child.ParentID, childState.Request.Prompt)
	}
	_, items = creationAgentSnapshotItems(t, s, sessionID)
	if items[questionID]["status"] != "answered" {
		t.Fatalf("question not marked answered: %v", items[questionID])
	}
	var appErr *AppError
	if _, err := s.AnswerCreationAgentQuestion("user", sessionID, questionID, CreationAgentAnswerRequest{RequestID: "request-answer-0002", SelectedOptions: []string{"cool"}}); !errors.As(err, &appErr) || appErr.Reason != ReasonQuestionAnswered {
		t.Fatalf("second answer not rejected: %v", err)
	}
	// 进行中的轮次收到新消息时作为插话送达，不开第二轮。
	extra, err := s.SendCreationAgentMessage("user", sessionID, creationAgentMessage("request-extra-0001", "再加一点金色"))
	if err != nil {
		t.Fatal(err)
	}
	if extra.Delivered != "interjection" || extra.RunID != answered.RunID {
		t.Fatalf("message during an active run did not become an interjection: %+v", extra)
	}
	if err := s.StopCreationAgent(t.Context(), "user", sessionID); err != nil {
		t.Fatal(err)
	}
	snapshot, _ = creationAgentSnapshotItems(t, s, sessionID)
	if snapshot.Status != model.CreationAgentStatusStopped || snapshot.ActiveRunID != "" {
		t.Fatalf("stop not reflected: %s active=%q", snapshot.Status, snapshot.ActiveRunID)
	}
}

func TestCreationAgentProjectionIgnoresCanvasRuns(t *testing.T) {
	run := &model.CloudAgentExecution{ID: "canvas-run", UserID: "user", Target: model.CloudAgentTargetCanvas}
	if err := projectCreationAgentJournal(nil, run, []model.CloudAgentEventRecord{{EventJSON: `{"type":"assistant_message"}`}}); err != nil {
		t.Fatal(err)
	}
}
