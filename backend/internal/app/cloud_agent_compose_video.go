package app

// 创作 Agent 的视频合成：把本会话已就绪的成品视频或图片按顺序拼接，叠加用户上传的音频作配乐或配音，
// 加字幕（默认烧录进画面，同时输出 SRT）。合成在本机 ffmpeg 执行，不经模型路由也不计费，所以不走媒体审批；
// 任务 ID 由运行和调用派生，同一调用重放时复用已创建的任务。素材只能来自本会话成品或本轮已授权的上传素材。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	cloudAgentComposeMaxClips      = 30
	cloudAgentComposeMaxAudio      = 4
	cloudAgentComposeMaxSubtitles  = 200
	cloudAgentComposeMaxTotalMs    = 10 * 60 * 1000
	cloudAgentComposeMaxClipMs     = 120 * 1000
	cloudAgentComposeMinClipMs     = 500
	cloudAgentComposeImageMs       = 3000
	cloudAgentComposeUnknownVideo  = 5000
	cloudAgentComposeFadeMs        = 300
	cloudAgentComposeSubtitleRunes = 120
	cloudAgentComposeTitleRunes    = 60
)

const cloudAgentComposeAcceptedInstruction = "视频合成已开始，完成后成片会直接出现在对话里；本轮不需要等待或查询。用一句话告诉用户已开始合成（片段数、时长、是否有配乐和字幕），不要描述尚未完成的成片，不要重复提交。"

var cloudAgentComposeSizes = map[string][2]int{"16:9": {1920, 1080}, "9:16": {1080, 1920}, "1:1": {1080, 1080}, "4:3": {1440, 1080}, "3:4": {1080, 1440}}

type cloudAgentComposeArgs struct {
	Title         string `json:"title"`
	AspectRatio   string `json:"aspectRatio"`
	Transition    string `json:"transition"`
	BurnSubtitles *bool  `json:"burnSubtitles"`
	Clips         []struct {
		TaskID          string   `json:"taskId"`
		OutputIndex     int      `json:"outputIndex"`
		ResourceID      string   `json:"resourceId"`
		DurationSeconds *float64 `json:"durationSeconds"`
		StartSeconds    float64  `json:"startSeconds"`
		Volume          *float64 `json:"volume"`
	} `json:"clips"`
	Audio []struct {
		ResourceID   string   `json:"resourceId"`
		StartSeconds float64  `json:"startSeconds"`
		Volume       *float64 `json:"volume"`
	} `json:"audio"`
	Subtitles []struct {
		Text         string  `json:"text"`
		StartSeconds float64 `json:"startSeconds"`
		EndSeconds   float64 `json:"endSeconds"`
	} `json:"subtitles"`
}

