package app

import "testing"

func TestCangyuanSeedreamDefaults(t *testing.T) {
	image := DefaultImageCapabilityConfig("cangyuan-seedream-5-pro", "doubao-seedream-5-0-pro")
	if err := validateImageCapabilityConfig(image); err != nil {
		t.Fatal(err)
	}
	if image.References.MaxImages != 10 || image.References.MaxImageBytes != 20*1024*1024 || image.References.MaskSupported || image.Size.Default != "1:1" || !image.Size.AllowCustom || len(image.Size.Values) != 8 || image.MaxOutputs != 1 || image.Quality.Supported || image.Resolution.Supported || image.TransparentBackground.Supported || !image.OutputFormat.Supported {
		t.Fatalf("defaults: %#v", image)
	}
}
