package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestKacangVideoDefaultRequestsAndLimits(t *testing.T) {
	for _, tc := range []struct {
		provider, model, resolution       string
		min, max, seconds, images, videos int
	}{
		{"kacang-gemini-omni-video", "gemini-omni-flash-1.1", "720p", 3, 10, 3, 4, 1},
		{"kacang-grok-video-15", "grok-imagine-video-1.5", "480p", 4, 15, 8, 14, 0},
		{"kacang-kling-video-30", "可灵3.0-特惠", "720p", 1, 15, 5, 1, 0},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "kacang-video.yingce-plugin", tc.provider)
			request := GenerationRequest{Model: tc.model, Prompt: "成年女性氛围感人像，微风吹动头发，镜头缓慢推进"}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"model": tc.model, "prompt": request.Prompt, "duration_seconds": float64(tc.seconds), "aspect_ratio": "16:9", "resolution": tc.resolution, "n": float64(1)}
			if spec.Method != "POST" || spec.Path != "/v1/videos" || spec.Auth.Type != "bearer" || spec.ContentType != "application/json" || !reflect.DeepEqual(manifestTestBody(t, spec), want) {
				t.Fatalf("create=%#v body=%#v", spec, manifestTestBody(t, spec))
			}
			check := func(r GenerationRequest, valid bool) {
				t.Helper()
				_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
				if (err == nil) != valid {
					t.Fatalf("valid=%v request=%#v error=%v", valid, r, err)
				}
			}
			for _, seconds := range []int{tc.min, tc.max} {
				r := request
				r.Duration = seconds
				check(r, true)
			}
			for _, seconds := range []int{-1, tc.min - 1, tc.max + 1} {
				if seconds == 0 {
					continue
				}
				r := request
				r.Duration = seconds
				check(r, false)
			}
			for _, change := range []func(*GenerationRequest){
				func(r *GenerationRequest) { r.Model = "wrong" },
				func(r *GenerationRequest) { r.Prompt = "  " },
				func(r *GenerationRequest) { r.Resolution = "2160p" },
				func(r *GenerationRequest) { r.AspectRatio = "21:9" },
				func(r *GenerationRequest) { r.GenerateAudio = true },
				func(r *GenerationRequest) { r.Watermark = true },
				func(r *GenerationRequest) { r.Output.Count = 2 },
				func(r *GenerationRequest) {
					r.Images = []MediaReference{{URL: "https://example.com/ref", Role: "last_frame"}}
				},
				func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://example.com/a.mp3"}} },
			} {
				r := request
				change(&r)
				check(r, false)
			}
			for kind, limit := range map[string]int{"images": tc.images, "videos": tc.videos} {
				r := request
				media := make([]MediaReference, limit+1)
				for i := range media {
					media[i] = MediaReference{URL: "https://example.com/ref"}
				}
				if kind == "images" {
					r.Images = media
				} else {
					r.Videos = media
				}
				check(r, false)
			}
			poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task-1"})
			if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/task-1" || poll.Auth.Type != "bearer" {
				t.Fatalf("poll=%#v %v", poll, err)
			}
			result, err := adapter.(ResultAdapter).BuildResult(context.Background(), PollContext{TaskID: "task-1"})
			if err != nil || result.Path != "/v1/videos/task-1/content" || len(result.Query["download"]) != 1 || result.Query["download"][0] != "1" || result.Auth.Type != "bearer" {
				t.Fatalf("result=%#v %v", result, err)
			}
			if _, err := adapter.BuildCancel(context.Background(), PollContext{TaskID: "task-1"}); err == nil {
				t.Fatal("undocumented cancellation available")
			}
		})
	}
}

