package app

func yuxiboxVideoCapability(profile *VideoCapabilityConfig, protocol string) *VideoCapabilityConfig {
	maxImages, maxVideos, maxAudios := 30, 10, 10
	duration := VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 30}
	switch protocol {
	case "yuxibox-sd20":
		maxImages, maxVideos, maxAudios = 9, 3, 3
		duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10, 15}, Default: 15}
	case "yuxibox-sd25", "yuxibox-sd25-per-request":
	default:
		return profile
	}
	value := *profile
	value.References = VideoReferenceConfig{PromptMaxChars: 16000, MaxImages: maxImages, MaxVideos: maxVideos, MaxAudios: maxAudios}
	value.Duration = duration
	value.Ratios = []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
	value.DefaultRatio = "16:9"
	value.Resolutions = []string{"720p"}
	value.DefaultResolution = "720p"
	value.GenerateAudio = VideoBooleanConfig{}
	value.Watermark = VideoBooleanConfig{}
	value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	value.DefaultOperation = "text_to_video"
	return &value
}
