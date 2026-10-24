package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"

	"golang.org/x/image/draw"
)

const appearanceIconRendererVersion = "icon-v2-transparent"

func appearanceIconSource(value AppearanceSetting) (string, string) {
	if value.LogoResourceID != "" {
		return AppearanceAssetLogo, value.LogoResourceID
	}
	if value.DarkLogoResourceID != "" {
		return AppearanceAssetDarkLogo, value.DarkLogoResourceID
	}
	return "", "neutral"
}

func appearanceIconVersion(value AppearanceSetting) string {
	_, id := appearanceIconSource(value)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(appearanceIconRendererVersion+":"+id)))[:24]
}

func appearanceIconURL(value AppearanceSetting, file string) string {
	return "/api/public/appearance/icons/" + appearanceIconVersion(value) + "/" + file
}

// Only the installation's currently published brand mark may be rendered publicly.
// The URL identifies both the source and renderer; page themes never participate.
func (s *Service) AppearanceIcon(version, file string) ([]byte, string, error) {
	if file != "favicon.png" && file != "favicon.ico" && file != "apple-touch-icon.png" {
		return nil, "", NotFound("站点图标不存在")
	}
	_, value, err := s.readAppearance()
	if err != nil {
		return nil, "", err
	}
	value = s.resolveAvailableAppearanceAssets(value)
	current := appearanceIconVersion(value)
	if version != "" && version != current {
		return nil, "", NotFound("站点图标版本已变更")
	}
	s.appearanceIconMu.Lock()
	defer s.appearanceIconMu.Unlock()
	if s.appearanceIconVersion != current {
		s.appearanceIconFiles = nil
	}
	if s.appearanceIconFiles == nil {
		var source image.Image
		slot, resourceID := appearanceIconSource(value)
		if slot != "" {
			resource, e := s.repo.Resource(resourceID)
			if e != nil {
				return nil, "", e
			}
			if e = validateAppearanceResourceType(slot, resource); e != nil {
				return nil, "", e
			}
			stream, e := s.openResourceRange(resource.UserID, resource, "")
			if e != nil {
				return nil, "", e
			}
			defer stream.Body.Close()
			data, e := io.ReadAll(io.LimitReader(stream.Body, appearanceLogoMaxBytes+1))
			if e != nil {
				return nil, "", e
			}
			if int64(len(data)) > appearanceLogoMaxBytes {
				return nil, "", BadAuthRequest("站点图标来源过大")
			}
			cfg, _, e := image.DecodeConfig(bytes.NewReader(data))
			if e != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
				return nil, "", BadAuthRequest("站点图标来源尺寸无效，最大为 4096×4096")
			}
			source, _, e = image.Decode(bytes.NewReader(data))
			if e != nil {
				return nil, "", BadAuthRequest("站点图标来源无法解码")
			}
		}
		files, e := renderAppearanceIcons(source)
		if e != nil {
			return nil, "", e
		}
		s.appearanceIconFiles = files
		s.appearanceIconVersion = current
	}
	mime := "image/png"
	if file == "favicon.ico" {
		mime = "image/x-icon"
	}
	return s.appearanceIconFiles[file], mime, nil
}

func renderAppearanceIcons(source image.Image) (map[string][]byte, error) {
	// A neutral geometric mark is used only when the deployment has no logo.
	if source == nil {
		mark := image.NewNRGBA(image.Rect(0, 0, 32, 32))
		for _, r := range []image.Rectangle{image.Rect(4, 4, 16, 12), image.Rect(4, 12, 12, 28), image.Rect(16, 20, 28, 28), image.Rect(20, 4, 28, 20)} {
			draw.Draw(mark, r, image.NewUniform(color.Black), image.Point{}, draw.Src)
		}
		source = mark
	}
	bounds := source.Bounds()
	crop := image.Rectangle{}
	var luminance, weight float64
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			if c.A < 32 {
				continue
			}
			point := image.Rect(x, y, x+1, y+1)
			crop = crop.Union(point)
			w := float64(c.A)
			luminance += (0.2126*float64(c.R) + 0.7152*float64(c.G) + 0.0722*float64(c.B)) * w
			weight += w
		}
	}
	if crop.Empty() {
		return nil, BadAuthRequest("站点图标来源没有可见内容")
	}
	outline := color.NRGBA{255, 255, 255, 255}
	if luminance/weight > 150 {
		outline = color.NRGBA{24, 24, 24, 255}
	}
	pngs := make(map[int][]byte)
	for _, size := range []int{16, 32, 48, 64, 180} {
		out := image.NewNRGBA(image.Rect(0, 0, size, size))
		padding := max(2, size/8)
		available := size - 2*padding
		w, h := available, available
		if crop.Dx() > crop.Dy() {
			h = max(1, available*crop.Dy()/crop.Dx())
		} else {
			w = max(1, available*crop.Dx()/crop.Dy())
		}
		x, y := (size-w)/2, (size-h)/2
		mark := image.NewNRGBA(out.Bounds())
		draw.CatmullRom.Scale(mark, image.Rect(x, y, x+w, y+h), source, crop, draw.Src, nil)
		// Contrast follows the mark's silhouette, never a rectangular tile.
		radius := max(1, size/64)
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				alpha := uint8(0)
				for dy := -radius; dy <= radius; dy++ {
					for dx := -radius; dx <= radius; dx++ {
						if dx*dx+dy*dy <= radius*radius {
							alpha = max(alpha, mark.NRGBAAt(x+dx, y+dy).A)
						}
					}
				}
				c := outline
				c.A = alpha
				out.SetNRGBA(x, y, c)
			}
		}
		draw.Draw(out, out.Bounds(), mark, image.Point{}, draw.Over)
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, out); err != nil {
			return nil, err
		}
		pngs[size] = encoded.Bytes()
	}
	// ICO permits PNG-encoded frames; each directory entry describes its real size.
	var ico bytes.Buffer
	for _, v := range []uint16{0, 1, 3} {
		_ = binary.Write(&ico, binary.LittleEndian, v)
	}
	offset := uint32(6 + 3*16)
	for _, size := range []int{16, 32, 48} {
		ico.Write([]byte{byte(size), byte(size), 0, 0})
		_ = binary.Write(&ico, binary.LittleEndian, uint16(1))
		_ = binary.Write(&ico, binary.LittleEndian, uint16(32))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(len(pngs[size])))
		_ = binary.Write(&ico, binary.LittleEndian, offset)
		offset += uint32(len(pngs[size]))
	}
	for _, size := range []int{16, 32, 48} {
		ico.Write(pngs[size])
	}
	return map[string][]byte{"favicon.png": pngs[64], "favicon.ico": ico.Bytes(), "apple-touch-icon.png": pngs[180]}, nil
}
