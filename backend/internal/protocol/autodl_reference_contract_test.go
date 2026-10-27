package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func autoDLReferenceAdapter(t *testing.T) Adapter {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, adapter := range adapters {
		if adapter.Metadata().ID == "autodl-comfyui" {
			return adapter
		}
	}
	t.Fatal("AutoDL adapter missing")
	return nil
}

func TestAutoDLReferenceRoleMapping(t *testing.T) {
	adapter := autoDLReferenceAdapter(t)
	for _, model := range []string{"minimax_h3_zm_u24", "minimax_h3_image_audio_to_video_v2_15s", "minimax_h3_z0902"} {
		t.Run(model, func(t *testing.T) {
			request := GenerationRequest{Model: model, Prompt: "@图片1 then @图片2 then @图片3", Duration: 8, Resolution: "768P竖",
				Images: []MediaReference{
					{URL: "https://cdn.example/third.png", Role: "reference_image", Order: 3},
					{URL: "https://cdn.example/last.png", Role: "last_frame", Order: 2},
					{URL: "https://cdn.example/first.png", Role: "first_frame", Order: 1},
				}}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			for index, name := range []string{"first", "last", "third"} {
				if body[fmt.Sprintf("ref_image_%d", index)] != "https://cdn.example/"+name+".png" {
					t.Fatalf("reference lost or renumbered: %#v", body)
				}
			}
			if body["first_frame"] != nil || body["last_frame"] != nil || body["prompt"] != request.Prompt {
				t.Fatalf("reference workflow changed semantics: %#v", body)
			}
		})
	}
}

func TestAutoDLExplicitFrameMapping(t *testing.T) {
	adapter := autoDLReferenceAdapter(t)
	for _, tc := range []struct {
		name   string
		images []MediaReference
		first  string
		last   string
	}{
		{"explicit reversed", []MediaReference{{URL: "last", Role: "last_frame"}, {URL: "first", Role: "first_frame", Order: 1}}, "first", "last"},
		{"last only", []MediaReference{{URL: "last", Role: "last_frame"}}, "", "last"},
		{"first only", []MediaReference{{URL: "first", Role: "first_frame"}}, "first", ""},
		{"first and ordinary", []MediaReference{{URL: "first", Role: "first_frame"}, {URL: "last", Order: 1}}, "first", "last"},
		{"last and ordinary", []MediaReference{{URL: "last", Role: "last_frame"}, {URL: "first", Order: 1}}, "first", "last"},
		{"legacy ordered", []MediaReference{{URL: "last", Order: 2}, {URL: "first", Order: 1}}, "first", "last"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "minimax_h3_b99_002", Images: tc.images}})
			if err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			for key, want := range map[string]string{"first_frame": tc.first, "last_frame": tc.last} {
				if want == "" && body[key] != nil || want != "" && body[key] != want {
					t.Fatalf("unexpected frame mapping: %#v", body)
				}
			}
		})
	}
}

func TestAutoDLMediaValidation(t *testing.T) {
	adapter := autoDLReferenceAdapter(t)
	media := func(count int) []MediaReference {
		items := make([]MediaReference, count)
		for index := range items {
			items[index] = MediaReference{URL: fmt.Sprintf("https://cdn.example/%d", index), Order: index}
		}
		return items
	}
	for _, tc := range []struct {
		name    string
		request GenerationRequest
		wantErr string
	}{
		{"u24 requires image", GenerationRequest{Model: "minimax_h3_zm_u24"}, "至少需要 1 张"},
		{"u24 maximum", GenerationRequest{Model: "minimax_h3_zm_u24", Images: media(9)}, ""},
		{"u24 overflow", GenerationRequest{Model: "minimax_h3_zm_u24", Images: media(10)}, "最多支持 9 张"},
		{"u24 unsupported audio", GenerationRequest{Model: "minimax_h3_zm_u24", Images: media(1), Audios: media(1)}, "不支持参考音频"},
		{"z0902 maximum", GenerationRequest{Model: "minimax_h3_z0902", Images: media(6)}, ""},
		{"z0902 overflow", GenerationRequest{Model: "minimax_h3_z0902", Images: media(7)}, "最多支持 6 张"},
		{"v1 audio maximum", GenerationRequest{Model: "minimax_h3_image_audio_to_video", Images: media(1), Audios: media(1)}, ""},
		{"v1 image overflow", GenerationRequest{Model: "minimax_h3_image_audio_to_video", Images: media(2)}, "最多支持 1 张"},
		{"v1 audio overflow", GenerationRequest{Model: "minimax_h3_image_audio_to_video", Audios: media(2)}, "最多支持 1 段"},
		{"v2 optional references", GenerationRequest{Model: "minimax_h3_image_audio_to_video_v2_15s"}, ""},
		{"v2 audio maximum", GenerationRequest{Model: "minimax_h3_image_audio_to_video_v2", Audios: media(3)}, ""},
		{"v2 audio overflow", GenerationRequest{Model: "minimax_h3_image_audio_to_video_v2", Audios: media(4)}, "最多支持 3 段"},
		{"text workflow image", GenerationRequest{Model: "minimax_h3_lightx2v_no_pic", Images: media(1)}, "不支持参考图片"},
		{"unsupported video", GenerationRequest{Model: "minimax_h3_zm_u24", Images: media(1), Videos: media(1)}, "不支持参考视频"},
		{"empty image", GenerationRequest{Model: "minimax_h3_zm_u24", Images: []MediaReference{{Role: "first_frame"}}}, "图片尚未就绪"},
		{"unknown role", GenerationRequest{Model: "minimax_h3_zm_u24", Images: []MediaReference{{URL: "image", Role: "mask"}}}, "图片用途不受支持"},
		{"duplicate first frame", GenerationRequest{Model: "minimax_h3_b99_002", Images: []MediaReference{{URL: "first", Role: "first_frame"}, {URL: "other", Role: "first_frame"}}}, "只选择一张首帧"},
		{"undeclared workflow", GenerationRequest{Model: "unknown_workflow", Images: media(1)}, ""},
		{"undeclared audio overflow", GenerationRequest{Model: "unknown_workflow", Audios: media(4)}, "最多支持 3 段"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: tc.request})
			if tc.wantErr == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected %q, got spec=%#v err=%v", tc.wantErr, spec, err)
			}
			if spec.Path != "" || spec.Body != nil {
				t.Fatal("invalid input produced an outbound request")
			}
		})
	}
}

func TestAutoDLWorkflowContractsCoverContributions(t *testing.T) {
	root := filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui")
	data, err := os.ReadFile(filepath.Join(root, "workflow-media.json"))
	if err != nil {
		t.Fatal(err)
	}
	var contracts map[string]json.RawMessage
	if err := json.Unmarshal(data, &contracts); err != nil {
		t.Fatal(err)
	}
	for model := range contracts {
		request := GenerationRequest{Model: model}
		// A common ordinary reference must be serializable on every image workflow.
		var contract struct{ MaxImages int }
		if err := json.Unmarshal(contracts[model], &contract); err != nil {
			t.Fatal(err)
		}
		if contract.MaxImages > 0 {
			request.Images = []MediaReference{{URL: "https://cdn.example/ref.png", Role: "subject_reference"}}
		}
		if _, err := autoDLReferenceAdapter(t).BuildCreate(context.Background(), RequestContext{Request: request}); err != nil {
			t.Fatalf("%s: %v", model, err)
		}
	}
}
