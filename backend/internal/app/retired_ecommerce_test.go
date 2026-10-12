package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestWithdrawnEcommerceCannotDispatchOrRetry(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if _, err := s.CreateTask("user", CreateTaskRequest{Operation: "ecommerce_image"}); err == nil || !strings.Contains(err.Error(), "已撤回") {
		t.Fatalf("withdrawn operation admitted: %v", err)
	}
	stepID := "historical-step"
	task := model.Task{ID: "withdrawn-image", UserID: "user", Type: "canvas_image", Operation: "image_to_image", Status: model.TaskStatusFailed, InputJSON: `{}`, EcommerceStepID: &stepID}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RetryTask(task.UserID, task.ID); err == nil || !strings.Contains(err.Error(), "已撤回") {
		t.Fatalf("historical task admitted for another charge: %v", err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.BillingOrderID != "" || stored.EcommerceStepID == nil || *stored.EcommerceStepID != stepID {
		t.Fatalf("historical task changed: %+v %v", stored, err)
	}
}
