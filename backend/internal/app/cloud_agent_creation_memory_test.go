package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func rememberLessonCall(arguments string) cloudAgentCall {
	var call cloudAgentCall
	call.Function.Name, call.Function.Arguments = "remember_lesson", arguments
	return call
}

func TestCreationMemoryAdmissionAndRecallIsolation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	now := time.Now()
	for _, item := range []model.AgentLesson{
		{ID: "smart", AuthorUserID: "user", Category: "smart_creation", Topic: "creation.style", Situation: "SMART_CREATION_ONLY", Lesson: "按目标图逐项修改", Status: model.AgentLessonStatusApproved},
		{ID: "canvas", AuthorUserID: "user", Category: "canvas", Topic: "canvas.style", Situation: "CANVAS_ONLY", Lesson: "先读画布", Status: model.AgentLessonStatusApproved},
		{ID: "pending", AuthorUserID: "user", Category: "smart_creation", Topic: "creation.pending", Situation: "PENDING_ONLY", Status: model.AgentLessonStatusPending},
		{ID: "foreign", AuthorUserID: "other", Category: "smart_creation", Topic: "creation.foreign", Situation: "FOREIGN_ONLY", Status: model.AgentLessonStatusApproved},
	} {
		item.CreatedAt, item.UpdatedAt = now, now
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	run, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	task, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	canonical := runtime.Canonical
	state := cloudAgentRuntime{Request: admitted.Request, Memory: admitted.Memory, SkillHints: admitted.SkillHints}
	cloudAgentAttachRunContext(&canonical, &state)
	encoded, _ := json.Marshal(canonical)
	for _, expected := range []string{"SMART_CREATION_ONLY", "CANVAS_ONLY"} {
		if !strings.Contains(string(encoded), expected) {
			t.Fatalf("共享记忆文件未导入本人已批准的经验 %s", expected)
		}
		if strings.Contains(canonical.SystemPrompt, expected) {
			t.Fatal("个人记忆进入稳定 system 前缀")
		}
	}
	for _, forbidden := range []string{"PENDING_ONLY", "FOREIGN_ONLY"} {
		if strings.Contains(task.InputJSON, forbidden) || strings.Contains(string(encoded), forbidden) {
			t.Fatalf("记忆文件泄漏 %s", forbidden)
		}
	}
	canvasMemory, err := s.cloudAgentMemorySnapshotForRun("user", "canvas style")
	if err != nil || canvasMemory.Text != admitted.Memory.Text {
		t.Fatalf("创作与画布没有使用同一份个人记忆文件: %v", err)
	}
}

func TestCreationMemoryRequiresDeliveredMediaAndUsesSmartCategory(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	state := &cloudAgentRuntime{Request: creationAgentRequest(), TaskIDs: []string{"media"}, LessonEligibleToolSuccesses: 4}
	state.Request.PermissionMode = "auto"
	call := rememberLessonCall(`{"topic":"creation.edit","category":"image","situation":"多图分别修改","lesson":"每张图绑定对应原图"}`)
	item := model.Task{ID: "media", UserID: "user", Type: "canvas_image", Status: model.TaskStatusRunning, AgentRunID: "run"}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentRememberLesson(s.repo, "user", state, call); err == nil {
		t.Fatal("仍在运行的任务被记成成功经验")
	}
	if err := db.Model(&item).Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentRememberLesson(s.repo, "user", state, call); err != nil {
		t.Fatal(err)
	}
	if err := cloudAgentCommitLessonDrafts(s.repo, "user", "run", state); err != nil {
		t.Fatal(err)
	}
	lessons, err := s.repo.UserAgentLessons("user", model.AgentLessonStatusPending, 10)
	if err != nil || len(lessons) != 1 || lessons[0].Category != "smart_creation" {
		t.Fatalf("首页记忆分类不正确: %+v %v", lessons, err)
	}
}

func TestMemoryCompactCannotCrossCreationSurface(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	var ids []string
	var snapshots []model.AgentMemorySnapshot
	for _, category := range []string{"smart_creation", "canvas"} {
		item, err := s.CreateUserAgentMemory("user", AgentMemoryRequest{Topic: category + ".edit", Category: category, Situation: "多图修改", Lesson: "按目标修改"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, item.ID)
		lesson, _ := s.repo.AgentLessonByTopic("user", item.Topic)
		snapshots = append(snapshots, model.SnapshotAgentMemory(*lesson))
	}
	changes, summary := s.buildAgentMemoryProposalChanges("user", snapshots, agentMemoryCompactPlan{
		Merges:   []agentMemoryCompactMerge{{IDs: ids, Topic: "merged.edit", Category: "canvas", Situation: "多图修改", Lesson: "按目标修改"}},
		Rewrites: []agentMemoryCompactRewrite{{ID: ids[0], Topic: "rewritten.edit", Category: "image", Situation: "多图修改", Lesson: "按目标修改"}},
	})
	if len(changes) != 0 || summary.Merged != 0 || summary.Rewritten != 0 || summary.Skipped != 2 {
		t.Fatalf("压缩混淆场景: %+v", summary)
	}
}
