package app

func api968VideoCapability(profile *VideoCapabilityConfig, protocol string) *VideoCapabilityConfig {
	var defaultSeconds, maxImages, maxAudios int
	switch protocol {
	case "api968-sd20", "api968-sdc2":
		defaultSeconds, maxImages, maxAudios = 15, 9, 3
	case "api968-sd25":
		defaultSeconds, maxImages, maxAudios = 30, 14, 10
	case "api968-sd25-15":
		defaultSeconds, maxImages, maxAudios = 15, 9, 0
	case "api968-sdmini":
		defaultSeconds, maxImages, maxAudios = 8, 9, 3
	default:
		return profile
	}
	value := *profile
	value.References = VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MaxImages: maxImages, MaxAudios: maxAudios}
	value.Duration = VideoDurationConfig{Selection: "range", Min: 5, Max: 15, Step: 1, Default: defaultSeconds}
	value.Ratios = []string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
	value.DefaultRatio = "16:9"
	value.Resolutions = []string{"720p"}
	value.DefaultResolution = "720p"
	value.GenerateAudio = VideoBooleanConfig{}
	value.Watermark = VideoBooleanConfig{}
	value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
	value.DefaultOperation = "text_to_video"
	if protocol == "api968-sd25" {
		value.Duration = VideoDurationConfig{Selection: "enum", Values: []int{30}, Default: 30}
	}
	if protocol == "api968-sdmini" {
		value.Resolutions = []string{"480p", "720p"}
		value.Duration.MaxByResolution = map[string]int{"480p": 15, "720p": 12}
	}
	return &value
}

func videoDurationForResolution(profile *VideoCapabilityConfig, resolution string) VideoDurationConfig {
	value := profile.Duration
	resolution = videoResolutionNameRequest(profile, resolution)
	if resolution == "" {
		resolution = profile.DefaultResolution
	}
	if maximum, ok := value.MaxByResolution[resolution]; ok {
		value.Max = maximum
	}
	return value
}
