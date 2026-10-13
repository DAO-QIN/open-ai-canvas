package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"mime"
	"strconv"
	"strings"
)

const maxInlineAudioBytes = 64 << 20

func inlineAudioReference(payload map[string]any, spec ManifestInlineAudio) (MediaReference, error) {
	var pcm bytes.Buffer
	for index, value := range arrayValue(pathValue(payload, spec.PartsPath)) {
		part, ok := value.(map[string]any)
		if !ok {
			return MediaReference{}, fmt.Errorf("inline audio part %d is not an object", index)
		}
		dataValue, mimeValue := pathValue(part, spec.DataPath), pathValue(part, spec.MIMETypePath)
		if dataValue == nil && mimeValue == nil {
			continue
		}
		encoded, ok := dataValue.(string)
		if !ok || strings.TrimSpace(encoded) == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxInlineAudioBytes) {
			return MediaReference{}, fmt.Errorf("inline audio part %d has invalid data", index)
		}
		mediaType, parameters, err := mime.ParseMediaType(strings.ToLower(manifestString(mimeValue)))
		if err != nil {
			return MediaReference{}, fmt.Errorf("inline audio part %d has invalid MIME type", index)
		}
		decoded, err := decodeStreamedAudioBase64(encoded)
		if err != nil {
			return MediaReference{}, fmt.Errorf("inline audio part %d has invalid Base64: %w", index, err)
		}
		switch mediaType {
		case "audio/l16", "audio/pcm":
			for name, expected := range map[string]int{"rate": spec.SampleRate, "channels": spec.Channels} {
				if raw, present := parameters[name]; present {
					actual, err := strconv.Atoi(raw)
					if err != nil || actual != expected {
						return MediaReference{}, fmt.Errorf("inline audio %s differs from declared format", name)
					}
				}
			}
			if codec := parameters["codec"]; codec != "" && codec != "pcm" {
				return MediaReference{}, fmt.Errorf("unsupported inline audio codec")
			}
		case "audio/wav", "audio/x-wav":
			decoded, err = inlineWAVPCM(decoded, spec)
			if err != nil {
				return MediaReference{}, err
			}
		default:
			return MediaReference{}, fmt.Errorf("unsupported inline audio MIME type %q", mediaType)
		}
		if len(decoded) == 0 || len(decoded) > maxInlineAudioBytes-pcm.Len() {
			return MediaReference{}, fmt.Errorf("inline audio is empty or exceeds %d bytes", maxInlineAudioBytes)
		}
		_, _ = pcm.Write(decoded)
	}
	if pcm.Len() == 0 || pcm.Len()%(spec.Channels*2) != 0 {
		return MediaReference{}, fmt.Errorf("inline audio is empty or contains an incomplete PCM sample")
	}
	wav := make([]byte, 44+pcm.Len())
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], uint16(spec.Channels))
	binary.LittleEndian.PutUint32(wav[24:], uint32(spec.SampleRate))
	binary.LittleEndian.PutUint32(wav[28:], uint32(spec.SampleRate*spec.Channels*2))
	binary.LittleEndian.PutUint16(wav[32:], uint16(spec.Channels*2))
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], uint32(pcm.Len()))
	copy(wav[44:], pcm.Bytes())
	return MediaReference{Kind: "audio", MIMEType: "audio/wav", DataURL: "data:audio/wav;base64," + base64.StdEncoding.EncodeToString(wav)}, nil
}

// WAV parts already contain a container; extract samples instead of joining headers.
func inlineWAVPCM(data []byte, spec ManifestInlineAudio) ([]byte, error) {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return nil, fmt.Errorf("invalid inline WAV container")
	}
	formatOK := false
	var pcm []byte
	for offset := 12; offset < len(data); {
		if len(data)-offset < 8 {
			return nil, fmt.Errorf("truncated inline WAV chunk")
		}
		size := uint64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		if size > uint64(len(data)-offset-8) {
			return nil, fmt.Errorf("truncated inline WAV chunk")
		}
		chunk := data[offset+8 : offset+8+int(size)]
		switch string(data[offset : offset+4]) {
		case "fmt ":
			formatOK = len(chunk) >= 16 && binary.LittleEndian.Uint16(chunk) == 1 &&
				int(binary.LittleEndian.Uint16(chunk[2:])) == spec.Channels && int(binary.LittleEndian.Uint32(chunk[4:])) == spec.SampleRate &&
				int(binary.LittleEndian.Uint32(chunk[8:])) == spec.SampleRate*spec.Channels*2 &&
				int(binary.LittleEndian.Uint16(chunk[12:])) == spec.Channels*2 && binary.LittleEndian.Uint16(chunk[14:]) == 16
		case "data":
			pcm = append(pcm, chunk...)
		}
		offset += 8 + int(size) + int(size%2)
		if offset > len(data) {
			return nil, fmt.Errorf("missing inline WAV chunk padding")
		}
	}
	if !formatOK || len(pcm) == 0 {
		return nil, fmt.Errorf("inline WAV differs from declared PCM format or has no samples")
	}
	return pcm, nil
}
