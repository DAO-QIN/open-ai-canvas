package app

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"math/rand/v2"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

// noisyImage 生成压缩不了的噪点图：PNG 体积大，缩小后的 JPEG 明显更小，展示档位一定值得生成。
func noisyImage(width, height int, alpha bool) *image.NRGBA {
	random := rand.New(rand.NewPCG(1, 2))
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			a := uint8(255)
			if alpha {
				a = uint8(64 + x%128)
			}
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(random.UintN(256)), G: uint8(random.UintN(256)), B: uint8(random.UintN(256)), A: a})
		}
	}
	return img
}

// newDisplayTestService 预置签名密钥：本地资源的展示地址要签名，测试里不走首次生成密钥的落盘流程。
func newDisplayTestService(t *testing.T) *Service {
	t.Helper()
	svc := newResourceTestService(t)
	if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	return svc
}

func writeDisplaySource(t *testing.T, svc *Service, id, objectKey, mimeType string, data []byte, width, height int) *model.Resource {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", objectKey), data, 0o600); err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: id, UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: objectKey, MimeType: mimeType, Size: int64(len(data)), Width: width, Height: height}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestOpaqueOriginalGetsJPEGDisplayVariant(t *testing.T) {
	svc := newDisplayTestService(t)
	original := encodePNG(t, noisyImage(1800, 1000, false))
	resource := writeDisplaySource(t, svc, "display-opaque", "display.png", "image/png", original, 1800, 1000)

	// 生成前访问展示档位：回落原图，并标明展示图还在准备。
	results, err := svc.ResourceAccessBatch("user-1", []ResourceAccessRequest{{ResourceID: resource.ID, AccessOptions: ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantDisplay}}})
	if err != nil || results[0].Access == nil || results[0].Access.ActualVariant != assets.VariantOriginal || results[0].Access.FallbackReason != "display_not_ready" {
		t.Fatalf("pending display access = %#v, %v", results, err)
	}

	svc.generateResourceDisplay("user-1", resource.ID)
	updated, err := svc.repo.ResourceForUser("user-1", resource.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayStatus != "ready" || updated.DisplayMimeType != "image/jpeg" || updated.DisplayWidth != 1600 || updated.DisplayHeight != 889 || updated.DisplaySize <= 0 || updated.DisplaySize >= updated.Size {
		t.Fatalf("display fields = %+v", updated)
	}
	stored, err := os.ReadFile(filepath.Join(svc.dataDir, "resources", assets.DisplayObjectKey(resource.ObjectKey)))
	if err != nil || int64(len(stored)) != updated.DisplaySize {
		t.Fatalf("display object = %d bytes, %v", len(stored), err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(stored))
	if err != nil || format != "jpeg" || config.Width != 1600 || config.Height != 889 {
		t.Fatalf("display image = %s %dx%d, %v", format, config.Width, config.Height, err)
	}

	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantDisplay}, "")
	if err != nil {
		t.Fatal(err)
	}
	served, err := io.ReadAll(delivery.Stream.Body)
	_ = delivery.Stream.Body.Close()
	if err != nil || !bytes.Equal(served, stored) || delivery.Access.ActualVariant != assets.VariantDisplay || delivery.Access.OriginalWidth != 1800 {
		t.Fatalf("display delivery = %#v, %d bytes, %v", delivery.Access, len(served), err)
	}
	// 下载和复制始终是原图。
	download, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceAccessOptions{Purpose: assets.PurposeDownload, Variant: assets.VariantDisplay}, "")
	if err != nil {
		t.Fatal(err)
	}
	downloaded, _ := io.ReadAll(download.Stream.Body)
	_ = download.Stream.Body.Close()
	if !bytes.Equal(downloaded, original) {
		t.Fatal("download must serve the original bytes")
	}

	usage, err := svc.repo.UserStoredFileBytes("user-1")
	if err != nil || usage != updated.Size+updated.DisplaySize {
		t.Fatalf("display bytes not charged: %d %v", usage, err)
	}
	jobs := resourceDeletionJobs("user-1", map[string]*model.Resource{"original": updated})
	if len(jobs) != 2 || jobs[1].ObjectKey != assets.DisplayObjectKey(resource.ObjectKey) {
		t.Fatalf("display cleanup not scheduled: %#v", jobs)
	}

	// 已就绪时不再认领，也不重写对象。
	if claimed, err := svc.repo.ClaimResourceDisplay("user-1", resource.ID, updated.UpdatedAt); err != nil || claimed {
		t.Fatalf("ready display must not be claimed again: %v %v", claimed, err)
	}
}

func TestTransparentOriginalKeepsPNGDisplayVariant(t *testing.T) {
	svc := newDisplayTestService(t)
	resource := writeDisplaySource(t, svc, "display-alpha", "alpha.png", "image/png", encodePNG(t, noisyImage(3200, 400, true)), 0, 0)
	svc.generateResourceDisplay("user-1", resource.ID)
	updated, err := svc.repo.ResourceForUser("user-1", resource.ID)
	if err != nil || updated.DisplayStatus != "ready" || updated.DisplayMimeType != "image/png" || updated.DisplayWidth != 1600 || updated.DisplayHeight != 200 {
		t.Fatalf("alpha display = %+v, %v", updated, err)
	}
}

