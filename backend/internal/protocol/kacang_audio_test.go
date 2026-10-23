package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestKacangSunoRequestAndReferences(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-audio.yingce-plugin", "kacang-suno")
	r := GenerationRequest{Capability: CapabilityAudio, Model: "suno-v6", Prompt: "温柔钢琴和轻柔弦乐，舒缓，纯器乐无人声", Extra: map[string]any{"audioInstrumental": true, "audioVoice": "alloy", "audioSpeed": 1.5, "audioFormat": "wav", "temperature": 0.7}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"model": "suno-v6", "messages": []any{map[string]any{"role": "user", "content": r.Prompt}}, "instrumental": true, "n": float64(1), "stream": false}
	if spec.Path != "/v1/chat/completions" || spec.Auth.Type != "bearer" || !reflect.DeepEqual(manifestTestBody(t, spec), want) {
		t.Fatalf("request differs from supplier contract: %#v", spec)
	}
	for _, invalid := range []GenerationRequest{{Model: "suno", Prompt: "  "}, {Model: "", Prompt: "music"}, {Model: "suno", Prompt: "music", Images: []MediaReference{{URL: "https://media.example/a.png"}}}, {Model: "suno", Prompt: "music", Videos: []MediaReference{{URL: "https://media.example/a.mp4"}}}, {Model: "suno", Prompt: "music", Audios: []MediaReference{{URL: "https://media.example/a.mp3"}}}} {
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: invalid}); err == nil {
			t.Fatalf("accepted unsupported input: %#v", invalid)
		}
	}
}

func TestMusicProtocolReusableModelsAndUTF16Limit(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-audio.yingce-plugin", "kacang-suno")
	for _, name := range []string{"suno", "suno-v5", "suno-v5.5", "suno-v6", "suno-v6-mini", "suno-v6-wild", "compatible-music-model"} {
		for _, instrumental := range []any{nil, false, true} {
			extra := map[string]any{}
			if instrumental != nil {
				extra["audioInstrumental"] = instrumental
			}
			spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: name, Prompt: "music", Extra: extra}})
			if err != nil {
				t.Fatal(name, err)
			}
			body := manifestTestBody(t, spec)
			if body["model"] != name || body["instrumental"] != instrumental {
				t.Fatalf("model or optional switch changed: %#v", body)
			}
		}
	}
	for _, tc := range []struct {
		prompt string
		limit  int
		valid  bool
	}{
		{strings.Repeat("你", 3000), 3000, true}, {strings.Repeat("你", 3001), 3000, false},
		{strings.Repeat("🎵", 1500), 3000, true}, {strings.Repeat("🎵", 1501), 3000, false},
		{strings.Repeat("你", 4000), 5000, true},
	} {
		_, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "suno-v6", Prompt: tc.prompt, Extra: map[string]any{"audioPromptMaxChars": tc.limit}}})
		if (err == nil) != tc.valid {
			t.Fatalf("UTF-16 limit %d accepted=%v, want %v", tc.limit, err == nil, tc.valid)
		}
	}
}

func TestKacangSunoObservedMusicResponse(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-audio.yingce-plugin", "kacang-suno")
	payload := map[string]any{"id": "chatcmpl-music", "choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": "[音乐音频 1](https://media.example/one.mp3?token=one)\n[音乐音频 2](https://media.example/two.mp3?token=two)"}}}}
	raw, _ := json.Marshal(payload)
	result, err := a.ParseCreate(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 2 {
		t.Fatalf("music output = %#v", result)
	}
	if result.Result.Audios[0].URL != "https://media.example/one.mp3?token=one" || result.Result.Audios[1].URL != "https://media.example/two.mp3?token=two" || !result.Result.Audios[1].Ephemeral {
		t.Fatal("order or signed query lost")
	}
	failed, err := a.ParseCreate(context.Background(), []byte(`{"error":{"message":"music failed"}}`))
	if err != nil || failed.Status != StatusFailed {
		t.Fatalf("supplier error = %#v %v", failed, err)
	}
	for _, text := range []string{"no audio available", "[link](javascript:alert(1))", "![cover](https://media.example/cover.png)"} {
		if values := audioMediaPathValues(map[string]any{"content": text}, "content"); len(values) != 0 {
			t.Fatalf("non-audio link parsed: %s", text)
		}
	}
	dupe := audioMediaPathValues(map[string]any{"content": "[1](https://media.example/a.mp3)\n[2](https://media.example/a.mp3)"}, "content")
	if len(dupe) != 1 {
		t.Fatal("duplicate track links were counted twice")
	}
}
