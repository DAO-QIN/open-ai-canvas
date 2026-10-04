package app

import "testing"

func TestAPI968VideoDefaultCapabilities(t *testing.T) {
	for _, tc := range []struct {
		protocol                string
		seconds, images, audios int
	}{{"api968-sd20", 15, 9, 3}, {"api968-sdc2", 15, 9, 3}, {"api968-sd25", 30, 14, 10}, {"api968-sd25-15", 15, 9, 0}, {"api968-sdmini", 8, 9, 3}} {
		t.Run(tc.protocol, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(tc.protocol, "")
			video := profile.Video
			if video.Duration.Default != tc.seconds || video.References.MaxImages != tc.images || video.References.MaxAudios != tc.audios || video.DefaultRatio != "16:9" || video.DefaultResolution != "720p" || video.References.MaxVideos != 0 {
				t.Fatalf("profile: %#v", video)
			}
			normalized, err := NormalizeModelCapabilityConfigForModel("video", tc.protocol, "", profile)
			if err != nil {
				t.Fatal(err)
			}
			if normalized.Video.Duration.Default != tc.seconds {
				t.Fatal("default lost on normalization")
			}
		})
	}
}

func TestAPI968VideoResolutionDurationValidation(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("api968-sdmini", "sdmini").Video
	for _, tc := range []struct {
		resolution, seconds string
		valid               bool
	}{{"720p", "8", true}, {"720", "12", true}, {"720p", "13", false}, {"480p", "15", true}, {"480", "16", false}, {"", "13", false}} {
		err := validateVideoTask(profile, canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "api968-sdmini", Model: "sdmini", VQuality: tc.resolution, VideoSeconds: tc.seconds, Size: "16:9"}})
		if (err == nil) != tc.valid {
			t.Fatalf("%s %ss valid=%v err=%v", tc.resolution, tc.seconds, tc.valid, err)
		}
	}
	if profile.Duration.Max != 15 || profile.Duration.MaxByResolution["720p"] != 12 {
		t.Fatal("validation mutated profile")
	}
	for _, tc := range []struct {
		key      string
		max, def int
	}{{"unknown", 12, 8}, {"720p", 4, 8}, {"720p", 16, 8}, {"720p", 12, 15}} {
		profile := DefaultModelCapabilityConfigForModel("api968-sdmini", "sdmini").Video
		profile.Duration.MaxByResolution = map[string]int{tc.key: tc.max}
		profile.Duration.Default = tc.def
		if err := validateVideoCapabilityConfig(profile); err == nil {
			t.Fatalf("invalid conditional duration accepted: %#v", profile.Duration)
		}
	}
}
