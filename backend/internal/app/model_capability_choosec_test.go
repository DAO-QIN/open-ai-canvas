package app

import (
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestChooseCQwenCapabilityDefaultsAndPluginContract(t *testing.T) {
	image := DefaultImageCapabilityConfig("choosec-qwen-image", "qwen-image-2.1-turbo")
	if image.Size.Default != "1024x1024" || !image.Size.AllowCustom || image.MaxOutputs != 10 || image.References.MaxImages != 0 || image.References.MaskSupported || image.Resolution.Supported || image.TransparentBackground.Supported || image.OutputFormat.Supported || image.Quality.Default != "standard" {
		t.Fatalf("unexpected defaults: %#v", image)
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
	if defaults["style"] != "vivid" || defaults["responseFormat"] != "url" || defaults["size"] != "1024x1024" || image.MaxOutputs != 10 {
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
	if config.Size != "1024x1360" || config.ImageParameters["size"] != config.Size {
		t.Fatalf("pixel encoding lost: %#v", config.ImageParameters)
	}
}
