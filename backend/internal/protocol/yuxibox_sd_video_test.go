package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestYuxiBoxSDVideoProfiles(t *testing.T) {
	for _, tc := range []struct {
		provider, model string
		seconds         string
	}{
		{"yuxibox-sd20", "seedance-2.0（YX）", "15"},
		{"yuxibox-sd25", "seedance-2.5（YX）", "30"},
		{"yuxibox-sd25-per-request", "seedance-2.5（YX）-按次", "30"},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "yuxibox-sd-video.yingce-plugin", tc.provider)
			request := GenerationRequest{Model: tc.model, Prompt: "小猫在房间里跑"}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"model": tc.model, "prompt": request.Prompt, "seconds": tc.seconds, "ratio": "16:9"}
			if spec.Method != "POST" || spec.Path != "/v1/videos" || spec.ContentType != "application/json" || spec.Auth.Type != "bearer" || !reflect.DeepEqual(spec.Body, want) {
				t.Fatalf("create: %#v", spec)
			}
			request.Model = "seedance-2.0(YX)"
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("wrong model ID accepted")
			}
			poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "video-test"})
			if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/video-test" || poll.Auth.Type != "bearer" {
				t.Fatalf("poll: %#v %v", poll, err)
			}
			result, err := adapter.(ResultAdapter).BuildResult(context.Background(), PollContext{TaskID: "video-test"})
			if err != nil || result.Method != "GET" || result.Path != "/v1/videos/video-test/content" || result.Headers["Accept"] != "video/mp4" || result.Auth.Type != "bearer" {
				t.Fatalf("download: %#v %v", result, err)
			}
			if _, err := adapter.BuildCancel(context.Background(), PollContext{TaskID: "video-test"}); err == nil {
				t.Fatal("undocumented cancel operation available")
			}
		})
	}
}

func TestYuxiBoxSDVideoValidationAndMedia(t *testing.T) {
	for _, tc := range []struct {
		provider, model string
		valid, invalid  []int
		images, videos  int
	}{
		{"yuxibox-sd20", "seedance-2.0（YX）", []int{0, 5, 10, 15}, []int{-1, 4, 6, 16}, 9, 3},
		{"yuxibox-sd25", "seedance-2.5（YX）", []int{0, 4, 5, 29, 30}, []int{-1, 3, 31}, 30, 10},
		{"yuxibox-sd25-per-request", "seedance-2.5（YX）-按次", []int{0, 4, 30}, []int{3, 31}, 30, 10},
	} {
		adapter := officialPackageAdapter(t, "yuxibox-sd-video.yingce-plugin", tc.provider)
		valid := GenerationRequest{Model: tc.model, Prompt: "小猫在房间里跑", Duration: 5, Resolution: "720P", AspectRatio: "adaptive"}
		check := func(request GenerationRequest, accepted bool) {
			t.Helper()
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if (err == nil) != accepted {
				t.Fatalf("%s duration=%d ratio=%s resolution=%s media=%d/%d/%d accepted=%v err=%v", tc.provider, request.Duration, request.AspectRatio, request.Resolution, len(request.Images), len(request.Videos), len(request.Audios), accepted, err)
			}
		}
		for _, seconds := range tc.valid {
			r := valid
			r.Duration = seconds
			check(r, true)
		}
		for _, seconds := range tc.invalid {
			r := valid
			r.Duration = seconds
			check(r, false)
		}
		for _, ratio := range []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"} {
			r := valid
			r.AspectRatio = ratio
			check(r, true)
		}
		for _, change := range []func(*GenerationRequest){
			func(r *GenerationRequest) { r.Resolution = "1080p" },
			func(r *GenerationRequest) { r.AspectRatio = "1280x720" },
			func(r *GenerationRequest) { r.Prompt = "" },
			func(r *GenerationRequest) { r.Prompt = strings.Repeat("猫", 16001) },
			func(r *GenerationRequest) { r.GenerateAudio = true },
			func(r *GenerationRequest) { r.Watermark = true },
		} {
			r := valid
			change(&r)
			check(r, false)
		}
		r := valid
		r.Prompt = strings.Repeat("猫", 16000)
		check(r, true)
		for _, kind := range []string{"images", "videos", "audios"} {
			limit := tc.videos
			if kind == "images" {
				limit = tc.images
			}
			for _, count := range []int{limit, limit + 1} {
				r := valid
				refs := make([]MediaReference, count)
				for i := range refs {
					refs[i] = MediaReference{URL: "https://media.example/reference"}
				}
				switch kind {
				case "images":
					r.Images = refs
				case "videos":
					r.Videos = refs
				case "audios":
					r.Audios = refs
				}
				check(r, count == limit)
			}
		}
	}
	adapter := officialPackageAdapter(t, "yuxibox-sd-video.yingce-plugin", "yuxibox-sd20")
	request := GenerationRequest{Model: "seedance-2.0（YX）", Prompt: "猫", Duration: 5,
		Images: []MediaReference{{URL: "https://media.example/b.png", Order: 2}, {DataURL: "data:image/png;base64,YQ==", Order: 1}},
		Videos: []MediaReference{{URL: "https://media.example/b.mp4", Order: 2}, {URL: "https://media.example/a.mp4", Order: 1}},
		Audios: []MediaReference{{URL: "https://media.example/a.mp3"}}, Extra: map[string]any{"sensitive": "must-not-forward"},
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if !reflect.DeepEqual(body["reference_images"], []any{"data:image/png;base64,YQ==", "https://media.example/b.png"}) || !reflect.DeepEqual(body["videos"], []any{"https://media.example/a.mp4", "https://media.example/b.mp4"}) || !reflect.DeepEqual(body["audios"], []any{"https://media.example/a.mp3"}) || len(body) != 7 {
		t.Fatalf("media mapping: %#v", body)
	}
}

func TestYuxiBoxSDVideoResponses(t *testing.T) {
	adapter := officialPackageAdapter(t, "yuxibox-sd-video.yingce-plugin", "yuxibox-sd20")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"video-test","status":"queued"}`))
	if err != nil || created.TaskID != "video-test" || created.Status != StatusPending {
		t.Fatalf("create: %#v %v", created, err)
	}
	for _, tc := range []struct {
		status   string
		expected Status
	}{{"queued", StatusPending}, {"in_progress", StatusProcessing}, {"completed", StatusSucceeded}, {"failed", StatusFailed}} {
		body, _ := json.Marshal(map[string]any{"id": "video-test", "status": tc.status, "error": map[string]any{"message": "supplier rejected"}})
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "video-test"}, body)
		if err != nil || result.Status != tc.expected || result.TaskID != "video-test" {
			t.Fatalf("%s: %#v %v", tc.status, result, err)
		}
		if tc.expected == StatusFailed && result.Message != "supplier rejected" {
			t.Fatal("failure message lost")
		}
	}
	for _, field := range []string{"video_url", "download_url"} {
		body, _ := json.Marshal(map[string]any{"status": "completed", field: "https://media.example/cat.mp4"})
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "video-test"}, body)
		if err != nil || result.Result == nil || len(result.Result.Videos) != 1 || !result.Result.Videos[0].Ephemeral {
			t.Fatalf("%s: %#v %v", field, result, err)
		}
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"error":{"code":"invalid_request","message":"rejected"}}`))
	if err != nil || result.Status != StatusFailed || result.Message != "rejected" {
		t.Fatalf("error envelope: %#v %v", result, err)
	}
}
