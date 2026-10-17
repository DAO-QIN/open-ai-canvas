package protocol

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestYunfeiOmniDocumentedJSONAndReferences(t *testing.T) {
	a := officialPackageAdapter(t, "yunfei-omni-video.yingce-plugin", "yunfei-omni-flash-video")
	r := GenerationRequest{Model: "gemini-omni-1.1-flash", Prompt: "参考角色奔跑", Duration: 10, Resolution: "720P", AspectRatio: "9:16",
		Images:          []MediaReference{{URL: "https://cdn.example/ref.png", Role: "subject_reference"}},
		Videos:          []MediaReference{{URL: "https://cdn.example/2.mp4", Order: 2}, {URL: "https://cdn.example/1.mp4", Order: 1}},
		Audios:          []MediaReference{{DataURL: "data:audio/mpeg;base64,AA==", Role: "reference_audio"}},
		ProviderOptions: map[string]map[string]any{"yunfei-omni-flash-video": {"seed": 1, "generateAudio": true, "body": map[string]any{"model": "another"}}}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{BaseURL: "https://img.yunfei.best/v1", Request: r})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/v1/videos" || !spec.OriginPath || spec.Auth.Type != "bearer" || spec.ContentType != "application/json" {
		t.Fatalf("create=%#v", spec)
	}
	want := map[string]any{"model": r.Model, "prompt": r.Prompt, "duration": float64(10), "resolution": "720p", "aspect_ratio": "9:16",
		"reference_images": []any{map[string]any{"url": "https://cdn.example/ref.png", "role": "reference"}},
		"reference_videos": []any{"https://cdn.example/1.mp4", "https://cdn.example/2.mp4"},
		"reference_audios": []any{"data:audio/mpeg;base64,AA=="}}
	if got := manifestTestBody(t, spec); !reflect.DeepEqual(got, want) {
		t.Fatalf("body=%#v\nwant=%#v", got, want)
	}
	r.Videos, r.Audios = nil, nil
	r.Images = []MediaReference{{URL: "https://cdn.example/end.png", Role: "last_frame", Order: 2}, {DataURL: "data:image/png;base64,AA==", Role: "first_frame", Order: 1}}
	spec, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	wantFrames := []any{map[string]any{"url": "data:image/png;base64,AA==", "role": "first_frame"}, map[string]any{"url": "https://cdn.example/end.png", "role": "last_frame"}}
	if got := manifestTestBody(t, spec)["reference_images"]; !reflect.DeepEqual(got, wantFrames) {
		t.Fatalf("frames=%#v", got)
	}
}

func TestYunfeiOmniDefaultsOmitUndocumentedFieldsAndRejectInvalidRequests(t *testing.T) {
	a := officialPackageAdapter(t, "yunfei-omni-video.yingce-plugin", "yunfei-omni-flash-video")
	r := GenerationRequest{Model: "gemini-omni-1.1-flash", Prompt: "小猫在房间里奔跑"}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"model": r.Model, "prompt": r.Prompt, "duration": float64(10), "resolution": "720p", "aspect_ratio": "16:9"}
	if got := manifestTestBody(t, spec); !reflect.DeepEqual(got, want) {
		t.Fatalf("defaults=%#v", got)
	}
	for _, model := range []string{"gemini-omni-1.1-flash", "gemini-omni-1.1-flash-10s"} {
		for _, ratio := range []string{"16:9", "9:16"} {
			next := r
			next.Model, next.AspectRatio = model, ratio
			created, err := a.BuildCreate(context.Background(), RequestContext{Request: next})
			if err != nil || manifestTestBody(t, created)["model"] != model || manifestTestBody(t, created)["aspect_ratio"] != ratio {
				t.Fatalf("model=%s ratio=%s: %v", model, ratio, err)
			}
		}
	}
	for name, mutate := range map[string]func(*GenerationRequest){
		"old-alias":        func(r *GenerationRequest) { r.Model = "omni-flash" },
		"extend-operation": func(r *GenerationRequest) { r.Model = "gemini-omni-1.1-flash-extend" },
		"empty-prompt":     func(r *GenerationRequest) { r.Prompt = " \n " },
		"duration":         func(r *GenerationRequest) { r.Duration = 4 },
		"ratio":            func(r *GenerationRequest) { r.AspectRatio = "1:1" },
		"resolution":       func(r *GenerationRequest) { r.Resolution = "1080p" },
		"multiple-output":  func(r *GenerationRequest) { r.ImageCount = 2 },
		"audio-control":    func(r *GenerationRequest) { r.GenerateAudio = true },
		"watermark":        func(r *GenerationRequest) { r.Watermark = true },
		"unknown-role": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "mask"}}
		},
		"local-path": func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "file:///private/a.mp4"}} },
		"two-first-frames": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/1.png", Role: "first_frame"}, {URL: "https://cdn.example/2.png", Role: "first_frame"}}
		},
		"mixed-reference-and-frame": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/1.png", Role: "first_frame"}, {URL: "https://cdn.example/2.png", Role: "reference_image"}}
		},
		"frame-with-audio": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/1.png", Role: "first_frame"}}
			r.Audios = []MediaReference{{URL: "https://cdn.example/a.mp3"}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			next := r
			mutate(&next)
			if _, err := a.BuildCreate(context.Background(), RequestContext{Request: next}); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}

