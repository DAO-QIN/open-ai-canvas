package app

func yunfeiOmniVideoCapability(profile *VideoCapabilityConfig, protocol string) *VideoCapabilityConfig {
	if protocol != "yunfei-omni-flash-video" {
		return profile
	}
	value := *profile
	ordinaryImages := 1
	value.References = VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MaxImages: 3, MaxReferenceImages: &ordinaryImages, MaxVideos: 1, MaxAudios: 1}
	value.Duration = VideoDurationConfig{Selection: "enum", Values: []int{8}, Default: 8}
	value.Ratios, value.DefaultRatio = []string{"16:9"}, "16:9"
	value.Resolutions, value.DefaultResolution = []string{"720p"}, "720p"
	value.GenerateAudio, value.Watermark = VideoBooleanConfig{}, VideoBooleanConfig{}
	value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	value.DefaultOperation = "text_to_video"
	return &value
}