func TestKacangVideoMediaRoles(t *testing.T) {
	ctx := context.Background()
	gemini := officialPackageAdapter(t, "kacang-video.yingce-plugin", "kacang-gemini-omni-video")
	r := GenerationRequest{Model: "gemini-omni-flash-1.1", Prompt: "产品视频", Images: []MediaReference{
		{URL: "https://example.com/element.png", Role: "subject_reference", Order: 3},
		{URL: "https://example.com/style.png", Role: "style_reference", Order: 2},
		{URL: "https://example.com/frame.png", Role: "first_frame", Order: 1},
	}, Videos: []MediaReference{{URL: "https://example.com/source.mp4", Role: "reference_video"}}}
	spec, err := gemini.BuildCreate(ctx, RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if !reflect.DeepEqual(body["images"], []any{"https://example.com/frame.png"}) || !reflect.DeepEqual(body["style_references"], []any{"https://example.com/style.png"}) || !reflect.DeepEqual(body["element_references"], []any{"https://example.com/element.png"}) || body["input_video"] != "https://example.com/source.mp4" {
		t.Fatalf("body=%#v", body)
	}
	r.Images = append(r.Images, MediaReference{URL: "https://example.com/style2.png", Role: "style_reference"})
	if _, err := gemini.BuildCreate(ctx, RequestContext{Request: r}); err == nil {
		t.Fatal("five total references accepted")
	}
	r.Images = []MediaReference{{URL: "https://example.com/a.png"}, {URL: "https://example.com/b.png"}}
	r.Videos = nil
	if _, err := gemini.BuildCreate(ctx, RequestContext{Request: r}); err == nil {
		t.Fatal("two ordinary frames accepted")
	}
	grok := officialPackageAdapter(t, "kacang-video.yingce-plugin", "kacang-grok-video-15")
	r = GenerationRequest{Model: "grok-imagine-video-1.5", Prompt: "人像", Resolution: "1080P", Images: []MediaReference{{URL: "https://example.com/b.png", Role: "reference_image", Order: 2}, {URL: "https://example.com/a.png", Role: "reference_image", Order: 1}}}
	spec, err = grok.BuildCreate(ctx, RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	if !reflect.DeepEqual(body["images"], []any{"https://example.com/a.png", "https://example.com/b.png"}) || body["image"] != nil || body["resolution"] != "1080p" {
		t.Fatalf("body=%#v", body)
	}
	r.Images[0].Role = "first_frame"
	if _, err := grok.BuildCreate(ctx, RequestContext{Request: r}); err == nil {
		t.Fatal("mixed first frame and references accepted")
	}
	r.Images = []MediaReference{{URL: "https://example.com/a.png", Role: "first_frame"}}
	spec, err = grok.BuildCreate(ctx, RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	if body["image"] != "https://example.com/a.png" || body["images"] != nil {
		t.Fatalf("single frame=%#v", body)
	}
	r.Images = []MediaReference{{DataURL: "data:image/png;base64,YQ=="}}
	if _, err := grok.BuildCreate(ctx, RequestContext{Request: r}); err == nil {
		t.Fatal("Grok inline media accepted")
	}
	kling := officialPackageAdapter(t, "kacang-video.yingce-plugin", "kacang-kling-video-30")
	r = GenerationRequest{Model: "可灵3.0-特惠", Prompt: "人像", Duration: 5, Output: OutputOptions{Duration: 7, AspectRatio: "9:16"}, Images: []MediaReference{{URL: "https://example.com/a.png", Role: "first_frame"}}, ProviderOptions: map[string]map[string]any{"kacang-kling-video-30": {"negativePrompt": "模糊", "secret": "never-forward"}}, Extra: map[string]any{"apiKey": "never-forward", "duration_seconds": 99}}
	spec, err = kling.BuildCreate(ctx, RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	if body["duration_seconds"] != float64(7) || body["aspect_ratio"] != "9:16" || body["first_frame_url"] != "https://example.com/a.png" || body["negative_prompt"] != "模糊" || len(body) != 8 {
		t.Fatalf("body=%#v", body)
	}
}

func TestKacangVideoResponses(t *testing.T) {
	a := officialPackageAdapter(t, "kacang-video.yingce-plugin", "kacang-kling-video-30")
	for _, field := range []string{"id", "task_id"} {
		raw, _ := json.Marshal(map[string]any{field: "task-1", "status": "queued"})
		created, err := a.ParseCreate(context.Background(), raw)
		if err != nil || created.TaskID != "task-1" || created.Status != StatusPending {
			t.Fatalf("create=%#v %v", created, err)
		}
	}
	for _, tc := range []struct {
		status string
		want   Status
	}{{"queued", StatusPending}, {"in_progress", StatusProcessing}, {"completed", StatusSucceeded}, {"failed", StatusFailed}} {
		raw, _ := json.Marshal(map[string]any{"status": tc.status, "error": map[string]any{"message": "reason"}})
		result, err := a.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, raw)
		if err != nil || result.TaskID != "task-1" || result.Status != tc.want {
			t.Fatalf("poll=%#v %v", result, err)
		}
	}
	created, err := a.ParseCreate(context.Background(), []byte(`{"id":"task-1","status":"completed","outputs":[{"type":"video","content_url":"/v1/videos/task-1/content"}]}`))
	if err != nil || created.Status != StatusSucceeded || (created.Result != nil && len(created.Result.Videos) > 0) {
		t.Fatalf("relative result must use authenticated content: %#v %v", created, err)
	}
	result, err := a.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(`{"status":"completed","outputs":[{"content_url":"https://example.com/final.mp4"}],"url":"https://example.com/old.mp4"}`))
	if err != nil || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://example.com/final.mp4" || !result.Result.Videos[0].Ephemeral {
		t.Fatalf("output=%#v %v", result, err)
	}
	created, err = a.ParseCreate(context.Background(), []byte(`{"error":{"code":"invalid_request","message":"rejected"}}`))
	if err != nil || created.Status != StatusFailed || created.Message != "rejected" {
		t.Fatalf("error=%#v %v", created, err)
	}
}