func TestYunfeiOmniLifecycleOutputFallbackAndErrors(t *testing.T) {
	a := officialPackageAdapter(t, "yunfei-omni-video.yingce-plugin", "yunfei-omni-flash-video")
	for _, tc := range []struct {
		body   string
		status Status
		url    string
	}{
		{`{"id":"task-1","status":"queued","url":"https://cdn.example/early.mp4"}`, StatusPending, ""},
		{`{"status":"in_progress"}`, StatusProcessing, ""},
		{`{"status":"processing"}`, StatusProcessing, ""},
		{`{"status":"completed","url":"https://cdn.example/done.mp4","output":[{"url":"https://cdn.example/done.mp4"}]}`, StatusSucceeded, "https://cdn.example/done.mp4"},
		{`{"status":"completed","output":[{"url":"https://cdn.example/output.mp4"}]}`, StatusSucceeded, "https://cdn.example/output.mp4"},
		{`{"status":"completed","url":"/relative.mp4","output":[{}, {"url":"https://cdn.example/fallback.mp4"}]}`, StatusSucceeded, "https://cdn.example/fallback.mp4"},
		{`{"status":"completed"}`, StatusSucceeded, ""},
		{`{"status":"failed","error":"blocked"}`, StatusFailed, ""},
		{`{"status":"completed","error":{"message":"rejected"},"url":"https://cdn.example/error.mp4"}`, StatusFailed, ""},
		{`{"status":"unexpected"}`, StatusFailed, ""},
		{`{}`, StatusFailed, ""},
	} {
		got, err := a.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(tc.body))
		if err != nil {
			t.Fatal(err)
		}
		var videos []MediaReference
		if got.Result != nil {
			videos = got.Result.Videos
		}
		if got.TaskID != "task-1" || got.Status != tc.status || (tc.url == "" && len(videos) != 0) || (tc.url != "" && (len(videos) != 1 || videos[0].URL != tc.url || !videos[0].Ephemeral)) {
			t.Fatalf("%s: %#v videos=%#v", tc.body, got, videos)
		}
		if strings.Contains(tc.body, `"blocked"`) && got.Message != "blocked" {
			t.Fatalf("string error lost: %#v", got)
		}
	}
	spec, err := a.BuildPoll(context.Background(), PollContext{TaskID: "task-1"})
	if err != nil || spec.Path != "/v1/videos/task-1" || spec.Method != "GET" || !spec.OriginPath || spec.Auth.Type != "bearer" {
		t.Fatalf("poll=%#v err=%v", spec, err)
	}
	if a.(ResultCapability).ResultAvailable() {
		t.Fatal("undocumented content endpoint exposed")
	}
}
