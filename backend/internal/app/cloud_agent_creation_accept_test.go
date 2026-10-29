package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func creationAcceptVideoArgs() (cloudAgentMediaArgs, CloudAgentCreationMediaChoice) {
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "auto"}
	return cloudAgentMediaArgs{Mode: "video", Prompt: "商品演示", Duration: 12, AttachmentResourceIDs: []string{"ref-one"}}, choice
}

func saveCreationAcceptState(t *testing.T, s *Service, run *model.CloudAgentExecution, state cloudAgentRuntime) *model.CloudAgentExecution {
	t.Helper()
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func creationAcceptOutcome(t *testing.T, s *Service, runID string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	stored, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	return stored, state
}

func assertCreationAccepted(t *testing.T, s *Service, stored *model.CloudAgentExecution, state cloudAgentRuntime) *model.Task {
	t.Helper()
	// TaskIDs 里还有阿Q 自己的模型调用任务；只看本轮提交的视频。
	var media []*model.Task
	for _, id := range state.TaskIDs {
		task, err := s.repo.TaskForUser("user", id)
		if err != nil {
			t.Fatal(err)
		}
		if task.Type == "canvas_video" {
			media = append(media, task)
		}
	}
	if stored.Status == "waiting_approval" || state.MediaTaskID != "" || cloudAgentMediaPending(&state) || len(media) != 1 || state.Generations != 1 {
		t.Fatalf("media was not accepted without waiting: status=%s mediaTask=%q pending=%v tasks=%v media=%d generations=%d", stored.Status, state.MediaTaskID, cloudAgentMediaPending(&state), state.TaskIDs, len(media), state.Generations)
	}
	task := media[0]
	if cloudAgentTaskTerminal(task.Status) {
		t.Fatalf("test expects the generation to still be running, got %s", task.Status)
	}
	content, ok := cloudAgentCurrentStepToolMessage(&state, "media-call")
	if !ok || !strings.Contains(content, `"phase":"accepted"`) || !strings.Contains(content, task.ID) || !strings.Contains(content, `"taskSubmitted":true`) {
		t.Fatalf("missing accepted receipt for the model: ok=%v content=%s", ok, content)
	}
	created, completed := false, false
	for _, event := range state.Events {
		created = created || event.Type == "generation_task_created" && stringValue(event.Payload["taskId"]) == task.ID
		completed = completed || event.Type == "generation_task_completed"
	}
	if !created || completed {
		t.Fatalf("receipt events: created=%v completed=%v", created, completed)
	}
	return task
}

// 创作页提交即返回：受理后立即把回执交还模型，本轮不再等出图；任务照常排队和计费，重放不重复提交。
func TestCreationMediaReturnsAcceptedReceiptWithoutWaiting(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	args, choice := creationAcceptVideoArgs()
	run, _ := creationMediaRun(t, s, "creation-accepted", args, choice, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, state := creationAcceptOutcome(t, s, run.ID)
	task := assertCreationAccepted(t, s, stored, state)
	var orders int64
	db.Model(&model.BillingOrder{}).Where("task_id = ?", task.ID).Count(&orders)
	if orders != 1 {
		t.Fatalf("accepted media must keep exactly one billed order, got %d", orders)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("advancing after the receipt duplicated the charged task: %d", count)
	}
}

// 本轮下一步要用新成品时，模型传 waitForResult=true，仍等待任务结束再交付结果。
func TestCreationMediaWaitForResultKeepsWaiting(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	args, choice := creationAcceptVideoArgs()
	args.WaitForResult = true
	run, _ := creationMediaRun(t, s, "creation-wait-for-result", args, choice, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	_, state := creationAcceptOutcome(t, s, run.ID)
	if state.MediaTaskID == "" || !cloudAgentMediaPending(&state) {
		t.Fatalf("waitForResult must keep the media wait: mediaTask=%q", state.MediaTaskID)
	}
	if content, ok := cloudAgentCurrentStepToolMessage(&state, "media-call"); ok {
		t.Fatalf("tool result recorded before the media finished: %s", content)
	}
}

// 按预估授权：需要确认的模式下，报价不超过发送时同意的额度就直接执行，不出确认卡。
func TestCreationPreauthorizedMediaSkipsApproval(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	args, choice := creationAcceptVideoArgs()
	run, state := creationMediaRun(t, s, "creation-preauthorized", args, choice)
	state.Request.Budget.AutoApproveCredits = 0.0001 // 100 microcredits; the 12s test video quotes 12.
	run = saveCreationAcceptState(t, s, run, state)
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, state := creationAcceptOutcome(t, s, run.ID)
	if stored.Status == "waiting_approval" || state.Approval != nil {
		t.Fatalf("media within the preauthorized amount still asked for approval: status=%s", stored.Status)
	}
	assertCreationAccepted(t, s, stored, state)
}

// 超出预授权额度才出确认卡；用户批准后，批准的报价计入本轮已同意的额度，并且同样受理即返回。
func TestCreationMediaAboveEstimateAsksOnceAndRecordsApprovedQuote(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	args, choice := creationAcceptVideoArgs()
	run, state := creationMediaRun(t, s, "creation-above-estimate", args, choice)
	state.Request.Budget.AutoApproveCredits = 0.00001 // 10 microcredits, below the 12 microcredit quote.
	run = saveCreationAcceptState(t, s, run, state)
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := s.CloudAgentRun("user", run.ID)
	if err != nil || stored.Status != "waiting_approval" || stored.Approval == nil {
		t.Fatalf("media above the estimate must ask for approval: %+v %v", stored, err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("media task submitted before approval")
	}
	_, pending := creationAcceptOutcome(t, s, run.ID)
	quote := cloudAgentApprovalQuoteMicrocredits(pending.Approval)
	if quote <= 10 {
		t.Fatalf("fixture quote %d does not exceed the preauthorized amount", quote)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, stored.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	after, state := creationAcceptOutcome(t, s, run.ID)
	if state.ApprovedMicrocredits != quote {
		t.Fatalf("approved quote = %d, want %d", state.ApprovedMicrocredits, quote)
	}
	assertCreationAccepted(t, s, after, state)
}

// 预授权额度不能越过本轮积分上限，只读和自动模式也不使用它。
func TestCreationPreauthorizationBoundaries(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	state := &cloudAgentRuntime{}
	state.Request.Surface, state.Request.PermissionMode = "creation", "request_approval"
	state.Request.Budget.MaxCredits, state.Request.Budget.AutoApproveCredits = 0.00001, 1 // preauthorized above the cap is clamped to the cap.
	if ok, err := s.cloudAgentCreationAutoApproves("user", state, 12); err != nil || ok {
		t.Fatalf("quote above the run cap was preauthorized: %v %v", ok, err)
	}
	state.Request.Budget.MaxCredits = 1
	if ok, err := s.cloudAgentCreationAutoApproves("user", state, 12); err != nil || !ok {
		t.Fatalf("quote within the preauthorized amount was not approved: %v %v", ok, err)
	}
	state.ApprovedMicrocredits = 0
	state.Request.Budget.AutoApproveCredits = 0
	if ok, _ := s.cloudAgentCreationAutoApproves("user", state, 1); ok {
		t.Fatal("zero preauthorization must keep asking")
	}
	state.Request.Budget.AutoApproveCredits = 1
	for _, mode := range []string{"auto", "read_only"} {
		state.Request.PermissionMode = mode
		if ok, _ := s.cloudAgentCreationAutoApproves("user", state, 1); ok {
			t.Fatalf("%s mode used the creation preauthorization", mode)
		}
	}
	state.Request.PermissionMode, state.Request.Surface = "request_approval", "canvas"
	if ok, _ := s.cloudAgentCreationAutoApproves("user", state, 1); ok {
		t.Fatal("canvas surface used the creation preauthorization")
	}
}

func TestCreationRequestRejectsPreauthorizationOutsideCreationApproval(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	for _, tc := range []struct {
		name       string
		surface    string
		permission string
		credits    float64
		ok         bool
	}{
		{"creation approval", "creation", "request_approval", 1.2, true},
		{"negative", "creation", "request_approval", -1, false},
		{"auto mode", "creation", "auto", 1.2, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := creationAgentRequest()
			req.Surface, req.PermissionMode, req.IdempotencyKey = tc.surface, tc.permission, "preauthorization-"+strings.ReplaceAll(tc.name, " ", "-")
			req.Budget.AutoApproveCredits = tc.credits
			_, err := s.CreateCloudAgentRun("user", req, "")
			if (err == nil) != tc.ok {
				t.Fatalf("create run err = %v, want ok=%v", err, tc.ok)
			}
		})
	}
}
