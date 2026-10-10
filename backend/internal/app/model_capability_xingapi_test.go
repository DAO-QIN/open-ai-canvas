package app

import "testing"

func TestXingAPIVideoCapabilityDefaults(t *testing.T) {
	for _, tc := range []struct {
		protocol, resolution             string
		min, max, images, videos, audios int
	}{
		{"xingapi-sd-mini-480p", "480p", 5, 10, 9, 0, 3}, {"xingapi-sd-mini-720p", "720p", 5, 15, 9, 0, 0},
		{"xingapi-sd-933", "720p", 4, 15, 9, 0, 3}, {"xingapi-sd-933-v", "720p", 5, 15, 9, 3, 3}, {"xingapi-sd25", "720p", 5, 30, 30, 10, 10},
	} {
		p := DefaultModelCapabilityConfig(tc.protocol)
		v := p.Video
		if v.Duration.Min != tc.min || v.Duration.Max != tc.max || v.Duration.Default != 5 || v.References.MaxImages != tc.images || v.References.MaxVideos != tc.videos || v.References.MaxAudios != tc.audios || v.DefaultResolution != tc.resolution || len(v.Resolutions) != 1 || len(v.Ratios) != 2 || v.References.PromptMaxChars != 8000 || v.References.MaxImageBytes != 0 || v.GenerateAudio.Supported || v.Watermark.Supported {
			t.Fatalf("%s: %#v", tc.protocol, v)
		}
		if _, err := NormalizeModelCapabilityConfig("video", tc.protocol, p); err != nil {
			t.Fatal(err)
		}
		input := canvasGenerationInput{Mode: "video", Prompt: "猫", Config: providerConfig{VideoSeconds: "5", Size: "16:9", VQuality: tc.resolution}}
		if err := validateVideoTask(v, input); err != nil {
			t.Fatal(err)
		}
		input.Config.VQuality = "1080p"
		if err := validateVideoTask(v, input); err == nil {
			t.Fatal("wrong resolution accepted")
		}
	}
}
