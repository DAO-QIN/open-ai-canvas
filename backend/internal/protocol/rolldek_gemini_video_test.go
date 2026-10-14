package protocol

import (
	"context"
	"reflect"
	"testing"
)

func TestRollDekGeminiFlatJSONAndExplicitFrames(t *testing.T) {
	a := officialPackageAdapter(t, "rolldek-gemini-video.yingce-plugin", "rolldek-gemini-omni-video")
	r := GenerationRequest{Model: "gemini-omni-1.1-flash", Prompt: "保持角色外观", Duration: 6, AspectRatio: "9:16", Resolution: "720P", GenerateAudio: false,
		Images: []MediaReference{{URL: "https://cdn.example/end.png", Role: "last_frame", Order: 3}, {URL: "https://cdn.example/ref.png", Role: "reference_image", Order: 2}, {URL: "https://cdn.example/start.png", Role: "first_frame", Order: 1}},
		Videos: []MediaReference{{URL: "https://cdn.example/motion.mp4", Role: "reference_video"}}, Audios: []MediaReference{{URL: "https://cdn.example/voice.wav", Role: "reference_audio"}},
		ProviderOptions: map[string]map[string]any{"rolldek-gemini-omni-video": {"preprocess": false, "seed": 0, "unknown": "do not send"}}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{BaseURL: "https://rolldek.com/v1", Request: r})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/videos" || spec.Method != "POST" || !spec.OriginPath || spec.Auth.Type != "bearer" || spec.ContentType != "application/json" {
		t.Fatalf("spec=%#v", spec)
	}
	body := manifestTestBody(t, spec)
	want := map[string]any{"model": r.Model, "prompt": r.Prompt, "duration": float64(6), "aspect_ratio": "9:16", "resolution": "720p", "n": float64(1), "generateAudio": false,
		"images": []any{"https://cdn.example/ref.png"}, "first_frame_url": "https://cdn.example/start.png", "last_frame_url": "https://cdn.example/end.png",
		"videos": []any{"https://cdn.example/motion.mp4"}, "audios": []any{"https://cdn.example/voice.wav"}, "preprocess": false, "seed": float64(0)}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("body=%#v\nwant=%#v", body, want)
	}
	r.Images = []MediaReference{{URL: "https://cdn.example/2.png", Order: 2}, {URL: "https://cdn.example/1.png", Order: 1}}
	spec, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestTestBody(t, spec)["images"]; !reflect.DeepEqual(got, []any{"https://cdn.example/1.png", "https://cdn.example/2.png"}) {
		t.Fatalf("reference order=%#v", got)
	}
}

func TestRollDekGeminiDefaultsAndValidation(t *testing.T) {
	a := officialPackageAdapter(t, "rolldek-gemini-video.yingce-plugin", "rolldek-gemini-omni-video")
	r := GenerationRequest{Model: "gemini-omni-1.1-flash", Prompt: "一只柴犬"}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["duration"] != float64(4) || body["resolution"] != "720p" || body["aspect_ratio"] != "16:9" || body["generateAudio"] != false {
		t.Fatalf("defaults=%#v", body)
	}
	for _, key := range []string{"preprocess", "seed", "images", "videos", "audios", "seconds", "size", "reference_images", "metadata"} {
		if _, ok := body[key]; ok {
			t.Fatalf("unrequested field %s sent", key)
		}
	}
	for _, seconds := range []int{4, 6, 8, 10} {
		r.Duration = seconds
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err != nil {
			t.Fatalf("duration %d: %v", seconds, err)
		}
	}
	for name, mutate := range map[string]func(*GenerationRequest){
		"wrong-model":       func(r *GenerationRequest) { r.Model = "gemini-omni-flash-1.1" },
		"blank-prompt":      func(r *GenerationRequest) { r.Prompt = "  " },
		"duration-gap":      func(r *GenerationRequest) { r.Duration = 5 },
		"negative-duration": func(r *GenerationRequest) { r.Duration = -1 },
		"bad-resolution":    func(r *GenerationRequest) { r.Resolution = "1080p" },
		"bad-ratio":         func(r *GenerationRequest) { r.AspectRatio = "1:1" },
		"multiple-output":   func(r *GenerationRequest) { r.ImageCount = 2 },
		"watermark":         func(r *GenerationRequest) { r.Watermark = true },
		"data-url":          func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "data:image/png;base64,AA=="}} },
		"http-url":          func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "http://cdn.example/a.mp4"}} },
		"unknown-role": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "mask"}}
		},
		"two-first-frames": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "first_frame"}, {URL: "https://cdn.example/b.png", Role: "first_frame"}}
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

