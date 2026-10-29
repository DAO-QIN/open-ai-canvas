package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAdminCreationMetricsHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.Task{}, &model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		if err := db.Create(&model.User{ID: string(role), Username: string(role), Email: string(role) + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: string(role), UserID: string(role), TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 一轮创作页对话，6 秒后才出现第一段正文：首个反馈 P95 超过 5 秒，应给出提醒。
	started := time.Now().Add(-10 * time.Minute)
	if err := db.Create(&model.CloudAgentExecution{ID: "run-1", UserID: "user", Surface: "creation", Status: "completed", CreatedAt: started, UpdatedAt: started}).Error; err != nil {
		t.Fatal(err)
	}
	event := `{"eventId":"run-1:1","runId":"run-1","seq":1,"type":"assistant_delta","payload":{"messageId":"step","text":"好的"},"createdAt":"` + started.Add(6*time.Second).Format(time.RFC3339Nano) + `"}`
	if err := db.Create(&model.CloudAgentEventRecord{RunID: "run-1", Sequence: 1, UserID: "user", EventJSON: event, CreatedAt: started.Add(6 * time.Second)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "image-1", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"source":"create-page"}}`, CreatedAt: started, StartedAt: creationMetricsTime(started.Add(time.Second)), CompletedAt: creationMetricsTime(started.Add(12 * time.Second))}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	router := gin.New()
	RegisterAdminCreationMetricsRoutes(router.Group("/api"), svc)
	call := func(role, query string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/admin/creation-metrics"+query, nil)
		if role != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}

	if w := call("", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %s", w.Code, w.Body.String())
	}
	if w := call("user", ""); w.Code != http.StatusForbidden {
		t.Fatalf("non-admin: %d %s", w.Code, w.Body.String())
	}
	for _, query := range []string{"?window=30d", "?window=24H", "?window=1h"} {
		w := call("admin", query)
		var body struct {
			Code   int    `json:"code"`
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != http.StatusBadRequest || body.Code == 0 || body.Reason != "invalid_argument" {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body.String())
		}
	}

	w := call("admin", "")
	if w.Code != http.StatusOK {
		t.Fatalf("admin: %d %s", w.Code, w.Body.String())
	}
	var envelope struct {
		Code int                        `json:"code"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"generatedAt", "window", "agent", "image", "video", "agentMedia", "interactiveQueue", "refunds", "alerts", "truncated"} {
		if _, exists := envelope.Data[key]; !exists {
			t.Fatalf("response missing %q: %s", key, w.Body.String())
		}
	}
	var data struct {
		Window string `json:"window"`
		Agent  struct {
			Runs          int `json:"runs"`
			FirstFeedback struct {
				P95Ms   *int64 `json:"p95Ms"`
				Samples int    `json:"samples"`
			} `json:"firstFeedback"`
		} `json:"agent"`
		Image struct {
			Count int `json:"count"`
			Total struct {
				P50Ms *int64 `json:"p50Ms"`
			} `json:"total"`
		} `json:"image"`
		Video struct {
			QueueWait struct {
				P50Ms   *int64 `json:"p50Ms"`
				Samples int    `json:"samples"`
			} `json:"queueWait"`
		} `json:"video"`
		Refunds struct {
			AutoRefundEnabled bool  `json:"autoRefundEnabled"`
			StuckFrozen       int64 `json:"stuckFrozen"`
		} `json:"refunds"`
		Alerts []struct {
			Key       string  `json:"key"`
			Level     string  `json:"level"`
			Title     string  `json:"title"`
			Value     float64 `json:"value"`
			Threshold float64 `json:"threshold"`
		} `json:"alerts"`
	}
	raw, _ := json.Marshal(envelope.Data)
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 0 || data.Window != "24h" || data.Agent.Runs != 1 || data.Agent.FirstFeedback.Samples != 1 || data.Agent.FirstFeedback.P95Ms == nil || *data.Agent.FirstFeedback.P95Ms != 6000 {
		t.Fatalf("agent metrics = %s", w.Body.String())
	}
	if data.Image.Count != 1 || data.Image.Total.P50Ms == nil || *data.Image.Total.P50Ms != 12000 || data.Video.QueueWait.P50Ms != nil || data.Video.QueueWait.Samples != 0 {
		t.Fatalf("task metrics = %s", w.Body.String())
	}
	if data.Refunds.AutoRefundEnabled || data.Refunds.StuckFrozen != 0 {
		t.Fatalf("refunds = %s", w.Body.String())
	}
	if len(data.Alerts) != 1 || data.Alerts[0].Key != "agent_first_feedback_p95" || data.Alerts[0].Level != "warning" || data.Alerts[0].Value != 6000 || data.Alerts[0].Threshold != 5000 || data.Alerts[0].Title != "自动模式首个反馈 P95 为 6.0 秒，超过 5 秒" {
		t.Fatalf("alerts = %+v", data.Alerts)
	}

	if w := call("admin", "?window=7d"); w.Code != http.StatusOK {
		t.Fatalf("7d: %d %s", w.Code, w.Body.String())
	} else if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || string(envelope.Data["window"]) != `"7d"` {
		t.Fatalf("7d window = %s (%v)", w.Body.String(), err)
	}
}

func creationMetricsTime(value time.Time) *time.Time {
	return &value
}
