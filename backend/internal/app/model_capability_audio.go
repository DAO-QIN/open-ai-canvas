package app

// Music task count is distinct from the number of tracks returned by one task.
type AudioCapabilityConfig struct {
	GenerationType string `json:"generationType"`
	TaskCount      int    `json:"taskCount"`
	OutputCount    int    `json:"outputCount"`
	Streaming      bool   `json:"streaming"`
}

func defaultAudioCapabilityConfig(protocol string) *AudioCapabilityConfig {
	if protocol != "kacang-suno" {
		return nil
	}
	return &AudioCapabilityConfig{GenerationType: "music", TaskCount: 1, OutputCount: 2, Streaming: false}
}

func normalizeAudioCapabilityConfig(protocol string, input *ModelCapabilityConfig) (*ModelCapabilityConfig, error) {
	profile := defaultAudioCapabilityConfig(protocol)
	if profile == nil {
		return nil, nil
	}
	if input != nil && input.Audio != nil && *input.Audio != *profile {
		return nil, BadAuthRequest("卡藏 Suno 固定为纯文本音乐、每次一个任务返回两首，且不支持流式输出")
	}
	return &ModelCapabilityConfig{Version: 1, Audio: profile}, nil
}