func cloudAgentComposeVideoToolProperties() map[string]any {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	clip := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"taskId":          str("本会话成品所属的任务 ID，与 outputIndex 一起使用"),
			"outputIndex":     map[string]any{"type": "integer", "minimum": 1, "description": "任务内成品序号，从1开始"},
			"resourceId":      str("本轮上传或已用 creation_media_read 精读的视频/图片素材 ID；与 taskId 二选一"),
			"durationSeconds": map[string]any{"type": "number", "minimum": 0.5, "maximum": 120, "description": "片段在成片中的时长；图片默认3秒，视频默认截到素材结尾"},
			"startSeconds":    map[string]any{"type": "number", "minimum": 0, "description": "视频从第几秒开始截取，默认0；图片忽略"},
			"volume":          map[string]any{"type": "number", "minimum": 0, "maximum": 2, "description": "片段原声音量，1为原声（默认），0为静音；图片没有声音"},
		},
		"additionalProperties": false,
	}
	audio := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"resourceId":   str("用户上传的音频素材 ID（本轮附件或已精读的历史上传）"),
			"startSeconds": map[string]any{"type": "number", "minimum": 0, "description": "在成片第几秒开始播放，默认0"},
			"volume":       map[string]any{"type": "number", "minimum": 0.05, "maximum": 2, "description": "音量，默认1；作背景音乐且保留片段原声时建议0.3到0.6"},
		},
		"required": []string{"resourceId"}, "additionalProperties": false,
	}
	subtitle := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"text":         map[string]any{"type": "string", "minLength": 1, "maxLength": cloudAgentComposeSubtitleRunes, "description": "一条字幕，单行短句"},
			"startSeconds": map[string]any{"type": "number", "minimum": 0, "description": "在成片中的开始时间"},
			"endSeconds":   map[string]any{"type": "number", "minimum": 0, "description": "在成片中的结束时间，必须大于开始时间"},
		},
		"required": []string{"text", "startSeconds", "endSeconds"}, "additionalProperties": false,
	}
	return map[string]any{
		"title":         str("成片名称，显示在对话里的合成卡片上"),
		"clips":         map[string]any{"type": "array", "minItems": 1, "maxItems": cloudAgentComposeMaxClips, "items": clip, "description": "按播放顺序排列的画面片段"},
		"audio":         map[string]any{"type": "array", "maxItems": cloudAgentComposeMaxAudio, "items": audio, "description": "配乐或配音，与片段原声混合；超出成片长度的部分被截掉"},
		"subtitles":     map[string]any{"type": "array", "maxItems": cloudAgentComposeMaxSubtitles, "items": subtitle, "description": "字幕，时间按成片时间轴"},
		"aspectRatio":   map[string]any{"type": "string", "enum": []string{"16:9", "9:16", "1:1", "4:3", "3:4"}, "description": "成片画幅；省略时按第一个片段的方向"},
		"transition":    map[string]any{"type": "string", "enum": []string{"none", "fade"}, "description": "片段之间的转场：none 硬切（默认），fade 短暂黑场淡入淡出"},
		"burnSubtitles": map[string]any{"type": "boolean", "description": "是否把字幕烧录进画面，默认 true；false 时只输出 SRT 字幕文件"},
	}
}

func cloudAgentHandleComposeVideo(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if len(services) == 0 || services[0] == nil {
		return nil, BadAuthRequest("视频合成服务不可用")
	}
	s := services[0]
	if state.Request.Surface != "creation" || state.Request.SessionID == "" || state.RuntimeRunID == "" {
		return nil, BadAuthRequest("视频合成只能在创作会话中使用")
	}
	if state.Request.PermissionMode == "read_only" {
		return nil, BadAuthRequest("只读模式不能提交视频合成")
	}
	var args cloudAgentComposeArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	// 同一调用重放（进程重启、结果未落库）时复用原任务，不重复合成。
	taskID := cloudAgentID(userID, state.RuntimeRunID+":compose:"+call.ID)
	if existing, err := repo.TaskForUser(userID, taskID); err == nil {
		return cloudAgentComposeAcceptedResult(existing), nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	timeline, title, err := cloudAgentComposeTimeline(repo, userID, state, args)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	// 与时间线渲染接口共用同一个频控键：Agent 和画布不能叠加出两倍的本地渲染压力。
	allowed, err := s.AllowRequest(context.Background(), "timeline-render:"+userID, policy.Request.TaskCreatePerMinute, time.Minute)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, NewAppError(429, "视频合成提交过于频繁，请稍后再试")
	}
	task, err := s.createTimelineRenderTask(userID, TimelineRenderCreateRequest{Timeline: timeline}, timelineRenderTaskOptions{TaskID: taskID, AgentRunID: state.RuntimeRunID, Prompt: title})
	if err != nil {
		return nil, err
	}
	s.wakeTaskDispatcher()
	return cloudAgentComposeAcceptedResult(task), nil
}

// cloudAgentComposeAcceptedResult 从任务里保存的时间线还原回执，首次受理和重放得到同一份结果。
func cloudAgentComposeAcceptedResult(task *model.Task) map[string]any {
	var input timelineRenderInput
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	counts := map[string]int{}
	for _, clip := range input.Timeline.Clips {
		counts[clip.Kind]++
	}
	plan := buildRenderPlan(input.Timeline)
	width, height := plan.size()
	return map[string]any{
		"phase": "accepted", "taskId": task.ID, "status": task.Status, "title": task.Prompt, "mode": "video",
		"taskSubmitted": true, "delivery": "conversation", "charged": false,
		"clipCount": counts["video"] + counts["image"], "audioCount": counts["audio"], "subtitleCount": counts["subtitle"],
		"durationSeconds": math.Round(float64(planDurationMs(plan))/100) / 10, "width": width, "height": height,
		"burnSubtitles": plan.burnsSubtitles(), "instruction": cloudAgentComposeAcceptedInstruction,
	}
}

