package app

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func autoDLProfile(t *testing.T, custom bool) *ModelCapabilityConfig {
	t.Helper()
	profile := DefaultModelCapabilityConfigForModel("autodl-comfyui", "minimax_h3_zm_u24")
	profile.Video.CustomSizeEnabled = custom
	profile.Video.CustomScreenSpec = &VideoScreenSpecConfig{Resolutions: []string{"480p横", "768p(1:1)"}, DefaultResolution: "768p(1:1)"}
	return profile
}

func normalizeAutoDLProfile(t *testing.T, profile *ModelCapabilityConfig, name string) *ModelCapabilityConfig {
	t.Helper()
	result, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", name, profile)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestAutoDLScreenSpecFixedIgnoresCustomAndKeepsOtherParameters(t *testing.T) {
	profile := autoDLProfile(t, false)
	profile.Video.CustomScreenSpec.DefaultResolution = "invalid"
	profile.Video.FixedScreenSpec = &VideoScreenSpecConfig{Resolutions: []string{"forged"}, DefaultResolution: "forged"}
	result := normalizeAutoDLProfile(t, profile, "minimax_h3_zm_u24")
	if result.Video.DefaultResolution != "768p竖" || len(result.Video.Resolutions) != 6 || len(result.Video.Ratios) != 0 || result.Video.DefaultRatio != "" {
		t.Fatalf("fixed spec = %#v", result.Video)
	}
	if !reflect.DeepEqual(result.Video.References, profile.Video.References) || !reflect.DeepEqual(result.Video.Duration, profile.Video.Duration) || !reflect.DeepEqual(result.Video.Operations, profile.Video.Operations) {
		t.Fatal("screen-spec switch changed unrelated parameters")
	}
	if profile.Video.DefaultResolution != "720p" {
		t.Fatal("normalization mutated the original profile")
	}
}

func TestAutoDLScreenSpecCustomSurvivesDisableAndJSONReload(t *testing.T) {
	profile := autoDLProfile(t, true)
	profile.Video.CustomScreenSpec.Resolutions = []string{" 480p横 ", "768p(1:1)", "480P横", ""}
	profile.Video.CustomScreenSpec.DefaultResolution = " 768P(1:1) "
	enabled := normalizeAutoDLProfile(t, profile, "minimax_h3_zm_u24")
	if !reflect.DeepEqual(enabled.Video.Resolutions, []string{"480p横", "768p(1:1)"}) || enabled.Video.DefaultResolution != "768p(1:1)" {
		t.Fatalf("custom spec = %#v", enabled.Video)
	}
	enabled.Video.CustomSizeEnabled = false
	fixed := normalizeAutoDLProfile(t, enabled, "minimax_h3_zm_u24")
	loaded, err := DecodeModelCapabilityConfig(mustEncodeModelCapabilityConfig(t, fixed))
	if err != nil {
		t.Fatal(err)
	}
	loaded.Video.CustomSizeEnabled = true
	restored := normalizeAutoDLProfile(t, loaded, "minimax_h3_zm_u24")
	if !reflect.DeepEqual(restored.Video.CustomScreenSpec, enabled.Video.CustomScreenSpec) || restored.Video.DefaultResolution != "768p(1:1)" {
		t.Fatalf("restored spec = %#v", restored.Video)
	}
}

func TestAutoDLScreenSpecRejectsInvalidEnabledDraftAndUnknownWorkflow(t *testing.T) {
	for _, values := range [][]string{nil, {"480p横"}} {
		profile := autoDLProfile(t, true)
		profile.Video.CustomScreenSpec.Resolutions = values
		if _, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", "minimax_h3_zm_u24", profile); err == nil {
			t.Fatal("invalid custom default was accepted")
		}
	}
	if _, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", "unknown", autoDLProfile(t, false)); err == nil {
		t.Fatal("unknown workflow invented fixed values")
	}
}

