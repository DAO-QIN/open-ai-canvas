package app

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
)

func TestAppearanceIconsTransparentAndSmallAcrossLogoColors(t *testing.T) {
	for _, foreground := range []color.NRGBA{{0, 0, 0, 255}, {255, 255, 255, 255}, {255, 255, 0, 255}} {
		source := image.NewNRGBA(image.Rect(0, 0, 128, 128))
		for y := 40; y < 88; y++ {
			for x := 48; x < 80; x++ {
				source.SetNRGBA(x, y, foreground)
			}
		}
		files, err := renderAppearanceIcons(source)
		if err != nil {
			t.Fatal(err)
		}
		for file, size := range map[string]int{"favicon.png": 64, "apple-touch-icon.png": 180} {
			img, e := png.Decode(bytes.NewReader(files[file]))
			if e != nil || img.Bounds().Dx() != size || img.Bounds().Dy() != size {
				t.Fatalf("%s decode/size: %v", file, e)
			}
			for edge := 0; edge < size; edge++ {
				for _, point := range []image.Point{{edge, 0}, {edge, size - 1}, {0, edge}, {size - 1, edge}} {
					_, _, _, alpha := img.At(point.X, point.Y).RGBA()
					if alpha != 0 {
						t.Fatalf("%s has a visible frame", file)
					}
				}
			}
			center := color.NRGBAModel.Convert(img.At(size/2, size/2)).(color.NRGBA)
			if center != foreground {
				t.Fatalf("%s changed the mark color: %v", file, center)
			}
			hasContrastOutline := false
			for y := 1; y < size-1; y++ {
				for x := 1; x < size-1; x++ {
					c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
					delta := int(c.R) - int(foreground.R)
					if c.A > 32 && (delta < -150 || delta > 150) {
						hasContrastOutline = true
					}
				}
			}
			if !hasContrastOutline {
				t.Fatalf("%s lacks silhouette contrast", file)
			}
		}
		ico := files["favicon.ico"]
		if len(ico) > 20<<10 || binary.LittleEndian.Uint16(ico[4:6]) != 3 {
			t.Fatal("ICO should have three small frames")
		}
		for i, size := range []int{16, 32, 48} {
			entry := ico[6+i*16:]
			n, offset := binary.LittleEndian.Uint32(entry[8:12]), binary.LittleEndian.Uint32(entry[12:16])
			img, e := png.Decode(bytes.NewReader(ico[offset : offset+n]))
			if e != nil || img.Bounds().Dx() != size || int(entry[0]) != size {
				t.Fatalf("invalid ICO frame %d: %v", size, e)
			}
			if !bytes.Equal(ico[offset:offset+n], files[fmt.Sprintf("favicon-%d.png", size)]) {
				t.Fatalf("preview differs from the native %dpx frame", size)
			}
		}
	}
	if _, err := renderAppearanceIcons(image.NewNRGBA(image.Rect(0, 0, 32, 32))); err == nil {
		t.Fatal("transparent source should be rejected")
	}
}

func TestAppearanceIconsColorfulMarkHasNoWhiteHaloAndUsesSmallCanvas(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 96, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 96; x++ {
			source.SetNRGBA(x, y, color.NRGBA{24, 72, 224, 255})
		}
	}
	files, err := renderAppearanceIcons(source)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(files["favicon-16.png"]))
	if err != nil {
		t.Fatal(err)
	}
	visible := image.Rectangle{}
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			if c.A > 32 {
				visible = visible.Union(image.Rect(x, y, x+1, y+1))
				if c.R > 35 || c.G > 85 || c.B < 210 {
					t.Fatalf("colorful mark acquired a neutral halo: %v", c)
				}
			}
		}
	}
	if visible.Dx() < 14 || visible.Min.X < 1 || visible.Max.X > 15 {
		t.Fatalf("small mark should use 14px with transparent margins: %v", visible)
	}
}

func TestAppearanceIconOnlyPublishedSourceAndContentVersion(t *testing.T) {
	svc, db, dataDir, admin := newAppearanceTestService(t)
	resource := model.Resource{ID: "logo-icon-test", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "logo.png", MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "resources"), 0750); err != nil {
		t.Fatal(err)
	}
	files, _ := renderAppearanceIcons(nil)
	if err := os.WriteFile(filepath.Join(dataDir, "resources", "logo.png"), files["favicon.png"], 0640); err != nil {
		t.Fatal(err)
	}
	value := defaultAppearanceSetting()
	value.LogoResourceID = resource.ID
	updated, err := svc.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	version := appearanceIconVersion(value)
	first, mime, err := svc.AppearanceIcon(version, "favicon.ico")
	if err != nil || len(first) == 0 || mime != "image/x-icon" {
		t.Fatalf("icon: %v %s", err, mime)
	}
	value.BrandName = "Changed title"
	second, err := svc.UpdateAppearance(admin, value)
	if err != nil || second.Public.FaviconURL != updated.Public.FaviconURL {
		t.Fatalf("unrelated metadata invalidated icon: %v", err)
	}
	if _, _, err = svc.AppearanceIcon("unpublished-resource", "favicon.png"); err == nil {
		t.Fatal("arbitrary resource/version must not be served")
	}
	value.LogoResourceID = ""
	if _, err = svc.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	if _, _, err = svc.AppearanceIcon(version, "favicon.ico"); err == nil {
		t.Fatal("unpublished logo must not be served")
	}
	if _, _, err = svc.AppearanceIcon("", "unknown.png"); err == nil {
		t.Fatal("unknown variants must be rejected")
	}
	if data, _, e := svc.AppearanceIcon("", "favicon.png"); e != nil || len(data) == 0 {
		t.Fatalf("neutral bootstrap icon unavailable: %v", e)
	}
}
