package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestAutoDLCanvasFrameMetadataBecomesOrderedReferences(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("load adapter: %v", err)
	}
	input := canvasGenerationInput{
		Mode: "video", Prompt: "@图片1 转向 @图片2",
		ReferenceImages: []providerMedia{{ID: "canvas-first", URL: "https://cdn.example/first.png"}, {ID: "canvas-last", URL: "https://cdn.example/last.png"}},
		Metadata: map[string]interface{}{
			"videoEditOperation": "image_to_video", "workflowProvider": "model",
			"videoStartFrameNodeId": "canvas-first", "videoEndFrameNodeId": "canvas-last",
		},
	}
	input.Config.Model = "minimax_h3_zm_u24"
	request := protocolRequestFromInput(input)
	if len(request.Images) != 2 || request.Images[0].Role != "first_frame" || request.Images[1].Role != "last_frame" {
		t.Fatalf("test must cover the historical canvas metadata path: %#v", request.Images)
	}
	spec, err := adapters[0].BuildCreate(context.Background(), protocol.RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]interface{})
	if body["ref_image_0"] != input.ReferenceImages[0].URL || body["ref_image_1"] != input.ReferenceImages[1].URL || body["prompt"] != input.Prompt {
		t.Fatalf("canvas references were lost or reordered: %#v", body)
	}
}