func TestAutoDLScreenSpecUsesEachPackagedWorkflowExactly(t *testing.T) {
	dir, err := officialPluginPackageDir()
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := inspectOfficialPluginPackage(filepath.Join(dir, "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	for _, workflow := range pkg.info.Manifest.Contributes.Workflows {
		t.Run(workflow.ID, func(t *testing.T) {
			profile := normalizeAutoDLProfile(t, autoDLProfile(t, false), workflow.ID)
			for _, parameter := range workflow.Parameters {
				if parameter.Name == "resolution" {
					if !reflect.DeepEqual(profile.Video.Resolutions, parameter.Values) || profile.Video.DefaultResolution != workflow.Defaults[parameter.Name] {
						t.Fatalf("workflow contract mismatch: %#v", profile.Video)
					}
				}
			}
		})
	}
}

func TestAutoDLScreenSpecSubmissionUsesSameValueAsValidation(t *testing.T) {
	adapter, ok := loadOfficialFallbackRegistry().Resolve("autodl-comfyui")
	if !ok {
		t.Fatal("AutoDL adapter missing")
	}
	for _, custom := range []bool{false, true} {
		profile := normalizeAutoDLProfile(t, autoDLProfile(t, custom), "minimax_h3_zm_u24")
		input := canvasGenerationInput{Mode: "video", Prompt: "test", VideoCapability: profile.Video, Config: providerConfig{InterfaceType: "autodl-comfyui", Model: "minimax_h3_zm_u24", Size: "16:9", VQuality: "720p", VideoSeconds: "6"}}
		if custom {
			input.Config.VQuality = "768p(1:1)"
		}
		applyAutoDLVideoScreenSpec(&input, profile.Video)
		if err := validateVideoTask(profile.Video, input); err != nil {
			t.Fatal(err)
		}
		request := protocolRequestFromInput(input)
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := spec.Body.(map[string]any)
		if body["resolution"] != input.Config.VQuality || request.AspectRatio != "" || body["duration"] != 6 {
			t.Fatalf("validated input and actual request differ: %#v, %#v", input.Config, body)
		}
		if _, exists := body["aspect_ratio"]; exists {
			t.Fatal("unsupported independent aspect ratio was sent")
		}
		input.Config.VQuality = "unsupported"
		applyAutoDLVideoScreenSpec(&input, profile.Video)
		if custom && validateVideoTask(profile.Video, input) == nil {
			t.Fatal("enabled custom profile accepted an undeclared request value")
		}
	}
}

func TestAutoDLScreenSpecSystemSaveCatalogAndExecutionIgnoreClientOverride(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "autodl", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "AutoDL", BaseURL: "https://autodl.art", APIKey: "test", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	enabled := true
	priceTiers := make([]ChannelModelPriceTierRequest, 0, 6)
	for _, resolution := range []string{"480p竖", "768p竖", "480p横", "768p横", "480p(1:1)", "768p(1:1)"} {
		sale, cost := int64(6), int64(3)
		if resolution[:4] == "768p" {
			sale, cost = 8, 4
		}
		priceTiers = append(priceTiers, ChannelModelPriceTierRequest{Resolution: resolution, BillingMode: "per_second", UnitPriceMicrocredits: sale * CreditScale, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: cost * CreditScale}, PriceConfigured: true, Enabled: &enabled})
	}
	for _, custom := range []bool{true, false} {
		profile := autoDLProfile(t, custom)
		id := ""
		if item, err := svc.repo.ChannelModelByKey(channel.ID, "minimax_h3_zm_u24"); err == nil {
			id = item.ID
		}
		saved, err := svc.SaveAdminChannelModel(admin, channel.ID, id, ChannelModelRequest{
			ModelKey: "minimax_h3_zm_u24", ProviderModelKey: "minimax_h3_zm_u24", Capability: "video", Protocol: "autodl-comfyui", CapabilityConfig: profile, Enabled: &enabled,
			PriceTiers: priceTiers,
		})
		if err != nil {
			t.Fatal(err)
		}
		public, err := svc.sanitizeChannelModel(saved)
		if err != nil {
			t.Fatal(err)
		}
		catalogSpec, err := channelModelCapabilitySpec(*saved)
		if err != nil {
			t.Fatal(err)
		}
		if _, exists := catalogSpec.Options["size"]; exists {
			t.Fatal("catalog exposes an unsupported independent ratio")
		}
		wantChoices := 6
		if custom {
			wantChoices = 2
		}
		if len(catalogSpec.Options["vquality"].Values) != wantChoices {
			t.Fatalf("catalog choices ignored the switch: %#v", catalogSpec)
		}
		for _, tier := range saved.PriceTiers {
			if custom && tier.Resolution != "480p横" && tier.Resolution != "768p(1:1)" {
				continue
			}
			priceInput := map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"channelId": channel.ID, "channelModelKey": saved.ModelKey, "model": saved.ModelKey, "vquality": tier.Resolution, "videoSeconds": "6"}}
			priced, err := svc.resolveSystemChannelModelSelection(priceInput, "canvas_video", "text_to_video")
			if err != nil {
				t.Fatal(err)
			}
			config := priced["config"].(map[string]any)
			if config["priceTierId"] != tier.ID || config["vquality"] != tier.Resolution || tier.BillingMode != "per_second" || tier.UnitPriceMicrocredits != tier.CostPricing.UnitPriceMicrocredits*2 {
				t.Fatalf("resolution and price diverged: %#v, %#v", config, tier)
			}
		}
		data, _ := json.Marshal(public.CapabilityConfig)
		catalog, err := DecodeModelCapabilityConfig(string(data))
		if err != nil || catalog.Video.CustomSizeEnabled != custom {
			t.Fatalf("catalog = %s, err = %v", data, err)
		}
		resolution := "768p(1:1)"
		if !custom {
			resolution = "720p"
		}
		input := map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"channelId": channel.ID, "channelModelKey": saved.ModelKey, "model": saved.ModelKey, "interfaceType": "autodl-comfyui", "vquality": resolution, "size": "16:9", "videoSeconds": "6", "capabilityConfig": autoDLProfile(t, true)}}
		resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_video", "text_to_video")
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.ValidateTaskCapability(resolved); err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(resolved)
		var execution canvasGenerationInput
		if err := json.Unmarshal(encoded, &execution); err != nil {
			t.Fatal(err)
		}
		if err := svc.validateResolvedVideoCapability(&execution); err != nil {
			t.Fatal(err)
		}
		if execution.Config.VQuality != catalog.Video.DefaultResolution || execution.Config.Size != "" || execution.VideoCapability.CustomSizeEnabled != custom {
			t.Fatalf("catalog and execution mismatch: %#v, %#v", catalog.Video, execution.Config)
		}
	}
}
