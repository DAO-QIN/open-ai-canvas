package app

func rolldekGeminiVideoCapability(profile *VideoCapabilityConfig, protocol string) *VideoCapabilityConfig {
	if protocol != "rolldek-gemini-omni-video" && protocol != "rolldek-veo-fast-video" {
		return profile
	}
	value := *profile
	value.References = VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars}
	value.Ratios, value.DefaultRatio = []string{"16:9"}, "16:9"
	value.Resolutions, value.DefaultResolution = []string{"720p"}, "720p"
	value.Duration = VideoDurationConfig{Selection: "enum", Values: []int{8}, Default: 8}
	value.GenerateAudio, value.Watermark = VideoBooleanConfig{}, VideoBooleanConfig{}
	value.Operations, value.DefaultOperation = []string{"text_to_video"}, "text_to_video"
	if protocol == "rolldek-gemini-omni-video" {
		ordinaryImages := 1
		value.References.MaxImages, value.References.MaxReferenceImages = 3, &ordinaryImages
		value.References.MaxVideos, value.References.MaxAudios = 1, 1
		value.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 6, 8, 10}, Default: 4}
		value.Ratios = []string{"16:9", "9:16"}
		value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	}
	return &value
}
