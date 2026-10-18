package protocol

import (
	"context"
	"testing"
)

func TestCangyuanSeedreamCreateEditAndPolling(t *testing.T) {
	a := officialPackageAdapter(t, "cangyuan-seedream.yingce-plugin", "cangyuan-seedream-5-pro")
	r := GenerationRequest{Model: "doubao-seedream-5-0-pro", Prompt: "白盘红苹果", ImageCount: 1, Quality: "high", Resolution: "4k"}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/images/generations" || body["size"] != "1:1" || body["n"] != float64(1) || body["async"] != true || body["output_format"] != "jpeg" || body["response_format"] != "url" {
		t.Fatalf("create: %#v %#v", spec, body)
	}
	for _, key := range []string{"images", "quality", "resolution", "watermark", "background", "image", "seed"} {
		if _, ok := body[key]; ok {
			t.Fatalf("unexpected %s: %#v", key, body)
		}
	}
	poll, err := a.BuildPoll(context.Background(), PollContext{Request: r, TaskID: "task-42"})
	if err != nil || poll.Path != "/v1/images/generations/task-42" {
		t.Fatalf("poll: %#v %v", poll, err)
	}
	r.Images = []MediaReference{{URL: "https://example.com/second.jpg", Order: 2}, {URL: "https://example.com/first.jpg", Order: 1}}
	r.AspectRatio = "21:9"
	r.ProviderOptions = map[string]map[string]any{"cangyuan-seedream-5-pro": {"output_format": "png", "response_format": "b64_json"}}
	spec, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	if spec.Path != "/v1/images/edits" || body["size"] != "21:9" || body["output_format"] != "png" || body["response_format"] != "b64_json" || body["images"].([]any)[0] != r.Images[1].URL {
		t.Fatalf("edit: %#v %#v", spec, body)
	}
	poll, err = a.BuildPoll(context.Background(), PollContext{Request: r, TaskID: "task-edit"})
	if err != nil || poll.Path != "/v1/images/edits/task-edit" {
		t.Fatalf("edit poll: %#v %v", poll, err)
	}
	r.AspectRatio = "2048x2048"
	if _, err = a.BuildCreate(context.Background(), RequestContext{Request: r}); err != nil {
		t.Fatal(err)
	}
}

func TestCangyuanSeedreamRejectsInvalidRequests(t *testing.T) {
	a := officialPackageAdapter(t, "cangyuan-seedream.yingce-plugin", "cangyuan-seedream-5-pro")
	for _, tc := range []struct {
		name   string
		change func(*GenerationRequest)
	}{
		{"wrong model", func(r *GenerationRequest) { r.Model = "doubao-seedream-5-0-pro-260628" }},
		{"flash model", func(r *GenerationRequest) { r.Model = "doubao-seedream-5-0-flash" }},
		{"multiple outputs", func(r *GenerationRequest) { r.ImageCount = 2 }},
		{"empty prompt", func(r *GenerationRequest) { r.Prompt = " " }},
		{"mask", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.com/a.png", Role: "mask"}}
		}},
		{"data URI", func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "data:image/png;base64,aA=="}} }},
		{"HTTP", func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "http://example.com/a.png"}} }},
		{"11 references", func(r *GenerationRequest) {
			for i := 0; i < 11; i++ {
				r.Images = append(r.Images, MediaReference{URL: "https://example.com/a.png"})
			}
		}},
		{"unsupported tier", func(r *GenerationRequest) { r.AspectRatio = "4K" }},
		{"invalid size", func(r *GenerationRequest) { r.AspectRatio = "0x2048" }},
		{"bad output", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"cangyuan-seedream-5-pro": {"output_format": "webp"}}
		}},
		{"bad response", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"cangyuan-seedream-5-pro": {"response_format": "base64"}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := GenerationRequest{Model: "doubao-seedream-5-0-pro", Prompt: "苹果", ImageCount: 1}
			tc.change(&r)
			if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}

func TestCangyuanSeedreamResponses(t *testing.T) {
	a := officialPackageAdapter(t, "cangyuan-seedream.yingce-plugin", "cangyuan-seedream-5-pro")
	created, err := a.ParseCreate(context.Background(), []byte(`{"id":"task-42","status":"queued","progress":0}`))
	if err != nil || created.TaskID != "task-42" || created.Status != StatusPending {
		t.Fatalf("created: %#v %v", created, err)
	}
	done, err := a.ParsePoll(context.Background(), PollContext{}, []byte(`{"id":"task-42","status":"completed","data":[{"url":"https://example.com/result.jpg"},{"b64_json":"aA=="}],"usage":{"total_tokens":42}}`))
	if err != nil || done.Status != StatusSucceeded || done.Result == nil || len(done.Result.Images) != 2 {
		t.Fatalf("done: %#v %v", done, err)
	}
	failed, err := a.ParsePoll(context.Background(), PollContext{}, []byte(`{"id":"task-42","status":"failed","error":{"code":"invalid_size","message":"尺寸不合法"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "尺寸不合法" {
		t.Fatalf("failed: %#v %v", failed, err)
	}
}