func TestDisplayVariantSkipsOriginalsItCannotImprove(t *testing.T) {
	svc := newDisplayTestService(t)
	// 尺寸未知的小图：解码头部后发现长边不超过 1600，记为 skipped，之后直接用原图。
	small := writeDisplaySource(t, svc, "display-small", "small.png", "image/png", encodePNG(t, noisyImage(1200, 800, false)), 0, 0)
	svc.generateResourceDisplay("user-1", small.ID)
	if updated, err := svc.repo.ResourceForUser("user-1", small.ID); err != nil || updated.DisplayStatus != "skipped" {
		t.Fatalf("small display = %+v, %v", updated, err)
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, "resources", assets.DisplayObjectKey(small.ObjectKey))); !os.IsNotExist(err) {
		t.Fatalf("skipped display must not leave an object: %v", err)
	}

	// 纯色细长图的 PNG 只有几百字节，缩完的 JPEG 光文件头就更大，省不下两成，不多存一份。
	flat := image.NewRGBA(image.Rect(0, 0, 1700, 10))
	for index := 0; index < len(flat.Pix); index += 4 {
		copy(flat.Pix[index:index+4], []byte{200, 200, 200, 255})
	}
	plain := writeDisplaySource(t, svc, "display-flat", "flat.png", "image/png", encodePNG(t, flat), 1700, 10)
	svc.generateResourceDisplay("user-1", plain.ID)
	if updated, err := svc.repo.ResourceForUser("user-1", plain.ID); err != nil || updated.DisplayStatus != "skipped" {
		t.Fatalf("flat display = %+v, %v", updated, err)
	}
}

// jpegWithSegment 在 SOI 后插入一个 APP 段。
func jpegWithSegment(t *testing.T, img image.Image, marker byte, payload []byte) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	segment := []byte{0xFF, marker, 0, 0}
	binary.BigEndian.PutUint16(segment[2:], uint16(len(payload)+2))
	segment = append(segment, payload...)
	data := encoded.Bytes()
	return append(append(append([]byte{}, data[:2]...), segment...), data[2:]...)
}

func exifPayload(orientation uint16) []byte {
	payload := []byte("Exif\x00\x00II*\x00\x08\x00\x00\x00\x01\x00")
	entry := make([]byte, 12)
	binary.LittleEndian.PutUint16(entry[0:], 0x0112)
	binary.LittleEndian.PutUint16(entry[2:], 3)
	binary.LittleEndian.PutUint32(entry[4:], 1)
	binary.LittleEndian.PutUint16(entry[8:], orientation)
	return append(append(payload, entry...), 0, 0, 0, 0)
}

func iccPayload(colorSpace string) []byte {
	profile := make([]byte, 132)
	binary.BigEndian.PutUint32(profile, uint32(len(profile)))
	copy(profile[16:20], colorSpace)
	copy(profile[36:40], "acsp")
	return append([]byte("ICC_PROFILE\x00\x01\x01"), profile...)
}

func TestDisplayEncodingRespectsJPEGOrientationAndColorProfile(t *testing.T) {
	source := noisyImage(1800, 1000, false)
	if orientation := exifOrientation(exifPayload(6)[6:]); orientation != 6 {
		t.Fatalf("orientation = %d", orientation)
	}
	// 带旋转标记的照片：浏览器按标记旋转原图，重新编码会丢掉标记，所以不生成。
	if _, err := encodeResourceDisplay(jpegWithSegment(t, source, 0xE1, exifPayload(6))); !errors.Is(err, errDisplayNotNeeded) {
		t.Fatalf("rotated jpeg must keep the original: %v", err)
	}
	if _, err := encodeResourceDisplay(jpegWithSegment(t, source, 0xE1, exifPayload(1))); err != nil {
		t.Fatalf("upright jpeg: %v", err)
	}
	// RGB 色彩配置原样带进展示图；其他色彩空间的配置带不过去，不生成。
	rgb := iccPayload("RGB ")
	display, err := encodeResourceDisplay(jpegWithSegment(t, source, 0xE2, rgb))
	if err != nil || !bytes.Contains(display.data, rgb) || display.mimeType != "image/jpeg" {
		t.Fatalf("rgb profile not preserved: %v", err)
	}
	if _, err := encodeResourceDisplay(jpegWithSegment(t, source, 0xE2, iccPayload("GRAY"))); !errors.Is(err, errDisplayNotNeeded) {
		t.Fatalf("non-RGB profile must keep the original: %v", err)
	}
	// PNG 里的色彩配置、动画 PNG 同样保持原图。
	plain := encodePNG(t, source)
	withChunk := func(kind string) []byte {
		chunk := []byte{0, 0, 0, 0}
		chunk = append(chunk, kind...)
		chunk = append(chunk, 0, 0, 0, 0)
		// 8 字节签名之后是 25 字节的 IHDR 块（4 长度 + 4 类型 + 13 数据 + 4 校验），新块插在第 33 字节处。
		return append(append(append([]byte{}, plain[:33]...), chunk...), plain[33:]...)
	}
	for _, kind := range []string{"iCCP", "acTL", "eXIf"} {
		if _, err := encodeResourceDisplay(withChunk(kind)); !errors.Is(err, errDisplayNotNeeded) {
			t.Fatalf("png with %s must keep the original: %v", kind, err)
		}
	}
}
