package app

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 对话结果图的展示档位：首次按 variant=display 访问时在后台生成，生成好之前这次访问仍回落原图。
// 只做长边缩放和重新编码（不透明图 JPEG，带透明像素的 PNG），不裁切、不改色；
// 方向标记、色彩配置或动画没法原样带过去时不生成，展示继续用原图。
const (
	// 解码前按像素数拦住超大图，4K（约 1700 万像素）解码约占 64MB。
	displayMaxPixels      = 40_000_000
	displayMaxSourceBytes = 64 << 20
	// 认领超过这个时间仍是 processing（进程中途退出）时允许重新认领。
	displayClaimTTL    = 10 * time.Minute
	displayJPEGQuality = 85
	// 排队等生成的上限；排满时这次不排，之后的访问会再触发。
	displayMaxPending = 256
)

var (
	// 同时最多解码两张原图。
	displaySlots        = make(chan struct{}, 2)
	displayInFlight     sync.Map
	displayPending      atomic.Int64
	errDisplayNotNeeded = errors.New("展示档位无需生成")
)

// scheduleResourceDisplay 把一张图排进后台生成；同一进程里同一资源只排一次，跨实例由数据库认领去重。
func (s *Service) scheduleResourceDisplay(resource *model.Resource) {
	if resource == nil || resource.Status != model.ResourceStatusReady || !assets.DisplayEligible(resource) {
		return
	}
	if resource.DisplayStatus != "" && !(resource.DisplayStatus == "processing" && time.Since(resource.UpdatedAt) > displayClaimTTL) {
		return
	}
	userID, id := resource.UserID, resource.ID
	if _, queued := displayInFlight.LoadOrStore(id, struct{}{}); queued {
		return
	}
	release := func() {
		displayPending.Add(-1)
		displayInFlight.Delete(id)
	}
	if displayPending.Add(1) > displayMaxPending {
		release()
		return
	}
	started := s.runWorkerTask(func() {
		defer release()
		displaySlots <- struct{}{}
		defer func() { <-displaySlots }()
		if s.IsDraining() {
			return
		}
		s.generateResourceDisplay(userID, id)
	})
	if !started {
		release()
	}
}

func (s *Service) generateResourceDisplay(userID, id string) {
	claimed, err := s.repo.ClaimResourceDisplay(userID, id, time.Now().Add(-displayClaimTTL))
	if err != nil {
		slog.Warn("resource display claim failed", "resourceId", id, "error", err)
		return
	}
	if !claimed {
		return
	}
	status, err := s.renderResourceDisplay(userID, id)
	if err != nil {
		slog.Warn("resource display generation failed", "resourceId", id, "error", err)
		status = "failed"
	}
	// ready 已在登记时写入；空串表示原图已删除或认领已被接手，不再改状态。
	if status == "ready" || status == "" {
		return
	}
	if err := s.repo.SettleResourceDisplay(userID, id, status); err != nil {
		slog.Warn("resource display status update failed", "resourceId", id, "status", status, "error", err)
	}
}

// renderResourceDisplay 读原图、生成并登记展示图。返回 ready、skipped，或空串（不再归这次认领处理）。
func (s *Service) renderResourceDisplay(userID, id string) (string, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if resource.Status != model.ResourceStatusReady || !assets.DisplayEligible(resource) || resource.Size > displayMaxSourceBytes {
		return "skipped", nil
	}
	stream, err := s.openResourceRange(userID, resource, "")
	if err != nil {
		return "", err
	}
	data, err := io.ReadAll(io.LimitReader(stream.Body, displayMaxSourceBytes+1))
	_ = stream.Body.Close()
	if err != nil {
		return "", fmt.Errorf("读取原图：%w", err)
	}
	if len(data) > displayMaxSourceBytes {
		return "skipped", nil
	}
	encoded, err := encodeResourceDisplay(data)
	if errors.Is(err, errDisplayNotNeeded) {
		return "skipped", nil
	}
	if err != nil {
		return "", err
	}
	// 缩完省不下两成就不多存一份。
	if int64(len(encoded.data))*5 >= int64(len(data))*4 {
		return "skipped", nil
	}
	display := *resource
	display.ObjectKey, display.MimeType, display.Size = assets.DisplayObjectKey(resource.ObjectKey), encoded.mimeType, int64(len(encoded.data))
	if _, err := s.storeResourceObject(&display, "display", bytes.NewReader(encoded.data)); err != nil {
		return "", fmt.Errorf("保存展示图：%w", err)
	}
	published, err := s.publishResourceDisplay(userID, id, encoded)
	if err == nil && published {
		return "ready", nil
	}
	s.discardResourceDisplayObject(userID, resource, &display)
	if errors.Is(err, repository.ErrUploadStorageLimit) {
		// 账号容量不够就不再多存展示图，展示继续用原图。
		return "skipped", nil
	}
	return "", err
}