func TestRollDekVideoLifecycleDoesNotFinishEarly(t *testing.T) {
	a := officialPackageAdapter(t, "rolldek-gemini-video.yingce-plugin", "rolldek-gemini-omni-video")
	for _, tc := range []struct {
		body   string
		status Status
		videos int
	}{
		{`{"id":"task-1","status":"queued","metadata":{"url":"https://cdn.example/early.mp4"}}`, StatusPending, 0},
		{`{"id":"task-1","status":"in_progress"}`, StatusProcessing, 0},
		{`{"id":"task-1","status":"completed","metadata":{"url":"https://rolldek.com/v1/videos/task-1/content"}}`, StatusSucceeded, 1},
		{`{"status":"completed","video_url":"https://cdn.example/done.mp4"}`, StatusSucceeded, 1},
		{`{"status":"completed","url":"/v1/videos/task-1/content"}`, StatusSucceeded, 0},
		{`{"status":"failed","error":{"message":"blocked"},"metadata":{"url":"https://cdn.example/error.mp4"}}`, StatusFailed, 0},
		{`{"status":"completed","error":{"message":"failed"}}`, StatusFailed, 0},
		{`{"status":"unexpected"}`, StatusFailed, 0},
		{`{}`, StatusFailed, 0},
	} {
		got, err := a.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(tc.body))
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		if got.Result != nil {
			count = len(got.Result.Videos)
		}
		if got.TaskID != "task-1" || got.Status != tc.status || count != tc.videos {
			t.Fatalf("response %s: %#v", tc.body, got)
		}
	}
	for name, build := range map[string]func(context.Context, PollContext) (RequestSpec, error){"poll": a.BuildPoll, "result": a.(ResultAdapter).BuildResult} {
		spec, err := build(context.Background(), PollContext{TaskID: "task-1"})
		if err != nil || !spec.OriginPath || spec.Auth.Type != "bearer" || spec.Method != "GET" {
			t.Fatalf("%s spec=%#v err=%v", name, spec, err)
		}
		want := "/v1/videos/task-1"
		if name == "result" {
			want += "/content"
		}
		if spec.Path != want {
			t.Fatalf("path=%s", spec.Path)
		}
	}
}

func TestRollDekVeoFastOnlyOpensDocumentedProfile(t *testing.T) {
	a := officialPackageAdapter(t, "rolldek-gemini-video.yingce-plugin", "rolldek-veo-fast-video")
	r := GenerationRequest{Model: "veo-3.1-fast", Prompt: "柴犬跑过樱花树"}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if len(body) != 6 || body["duration"] != float64(8) || body["resolution"] != "720p" || body["aspect_ratio"] != "16:9" || body["n"] != float64(1) {
		t.Fatalf("Veo body=%#v", body)
	}
	for _, next := range []GenerationRequest{{Model: "veo-3.1-lite", Prompt: r.Prompt}, {Model: r.Model, Prompt: r.Prompt, Duration: 6}, {Model: r.Model, Prompt: r.Prompt, AspectRatio: "9:16"}, {Model: r.Model, Prompt: r.Prompt, Images: []MediaReference{{URL: "https://cdn.example/a.png"}}}, {Model: r.Model, Prompt: r.Prompt, GenerateAudio: true}} {
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: next}); err == nil {
			t.Fatalf("unverified Veo combination accepted: %#v", next)
		}
	}
}
