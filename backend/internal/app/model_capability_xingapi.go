package app

func xingapiVideoCapability(profile *VideoCapabilityConfig, protocol string) *VideoCapabilityConfig {
	minimum, maximum, images, videos, audios, resolution := 5, 15, 9, 0, 3, "720p"
	switch protocol {
	case "xingapi-sd-mini-480p":
		maximum, resolution = 10, "480p"
	case "xingapi-sd-mini-720p":
		audios = 0
	case "xingapi-sd-933":
		minimum = 4
	case "xingapi-sd-933-v":
		videos = 3
	case "xingapi-sd25":
		maximum, images, videos, audios = 30, 30, 10, 10
	default:
		return profile
	}
	value := *profile
	value.References = VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MaxImages: images, MaxVideos: videos, MaxAudios: audios}
	value.Duration = VideoDurationConfig{Selection: "range", Min: minimum, Max: maximum, Step: 1, Default: 5}
	value.Ratios, value.DefaultRatio = []string{"16:9", "9:16"}, "16:9"
	value.Resolutions, value.DefaultResolution = []string{resolution}, resolution
	value.GenerateAudio, value.Watermark = VideoBooleanConfig{}, VideoBooleanConfig{}
	value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
	if audios > 0 {
		value.Operations = append(value.Operations, "audio_to_video")
	}
	value.DefaultOperation = "text_to_video"
	return &value
}
