package protocol

import (
	"context"
	"reflect"
	"testing"
)

func TestGrokImageEditModelAndReferences(t *testing.T) {
	adapter := officialPackageAdapter(t, "xai-grok-images.yingce-plugin", "grok-image")
	for _, tc := range []struct {
		name      string
		images    []MediaReference
		editModel string
		path      string
		model     string
		urls      []string
	}{
		{"text", nil, "grok-imagine-image-edit", "/v1/images/generations", "grok-imagine-image-2.0", nil},
		{"single web edit", []MediaReference{{URL: "https://example.com/cat.jpg", Role: "edit_source"}}, "grok-imagine-image-edit", "/v1/images/edits", "grok-imagine-image-edit", []string{"https://example.com/cat.jpg"}},
		{"same model by default", []MediaReference{{URL: "https://example.com/cat.jpg"}}, "", "/v1/images/edits", "grok-imagine-image-2.0", []string{"https://example.com/cat.jpg"}},
		{"ordered multiple", []MediaReference{{URL: "https://example.com/second.jpg", Role: "reference_image", Order: 2}, {DataURL: "data:image/jpeg;base64,aW1hZ2U=", Role: "edit_source", Order: 1}, {URL: "https://example.com/mask.png", Role: "mask"}}, "grok-imagine-image-edit", "/v1/images/edits", "grok-imagine-image-edit", []string{"data:image/jpeg;base64,aW1hZ2U=", "https://example.com/second.jpg"}},
		{"mask is not reference", []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}}, "grok-imagine-image-edit", "/v1/images/generations", "grok-imagine-image-2.0", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Capability: CapabilityImage, Model: "grok-imagine-image-2.0", Prompt: "white background", Images: tc.images, ImageCount: 1, ImageParameters: map[string]any{"editModel": tc.editModel}}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if spec.Path != tc.path || spec.ContentType != "application/json" || len(spec.Files) != 0 || body["model"] != tc.model {
				t.Fatalf("request = %#v body=%#v", spec, body)
			}
			var urls []string
			if one, ok := body["image"].(map[string]any); ok {
				urls = append(urls, one["url"].(string))
			}
			if multiple, ok := body["images"].([]any); ok {
				for _, v := range multiple {
					urls = append(urls, v.(map[string]any)["url"].(string))
				}
			}
			if !reflect.DeepEqual(urls, tc.urls) {
				t.Fatalf("urls=%#v want=%#v", urls, tc.urls)
			}
			if len(tc.urls) == 0 {
				for _, key := range []string{"image", "images"} {
					if _, ok := body[key]; ok {
						t.Fatalf("unexpected %s in text request", key)
					}
				}
			}
		})
	}
}

func TestGrokImageResponsePreservesMIME(t *testing.T) {
	adapter := officialPackageAdapter(t, "xai-grok-images.yingce-plugin", "grok-image")
	for _, tc := range []struct{ body, prefix string }{
		{`{"data":[{"b64_json":"aW1hZ2U=","mime_type":"image/jpeg"}]}`, "data:image/jpeg;base64,aW1hZ2U="},
		{`{"data":[{"b64_json":"aW1hZ2U="}]}`, "data:image/png;base64,aW1hZ2U="},
	} {
		result, err := adapter.ParseCreate(context.Background(), []byte(tc.body))
		if err != nil {
			t.Fatal(err)
		}
		if result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].DataURL != tc.prefix {
			t.Fatalf("result=%#v", result)
		}
	}
}
