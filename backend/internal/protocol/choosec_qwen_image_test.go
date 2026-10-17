package protocol

import (
	"context"
	"testing"
)

func TestChooseCQwenImageUsesDocumentedDefaults(t *testing.T) {
	adapter := officialPackageAdapter(t, "choosec-qwen-image.yingce-plugin", "choosec-qwen-image")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "qwen-image-2.1-turbo", Prompt: "中文海报"}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Method != "POST" || spec.Path != "/v1/images/generations" || spec.Auth.Type != "bearer" || len(body) != 4 || body["size"] != "2048x2048" || body["n"] != float64(1) {
		t.Fatalf("unexpected request: %#v, body=%#v", spec, body)
	}
	request := GenerationRequest{Capability: CapabilityImage, Model: "qwen-image-2.1-turbo", Prompt: "中文海报", ImageParameters: map[string]any{"size": "1024x1024", "quality": "standard", "count": 10, "style": "vivid", "responseFormat": "url"}}
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil || manifestTestBody(t, spec)["n"] != float64(10) {
		t.Fatalf("dynamic image parameters failed: %v", err)
	}
}

func TestChooseCQwenImageRejectsInvalidInputs(t *testing.T) {
	adapter := officialPackageAdapter(t, "choosec-qwen-image.yingce-plugin", "choosec-qwen-image")
	cases := map[string]func(*GenerationRequest){
		"wrong model":         func(r *GenerationRequest) { r.Model = "qwen-image-plus" },
		"empty prompt":        func(r *GenerationRequest) { r.Prompt = "  " },
		"invalid size":        func(r *GenerationRequest) { r.AspectRatio = "1024x0" },
		"unencoded ratio":     func(r *GenerationRequest) { r.AspectRatio = "16:9" },
		"too many":            func(r *GenerationRequest) { r.ImageCount = 11 },
		"negative count":      func(r *GenerationRequest) { r.ImageCount = -1 },
		"too many references": func(r *GenerationRequest) { r.Images = make([]MediaReference, 11) },
		"empty reference":     func(r *GenerationRequest) { r.Images = []MediaReference{{}} },
		"mask": func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}}
		},
		"dynamic count": func(r *GenerationRequest) {
			r.Capability = CapabilityImage
			r.ImageParameters = map[string]any{"count": 0}
		},
		"unknown parameter": func(r *GenerationRequest) {
			r.Capability = CapabilityImage
			r.ImageParameters = map[string]any{"outputFormat": "png"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := GenerationRequest{Model: "qwen-image-2.1-turbo", Prompt: "中文海报"}
			mutate(&r)
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("unexpected acceptance")
			}
		})
	}
}

func TestChooseCQwenImageReferenceJSONPreservesOrderAndEncoding(t *testing.T) {
	adapter := officialPackageAdapter(t, "choosec-qwen-image.yingce-plugin", "choosec-qwen-image")
	request := GenerationRequest{Capability: CapabilityImage, Model: "qwen-image-2.1-turbo", Prompt: "保留参考图的商品", Images: []MediaReference{
		{URL: "https://example.com/second.png", Order: 2},
		{URL: "https://example.com/first.png", DataURL: "data:image/png;base64,aGVsbG8=", Order: 1},
	}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	images := body["image"].([]any)
	if len(images) != 2 || images[0] != request.Images[1].DataURL || images[1] != request.Images[0].URL || body["size"] != "2048x2048" {
		t.Fatalf("reference mapping lost: %#v", body)
	}
	if _, exists := body["resolution"]; exists {
		t.Fatal("host resolution leaked upstream")
	}
	request.Images = request.Images[:1]
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil || len(manifestTestBody(t, spec)["image"].([]any)) != 1 {
		t.Fatalf("single reference: %v", err)
	}
	request.Images = nil
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := manifestTestBody(t, spec)["image"]; exists {
		t.Fatal("empty reference field sent")
	}
}

func TestChooseCQwenImageExampleValuesAreNotWhitelists(t *testing.T) {
	adapter := officialPackageAdapter(t, "choosec-qwen-image.yingce-plugin", "choosec-qwen-image")
	for _, size := range []string{"1024x1536", "1536x1024", "2048x2048", "1600x900"} {
		r := GenerationRequest{Capability: CapabilityImage, Model: "qwen-image-2.1-turbo", Prompt: "中文海报", ImageParameters: map[string]any{"size": size, "quality": "high", "style": "natural", "responseFormat": "b64_json", "count": 1}}
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if body["size"] != size || body["quality"] != "high" || body["style"] != "natural" || body["response_format"] != "b64_json" {
			t.Fatalf("configured parameters overwritten: %#v", body)
		}
	}
}

func TestChooseCQwenImageResponseKeepsImagesAndFailureSemantics(t *testing.T) {
	adapter := officialPackageAdapter(t, "choosec-qwen-image.yingce-plugin", "choosec-qwen-image")
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"url":"https://example.com/one.png"},{"b64_json":"aGVsbG8="}],"usage":{"images":2}}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 2 || !result.Result.Images[0].Ephemeral || result.Result.Images[1].DataURL != "data:image/png;base64,aGVsbG8=" || result.Result.Usage["images"] != float64(2) {
		t.Fatalf("unexpected result: %#v, %v", result, err)
	}
	for _, raw := range []string{`{"error":{"code":"invalid_model","message":"模型不可用"}}`, `{"data":[]}`} {
		failed, err := adapter.ParseCreate(context.Background(), []byte(raw))
		if err != nil || failed.Status != StatusFailed {
			t.Fatalf("failure was lost: %#v, %v", failed, err)
		}
	}
}