// publishResourceDisplay 登记展示图并计入账号存储用量（不占当日上传额度）。
func (s *Service) publishResourceDisplay(userID, id string, encoded displayImage) (bool, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return false, err
	}
	storedLimit, err := s.storedFileLimit(userID, policy)
	if err != nil {
		return false, err
	}
	return s.repo.PublishResourceDisplay(userID, id, map[string]any{
		"display_status": "ready", "display_mime_type": encoded.mimeType, "display_size": len(encoded.data),
		"display_width": encoded.width, "display_height": encoded.height, "updated_at": time.Now(),
	}, storedLimit)
}

// discardResourceDisplayObject 删掉没能登记的展示图。展示图对象键由原件派生：别的记录共用同一份原件，
// 或这条记录已经由接手的认领登记好展示图时，对象可能正在被使用，保留不删。
func (s *Service) discardResourceDisplayObject(userID string, original, display *model.Resource) {
	if latest, err := s.repo.ResourceForUser(userID, original.ID); err == nil && latest.DisplayStatus == "ready" {
		return
	}
	shared, err := s.repo.ResourceStorageReferenceCount(original, []string{original.ID})
	if err != nil || shared > 0 {
		return
	}
	if err := s.deleteResourceObjectAtKey(userID, display); err != nil {
		slog.Warn("resource display cleanup failed", "resourceId", original.ID, "error", err)
	}
}

type displayImage struct {
	data          []byte
	mimeType      string
	width, height int
}

// encodeResourceDisplay 把原图缩到长边 1600：不透明图编码为 JPEG（带上原图的 RGB 色彩配置），带透明像素的编码为 PNG。
func encodeResourceDisplay(data []byte) (displayImage, error) {
	source, err := inspectDisplaySource(data)
	if err != nil {
		return displayImage{}, err
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return displayImage{}, errDisplayNotNeeded
	}
	if max(config.Width, config.Height) <= assets.DisplayMaxEdge || int64(config.Width)*int64(config.Height) > displayMaxPixels {
		return displayImage{}, errDisplayNotNeeded
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return displayImage{}, fmt.Errorf("解码原图：%w", err)
	}
	width, height := displayDimensions(config.Width, config.Height)
	bounds := image.Rect(0, 0, width, height)
	var out bytes.Buffer
	if opaque, ok := decoded.(interface{ Opaque() bool }); ok && opaque.Opaque() {
		target := image.NewRGBA(bounds)
		draw.CatmullRom.Scale(target, bounds, decoded, decoded.Bounds(), draw.Src, nil)
		if err := jpeg.Encode(&out, target, &jpeg.Options{Quality: displayJPEGQuality}); err != nil {
			return displayImage{}, fmt.Errorf("编码展示图：%w", err)
		}
		return displayImage{data: withJPEGSegments(out.Bytes(), source.iccSegments), mimeType: "image/jpeg", width: width, height: height}, nil
	}
	target := image.NewNRGBA(bounds)
	draw.CatmullRom.Scale(target, bounds, decoded, decoded.Bounds(), draw.Src, nil)
	if err := png.Encode(&out, target); err != nil {
		return displayImage{}, fmt.Errorf("编码展示图：%w", err)
	}
	return displayImage{data: out.Bytes(), mimeType: "image/png", width: width, height: height}, nil
}

func displayDimensions(width, height int) (int, int) {
	edge := float64(assets.DisplayMaxEdge)
	if width >= height {
		return assets.DisplayMaxEdge, max(1, int(math.Round(float64(height)*edge/float64(width))))
	}
	return max(1, int(math.Round(float64(width)*edge/float64(height)))), assets.DisplayMaxEdge
}

