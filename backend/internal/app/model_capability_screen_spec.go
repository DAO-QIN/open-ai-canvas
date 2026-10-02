package app

import (
	"path/filepath"
	"strings"
)

// AutoDL's complete resolution enum also controls orientation. The bundled
// workflow contract supplies fixed choices; client-supplied fixed values are ignored.
func normalizeAutoDLVideoScreenSpec(profile *VideoCapabilityConfig, modelName string) (*VideoCapabilityConfig, error) {
	dir, err := officialPluginPackageDir()
	if err != nil {
		return nil, BadAuthRequest("无法读取 AutoDL 工作流规格")
	}
	pkg, err := inspectOfficialPluginPackage(filepath.Join(dir, "autodl-comfyui.yingce-plugin"))
	if err != nil {
		return nil, BadAuthRequest("无法读取 AutoDL 工作流规格")
	}
	modelName = strings.TrimPrefix(strings.TrimSpace(modelName), "models/")
	fixed := VideoScreenSpecConfig{Ratios: []string{}, Resolutions: []string{}}
	found := false
	for _, workflow := range pkg.info.Manifest.Contributes.Workflows {
		if workflow.ID != modelName || workflow.ProviderID != "autodl-comfyui" {
			continue
		}
		found = true
		for _, parameter := range workflow.Parameters {
			if parameter.Mapping != "resolution" && parameter.Name != "resolution" {
				continue
			}
			fixed.Resolutions = cleanVideoScreenSpecValues(parameter.Values)
			fixed.DefaultResolution, _ = workflow.Defaults[parameter.Name].(string)
			fixed.DefaultResolution = strings.TrimSpace(fixed.DefaultResolution)
		}
		break
	}
	if !found || len(fixed.Resolutions) == 0 || !containsCapabilityString(fixed.Resolutions, fixed.DefaultResolution) {
		return nil, BadAuthRequest("当前 AutoDL 工作流未声明有效的分辨率列表和默认值")
	}
	value := *profile
	custom := fixed
	if profile.CustomScreenSpec != nil {
		custom = *profile.CustomScreenSpec
	} else if profile.CustomSizeEnabled {
		custom.Resolutions = profile.Resolutions
		custom.DefaultResolution = profile.DefaultResolution
	}
	// No AutoDL v2.3 workflow declares an independent aspect-ratio parameter.
	custom.Ratios, custom.DefaultRatio = []string{}, ""
	custom.Resolutions = cleanVideoScreenSpecValues(custom.Resolutions)
	custom.DefaultResolution = strings.TrimSpace(custom.DefaultResolution)
	for _, resolution := range custom.Resolutions {
		if strings.EqualFold(resolution, custom.DefaultResolution) {
			custom.DefaultResolution = resolution
			break
		}
	}
	active := fixed
	if value.CustomSizeEnabled {
		if len(custom.Resolutions) == 0 || !containsCapabilityString(custom.Resolutions, custom.DefaultResolution) {
			return nil, BadAuthRequest("请至少配置一个完整分辨率标签，并从支持值中选择默认值")
		}
		active = custom
	}
	value.FixedScreenSpec = &fixed
	value.CustomScreenSpec = &custom
	value.Ratios, value.DefaultRatio = active.Ratios, active.DefaultRatio
	value.Resolutions, value.DefaultResolution = active.Resolutions, active.DefaultResolution
	return &value, nil
}

func cleanVideoScreenSpecValues(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value != "" && !seen[key] {
			result = append(result, value)
			seen[key] = true
		}
	}
	return result
}

func applyAutoDLVideoScreenSpec(input *canvasGenerationInput, profile *VideoCapabilityConfig) {
	if input == nil || profile == nil || profile.FixedScreenSpec == nil {
		return
	}
	input.Config.Size = ""
	resolution := videoResolutionNameRequest(profile, input.Config.VQuality)
	if resolution != "" {
		input.Config.VQuality = resolution
	} else if !profile.CustomSizeEnabled || isAutomaticVideoResolution(input.Config.VQuality) {
		input.Config.VQuality = profile.DefaultResolution
	}
}
