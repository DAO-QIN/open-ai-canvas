package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestKlingOmniHostCreationAndResumeUseAuthenticatedContent(t *testing.T) {
	allowLoopbackProviderTest(t)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "kling-video-omni.yingce-plugin"))
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
	creates, polls, downloads := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("authentication missing")
		}
		switch r.URL.Path {
		case "/v1/videos":
			creates++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["model"] != "kling-video-v4" || body["duration_seconds"] != float64(5) || body["n"] != nil {
				t.Errorf("body=%#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-1","status":"queued"}`))
		case "/v1/videos/task-1":
			polls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-1","status":"completed","outputs":[{"content_url":"/v1/videos/task-1/content"}]}`))
		case "/v1/videos/task-1/content":
			downloads++
			if r.URL.Query().Get("download") != "1" {
				t.Error("download parameter missing")
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "video", Prompt: "海边日落", Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "kling-video-v4", InterfaceType: "kling-video-omni", VideoSeconds: "5"}}
	for _, resume := range []bool{false, true} {
		ctx := context.Background()
		if resume {
			ctx = withProviderAnalytics(ctx, nil, model.Task{ID: "host-task", Type: "canvas_video", ProviderRequestID: "task-1"})
		}
		result, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapters[0], fastVideoPollPolicy())
		if err != nil || result["mode"] != "video" {
			t.Fatalf("result=%#v error=%v", result, err)
		}
	}
	if creates != 1 || polls != 2 || downloads != 2 {
		t.Fatalf("create=%d poll=%d download=%d", creates, polls, downloads)
	}
}
