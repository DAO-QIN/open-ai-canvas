package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func loadRollDekGeminiTestAdapter(t *testing.T) protocol.Adapter {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "rolldek-gemini-video.yingce-plugin"))
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

func TestRollDekVideoAdminSaveReadbackAndAdjustableReferenceLimits(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "rolldek", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "RollDek", BaseURL: "https://rolldek.com/v1", APIKey: "test", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	disabled := false
	profile := DefaultModelCapabilityConfigForModel("rolldek-gemini-omni-video", "gemini-omni-1.1-flash")
	req := ChannelModelRequest{ModelKey: "gemini-omni-1.1-flash", ProviderModelKey: "gemini-omni-1.1-flash", Capability: "video", Protocol: "rolldek-gemini-omni-video", CapabilityConfig: profile, Enabled: &disabled, PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: false, Enabled: &disabled}}}
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
		t.Fatalf("saved=%#v error=%v", stored, err)
	}
	if !reflect.DeepEqual(decoded.Video.Duration.Values, []int{4, 6, 8, 10}) || decoded.Video.References.MaxImages != 3 || *decoded.Video.References.MaxReferenceImages != 1 {
		t.Fatal("missing defaults")
	}
	readback, err := svc.AdminChannelModels(admin, channel.ID)
	if err != nil || len(readback) != 1 {
		t.Fatal("admin readback lost model", err)
	}
	readbackJSON, _ := json.Marshal(readback[0].CapabilityConfig)
	readbackConfig, err := DecodeModelCapabilityConfig(string(readbackJSON))
	if err != nil || readbackConfig == nil || !reflect.DeepEqual(readbackConfig.Video, profile.Video) {
		t.Fatal("admin readback lost defaults", err)
	}
	ordinary := 2
	req.CapabilityConfig.Video.References.MaxReferenceImages = &ordinary
	req.CapabilityConfig.Video.References.MaxImages = 4
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err != nil {
		t.Fatal("adjusted platform limits rejected", err)
	}
	before, _ := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	ordinary = 5
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err == nil {
		t.Fatal("ordinary image limit larger than total accepted")
	}
	after, _ := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("invalid save changed stored model")
	}
}

func TestRollDekVideoReferenceLimitsDistinguishFrames(t *testing.T) {
	profile := DefaultModelCapabilityConfig("rolldek-gemini-omni-video").Video
	input := canvasGenerationInput{Mode: "video", Prompt: "人物转头", Config: providerConfig{InterfaceType: "rolldek-gemini-omni-video", Model: "gemini-omni-1.1-flash", VideoSeconds: "4", Size: "16:9", VQuality: "720p"},
		ReferenceImages: []providerMedia{{ID: "ref", URL: "https://cdn.example/ref.png"}, {ID: "start", URL: "https://cdn.example/start.png"}, {ID: "end", URL: "https://cdn.example/end.png"}},
		Metadata:        map[string]any{"videoStartFrameNodeId": "start", "videoEndFrameNodeId": "end", "videoEditOperation": "reference_to_video"}, VideoCapability: profile}
	if err := validateVideoTask(profile, input); err != nil {
		t.Fatal("one reference plus two frames rejected", err)
	}
	request := protocolRequestFromInput(input)
	if request.Images[0].Role != "reference_image" || request.Images[1].Role != "first_frame" || request.Images[2].Role != "last_frame" {
		t.Fatalf("mixed multimodal frame roles lost: %#v", request.Images)
	}
	input.ReferenceImages[2].ID = "ordinary2"
	if err := validateVideoTask(profile, input); err == nil {
		t.Fatal("two ordinary references accepted")
	}
	newLimit := 2
	profile.References.MaxReferenceImages = &newLimit
	if err := validateVideoTask(profile, input); err != nil {
		t.Fatal("administrator's adjusted ordinary limit ignored", err)
	}
	input.Config.VideoSeconds = "5"
	if err := validateVideoTask(profile, input); err == nil {
		t.Fatal("duration gap accepted")
	}
	legacy := DefaultModelCapabilityConfig("rolldek-wan-video").Video
	if legacy.References.MaxReferenceImages != nil {
		t.Fatal("new ordinary reference limit leaked to an existing protocol")
	}
	veo := DefaultModelCapabilityConfig("rolldek-veo-fast-video").Video
	if veo.References.MaxImages != 0 || veo.References.MaxVideos != 0 || veo.References.MaxAudios != 0 || !reflect.DeepEqual(veo.Duration.Values, []int{8}) {
		t.Fatal("Veo inherited Gemini capabilities")
	}
}

func TestRollDekVideoHostRetriesPollAndDownloadWithoutNewCreate(t *testing.T) {
	allowLoopbackProviderTest(t)
	adapter := loadRollDekGeminiTestAdapter(t)
	creates, polls, downloads := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing authenticated lifecycle request")
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/videos":
			if r.Method != "POST" {
				t.Error("create is not POST")
			}
			creates++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["duration"] != float64(4) || body["generateAudio"] != false || body["n"] != float64(1) {
				t.Errorf("request=%#v", body)
			}
			_, _ = w.Write([]byte(`{"id":"task-roll-1","status":"queued"}`))
		case "/v1/videos/task-roll-1":
			polls++
			if polls == 1 {
				w.WriteHeader(503)
				return
			}
			if polls == 2 {
				_, _ = w.Write([]byte(`{"id":"task-roll-1","status":"queued","metadata":{"url":"https://cdn.example/early.mp4"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":"task-roll-1","status":"completed"}`))
		case "/v1/videos/task-roll-1/content":
			downloads++
			if downloads == 1 {
				w.WriteHeader(502)
				return
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-test-bytes"))
		default:
			t.Errorf("wrong path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "video", Prompt: "柴犬", Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "gemini-omni-1.1-flash", InterfaceType: "rolldek-gemini-omni-video", VideoSeconds: "4", VQuality: "720p", Size: "16:9", VideoGenerateAudio: "false"}}
	result, err := runProtocolAdapterTaskWithPolicy(context.Background(), input, adapter, fastVideoPollPolicy())
	if err != nil || result["mode"] != "video" || creates != 1 || polls != 3 || downloads != 2 {
		t.Fatalf("result=%#v creates=%d polls=%d downloads=%d err=%v", result, creates, polls, downloads, err)
	}
	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ProviderRequestID: "task-roll-1"})
	if _, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy()); err != nil {
		t.Fatal("resume failed", err)
	}
	if creates != 1 {
		t.Fatal("resumed task created a second paid request")
	}
}
