package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestXingAPISDVideoProfiles(t *testing.T) {
	for _, tc := range []struct {
		provider, model, resolution      string
		min, max, images, videos, audios int
	}{
		{"xingapi-sd-mini-480p", "seedance-2.0-mini-480P", "480p", 5, 10, 9, 0, 3},
		{"xingapi-sd-mini-720p", "seedance-2.0-mini-720P", "720p", 5, 15, 9, 0, 0},
		{"xingapi-sd-933", "seedance2.0-933", "720p", 4, 15, 9, 0, 3},
		{"xingapi-sd-933-v", "seedance2.0-933-V", "720p", 5, 15, 9, 3, 3},
		{"xingapi-sd25", "seedance2.5", "720p", 5, 30, 30, 10, 10},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "xingapi-sd-video.yingce-plugin", tc.provider)
			request := GenerationRequest{Model: tc.model, Prompt: "小猫在房间里跑"}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			want := map[string]any{"model": tc.model, "prompt": request.Prompt, "duration": float64(5), "ratio": "16:9", "resolution": tc.resolution}
			body := manifestTestBody(t, spec)
			if err != nil || spec.Path != "/v1/videos/generations" || spec.Method != "POST" || spec.Auth.Type != "bearer" || !reflect.DeepEqual(body, want) {
				t.Fatalf("create: %#v %v body=%#v", spec, err, body)
			}
			check := func(r GenerationRequest, valid bool) {
				t.Helper()
				_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
				if (err == nil) != valid {
					t.Fatalf("accepted=%v duration=%d resolution=%s err=%v", valid, r.Duration, r.Resolution, err)
				}
			}
			for _, seconds := range []int{tc.min, tc.max} {
				r := request
				r.Duration = seconds
				check(r, true)
			}
			for _, seconds := range []int{-1, tc.min - 1, tc.max + 1} {
				r := request
				r.Duration = seconds
				check(r, false)
			}
			for _, change := range []func(*GenerationRequest){
				func(r *GenerationRequest) { r.Model = "wrong" },
				func(r *GenerationRequest) { r.Prompt = "" },
				func(r *GenerationRequest) { r.Resolution = "1080p" },
				func(r *GenerationRequest) { r.AspectRatio = "1:1" },
				func(r *GenerationRequest) { r.GenerateAudio = true },
				func(r *GenerationRequest) { r.Watermark = true },
				func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "data:image/png;base64,YQ=="}} },
			} {
				r := request
				change(&r)
				check(r, false)
			}
			for kind, limit := range map[string]int{"images": tc.images, "videos": tc.videos, "audios": tc.audios} {
				for _, count := range []int{limit, limit + 1} {
					r := request
					media := make([]MediaReference, count)
					for i := range media {
						media[i] = MediaReference{URL: "https://cdn.example/reference"}
					}
					switch kind {
					case "images":
						r.Images = media
					case "videos":
						r.Videos = media
					case "audios":
						r.Audios = media
					}
					check(r, count == limit)
				}
			}
			poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "xing-task"})
			if err != nil || poll.Path != "/v1/videos/xing-task" || poll.Auth.Type != "bearer" {
				t.Fatalf("poll: %#v %v", poll, err)
			}
			result, err := adapter.(ResultAdapter).BuildResult(context.Background(), PollContext{TaskID: "xing-task"})
			if err != nil || result.Path != "/v1/videos/xing-task/content" || result.Headers["Accept"] != "video/mp4" || result.Auth.Type != "bearer" {
				t.Fatalf("content: %#v %v", result, err)
			}
			if _, err := adapter.BuildCancel(context.Background(), PollContext{TaskID: "xing-task"}); err == nil {
				t.Fatal("undocumented cancellation available")
			}
		})
	}
}

func TestXingAPISDVideoMediaAndResponses(t *testing.T) {
	adapter := officialPackageAdapter(t, "xingapi-sd-video.yingce-plugin", "xingapi-sd-mini-480p")
	r := GenerationRequest{Model: "seedance-2.0-mini-480P", Prompt: "猫", AspectRatio: "9:16", Resolution: "480P", Images: []MediaReference{{URL: "https://cdn.example/b.png", Order: 2}, {URL: "https://cdn.example/a.png", Order: 1}}, Audios: []MediaReference{{URL: "https://cdn.example/a.mp3"}}, Extra: map[string]any{"seconds": 99, "secret": "never-forward"}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if !reflect.DeepEqual(body["images"], []any{"https://cdn.example/a.png", "https://cdn.example/b.png"}) || !reflect.DeepEqual(body["audios"], []any{"https://cdn.example/a.mp3"}) || body["resolution"] != "480p" || len(body) != 7 {
		t.Fatalf("body=%#v", body)
	}
	for _, field := range []string{"id", "task_id"} {
		body, _ := json.Marshal(map[string]any{field: "xing-task", "status": "queued"})
		result, err := adapter.ParseCreate(context.Background(), body)
		if err != nil || result.TaskID != "xing-task" || result.Status != StatusPending {
			t.Fatalf("id %s: %#v %v", field, result, err)
		}
	}
	for _, tc := range []struct {
		status string
		want   Status
	}{
		{"queued", StatusPending}, {"pending", StatusPending}, {"running", StatusProcessing}, {"processing", StatusProcessing}, {"in_progress", StatusProcessing},
		{"success", StatusSucceeded}, {"completed", StatusSucceeded}, {"succeeded", StatusSucceeded}, {"done", StatusSucceeded}, {"finished", StatusSucceeded},
		{"failed", StatusFailed}, {"error", StatusFailed}, {"cancelled", StatusCancelled}, {"canceled", StatusCancelled},
	} {
		body, _ := json.Marshal(map[string]any{"status": tc.status, "error": map[string]any{"message": "rejected"}})
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "xing-task"}, body)
		if err != nil || result.TaskID != "xing-task" || result.Status != tc.want {
			t.Fatalf("status %s: %#v %v", tc.status, result, err)
		}
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"error":{"code":"invalid_request","message":"rejected"}}`))
	if err != nil || result.Status != StatusFailed || result.Message != "rejected" {
		t.Fatalf("error %#v %v", result, err)
	}
}
