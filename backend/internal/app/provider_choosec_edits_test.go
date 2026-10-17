package app

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestChooseCReferenceUploadsActualFileBytes(t *testing.T) {
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
	input := canvasGenerationInput{Mode: "image", Prompt: "place this cat in a garden", Config: providerConfig{Model: "qwen-image-2.1-turbo", Size: "2048x2048", Count: "1"}, ReferenceImages: []providerMedia{{Name: "cat.png", Type: "image/png", DataURL: "data:image/png;base64,aGVsbG8="}}}
	spec, err := adapters[0].BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/images/edits" {
		t.Fatalf("wrong endpoint: %s", spec.Path)
	}
	reader, contentType, err := protocolRequestBody(context.Background(), input.Config, spec)
	if err != nil {
		t.Fatal(err)
	}
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		t.Fatalf("invalid multipart: %s, %v", contentType, err)
	}
	form, err := multipart.NewReader(reader, params["boundary"]).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}
	defer form.RemoveAll()
	if form.Value["model"][0] != input.Config.Model || form.Value["size"][0] != "2048x2048" || form.Value["n"][0] != "1" || len(form.Value) != 4 {
		t.Fatalf("unexpected form fields: %#v", form.Value)
	}
	files := form.File["image[]"]
	if len(files) != 1 || files[0].Filename != "cat.png" || files[0].Header.Get("Content-Type") != "image/png" {
		t.Fatalf("invalid file parts: %#v", files)
	}
	file, err := files[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil || string(data) != "hello" {
		t.Fatalf("reference bytes changed: %q, %v", data, err)
	}
}
