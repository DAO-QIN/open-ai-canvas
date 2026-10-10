package app

func kacangVideoCapability(profile *VideoCapabilityConfig, protocol string) *VideoCapabilityConfig {
	value := *profile
	value.References = VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars}
	value.Ratios, value.DefaultRatio = []string{"16:9", "9:16"}, "16:9"
	value.Resolutions, value.DefaultResolution = []string{"720p"}, "720p"
	value.GenerateAudio, value.Watermark = VideoBooleanConfig{}, VideoBooleanConfig{}
	value.Operations, value.DefaultOperation = []string{"text_to_video", "image_to_video"}, "text_to_video"
	switch protocol {
	case "kacang-gemini-omni-video":
		value.References.MaxImages, value.References.MaxVideos = 4, 1
		value.Duration = VideoDurationConfig{Selection: "range", Min: 3, Max: 10, Step: 1, Default: 3}
		value.Operations = append(value.Operations, "reference_to_video")
	case "kacang-grok-video-15":
		value.References.MaxImages = 14
		value.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 15, Step: 1, Default: 8}
		value.Ratios = []string{"16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"}
		value.Resolutions, value.DefaultResolution = []string{"480p", "720p", "1080p"}, "480p"
		value.Operations = append(value.Operations, "reference_to_video")
	case "kacang-kling-video-30":
		value.References.MaxImages = 1
		value.Duration = VideoDurationConfig{Selection: "range", Min: 1, Max: 15, Step: 1, Default: 5}
	default:
		return profile
	}
	return &value
}
