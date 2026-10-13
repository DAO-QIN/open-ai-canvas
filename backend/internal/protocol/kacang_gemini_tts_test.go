package protocol

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestKacangGeminiTTSRequestContract(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-gemini-tts.yingce-plugin", "kacang-gemini-tts")
	request := GenerationRequest{Capability: CapabilityAudio, Model: "gemini-3.8-flash-tts", Prompt: "你好，祝你今天心情愉快！", Extra: map[string]any{"audioVoice": "Puck", "audioInstructions": "轻松、愉快", "audioSpeed": 1.5, "audioFormat": "mp3"}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"model": request.Model, "contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": request.Prompt, "speech_metadata": map[string]any{"style": "轻松、愉快"}}}}}, "generationConfig": map[string]any{"responseModalities": []any{"AUDIO"}, "speechConfig": map[string]any{"voiceConfig": map[string]any{"voice": "Puck"}}}}
	if spec.Path != "/v1beta/models/gemini-3.8-flash-tts:generateContent" || !spec.OriginPath || spec.Auth.Type != "bearer" || !reflect.DeepEqual(manifestTestBody(t, spec), want) {
		t.Fatalf("unexpected TTS request: %#v", spec)
	}
	for _, voice := range []any{nil, "", "alloy"} {
		request.Extra = map[string]any{"audioVoice": voice}
		spec, err = a.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if pathValue(body, "generationConfig.speechConfig.voiceConfig.voice") != "Kore" || pathValue(body, "contents.0.parts.0.speech_metadata.style") != "自然、友好、清晰" {
			t.Fatal("missing defaults", body)
		}
	}
	for _, invalid := range []GenerationRequest{{Model: "suno", Prompt: "hello"}, {Model: request.Model, Prompt: "  "}, {Model: request.Model, Prompt: "hello", Images: []MediaReference{{URL: "https://media.example/a.png"}}}, {Model: request.Model, Prompt: "hello", Videos: []MediaReference{{URL: "https://media.example/a.mp4"}}}, {Model: request.Model, Prompt: "hello", Audios: []MediaReference{{URL: "https://media.example/a.wav"}}}} {
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: invalid}); err == nil {
			t.Fatalf("unsupported request accepted: %#v", invalid)
		}
	}
}

func ttsAudioPayload(parts ...map[string]any) []byte {
	items := make([]any, len(parts))
	for i, part := range parts {
		items[i] = part
	}
	raw, _ := json.Marshal(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": items}}}, "usageMetadata": map[string]any{"totalTokenCount": 12}})
	return raw
}

func ttsAudioPart(mimeType string, data []byte) map[string]any {
	return map[string]any{"inlineData": map[string]any{"mimeType": mimeType, "data": base64.StdEncoding.EncodeToString(data)}}
}

func TestKacangGeminiTTSPCMPartsBecomeOneWAV(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-gemini-tts.yingce-plugin", "kacang-gemini-tts")
	// Independent padded Base64 chunks can split a PCM sample boundary.
	result, err := a.ParseCreate(context.Background(), ttsAudioPayload(ttsAudioPart("audio/l16; rate=24000; channels=1", []byte{1}), map[string]any{"text": "ignored"}, ttsAudioPart("audio/L16;codec=pcm;rate=24000", []byte{2, 3, 4})))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 1 {
		t.Fatalf("result %#v, %v", result, err)
	}
	ref := result.Result.Audios[0]
	wav, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ref.DataURL, "data:audio/wav;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	if ref.MIMEType != "audio/wav" || len(wav) != 48 || string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" || binary.LittleEndian.Uint32(wav[4:8]) != 40 || binary.LittleEndian.Uint32(wav[24:28]) != 24000 || binary.LittleEndian.Uint16(wav[22:24]) != 1 || binary.LittleEndian.Uint16(wav[34:36]) != 16 || binary.LittleEndian.Uint32(wav[40:44]) != 4 || !bytes.Equal(wav[44:], []byte{1, 2, 3, 4}) {
		t.Fatal("WAV header or ordered PCM differs", wav)
	}
	if result.Result.Usage["totalTokenCount"] != float64(12) {
		t.Fatal("usage lost")
	}
	// A complete WAV must not acquire a second header on the next normalization.
	again, err := a.ParseCreate(context.Background(), ttsAudioPayload(ttsAudioPart("audio/wav", wav)))
	if err != nil || again.Result.Audios[0].DataURL != ref.DataURL {
		t.Fatal("complete WAV corrupted", err)
	}
}

func TestKacangGeminiTTSMalformedAudioFailsClosed(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-gemini-tts.yingce-plugin", "kacang-gemini-tts")
	for _, parts := range [][]map[string]any{
		nil, {ttsAudioPart("audio/l16", nil)}, {ttsAudioPart("audio/l16", []byte{1})},
		{ttsAudioPart("image/png", []byte{1, 2})}, {ttsAudioPart("audio/l16;rate=16000", []byte{1, 2})},
		{ttsAudioPart("audio/l16;channels=2", []byte{1, 2})}, {ttsAudioPart("audio/l16;codec=opus", []byte{1, 2})},
		{ttsAudioPart("audio/wav", []byte("not a WAV"))},
		{{"inlineData": map[string]any{"mimeType": "audio/l16", "data": "!!!"}}},
		{{"text": "no audio"}},
	} {
		if result, err := a.ParseCreate(context.Background(), ttsAudioPayload(parts...)); err == nil {
			t.Fatalf("invalid audio accepted: %#v, %#v", parts, result)
		}
	}
	for _, raw := range []string{`{"error":{"message":"generation failed"}}`, `{"promptFeedback":{"blockReason":"SAFETY"}}`, `{"candidates":[{"finishReason":"MAX_TOKENS"}]}`} {
		result, err := a.ParseCreate(context.Background(), []byte(raw))
		if err != nil || result.Status != StatusFailed {
			t.Fatalf("upstream failure lost: %#v %v", result, err)
		}
	}
}
