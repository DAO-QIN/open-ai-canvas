package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestAPI968SDVideoProfiles(t *testing.T) {
	for _, tc := range []struct {
		provider, model string
		seconds         int
	}{
		{"api968-sd20", "sd-2.0", 15}, {"api968-sdc2", "sd-c2", 15}, {"api968-sd25", "sd2.5", 30}, {"api968-sd25-15", "sd2.5-15", 15}, {"api968-sdmini", "sdmini", 8},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "api968-sd-video.yingce-plugin", tc.provider)
			request := GenerationRequest{Model: tc.model, Prompt: "cat", Extra: map[string]any{"idempotencyKey": "968-contract-test"}}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			if spec.Method != "POST" || spec.Path != "/v1/videos/generations" || spec.Headers["User-Agent"] != "Mozilla/5.0" || spec.Headers["X-Request-Id"] != "968-contract-test" {
				t.Fatalf("request spec: %#v", spec)
			}
			encoded, _ := json.Marshal(body)
			var actual map[string]any
			_ = json.Unmarshal(encoded, &actual)
			if actual["duration"] != float64(tc.seconds) || actual["resolution"] != "720p" || actual["aspect_ratio"] != "16:9" || actual["size"] != "1280x720" || actual["videoGenerateAudio"] != true || actual["face_split"] != false {
				t.Fatalf("body: %s", encoded)
			}
			if _, ok := body["image"]; ok {
				t.Fatal("empty image should be omitted")
			}
			if _, ok := body["images"]; ok {
				t.Fatal("empty images should be omitted")
			}
			request.Model = "wrong-model"
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("model mismatch accepted")
			}
			poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "request-968"})
			if err != nil {
				t.Fatal(err)
			}
			if poll.Method != "GET" || poll.Path != "/v1/videos/generations/request-968" || poll.Headers["User-Agent"] != "Mozilla/5.0" {
				t.Fatalf("poll: %#v", poll)
			}
		})
	}
}

func TestAPI968SDVideoBoundsAndReferences(t *testing.T) {
	mini := officialPackageAdapter(t, "api968-sd-video.yingce-plugin", "api968-sdmini")
	for _, tc := range []struct {
		res     string
		seconds int
		valid   bool
	}{{"720p", 8, true}, {"720p", 12, true}, {"720p", 13, false}, {"480p", 15, true}, {"480p", 16, false}, {"720p", 4, false}, {"1080p", 8, false}} {
		_, err := mini.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "sdmini", Duration: tc.seconds, Resolution: tc.res}})
		if (err == nil) != tc.valid {
			t.Fatalf("%s %ds valid=%v err=%v", tc.res, tc.seconds, tc.valid, err)
		}
	}
	request := GenerationRequest{Model: "sdmini", Images: []MediaReference{{URL: "https://media.example/first.png", Order: 1}}, Audios: []MediaReference{{URL: "https://media.example/b.mp3", Order: 2}, {URL: "https://media.example/a.mp3", Order: 1}}}
	spec, err := mini.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(spec.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	if !reflect.DeepEqual(body["image"], map[string]any{"url": "https://media.example/first.png"}) || !reflect.DeepEqual(body["audio_refs"], []any{"https://media.example/a.mp3", "https://media.example/b.mp3"}) {
		t.Fatalf("single/reference mapping: %s", raw)
	}
	request.Images = append(request.Images, MediaReference{URL: "https://media.example/second.png", Order: 2})
	spec, err = mini.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(spec.Body)
	_ = json.Unmarshal(raw, &body)
	if len(body["images"].([]any)) != 2 {
		t.Fatalf("multiple images: %s", raw)
	}
	request.Videos = []MediaReference{{URL: "https://media.example/a.mp4"}}
	if _, err = mini.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("video references accepted")
	}
	for _, tc := range []struct {
		provider, model string
		seconds         int
		audio           bool
	}{{"api968-sd25", "sd2.5", 15, false}, {"api968-sd25-15", "sd2.5-15", 15, true}} {
		adapter := officialPackageAdapter(t, "api968-sd-video.yingce-plugin", tc.provider)
		r := GenerationRequest{Model: tc.model, Duration: tc.seconds}
		if tc.audio {
			r.Audios = []MediaReference{{URL: "https://media.example/a.mp3"}}
		}
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
			t.Fatal("invalid SD 2.5 request accepted")
		}
	}
}

func TestAPI968SDVideoResponses(t *testing.T) {
	adapter := officialPackageAdapter(t, "api968-sd-video.yingce-plugin", "api968-sdmini")
	for _, body := range []string{`{"request_id":"job-968"}`, `{"data":{"request_id":"job-968"}}`, `{"video":{"request_id":"job-968"}}`, `{"id":"job-968"}`, `{"data":{"id":"job-968"}}`} {
		created, err := adapter.ParseCreate(context.Background(), []byte(body))
		if err != nil || created.TaskID != "job-968" || created.Status != StatusPending {
			t.Fatalf("create %s => %#v %v", body, created, err)
		}
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "job-968"}, []byte(`{"status":"done","video":{"url":"https://media.example/cat.mp4"}}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://media.example/cat.mp4" || !result.Result.Videos[0].Ephemeral {
		t.Fatalf("done: %#v %v", result, err)
	}
	for _, status := range []string{"failed", "expired"} {
		raw, _ := json.Marshal(map[string]any{"status": status, "error": map[string]any{"message": "supplier rejected"}})
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "job-968"}, raw)
		if err == nil && (result.Status != StatusFailed || result.Message != "supplier rejected") {
			t.Fatalf("failure %s: %#v %v", status, result, err)
		}
	}
}
