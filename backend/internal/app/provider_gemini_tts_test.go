package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"yingce/backend/internal/protocol"
)

func TestKacangGeminiTTSHostRequestAndStoredWAV(t *testing.T) {
	allowLoopbackProviderTest(t)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "kacang-gemini-tts.yingce-plugin"))
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
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/v1beta/models/gemini-3.8-flash-tts:generateContent" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("root path or authentication differs")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["model"] != "gemini-3.8-flash-tts" {
			t.Error("model differs")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/l16;rate=24000;channels=1", "data": base64.StdEncoding.EncodeToString([]byte{1, 2, 3, 4})}}}}}}})
	}))
	defer server.Close()
	config := providerConfig{Model: "gemini-3.8-flash-tts", BaseURL: server.URL + "/v1", APIKey: "test-key", InterfaceType: "kacang-gemini-tts", AudioVoice: "Kore", AudioInstructions: "自然、友好、清晰", AudioFormat: "wav"}
	result, err := runProtocolAdapterTask(context.Background(), canvasGenerationInput{Mode: "audio", Prompt: "你好", Config: config}, adapters[0])
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || result["mode"] != "audio" || result["audio"].(map[string]any)["mimeType"] != "audio/wav" {
		t.Fatal("host result differs", calls, result)
	}
	s := newResourceTestService(t)
	stored, err := s.persistLegacyGeneratedMediaResult("user-1", result)
	if err != nil {
		t.Fatal(err)
	}
	if stored["audio"].(map[string]any)["resourceId"] == "" {
		t.Fatal("resource ID missing")
	}
	rows, err := s.repo.Resources("user-1", 10)
	if err != nil || len(rows) != 1 {
		t.Fatal("one audio resource expected", err)
	}
}
