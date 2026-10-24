package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestKlingOmniRequestsAndReferenceOrder(t *testing.T) {
	a := officialPackageAdapter(t, "kling-video-omni.yingce-plugin", "kling-video-omni")
	r := GenerationRequest{Model: "kling-video-v4", Prompt: "海边日落，鲸鱼跃出海面"}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"model": r.Model, "prompt": r.Prompt, "duration_seconds": float64(6), "aspect_ratio": "16:9", "resolution": "720p"}
	if spec.Method != "POST" || spec.Path != "/v1/videos" || spec.Auth.Type != "bearer" || !reflect.DeepEqual(manifestTestBody(t, spec), want) {
		t.Fatalf("create=%#v body=%#v", spec, manifestTestBody(t, spec))
	}
	r.Model = "another-compatible-model"
	r.Output = OutputOptions{Duration: 30, Resolution: "1080P", AspectRatio: "21:9"}
	r.Images = []MediaReference{{URL: "https://example.com/frame.png", Role: "first_frame"}, {URL: "https://example.com/ref.png", Role: "reference_image"}}
	r.Videos = []MediaReference{{URL: "https://example.com/late.mp4", Order: 2, Metadata: map[string]any{"durationMs": 1750}}, {URL: "https://example.com/early.mp4", Order: 1, Metadata: map[string]any{"durationMs": 2250}}}
	r.Audios = []MediaReference{{URL: "https://example.com/music.mp3", Role: "reference_audio"}}
	r.Extra = map[string]any{"apiKey": "do-not-forward", "duration_seconds": 999}
	spec, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["model"] != r.Model || body["resolution"] != "1080p" || body["duration_seconds"] != float64(30) || body["first_frame_url"] != r.Images[0].URL || !reflect.DeepEqual(body["reference_videos"], []any{r.Videos[1].URL, r.Videos[0].URL}) || !reflect.DeepEqual(body["referenceVideoDurations"], []any{2.25, 1.75}) || body["apiKey"] != nil {
		t.Fatalf("mapping=%#v", body)
	}
}

