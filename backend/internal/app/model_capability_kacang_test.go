package app

import "testing"

func TestKacangVideoCapabilityDefaults(t *testing.T) {
	for _, tc := range []struct {
		protocol, resolution              string
		min, max, seconds, images, videos int
	}{
		{"kacang-gemini-omni-video", "720p", 3, 10, 3, 4, 1},
		{"kacang-grok-video-15", "480p", 4, 15, 8, 14, 0},
		{"kacang-kling-video-30", "720p", 1, 15, 5, 1, 0},
		{"kacang-grok-video-15-fast", "720p", 4, 15, 6, 7, 0},
		{"kacang-grok-video-15-route8", "720p", 4, 15, 6, 7, 0},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			config := DefaultModelCapabilityConfig(tc.protocol)
			v := config.Video
			if v.Duration.Min != tc.min || v.Duration.Max != tc.max || v.Duration.Default != tc.seconds || v.DefaultResolution != tc.resolution || v.References.MaxImages != tc.images || v.References.MaxVideos != tc.videos || v.References.MaxAudios != 0 || v.References.MaxImageBytes != 0 || v.GenerateAudio.Supported || v.Watermark.Supported {
				t.Fatalf("defaults=%#v", v)
			}
			if _, err := NormalizeModelCapabilityConfig("video", tc.protocol, config); err != nil {
				t.Fatal(err)
			}
			input := canvasGenerationInput{Mode: "video", Prompt: "人像", Config: providerConfig{VideoSeconds: map[string]string{"kacang-gemini-omni-video": "3", "kacang-grok-video-15": "8", "kacang-kling-video-30": "5", "kacang-grok-video-15-fast": "6", "kacang-grok-video-15-route8": "6"}[tc.protocol], Size: "16:9", VQuality: tc.resolution}}
			if err := validateVideoTask(v, input); err != nil {
				t.Fatal(err)
			}
			input.Config.VideoSeconds = "16"
			if err := validateVideoTask(v, input); err == nil {
				t.Fatal("unsupported duration accepted")
			}
		})
	}
}
