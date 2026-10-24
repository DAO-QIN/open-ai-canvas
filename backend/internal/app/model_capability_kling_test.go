package app

import "testing"

func TestKlingOmniDefaultsAndPreflight(t *testing.T) {
	config := DefaultModelCapabilityConfigForModel("kling-video-omni", "kling-video-v4")
	v := config.Video
	if v.Duration.Min != 3 || v.Duration.Max != 30 || v.Duration.Default != 6 || v.DefaultResolution != "720p" || v.DefaultRatio != "16:9" || v.References.MaxImages != 10 || v.References.MaxVideos != 5 || v.References.MaxAudios != 3 || v.References.MaxTotalItems != 15 || v.References.MaxTotalVideoDuration != 30 || v.References.LastFrameSupported == nil || *v.References.LastFrameSupported {
		t.Fatalf("defaults=%#v", v)
	}
	if _, err := NormalizeModelCapabilityConfig("video", "kling-video-omni", config); err != nil {
		t.Fatal(err)
	}
	base := func() canvasGenerationInput {
		return canvasGenerationInput{Mode: "video", Prompt: "海边日落", Config: providerConfig{InterfaceType: "kling-video-omni", VideoSeconds: "5", Size: "16:9", VQuality: "720p"}}
	}
	for _, seconds := range []string{"3", "5", "30"} {
		input := base()
		input.Config.VideoSeconds = seconds
		if err := validateVideoTask(v, input); err != nil {
			t.Fatal(err)
		}
	}
	for name, change := range map[string]func(*canvasGenerationInput){
		"duration": func(i *canvasGenerationInput) { i.Config.VideoSeconds = "31" },
		"total": func(i *canvasGenerationInput) {
			i.ReferenceImages = make([]providerMedia, 10)
			i.ReferenceVideos = make([]providerMedia, 5)
			i.ReferenceAudios = make([]providerMedia, 1)
		},
		"unknown duration": func(i *canvasGenerationInput) { i.ReferenceVideos = []providerMedia{{}} },
		"duration sum": func(i *canvasGenerationInput) {
			i.ReferenceVideos = []providerMedia{{DurationMs: 15001}, {DurationMs: 15000}}
		},
		"tail": func(i *canvasGenerationInput) {
			i.ReferenceImages = []providerMedia{{ID: "frame", URL: "https://example.com/a.png"}}
			i.Metadata = map[string]any{"videoEndFrameNodeId": "frame"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			input := base()
			change(&input)
			if err := validateVideoTask(v, input); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
	input := base()
	input.VideoCapability = v
	input.ReferenceImages = []providerMedia{{ID: "frame", URL: "https://example.com/frame.png"}, {ID: "ref", URL: "https://example.com/ref.png"}}
	input.Metadata = map[string]any{"videoEditOperation": "reference_to_video", "videoStartFrameNodeId": "frame"}
	images := protocolRequestFromInput(input).Images
	if len(images) != 2 || images[0].Role != "first_frame" || images[1].Role != "reference_image" {
		t.Fatalf("explicit frame was lost in reference mode: %#v", images)
	}
	input = base()
	input.ReferenceVideos = []providerMedia{{DurationMs: 15000}, {DurationMs: 15000}}
	if err := validateVideoTask(v, input); err != nil {
		t.Fatal("exact duration rejected", err)
	}
}