func TestKlingOmniRejectsInvalidMediaAndLimits(t *testing.T) {
	a := officialPackageAdapter(t, "kling-video-omni.yingce-plugin", "kling-video-omni")
	media := func(n int) []MediaReference {
		out := make([]MediaReference, n)
		for i := range out {
			out[i] = MediaReference{URL: "https://example.com/ref", Metadata: map[string]any{"durationMs": 1000}}
		}
		return out
	}
	for name, change := range map[string]func(*GenerationRequest){
		"blank prompt": func(r *GenerationRequest) { r.Prompt = " " },
		"blank model":  func(r *GenerationRequest) { r.Model = " " },
		"short":        func(r *GenerationRequest) { r.Duration = 2 },
		"long":         func(r *GenerationRequest) { r.Duration = 31 },
		"negative":     func(r *GenerationRequest) { r.Duration = -1 },
		"ratio":        func(r *GenerationRequest) { r.AspectRatio = "4:3" },
		"resolution":   func(r *GenerationRequest) { r.Resolution = "4k" },
		"tail":         func(r *GenerationRequest) { r.Images = media(1); r.Images[0].Role = "last_frame" },
		"two first frames": func(r *GenerationRequest) {
			r.Images = media(2)
			for i := range r.Images {
				r.Images[i].Role = "first_frame"
			}
		},
		"inline":               func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "data:image/png;base64,YQ=="}} },
		"images":               func(r *GenerationRequest) { r.Images = media(11) },
		"videos":               func(r *GenerationRequest) { r.Videos = media(6) },
		"audios":               func(r *GenerationRequest) { r.Audios = media(4) },
		"combined":             func(r *GenerationRequest) { r.Images = media(10); r.Videos = media(5); r.Audios = media(1) },
		"unknown duration":     func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://example.com/a.mp4"}} },
		"nonpositive duration": func(r *GenerationRequest) { r.Videos = media(1); r.Videos[0].Metadata["durationMs"] = -1 },
		"combined duration": func(r *GenerationRequest) {
			r.Videos = media(2)
			for i := range r.Videos {
				r.Videos[i].Metadata["durationMs"] = 15001
			}
		},
		"audio switch": func(r *GenerationRequest) { r.GenerateAudio = true },
		"watermark":    func(r *GenerationRequest) { r.Watermark = true },
		"count":        func(r *GenerationRequest) { r.Output.Count = 2 },
	} {
		t.Run(name, func(t *testing.T) {
			r := GenerationRequest{Model: "kling-video-v4", Prompt: "鲸鱼跃出海面"}
			change(&r)
			if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	r := GenerationRequest{Model: "kling-video-v4", Prompt: "海面", Duration: 3, Images: media(7), Videos: media(5), Audios: media(3)}
	for i := range r.Videos {
		r.Videos[i].Metadata["durationMs"] = 6000
	}
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err != nil {
		t.Fatal("exact limits rejected", err)
	}
}

func TestKlingOmniTaskStatesAndAuthenticatedResult(t *testing.T) {
	a := officialPackageAdapter(t, "kling-video-omni.yingce-plugin", "kling-video-omni")
	ctx := context.Background()
	for _, field := range []string{"id", "task_id"} {
		raw, _ := json.Marshal(map[string]any{field: "task-1", "status": "queued"})
		result, err := a.ParseCreate(ctx, raw)
		if err != nil || result.TaskID != "task-1" || result.Status != StatusPending {
			t.Fatalf("create=%#v %v", result, err)
		}
	}
	for status, want := range map[string]Status{"queued": StatusPending, "in_progress": StatusProcessing, "completed": StatusSucceeded, "failed": StatusFailed} {
		raw, _ := json.Marshal(map[string]any{"status": status})
		result, err := a.ParsePoll(ctx, PollContext{TaskID: "task-1"}, raw)
		if err != nil || result.TaskID != "task-1" || result.Status != want {
			t.Fatalf("status=%#v %v", result, err)
		}
	}
	result, err := a.ParseCreate(ctx, []byte(`{"id":"task-1","status":"completed","outputs":[{"content_url":"/v1/videos/task-1/content"}]}`))
	if err != nil || result.Status != StatusSucceeded || (result.Result != nil && len(result.Result.Videos) > 0) {
		t.Fatalf("relative output=%#v %v", result, err)
	}
	poll, err := a.BuildPoll(ctx, PollContext{TaskID: "task-1"})
	if err != nil || poll.Path != "/v1/videos/task-1" || poll.Auth.Type != "bearer" {
		t.Fatalf("poll=%#v %v", poll, err)
	}
	download, err := a.(ResultAdapter).BuildResult(ctx, PollContext{TaskID: "task-1"})
	if err != nil || download.Path != "/v1/videos/task-1/content" || len(download.Query["download"]) != 1 || download.Query["download"][0] != "1" || download.Auth.Type != "bearer" {
		t.Fatalf("download=%#v %v", download, err)
	}
	result, err = a.ParseCreate(ctx, []byte(`{"id":"task-1","status":"completed","outputs":[{"content_url":"https://example.com/new.mp4"}],"url":"https://example.com/old.mp4"}`))
	if err != nil || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://example.com/new.mp4" || !result.Result.Videos[0].Ephemeral {
		t.Fatalf("output=%#v %v", result, err)
	}
	result, err = a.ParseCreate(ctx, []byte(`{"error":{"code":"bad_request","message":"rejected"}}`))
	if err != nil || result.Status != StatusFailed || result.Message != "rejected" {
		t.Fatalf("error=%#v %v", result, err)
	}
	if _, err = a.BuildCancel(ctx, PollContext{TaskID: "task-1"}); err == nil {
		t.Fatal("undocumented cancel enabled")
	}
}
