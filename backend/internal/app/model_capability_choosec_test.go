package app

import (
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestChooseCQwenCapabilityDefaultsAndPluginContract(t *testing.T) {
	image := DefaultImageCapabilityConfig("choosec-qwen-image", "qwen-image-2.1-turbo")
	if image.Size.Default != "1024x1024" || !image.Size.AllowCustom || image.MaxOutputs != 10 || image.References.MaxImages != 10 || image.References.MaxImageBytes != 10*1024*1024 || image.References.MaskSupported || !image.Resolution.Supported || image.Resolution.Default != "1k" || image.TransparentBackground.Supported || image.OutputFormat.Supported || image.Quality.Default != "standard" {
		t.Fatalf("unexpected defaults: %#v", image)
	}
	if len(image.Resolution.Values) != 1 || image.Resolution.Values[0] != "1k" {
		t.Fatalf("unexpected initial resolution choices: %#v", image.Resolution.Values)
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "choosec-qwen-image.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := resolveImageCapabilityParameters(image, adapters[0].Metadata().ImageParameters, "qwen-image-2.1-turbo"); err != nil {
		t.Fatal(err)
	}
	if err := validateImageCapabilityConfig(image); err != nil {
		t.Fatal(err)
	}
	defaults := imageParameterDefaults(image.Parameters)
	if defaults["style"] != "vivid" || defaults["responseFormat"] != "url" || defaults["size"] != "1024x1024" || defaults["imageResolution"] != "1k" || image.MaxOutputs != 10 {
		t.Fatalf("plugin defaults not projected: %#v", defaults)
	}
	for name, mutate := range map[string]func(*canvasGenerationInput){
		"count": func(i *canvasGenerationInput) { i.Config.Count = "11" },
	} {
		t.Run(name, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "image", Prompt: "中文海报", Config: providerConfig{InterfaceType: "choosec-qwen-image", Model: "qwen-image-2.1-turbo", Count: "1", Size: "1024x1024", Quality: "standard"}}
			mutate(&input)
			if err := validateImageTask(image, input); err == nil {
				t.Fatal("unsupported input accepted by host")
			}
		})
	}
	for _, size := range []string{"1024x1536", "1600x900"} {
		input := canvasGenerationInput{Mode: "image", Prompt: "中文海报", Config: providerConfig{Size: size, Quality: "standard", Count: "1"}}
		if err := validateImageTask(image, input); err != nil {
			t.Fatalf("custom size rejected: %v", err)
		}
	}
	config := providerConfig{InterfaceType: "choosec-qwen-image", Model: "qwen-image-2.1-turbo", Size: "3:4", Count: "1"}
	if err := applyImageParameterValues(&config, image); err != nil {
		t.Fatal(err)
	}
	if config.Size != "1024x1360" || config.ImageResolution != "1k" || config.ImageParameters["size"] != config.Size {
		t.Fatalf("pixel encoding lost: %#v", config.ImageParameters)
	}
	for _, preset := range image.Size.Presets {
		if preset.Tier != "1k" {
			t.Fatalf("unverified preset exposed: %#v", preset)
		}
	}
	for _, field := range publicImageParameters(image.Parameters) {
		if field.Name == "quality" || field.Name == "style" || field.Name == "responseFormat" {
			if field.UserVisible == nil || *field.UserVisible || !field.IsEnabled() {
				t.Fatalf("hidden metadata lost: %#v", field)
			}
		}
	}
}

func TestChooseCImageParameterVisibilityInRouteProjection(t *testing.T) {
	hidden, visible := false, true
	field := protocol.ImageParameter{Name: "style", Label: "画风", Type: "string", Default: "vivid", UserVisible: &hidden}
	route := CapabilitySpec{Capability: "image", ImageParameters: []protocol.ImageParameter{field}}
	spec := CapabilitySpec{Capability: "image", Options: map[string]OptionConstraint{"style": {Values: []any{"*"}}}}
	projected := effectiveImageParameterSpec(spec, []CapabilitySpec{route, route})
	if len(projected.ImageParameters) != 1 || projected.ImageParameters[0].UserVisible == nil || *projected.ImageParameters[0].UserVisible {
		t.Fatalf("hidden metadata lost: %#v", projected.ImageParameters)
	}
	route.ImageParameters = []protocol.ImageParameter{{Name: "style", Label: "画风", Type: "string", Default: "vivid", UserVisible: &visible}}
	projected = effectiveImageParameterSpec(spec, []CapabilitySpec{{Capability: "image", ImageParameters: []protocol.ImageParameter{field}}, route})
	if projected.ImageParameters[0].UserVisible != nil && !*projected.ImageParameters[0].UserVisible {
		t.Fatal("visible source lost during merge")
	}
}
