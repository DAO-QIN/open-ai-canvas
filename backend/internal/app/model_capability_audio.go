package app

import "reflect"

// Music task count is distinct from the number of tracks returned by one task.
type AudioCapabilityConfig struct {
	GenerationType string                  `json:"generationType"`
	TaskCount      int                     `json:"taskCount"`
	OutputCount    int                     `json:"outputCount"`
	Streaming      bool                    `json:"streaming"`
	Music          *MusicCapabilityConfig  `json:"music,omitempty"`
	Speech         *SpeechCapabilityConfig `json:"speech,omitempty"`
}

type MusicCapabilityConfig struct {
	PromptMaxChars        int  `json:"promptMaxChars"` // UTF-16 units, matching the music API contract.
	InstrumentalSupported bool `json:"instrumentalSupported"`
	DefaultInstrumental   bool `json:"defaultInstrumental"`
	RequestTimeoutSeconds int  `json:"requestTimeoutSeconds"`
}

type SpeechCapabilityConfig struct {
	Voices              []string `json:"voices"`
	DefaultVoice        string   `json:"defaultVoice"`
	DefaultInstructions string   `json:"defaultInstructions"`
	OutputFormat        string   `json:"outputFormat"`
	SampleRate          int      `json:"sampleRate"`
	Channels            int      `json:"channels"`
	InputMaxTokens      int      `json:"inputMaxTokens"`
	OutputMaxTokens     int      `json:"outputMaxTokens"`
}

func defaultAudioCapabilityConfig(protocol string) *AudioCapabilityConfig {
	switch protocol {
	case "kacang-suno":
		return &AudioCapabilityConfig{GenerationType: "music", TaskCount: 1, Streaming: false, Music: &MusicCapabilityConfig{PromptMaxChars: 3000, InstrumentalSupported: true, RequestTimeoutSeconds: 600}}
	case "kacang-gemini-tts":
		return &AudioCapabilityConfig{GenerationType: "speech", TaskCount: 1, OutputCount: 1, Streaming: false, Speech: &SpeechCapabilityConfig{
			Voices:       []string{"Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"},
			DefaultVoice: "Kore", DefaultInstructions: "自然、友好、清晰", OutputFormat: "wav", SampleRate: 24000, Channels: 1, InputMaxTokens: 8192, OutputMaxTokens: 16384,
		}}
	default:
		return nil
	}
}

func normalizeAudioCapabilityConfig(protocol string, input *ModelCapabilityConfig) (*ModelCapabilityConfig, error) {
	profile := defaultAudioCapabilityConfig(protocol)
	if profile == nil {
		return nil, nil
	}
	if protocol == "kacang-suno" && input != nil && input.Audio != nil {
		value := *input.Audio
		if value.Music == nil {
			value.Music = profile.Music
		}
		music := *value.Music
		if music.RequestTimeoutSeconds == 0 {
			music.RequestTimeoutSeconds = profile.Music.RequestTimeoutSeconds
		}
		value.Music = &music
		if value.GenerationType != "music" || value.TaskCount != 1 || value.Streaming || value.Speech != nil || value.OutputCount < 0 || value.OutputCount > 32 || music.PromptMaxChars < 1 || music.PromptMaxChars > 1000000 || music.RequestTimeoutSeconds < 1 || music.RequestTimeoutSeconds > 3600 || (!music.InstrumentalSupported && music.DefaultInstrumental) {
			return nil, BadAuthRequest("音乐协议需要纯文本、单次任务和非流式输出；请检查输入上限、返回数量和纯音乐选项")
		}
		return &ModelCapabilityConfig{Version: 1, Audio: &value}, nil
	}
	if input != nil && input.Audio != nil && !reflect.DeepEqual(input.Audio, profile) {
		if protocol == "kacang-gemini-tts" {
			return nil, BadAuthRequest("卡藏 Gemini TTS 固定为纯文本语音、每次一段 WAV、24kHz 单声道，且使用已公布的音色与输入输出上限")
		}
		return nil, BadAuthRequest("音乐生成参数配置无效")
	}
	return &ModelCapabilityConfig{Version: 1, Audio: profile}, nil
}