// withJPEGSegments 把原图的色彩配置段插在 SOI 之后。
func withJPEGSegments(encoded []byte, segments [][]byte) []byte {
	if len(segments) == 0 || len(encoded) < 2 {
		return encoded
	}
	size := len(encoded)
	for _, segment := range segments {
		size += len(segment)
	}
	out := make([]byte, 0, size)
	out = append(out, encoded[:2]...)
	for _, segment := range segments {
		out = append(out, segment...)
	}
	return append(out, encoded[2:]...)
}

// displaySource 记下原图容器里重新编码时要带过去的内容。
type displaySource struct {
	// JPEG 原图里 RGB 色彩配置的 APP2 段（含段头），原样写进展示图。
	iccSegments [][]byte
}

// inspectDisplaySource 检查原图能否直接缩小重编码：带方向标记的 JPEG、CMYK、动图（APNG、动画 WebP），
// 以及 PNG/WebP 里的色彩配置、方向信息都带不过去，返回 errDisplayNotNeeded。
func inspectDisplaySource(data []byte) (displaySource, error) {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return displaySource{}, inspectDisplayPNG(data)
	case len(data) > 4 && data[0] == 0xFF && data[1] == 0xD8:
		return inspectDisplayJPEG(data)
	case len(data) > 20 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		// 扩展格式（VP8X）的标志位：0x20 色彩配置、0x08 EXIF、0x02 动画。
		if string(data[12:16]) == "VP8X" && data[20]&(0x20|0x08|0x02) != 0 {
			return displaySource{}, errDisplayNotNeeded
		}
		return displaySource{}, nil
	}
	return displaySource{}, errDisplayNotNeeded
}

func inspectDisplayPNG(data []byte) error {
	for offset := 8; offset+8 <= len(data); {
		length := int(binary.BigEndian.Uint32(data[offset:]))
		switch string(data[offset+4 : offset+8]) {
		case "iCCP", "eXIf", "acTL":
			return errDisplayNotNeeded
		case "IDAT", "IEND":
			return nil
		}
		offset += 12 + length
	}
	return nil
}

func inspectDisplayJPEG(data []byte) (displaySource, error) {
	var source displaySource
	for offset := 2; offset+4 <= len(data) && data[offset] == 0xFF; {
		marker := data[offset+1]
		if marker == 0xFF {
			offset++
			continue
		}
		if marker == 0x01 || (marker >= 0xD0 && marker <= 0xD8) {
			offset += 2
			continue
		}
		if marker == 0xDA || marker == 0xD9 {
			break
		}
		length := int(binary.BigEndian.Uint16(data[offset+2:]))
		if length < 2 || offset+2+length > len(data) {
			break
		}
		segment := data[offset+4 : offset+2+length]
		switch {
		case marker == 0xE1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) && exifOrientation(segment[6:]) > 1:
			return source, errDisplayNotNeeded
		case marker == 0xE2 && bytes.HasPrefix(segment, []byte("ICC_PROFILE\x00")):
			source.iccSegments = append(source.iccSegments, data[offset:offset+2+length])
		case marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC:
			// 帧头第 6 字节是分量数：4 分量（CMYK/YCCK）转成 RGB 后色彩对不上。
			if len(segment) >= 6 && segment[5] == 4 {
				return source, errDisplayNotNeeded
			}
		}
		offset += 2 + length
	}
	if len(source.iccSegments) > 0 && !iccSegmentsDescribeRGB(source.iccSegments) {
		return source, errDisplayNotNeeded
	}
	return source, nil
}

// iccSegmentsDescribeRGB 看第一段配置正文的色彩空间（正文第 16–19 字节）是否为 RGB。
// 段结构：FFE2、两字节长度、"ICC_PROFILE\0"、序号、总段数，之后才是配置正文。
func iccSegmentsDescribeRGB(segments [][]byte) bool {
	for _, segment := range segments {
		if len(segment) >= 38 && segment[16] == 1 {
			return string(segment[34:38]) == "RGB "
		}
	}
	return false
}

// exifOrientation 读 TIFF 结构里第一个 IFD 的方向标记（0x0112），读不出时按正向返回 1。
func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 1
	}
	count := int(order.Uint16(tiff[ifd:]))
	for index := 0; index < count; index++ {
		entry := ifd + 2 + index*12
		if entry+12 > len(tiff) {
			return 1
		}
		if order.Uint16(tiff[entry:]) == 0x0112 {
			if value := int(order.Uint16(tiff[entry+8:])); value >= 1 && value <= 8 {
				return value
			}
			return 1
		}
	}
	return 1
}
