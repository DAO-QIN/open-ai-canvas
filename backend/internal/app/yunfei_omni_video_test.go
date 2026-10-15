package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func loadYunfeiOmniTestAdapter(t *testing.T) protocol.Adapter {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "yunfei-omni-video.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	return adapters[0]
}

func TestYunfeiOmniAdminSaveReadbackAndIndependentDefaults(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "yunfei", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "爱困视频", BaseURL: "https://img.yunfei.best/v1", APIKey: "test", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	disabled := false
	profile := DefaultModelCapabilityConfigForModel("yunfei-omni-flash-video", "omni-flash")
	if !reflect.DeepEqual(profile.Video.Duration.Values, []int{8}) || profile.Video.Duration.Default != 8 || profile.Video.References.MaxImages != 3 || *profile.Video.References.MaxReferenceImages != 1 || profile.Video.References.MaxVideos != 1 || profile.Video.References.MaxAudios != 1 || profile.Video.GenerateAudio.Supported {
		t.Fatalf("wrong defaults: %#v", profile.Video)
	}
	req := ChannelModelRequest{ModelKey: "omni-flash", ProviderModelKey: "omni-flash", Capability: "video", Protocol: "yunfei-omni-flash-video", CapabilityConfig: profile, Enabled: &disabled, PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: false, Enabled: &disabled}}}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeModelCapabilityConfig(stored.CapabilityConfigJSON)
	if err != nil || decoded == nil || !reflect.DeepEqual(decoded.Video, profile.Video) || stored.Enabled || stored.PriceConfigured {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	readback, err := svc.AdminChannelModels(admin, channel.ID)
	if err != nil || len(readback) != 1 {
		t.Fatal("missing admin readback", err)
	}
	raw, _ := json.Marshal(readback[0].CapabilityConfig)
	reopened, err := DecodeModelCapabilityConfig(string(raw))
	if err != nil || !reflect.DeepEqual(reopened.Video, profile.Video) {
		t.Fatal("admin readback lost defaults", err)
	}
	if !reflect.DeepEqual(DefaultModelCapabilityConfig("rolldek-gemini-omni-video").Video.Duration.Values, []int{4, 6, 8, 10}) {
		t.Fatal("Yunfei defaults changed RollDek")
	}
	ordinary := 2
	req.CapabilityConfig.Video.References.MaxImages = 4
	req.CapabilityConfig.Video.References.MaxReferenceImages = &ordinary
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err != nil {
		t.Fatal("platform reference limit is not adjustable", err)
	}
}

func TestYunfeiOmniHostRetriesAndResumesSameTask(t *testing.T) {
	allowLoopbackProviderTest(t)
	a := loadYunfeiOmniTestAdapter(t)
	creates, polls, downloads := 0, 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/result.mp4" && r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing bearer authentication")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/videos":
			creates++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["model"] != "omni-flash" || body["duration"] != float64(8) || len(body) != 5 || r.Method != "POST" {
				t.Errorf("bad create request: %#v err=%v", body, err)
			}
			_, _ = w.Write([]byte(`{"id":"task-yunfei-1","status":"queued"}`))
		case "/v1/videos/task-yunfei-1":
			polls++
			if polls == 1 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if polls == 2 {
				_, _ = w.Write([]byte(`{"status":"processing","url":"https://cdn.example/early.mp4"}`))
				return
			}
			_, _ = fmt.Fprintf(w, `{"status":"completed","output":[{"url":%q}]}`, server.URL+"/result.mp4")
		case "/result.mp4":
			downloads++
			if downloads == 1 {
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-test-bytes"))
		default:
			t.Errorf("undocumented request path: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "video", Prompt: "小猫在房间里奔跑", Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "omni-flash", InterfaceType: "yunfei-omni-flash-video", VideoSeconds: "8", VQuality: "720p", Size: "16:9"}}
	result, err := runProtocolAdapterTaskWithPolicy(context.Background(), input, a, fastVideoPollPolicy())
	if err != nil || result["mode"] != "video" || creates != 1 || polls != 3 || downloads != 2 {
		t.Fatalf("result=%#v creates=%d polls=%d downloads=%d err=%v", result, creates, polls, downloads, err)
	}
	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ProviderRequestID: "task-yunfei-1"})
	if _, err := runProtocolAdapterTaskWithPolicy(ctx, input, a, fastVideoPollPolicy()); err != nil {
		t.Fatal("resume failed", err)
	}
	if creates != 1 {
		t.Fatal("resume submitted another paid create")
	}
}
