package app

import (
	"context"
	"encoding/base64"
	"testing"
	"yingce/backend/internal/protocol"
)

func TestKacangSunoStoresTwoTracksWithoutDuplicatePrimary(t *testing.T) {
	s := newResourceTestService(t)
	items := []interface{}{map[string]interface{}{"dataUrl": "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString([]byte("ID3first"))}, map[string]interface{}{"dataUrl": "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString([]byte("ID3second"))}}
	stored, err := s.persistLegacyGeneratedMediaResult("user-1", map[string]interface{}{"mode": "audio", "audios": items})
	if err != nil {
		t.Fatal(err)
	}
	tracks := stored["audios"].([]interface{})
	first := tracks[0].(map[string]interface{})
	second := tracks[1].(map[string]interface{})
	if first["resourceId"] == second["resourceId"] || stored["audio"].(map[string]interface{})["resourceId"] != first["resourceId"] {
		t.Fatal("track identity lost")
	}
	rows, err := s.repo.Resources("user-1", 10)
	if err != nil || len(rows) != 2 {
		t.Fatalf("stored %d resources, want exactly two: %v", len(rows), err)
	}
}

func TestKacangSunoAudioCapabilities(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("kacang-suno", "suno")
	if profile.Audio == nil || profile.Audio.TaskCount != 1 || profile.Audio.OutputCount != 2 || profile.Audio.Streaming {
		t.Fatalf("default profile = %#v", profile)
	}
	normalized, err := NormalizeModelCapabilityConfigForModel("audio", "kacang-suno", "suno", nil)
	if err != nil || normalized.Audio == nil {
		t.Fatal("music defaults missing", err)
	}
	invalid := *profile.Audio
	invalid.TaskCount = 2
	if _, err := NormalizeModelCapabilityConfig("audio", "kacang-suno", &ModelCapabilityConfig{Audio: &invalid}); err == nil {
		t.Fatal("mutable music task count accepted")
	}
	for _, name := range []string{"openai-audio", "async-audio", "doubao-streaming-tts"} {
		value, err := NormalizeModelCapabilityConfig("audio", name, nil)
		if err != nil || value != nil {
			t.Fatal("existing speech behavior changed", name)
		}
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(normalized, "audio")
	if err != nil || len(spec.Inputs) != 3 || len(spec.Options) != 0 {
		t.Fatal("music reference/option constraints missing")
	}
	for _, kind := range []string{"image", "video", "audio"} {
		if spec.Inputs[kind].Max != 0 {
			t.Fatal("music references allowed")
		}
	}
}

func TestKacangSunoIncompleteOutputsFailBeforeDownload(t *testing.T) {
	_, err := finishProtocolResult(context.Background(), providerConfig{InterfaceType: "kacang-suno"}, "audio", "", &protocol.Result{Audios: []protocol.MediaReference{{URL: "https://media.example/one.mp3"}}}, defaultVideoPollPolicy())
	if err == nil {
		t.Fatal("one track incorrectly accepted as complete music result")
	}
}
