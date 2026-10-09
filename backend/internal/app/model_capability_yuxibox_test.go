package app

import "testing"

func TestYuxiBoxVideoCapabilityDefaults(t *testing.T) {
	for _, tc := range []struct {
		protocol               string
		seconds, images, media int
	}{
		{"yuxibox-sd20", 15, 9, 3}, {"yuxibox-sd25", 30, 30, 10}, {"yuxibox-sd25-per-request", 30, 30, 10},
	} {
		profile := DefaultModelCapabilityConfig(tc.protocol)
		video := profile.Video
		if video.Duration.Default != tc.seconds || video.References.MaxImages != tc.images || video.References.MaxVideos != tc.media || video.References.MaxAudios != tc.media || video.References.PromptMaxChars != 16000 || video.DefaultRatio != "16:9" || video.DefaultResolution != "720p" || len(video.Resolutions) != 1 || video.GenerateAudio.Supported || video.Watermark.Supported {
			t.Fatalf("%s: %#v", tc.protocol, video)
		}
		if _, err := NormalizeModelCapabilityConfig("video", tc.protocol, profile); err != nil {
			t.Fatal(err)
		}
		input := canvasGenerationInput{Mode: "video", Prompt: "小猫在房间里跑", Config: providerConfig{VideoSeconds: "5", Size: "16:9", VQuality: "720p"}}
		if err := validateVideoTask(video, input); err != nil {
			t.Fatal(err)
		}
		input.Config.VideoSeconds = "6"
		if err := validateVideoTask(video, input); (err == nil) == (tc.protocol == "yuxibox-sd20") {
			t.Fatalf("6s validation %s: %v", tc.protocol, err)
		}
	}
}