func cloudAgentComposeDirectMedia(resourceID, kind string) *struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	StorageKey string `json:"storageKey"`
} {
	return &struct {
		ID         string `json:"id"`
		Kind       string `json:"kind"`
		StorageKey string `json:"storageKey"`
	}{resourceID, kind, "resource:" + resourceID}
}

func cloudAgentComposeMs(seconds float64) int64 {
	return int64(math.Round(seconds * 1000))
}

// cloudAgentComposeTimeline 校验参数并解析每个素材的归属，组装成渲染器使用的时间线快照。
func cloudAgentComposeTimeline(repo *repository.Repository, userID string, state *cloudAgentRuntime, args cloudAgentComposeArgs) (renderProject, string, error) {
	project := renderProject{Version: 2}
	if len(args.Clips) == 0 || len(args.Clips) > cloudAgentComposeMaxClips {
		return project, "", cloudAgentFieldError("clips", "item_count", fmt.Sprintf("clips 需要 1 到 %d 个片段", cloudAgentComposeMaxClips))
	}
	if len(args.Audio) > cloudAgentComposeMaxAudio {
		return project, "", cloudAgentFieldError("audio", "item_count", fmt.Sprintf("audio 最多 %d 段", cloudAgentComposeMaxAudio))
	}
	if len(args.Subtitles) > cloudAgentComposeMaxSubtitles {
		return project, "", cloudAgentFieldError("subtitles", "item_count", fmt.Sprintf("subtitles 最多 %d 条", cloudAgentComposeMaxSubtitles))
	}
	if _, known := cloudAgentComposeSizes[args.AspectRatio]; args.AspectRatio != "" && !known {
		return project, "", cloudAgentFieldError("aspectRatio", "invalid_value", "aspectRatio 只支持 16:9、9:16、1:1、4:3、3:4")
	}
	if args.Transition != "" && args.Transition != "none" && args.Transition != "fade" {
		return project, "", cloudAgentFieldError("transition", "invalid_value", "transition 只支持 none 或 fade")
	}
	title := truncateRunes(strings.Join(strings.Fields(args.Title), " "), cloudAgentComposeTitleRunes)
	if title == "" {
		title = "视频合成"
	}
	// 本轮已授权素材：当前上传、已精读的历史上传和已精读的成品，与生成工具的 attachmentResourceIds 同一边界。
	var authorized map[string]CloudAgentAttachment
	attachment := func(id string) (CloudAgentAttachment, bool, error) {
		if authorized == nil {
			req, err := cloudAgentCreationRequestWithOutputs(repo, userID, state)
			if err != nil {
				return CloudAgentAttachment{}, false, err
			}
			authorized = map[string]CloudAgentAttachment{}
			for _, item := range req.Attachments {
				authorized[item.ResourceID] = item
			}
		}
		item, ok := authorized[id]
		return item, ok, nil
	}
	readyResource := func(id, kind string) (*model.Resource, error) {
		resource, err := repo.ResourceForUser(userID, id)
		if err != nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), kind+"/") {
			return nil, BadAuthRequest("素材不存在、尚未就绪或类型不匹配")
		}
		return resource, nil
	}

	visible := true
	project.Tracks = []renderTrack{{ID: "video", Kind: "video", Visible: &visible}}
	var cursor int64
	firstWidth, firstHeight := 0, 0
	for i, item := range args.Clips {
		field := fmt.Sprintf("clips[%d]", i)
		var resource *model.Resource
		kind := ""
		switch {
		case item.TaskID != "" && item.ResourceID != "":
			return project, "", cloudAgentFieldError(field, "conflict", field+" 的 taskId 与 resourceId 只能二选一")
		case item.TaskID != "":
			if item.OutputIndex < 1 {
				return project, "", cloudAgentFieldError(field+".outputIndex", "required", field+" 使用 taskId 时必须给出 outputIndex（从1开始）")
			}
			output, _, err := cloudAgentCreationOutputResource(repo, userID, state, cloudAgentCreationOutputRef{TaskID: item.TaskID, OutputIndex: item.OutputIndex})
			if err != nil {
				return project, "", err
			}
			resource, kind = output, strings.SplitN(strings.ToLower(output.MimeType), "/", 2)[0]
		case item.ResourceID != "":
			source, ok, err := attachment(item.ResourceID)
			if err != nil {
				return project, "", err
			}
			if !ok || (source.Kind != "image" && source.Kind != "video") {
				return project, "", cloudAgentFieldError(field+".resourceId", "unauthorized", field+" 不是本轮可用的视频或图片素材：本会话成品用 taskId/outputIndex，历史上传先用 creation_media_read 精读")
			}
			if resource, err = readyResource(item.ResourceID, source.Kind); err != nil {
				return project, "", err
			}
			kind = source.Kind
		default:
			return project, "", cloudAgentFieldError(field, "required", field+" 需要 taskId/outputIndex 或 resourceId")
		}
		if kind != "image" && kind != "video" {
			return project, "", cloudAgentFieldError(field, "invalid_value", field+" 只能是视频或图片")
		}
		if item.StartSeconds < 0 || (item.DurationSeconds != nil && (*item.DurationSeconds < 0.5 || *item.DurationSeconds > 120)) || (item.Volume != nil && (*item.Volume < 0 || *item.Volume > 2)) {
			return project, "", cloudAgentFieldError(field, "out_of_range", field+" 的 startSeconds 不能为负，durationSeconds 须在 0.5 到 120 秒，volume 须在 0 到 2")
		}
		clip := renderClip{ID: fmt.Sprintf("clip-%d", i+1), Kind: kind, TrackID: "video", StartMs: cursor, Volume: 1}
		if item.Volume != nil {
			clip.Volume = *item.Volume
			if clip.Volume == 0 {
				clip.Volume = -1
			}
		}
		if kind == "image" {
			clip.DurationMs = cloudAgentComposeImageMs
			if item.DurationSeconds != nil {
				clip.DurationMs = cloudAgentComposeMs(*item.DurationSeconds)
			}
		} else {
			start := cloudAgentComposeMs(item.StartSeconds)
			available := int64(-1)
			if resource.DurationMs > 0 {
				available = resource.DurationMs - start
				if available < cloudAgentComposeMinClipMs {
					return project, "", cloudAgentFieldError(field+".startSeconds", "out_of_range", fmt.Sprintf("%s 的 startSeconds 超出素材时长（约 %.1f 秒）", field, float64(resource.DurationMs)/1000))
				}
			}
			switch {
			case item.DurationSeconds != nil:
				clip.DurationMs = cloudAgentComposeMs(*item.DurationSeconds)
				if available > 0 {
					clip.DurationMs = min(clip.DurationMs, available)
				}
			case available > 0:
				clip.DurationMs = available
			default:
				// 素材没有记录时长：按常见生成时长截取，素材更短时由渲染器定格最后一帧补足。
				clip.DurationMs = cloudAgentComposeUnknownVideo
			}
			clip.SourceStartMs = start
		}
		clip.DurationMs = max(cloudAgentComposeMinClipMs, min(clip.DurationMs, cloudAgentComposeMaxClipMs))
		clip.SourceDurationMs = clip.DurationMs
		if args.Transition == "fade" {
			fade := min(int64(cloudAgentComposeFadeMs), clip.DurationMs/4)
			clip.FadeInMs, clip.FadeInColor, clip.FadeOutMs, clip.FadeOutColor = fade, "black", fade, "black"
		}
		clip.DirectMedia = cloudAgentComposeDirectMedia(resource.ID, kind)
		project.Clips = append(project.Clips, clip)
		cursor += clip.DurationMs
		if firstWidth == 0 && resource.Width > 0 && resource.Height > 0 {
			firstWidth, firstHeight = resource.Width, resource.Height
		}
		if cursor > cloudAgentComposeMaxTotalMs {
			return project, "", cloudAgentFieldError("clips", "out_of_range", fmt.Sprintf("成片总时长不能超过 %d 分钟", cloudAgentComposeMaxTotalMs/60000))
		}
	}
	total := cursor
	project.DurationMs = total

	if len(args.Audio) > 0 {
		project.Tracks = append(project.Tracks, renderTrack{ID: "audio", Kind: "audio", Visible: &visible})
	}
	for i, item := range args.Audio {
		field := fmt.Sprintf("audio[%d]", i)
		source, ok, err := attachment(item.ResourceID)
		if err != nil {
			return project, "", err
		}
		if !ok || source.Kind != "audio" {
			return project, "", cloudAgentFieldError(field+".resourceId", "unauthorized", field+" 不是本轮可用的音频素材：请让用户上传音频，或先用 creation_media_read 精读历史上传")
		}
		resource, err := readyResource(item.ResourceID, "audio")
		if err != nil {
			return project, "", err
		}
		start := cloudAgentComposeMs(item.StartSeconds)
		if item.StartSeconds < 0 || start >= total || (item.Volume != nil && (*item.Volume < 0.05 || *item.Volume > 2)) {
			return project, "", cloudAgentFieldError(field, "out_of_range", fmt.Sprintf("%s 的 startSeconds 须在成片时长（%.1f 秒）以内，volume 须在 0.05 到 2", field, float64(total)/1000))
		}
		duration := total - start
		if resource.DurationMs > 0 {
			duration = min(duration, resource.DurationMs)
		}
		volume := 1.0
		if item.Volume != nil {
			volume = *item.Volume
		}
		project.Clips = append(project.Clips, renderClip{ID: fmt.Sprintf("audio-%d", i+1), Kind: "audio", TrackID: "audio", StartMs: start, DurationMs: duration, SourceDurationMs: duration, Volume: volume, DirectMedia: cloudAgentComposeDirectMedia(resource.ID, "audio")})
	}

	if len(args.Subtitles) > 0 {
		project.Tracks = append(project.Tracks, renderTrack{ID: "subtitle", Kind: "subtitle", Visible: &visible})
	}
	// 字幕按单行纯文本处理：去掉换行和 ASS/HTML 标记符号，避免改写样式或打断 SRT 结构。
	clean := strings.NewReplacer("{", "", "}", "", "<", "", ">", "", "\\", "")
	for i, item := range args.Subtitles {
		field := fmt.Sprintf("subtitles[%d]", i)
		text := strings.Join(strings.Fields(clean.Replace(item.Text)), " ")
		if text == "" || utf8.RuneCountInString(text) > cloudAgentComposeSubtitleRunes {
			return project, "", cloudAgentFieldError(field+".text", "invalid_value", fmt.Sprintf("%s 的 text 须为 1 到 %d 字", field, cloudAgentComposeSubtitleRunes))
		}
		start, end := cloudAgentComposeMs(item.StartSeconds), min(cloudAgentComposeMs(item.EndSeconds), total)
		if item.StartSeconds < 0 || start >= total || end <= start {
			return project, "", cloudAgentFieldError(field, "out_of_range", fmt.Sprintf("%s 的时间须在成片时长（%.1f 秒）以内，且 endSeconds 大于 startSeconds", field, float64(total)/1000))
		}
		project.Clips = append(project.Clips, renderClip{ID: fmt.Sprintf("subtitle-%d", i+1), Kind: "subtitle", TrackID: "subtitle", StartMs: start, DurationMs: end - start, Text: text})
	}
	project.BurnSubtitles = len(args.Subtitles) > 0 && (args.BurnSubtitles == nil || *args.BurnSubtitles)

	aspect := args.AspectRatio
	if aspect == "" {
		aspect = "16:9"
		if firstWidth > 0 && firstHeight > 0 {
			ratio, best := float64(firstWidth)/float64(firstHeight), math.Inf(1)
			for _, name := range []string{"16:9", "9:16", "1:1", "4:3", "3:4"} {
				size := cloudAgentComposeSizes[name]
				if diff := math.Abs(math.Log(ratio * float64(size[1]) / float64(size[0]))); diff < best {
					aspect, best = name, diff
				}
			}
		}
	}
	size := cloudAgentComposeSizes[aspect]
	project.Width, project.Height = size[0], size[1]
	return project, title, nil
}
