package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestAdminVideoTestUsesDraftDefaultsAndStoresOwnedPreviewWithoutBilling(t *testing.T) {
	allowLoopbackProviderTest(t)
	creates, downloads := 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing upstream authentication")
		}
		switch r.URL.Path {
		case "/v1/videos":
			creates++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["prompt"] != "海边日落" || body["duration_seconds"] != float64(6) || body["resolution"] != "720p" || body["aspect_ratio"] != "16:9" {
				t.Errorf("unexpected video request: %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"preview-1","status":"completed","outputs":[{"content_url":"/v1/videos/preview-1/content"}]}`))
		case "/v1/videos/preview-1/content":
			downloads++
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("test-video-content"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, "video-preview-test")
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.UserStorageGrant{}, &model.UserStorageState{}, &model.UserDailyUploadUsage{}, &model.UserDailyActivity{}, &model.Resource{}, &model.UploadReservation{}, &model.BillingOrder{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "preview-admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "preview-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL + "/v1", APIKey: "test-key", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	req := AdminChannelModelTestRequest{ChannelModelRequest: ChannelModelRequest{ModelKey: "kling-video-v4", Capability: "video", Protocol: "kling-video-omni", CapabilityConfig: DefaultModelCapabilityConfigForModel("kling-video-omni", "kling-video-v4")}, Prompt: " 海边日落 "}
	// Test authorization and validation must fail before any paid request.
	if _, err := svc.TestAdminChannelModel(context.Background(), &model.User{ID: "ordinary-user"}, channel.ID, req); err == nil {
		t.Fatal("non-admin test was allowed")
	}
	tooLong := req
	tooLong.Prompt = strings.Repeat("海", DefaultVideoPromptMaxChars+1)
	if _, err := svc.TestAdminChannelModel(context.Background(), admin, channel.ID, tooLong); err == nil || creates != 0 {
		t.Fatalf("invalid prompt reached provider: creates=%d error=%v", creates, err)
	}
	result, err := svc.TestAdminChannelModel(context.Background(), admin, channel.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if creates != 1 || downloads != 1 || result.ResourceID == "" || !strings.Contains(result.VideoURL, result.ResourceID) {
		t.Fatalf("preview result=%#v creates=%d downloads=%d", result, creates, downloads)
	}
	var resource model.Resource
	if err := db.First(&resource, "id = ?", result.ResourceID).Error; err != nil || resource.UserID != admin.ID || resource.Kind != "video" {
		t.Fatalf("preview ownership: %#v error=%v", resource, err)
	}
	for _, table := range []any{&model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.Task{}, &model.BillingOrder{}} {
		var count int64
		if err := db.Model(table).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("test changed %T: count=%d error=%v", table, count, err)
		}
	}
}
