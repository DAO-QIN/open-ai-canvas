package protocol

import (
	"context"
	"reflect"
	"testing"
)

func TestOfficialResponsesMapsNonAgentMultimodalInput(t *testing.T) {
	const imageURL = "https://example.invalid/reference.png"
	const imageData = "data:image/png;base64,aW1hZ2U="
	cases := []struct {
		name    string
		request GenerationRequest
		input   []any
	}{
		{
			name: "plain_text_and_history",
			request: GenerationRequest{
				Messages: []Message{{Role: "system", Content: "system-only"}, {Role: "user", Content: "earlier"}, {Role: "assistant", Content: "answer"}},
				Prompt:   "continue",
			},
			input: []any{map[string]any{"role": "user", "content": "earlier"}, map[string]any{"role": "assistant", "content": "answer"}, map[string]any{"role": "user", "content": "continue"}},
		},
		{
			name: "url_and_data_url_keep_order",
			request: GenerationRequest{
				Prompt: "compare",
				Images: []MediaReference{{URL: imageURL}, {DataURL: imageData}},
			},
			input: []any{map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "input_text", "text": "compare"},
				map[string]any{"type": "input_image", "image_url": imageURL},
				map[string]any{"type": "input_image", "image_url": imageData},
			}}},
		},
		{
			name: "explicit_blocks_and_native_blocks",
			request: GenerationRequest{Messages: []Message{{Role: "user", Content: []any{
				map[string]any{"type": "text", "text": "describe"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": imageURL}},
				map[string]any{"type": "input_image", "image_url": imageData},
				map[string]any{"type": "input_file", "file_id": "file-example"},
			}}}},
			input: []any{map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "input_text", "text": "describe"},
				map[string]any{"type": "input_image", "image_url": imageURL},
				map[string]any{"type": "input_image", "image_url": imageData},
				map[string]any{"type": "input_file", "file_id": "file-example"},
			}}},
		},
	}
	for _, test := range cases {
		for _, stream := range []bool{false, true} {
			suffix := "/non_streaming"
			if stream {
				suffix = "/streaming"
			}
			t.Run(test.name+suffix, func(t *testing.T) {
				adapter := officialPackageAdapter(t, "openai-responses.yingce-plugin", "openai-response")
				request := test.request
				request.Capability, request.Model, request.Instructions = CapabilityText, "model-test", "independent instruction"
				request.ProviderOptions = map[string]map[string]any{"openai-response": {"stream": stream}}
				spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
				if err != nil {
					t.Fatal(err)
				}
				body := manifestTestBody(t, spec)
				if !reflect.DeepEqual(body["input"], test.input) {
					t.Fatalf("Responses input = %#v, want %#v", body["input"], test.input)
				}
				if body["instructions"] != request.Instructions || spec.Path != "/responses" || spec.Method != "POST" {
					t.Fatalf("Responses request lost its instructions or endpoint: %#v", spec)
				}
				if stream && body["stream"] != true {
					t.Fatalf("stream was not preserved: %#v", body["stream"])
				}
				if !stream && body["stream"] != nil && body["stream"] != false {
					t.Fatalf("non-streaming request enabled streaming: %#v", body["stream"])
				}
			})
		}
	}
}
