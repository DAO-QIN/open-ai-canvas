// 首页创作会话的 Agent 媒体生成（creation_generate_media）。设计见 docs/design/home-agent.md §8。
//
// 与画布版 generate_media 共用准入、报价、资源签名、预算与独立审批，只是产出不同：
// 画布版先建草稿节点、完成后回写节点；首页版不碰画布，批准后在同一事务里创建任务和
// 一条 origin=agent 的生成记录，任务终态由任务协调器回写记录，这里只把结果交给模型。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"gorm.io/gorm"
	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	cloudAgentCreationMediaToolName  = agenttool.CreationGenerateMedia
	creationAgentReadEntriesLimit    = 20
	creationAgentFactsEntryLimit     = 8
	creationAgentProposalLimit       = 20
	creationAgentProposalPromptRunes = 120
)

// cloudAgentCreationProposal 是首页会话里一次方案及用户决定。Decision：
// pending 等待审批，approve 已批准（EntryID 为生成记录），reject 已拒绝，expired 上一轮结束时仍未决定。
type cloudAgentCreationProposal struct {
	ApprovalID string `json:"approvalId"`
	RunID      string `json:"runId"`
	Mode       string `json:"mode"`
	Title      string `json:"title,omitempty"`
	Prompt     string `json:"prompt"`
	Decision   string `json:"decision"`
	EntryID    string `json:"entryId,omitempty"`
}

type cloudAgentCreationReferenceArg struct {
	EntryID    string `json:"entryId,omitempty"`
	Slot       *int   `json:"slot,omitempty"`
	ResourceID string `json:"resourceId,omitempty"`
}

// cloudAgentCreationMediaArgs 是 creation_generate_media 的参数。批准前执行器会把解析出的
// 模型默认写回参数，审批卡与最终提交使用同一份内容。
type cloudAgentCreationMediaArgs struct {
	Mode                       string                           `json:"mode"`
	Prompt                     string                           `json:"prompt"`
	Title                      string                           `json:"title,omitempty"`
	LogicalModelID             string                           `json:"logicalModelId,omitempty"`
	ChannelID                  string                           `json:"channelId,omitempty"`
	ChannelModelKey            string                           `json:"channelModelKey,omitempty"`
	Duration                   int                              `json:"durationSeconds,omitempty"`
	Size                       string                           `json:"size,omitempty"`
	ImageResolution            string                           `json:"imageResolution,omitempty"`
	ImageParameters            string                           `json:"imageParameters,omitempty"`
	Quality                    string                           `json:"quality,omitempty"`
	VideoGenerateAudio         *bool                            `json:"videoGenerateAudio,omitempty"`
	VideoWatermark             *bool                            `json:"videoWatermark,omitempty"`
	VideoArkPrivateAssetUpload *bool                            `json:"videoArkPrivateAssetUpload,omitempty"`
	References                 []cloudAgentCreationReferenceArg `json:"references"`
}

type cloudAgentCreationMediaPlan struct {
	Request    CreateTaskRequest
	Media      *cloudAgentMediaPlan
	Args       cloudAgentCreationMediaArgs
	References []CreationReference
}

var cloudAgentCreationModeLabels = map[string]string{"image": "图片", "video": "视频", "audio": "音频"}

// 首页没有画布：依赖哈希与准入复核都基于空文档，参考素材的变化由资源签名把关。
func cloudAgentCreationDocument() map[string]any {
	return map[string]any{"nodes": []any{}, "connections": []any{}}
}

func (a cloudAgentCreationMediaArgs) mediaArgs(runID string) cloudAgentMediaArgs {
	return cloudAgentMediaArgs{
		Mode: a.Mode, Prompt: a.Prompt, Title: a.Title,
		LogicalModelID: a.LogicalModelID, ChannelID: a.ChannelID, ChannelModelKey: a.ChannelModelKey,
		Duration: a.Duration, Size: a.Size, ImageResolution: a.ImageResolution, ImageParameters: a.ImageParameters, Quality: a.Quality,
		VideoGenerateAudio: a.VideoGenerateAudio, VideoWatermark: a.VideoWatermark, VideoArkPrivateAssetUpload: a.VideoArkPrivateAssetUpload,
		DraftRunID: runID, ReferenceNodeIDs: []string{},
	}
}

// applyResolved 把准入解析出的模型与规格写回首页参数。
func (a *cloudAgentCreationMediaArgs) applyResolved(m cloudAgentMediaArgs) {
	a.Prompt = m.Prompt
	a.LogicalModelID, a.ChannelID, a.ChannelModelKey = m.LogicalModelID, m.ChannelID, m.ChannelModelKey
	a.Duration, a.Size, a.ImageResolution, a.ImageParameters, a.Quality = m.Duration, m.Size, m.ImageResolution, m.ImageParameters, m.Quality
	a.VideoGenerateAudio, a.VideoWatermark, a.VideoArkPrivateAssetUpload = m.VideoGenerateAudio, m.VideoWatermark, m.VideoArkPrivateAssetUpload
}

func validateCloudAgentCreationMediaShape(a *cloudAgentCreationMediaArgs) error {
	a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
	if !cloudAgentGenerationModeSupported(a.Mode) {
		return cloudAgentFieldError("mode", "invalid_value", "生成模式当前不受 Agent 支持；请使用工具 schema 中列出的模式")
	}
	if strings.TrimSpace(a.Prompt) == "" {
		return cloudAgentFieldError("prompt", "required", "生成提示词不能为空，请补充完整提示词")
	}
	if !utf8.ValidString(a.Prompt) || strings.ContainsRune(a.Prompt, 0) {
		return cloudAgentFieldError("prompt", "invalid_value", "提示词包含无效字符")
	}
	if count := utf8.RuneCountInString(a.Prompt); count > 16000 {
		return cloudAgentFieldError("prompt", "length_exceeded", fmt.Sprintf("提示词共%d字符，超过16000字符上限；请先告知用户，不要擅自删改关键内容", count))
	}
	a.Title = strings.TrimSpace(a.Title)
	if utf8.RuneCountInString(a.Title) > 240 {
		return cloudAgentFieldError("title", "invalid_value", "方案名称不能超过 240 个字符")
	}
	if a.Duration < 0 {
		return cloudAgentFieldError("durationSeconds", "invalid_value", "生成时长不能为负数，请传入非负整数")
	}
	if a.Mode != "video" {
		if a.Duration != 0 {
			return cloudAgentFieldError("durationSeconds", "invalid_value", "只有视频生成允许设置 durationSeconds；图片或音频生成请省略该字段")
		}
		if a.VideoGenerateAudio != nil || a.VideoWatermark != nil || a.VideoArkPrivateAssetUpload != nil {
			return cloudAgentFieldError("videoGenerateAudio", "invalid_value", "视频参数仅适用于视频生成；图片或音频生成请省略该字段")
		}
	}
	if len(a.References) > creationReferenceLimit {
		return cloudAgentFieldError("references", "item_count", fmt.Sprintf("参考素材最多 %d 个，请减少引用数量", creationReferenceLimit))
	}
	seen := map[string]bool{}
	for index, ref := range a.References {
		field := fmt.Sprintf("references[%d]", index)
		ref.EntryID, ref.ResourceID = strings.TrimSpace(ref.EntryID), strings.TrimSpace(ref.ResourceID)
		a.References[index] = ref
		key := ""
		switch {
		case ref.EntryID != "" && ref.ResourceID == "":
			if validateCloudAgentID(ref.EntryID, "生成记录 ID", creationIDLimit) != nil || ref.Slot == nil || *ref.Slot < 0 || *ref.Slot >= creationEntryTaskLimit {
				return cloudAgentFieldError(field, "invalid_value", "引用生成结果需要真实 entryId 和 slot；请使用 creation_read_entries 返回的值")
			}
			key = "entry:" + ref.EntryID + ":" + strconv.Itoa(*ref.Slot)
		case ref.ResourceID != "" && ref.EntryID == "" && ref.Slot == nil:
			if validateCloudAgentID(ref.ResourceID, "资源 ID", 64) != nil {
				return cloudAgentFieldError(field, "invalid_value", "资源 ID 无效")
			}
			key = "resource:" + ref.ResourceID
		default:
			return cloudAgentFieldError(field, "invalid_value", "每个参考只能是 {entryId, slot} 或 {resourceId} 之一")
		}
		if seen[key] {
			return cloudAgentFieldError(field, "duplicate", "参考素材不能重复")
		}
		seen[key] = true
	}
	return nil
}

// cloudAgentCreationReferences 只接受本会话的生成结果和本人的资源，返回任务输入用的参考与生成记录保存的定位符。
func cloudAgentCreationReferences(repo *repository.Repository, userID, sessionID string, args []cloudAgentCreationReferenceArg) (map[string]any, []CreationReference, error) {
	refs := map[string]any{}
	stored := make([]CreationReference, 0, len(args))
	for index, arg := range args {
		field := fmt.Sprintf("references[%d]", index)
		reference := CreationReference{Kind: "resource"}
		resourceID, label := arg.ResourceID, ""
		if arg.EntryID != "" {
			entry, err := repo.CreationEntry(userID, arg.EntryID)
			if err != nil || entry.SessionID != sessionID {
				return nil, nil, cloudAgentFieldError(field, "invalid_value", "参考的生成记录不存在或不属于本会话；请使用 creation_read_entries 返回的 entryId")
			}
			resourceID = ""
			for _, result := range decodeCreationResults(entry.ResultsJSON) {
				if result.Slot == *arg.Slot && len(result.Resources) > 0 {
					resourceID = result.Resources[0].ResourceID
				}
			}
			if resourceID == "" {
				return nil, nil, cloudAgentFieldError(field, "invalid_value", "该生成结果还没有可用作品，不能作为参考")
			}
			slot := *arg.Slot
			reference = CreationReference{Kind: "entry_result", EntryID: entry.ID, Slot: &slot}
			label = truncateRunes(strings.Join(strings.Fields(entry.Prompt), " "), 24)
		}
		resource, err := repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return nil, nil, cloudAgentFieldError(field, "invalid_value", "参考素材不存在或无权使用")
		}
		if resource.Status != model.ResourceStatusReady {
			return nil, nil, cloudAgentFieldError(field, "invalid_value", "参考素材尚未就绪")
		}
		major, _, _ := strings.Cut(strings.ToLower(resource.MimeType), "/")
		adapter, supported := cloudAgentReferenceAdapters[major]
		if !supported {
			return nil, nil, cloudAgentFieldError(field, "invalid_value", "该素材类型不能作为生成参考")
		}
		if label == "" {
			label = cloudAgentCreationModeLabels[major] + "参考"
		}
		item := map[string]any{
			"id": resourceID, "name": label, "storageKey": "resource:" + resourceID, "type": resource.MimeType, "mimeType": resource.MimeType,
			"bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs, "inputKind": major,
		}
		list, _ := refs[adapter.PayloadField].([]any)
		refs[adapter.PayloadField] = append(list, item)
		reference.ResourceID, reference.StorageKey, reference.Label = resourceID, "resource:"+resourceID, truncateCreationText(label, 80)
		stored = append(stored, reference)
	}
	return refs, stored, nil
}

// prepareCreationAgentMedia 解析参数、参考素材和模型默认，返回待准入的任务请求。不创建任务、不收费。
func (s *Service) prepareCreationAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (*cloudAgentCreationMediaPlan, error) {
	if run == nil || state == nil || state.Request.CreationSessionID == "" {
		return nil, BadAuthRequest("首页生成只能在创作会话中使用")
	}
	var a cloudAgentCreationMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &a); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentCreationMediaShape(&a); err != nil {
		return nil, err
	}
	if a.Title == "" {
		a.Title = cloudAgentCreationModeLabels[a.Mode] + "创作"
	}
	media := a.mediaArgs(run.ID)
	if cloudAgentModelSelectionProvided(call.Function.Arguments) {
		if err := validateCloudAgentModelSelection(call.Function.Arguments, media); err != nil {
			return nil, err
		}
	}
	var prepared *cloudAgentPreparedMedia
	if state.Approval != nil && state.Approval.Prepared != nil && state.Approval.CallHash == cloudAgentApprovalCallHash(call) {
		prepared = state.Approval.Prepared
	}
	refs, references, err := cloudAgentCreationReferences(s.repo, run.UserID, state.Request.CreationSessionID, a.References)
	if err != nil {
		return nil, err
	}
	if prepared == nil && state.Approval == nil {
		if err := s.resolveCloudAgentMediaConfiguration(&media, state, call.Function.Arguments, cloudAgentCreationDocument(), refs); err != nil {
			return nil, err
		}
	}
	if err := validateCloudAgentModelSelection(mustCloudAgentJSON(media), media); err != nil {
		return nil, err
	}
	if err := validateCloudAgentMediaBudget(media, state); err != nil {
		return nil, err
	}
	if prepared != nil {
		media.Prompt = stringValue(prepared.Input["prompt"])
	} else if media.Prompt, err = cloudAgentMediaReferencePrompt(media.Prompt, refs); err != nil {
		return nil, err
	}
	spec, err := cloudAgentGenerationSpec(media, refs, nil)
	if err != nil {
		return nil, err
	}
	config := spec.Options.TaskConfig()
	if media.ChannelID != "" {
		config["channelId"], config["channelModelKey"], config["model"] = media.ChannelID, media.ChannelModelKey, media.ChannelModelKey
	}
	if media.Mode == "video" && media.VideoArkPrivateAssetUpload != nil {
		config["videoArkPrivateAssetUpload"] = strconv.FormatBool(*media.VideoArkPrivateAssetUpload)
	}
	if err := validateCloudAgentMediaReferences(media.Mode, refs); err != nil {
		return nil, err
	}
	operation := cloudAgentMediaOperation(media.Mode, refs)
	if operation == "" {
		return nil, BadAuthRequest("生成模式尚未实现媒体任务适配器")
	}
	metadata := map[string]any{"source": "cloud_agent", "creationSessionId": state.Request.CreationSessionID}
	if media.Mode == "video" {
		metadata["videoEditOperation"] = operation
	}
	input := refs
	input["mode"], input["prompt"], input["config"], input["metadata"] = media.Mode, media.Prompt, config, metadata
	a.applyResolved(media)
	return &cloudAgentCreationMediaPlan{
		Request:    CreateTaskRequest{Type: "canvas_" + media.Mode, Operation: operation, Prompt: media.Prompt, LogicalModelID: media.LogicalModelID, Model: media.ChannelModelKey, Input: input},
		Media:      &cloudAgentMediaPlan{Args: media, CallID: call.ID, Prepared: prepared},
		Args:       a,
		References: references,
	}, nil
}

func mustCloudAgentJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

// admitCreationAgentMedia 做一次不收费的准入，解析模型默认并把结果写回方案参数。
func (s *Service) admitCreationAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, plan *cloudAgentCreationMediaPlan, callerHoldsStorageMu bool) (*model.Task, *creationTaskPreparation, error) {
	preparation := &creationTaskPreparation{}
	req := plan.Request
	req.creationPrepare = preparation
	req.callerHoldsStorageMu = callerHoldsStorageMu
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		return nil, nil, err
	}
	if err := applyCloudAgentResolvedMediaDefaults(&req, plan.Media, task); err != nil {
		return nil, nil, err
	}
	if err := validateCloudAgentMediaBudget(plan.Media.Args, state); err != nil {
		return nil, nil, err
	}
	req.creationPrepare, req.callerHoldsStorageMu = nil, false
	plan.Request = req
	plan.Args.applyResolved(plan.Media.Args)
	return task, preparation, nil
}

func cloudAgentCreationMediaApprovalPreview(plan *cloudAgentCreationMediaPlan, modelName string) cloudAgentApprovalPreview {
	args := plan.Args
	label := cloudAgentCreationModeLabels[args.Mode]
	title := truncateRunes(args.Title, 120)
	details := make([]string, 0, 6)
	if modelName != "" {
		details = append(details, "模型："+truncateRunes(modelName, 120))
	}
	if len(plan.References) > 0 {
		details = append(details, fmt.Sprintf("引用 %d 个素材", len(plan.References)))
	} else {
		details = append(details, "不引用素材")
	}
	if args.Duration > 0 {
		details = append(details, fmt.Sprintf("时长：%d 秒", args.Duration))
	}
	if args.Size != "" {
		details = append(details, "画幅："+truncateRunes(args.Size, 40))
	}
	if args.Quality != "" {
		details = append(details, "质量："+truncateRunes(args.Quality, 40))
	}
	if args.ImageResolution != "" {
		details = append(details, "分辨率："+truncateRunes(args.ImageResolution, 40))
	}
	if args.VideoGenerateAudio != nil {
		details = append(details, map[bool]string{true: "音频：开启", false: "音频：关闭"}[*args.VideoGenerateAudio])
	}
	return cloudAgentApprovalPreview{
		Kind: "creation_generation", Title: "确认生成" + label,
		Description: "Agent 提出了一个生成方案，尚未提交。批准后才会提交收费任务，并在本会话新增一条生成记录；拒绝不产生扣费。",
		Items: []cloudAgentApprovalPreviewItem{{
			Operation: cloudAgentCreationMediaToolName, NodeTitle: title, NodeTypeLabel: label, Details: details,
			Summary: "生成" + label + "《" + title + "》",
		}},
	}
}

// requestCreationAgentMediaApproval 准入并报价后进入审批；不创建任务、不写生成记录。
func (s *Service) requestCreationAgentMediaApproval(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	plan, err := s.prepareCreationAgentMedia(run, state, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	task, preparation, err := s.admitCreationAgentMedia(run, state, plan, false)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	modelName, err := s.cloudAgentMediaModelName(plan.Media.Args)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	raw, err := json.Marshal(plan.Args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		prepared, err := prepareCloudAgentMediaApproval(repo, run.UserID, cloudAgentCreationDocument(), plan.Media, plan.Request, task, preparation.Order)
		if err != nil {
			return err
		}
		state.Calls[state.CallIndex] = call
		preview := cloudAgentCreationMediaApprovalPreview(plan, modelName)
		approvalID := fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex)
		state.Approval = &cloudAgentApproval{ID: approvalID, Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, ModelName: modelName, Prepared: prepared}
		if err := pinCloudAgentPreparedMedia(repo, run.UserID, run.ID, approvalID, prepared); err != nil {
			return err
		}
		state.recordCreationProposal(cloudAgentCreationProposal{
			ApprovalID: approvalID, RunID: run.ID, Mode: plan.Args.Mode, Title: plan.Args.Title,
			Prompt: truncateRunes(strings.Join(strings.Fields(plan.Args.Prompt), " "), creationAgentProposalPromptRunes), Decision: "pending",
		})
		state.PiResumePrompt = ""
		current.Status = "waiting_approval"
		state.event(run.ID, "approval_requested", map[string]any{
			"approvalId": approvalID, "toolName": call.Function.Name, "modelName": modelName, "arguments": json.RawMessage(call.Function.Arguments),
			"preview": preview, "prepared": prepared.publicView(), "creationSessionId": state.Request.CreationSessionID,
			"references": plan.References, "text": preview.Description,
		})
		return cloudAgentSave(current, state)
	})
}

// updateCreationAgentMediaApproval 是审批时修改模型或规格的首页版本，语义同 updateCloudAgentMediaApproval。
func (s *Service) updateCreationAgentMediaApproval(repo *repository.Repository, run *model.CloudAgentExecution, state *cloudAgentRuntime, settings CloudAgentMediaSettings) error {
	call := state.Approval.Call
	var args cloudAgentCreationMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return err
	}
	if args.Mode != "image" && args.Mode != "video" {
		return BadAuthRequest("仅图片或视频生成审批支持修改模型和规格")
	}
	if args.Mode == "image" && (settings.DurationSeconds != nil || settings.VideoGenerateAudio != nil || settings.VideoWatermark != nil || settings.VideoArkPrivateAssetUpload != nil) {
		return BadAuthRequest("视频参数仅适用于视频生成审批")
	}
	args.LogicalModelID, args.ChannelID, args.ChannelModelKey = settings.LogicalModelID, settings.ChannelID, settings.ChannelModelKey
	args.Size, args.ImageResolution, args.Quality, args.ImageParameters = settings.Size, settings.ImageResolution, settings.Quality, settings.ImageParameters
	if args.Mode == "video" {
		if settings.DurationSeconds != nil {
			if *settings.DurationSeconds < 0 {
				return BadAuthRequest("视频时长不能为负数")
			}
			args.Duration = *settings.DurationSeconds
		}
		args.VideoGenerateAudio, args.VideoWatermark, args.VideoArkPrivateAssetUpload = settings.VideoGenerateAudio, settings.VideoWatermark, settings.VideoArkPrivateAssetUpload
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	plan, err := s.prepareCreationAgentMedia(run, state, call)
	if err != nil {
		return err
	}
	// DecideCloudAgentApproval 已持有 storageMu。
	task, preparation, err := s.admitCreationAgentMedia(run, state, plan, true)
	if err != nil {
		return err
	}
	var resolved map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
		return err
	}
	requested, _ := plan.Request.Input["config"].(map[string]any)
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
		return err
	}
	name, err := s.cloudAgentMediaModelName(plan.Media.Args)
	if err != nil {
		return err
	}
	if raw, err = json.Marshal(plan.Args); err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	prepared, err := prepareCloudAgentMediaApproval(repo, run.UserID, cloudAgentCreationDocument(), plan.Media, plan.Request, task, preparation.Order)
	if err != nil {
		return err
	}
	if previous := state.Approval.Prepared; previous != nil && previous.GenerationID != "" {
		prepared.GenerationID = previous.GenerationID
		prepared.Hash = creationHash(prepared)
	}
	if err := replaceCloudAgentPreparedLeases(repo, run.UserID, run.ID, state.Approval.ID, prepared); err != nil {
		return err
	}
	state.Calls[state.CallIndex] = call
	state.Approval.Call = call
	state.Approval.CallHash = cloudAgentApprovalCallHash(call)
	state.Approval.ModelName = name
	state.Approval.Preview = cloudAgentCreationMediaApprovalPreview(plan, name)
	state.Approval.Prepared = prepared
	return nil
}

func creationAgentEntryID(userID, approvalID string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("creation-agent-entry:"+userID+":"+approvalID)).String()
}

func cloudAgentCreationEntryConfig(args cloudAgentCreationMediaArgs, modelName string) string {
	config := map[string]any{"title": args.Title}
	for key, value := range map[string]string{
		"logicalModelId": args.LogicalModelID, "channelId": args.ChannelID, "channelModelKey": args.ChannelModelKey, "modelName": modelName,
		"size": args.Size, "imageResolution": args.ImageResolution, "quality": args.Quality,
	} {
		if value != "" {
			config[key] = value
		}
	}
	if args.Duration > 0 {
		config["durationSeconds"] = args.Duration
	}
	if args.VideoGenerateAudio != nil {
		config["videoGenerateAudio"] = *args.VideoGenerateAudio
	}
	return mustCloudAgentJSON(config)
}

// advanceCreationAgentMedia 在方案批准后提交任务，或在任务结束后把生成记录交给模型。
func (s *Service) advanceCreationAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if state.MediaTaskID != "" {
		return s.completeCreationAgentMedia(run, state, call)
	}
	return s.enqueueCreationAgentMedia(run, state, call)
}

func (s *Service) enqueueCreationAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if state.Approval == nil || state.Approval.Decision != "approve" || state.Approval.Prepared == nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, creationConflict("缺少已批准的生成准备态，请重新申请审批；未提交任务"))
	}
	plan, err := s.prepareCreationAgentMedia(run, state, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(state.Request.Budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if remaining < 0 {
		return s.failCloudAgent(run, state, "Agent 累计预算已耗尽")
	}
	prepared, approvalID, modelName := state.Approval.Prepared, state.Approval.ID, state.Approval.ModelName
	refs, err := cloudAgentPreparedReferences(s.repo, run.UserID, prepared)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	req := plan.Request
	for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		delete(req.Input, field)
	}
	for field, value := range refs {
		req.Input[field] = value
	}
	prepare := &creationTaskPreparation{}
	req.admission = &taskAdmission{ID: cloudAgentID(run.UserID, fmt.Sprintf("%s:task:%d", run.ID, len(state.TaskIDs))), MaxCharge: remaining, AgentRunID: run.ID, GenerationID: prepared.GenerationID, ApprovalID: approvalID}
	req.creationPrepare = prepare
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	requested, _ := req.Input["config"].(map[string]any)
	if err := validateCloudAgentResolvedMediaOptions(requested, input); err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	task.InputJSON = string(raw)
	if prepare.Order != nil {
		task.BillingOrderID = prepare.Order.ID
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	proposalID := approvalID
	entry := &model.CreationEntry{
		ID: creationAgentEntryID(run.UserID, approvalID), SessionID: state.Request.CreationSessionID, UserID: run.UserID,
		Origin: model.CreationEntryOriginAgent, ProposalID: &proposalID, ClientOperationID: "agent:" + approvalID,
		Type: plan.Args.Mode, Prompt: truncateCreationText(plan.Args.Prompt, creationPromptLimit),
		ConfigJSON: cloudAgentCreationEntryConfig(plan.Args, modelName), ReferencesJSON: mustCloudAgentJSON(plan.References),
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if err := validateCloudAgentPreparedAdmission(repo, run.UserID, prepared, task, prepare.Order, cloudAgentCreationDocument(), plan.Media.Args); err != nil {
			return err
		}
		if err := createTaskWithStorageQuotaRepository(repo, task, prepare.Order, policy); err != nil {
			return err
		}
		// 任务与生成记录同一事务落库：任何一方失败都整体回滚，不会出现无记录的收费任务。
		results := []CreationResultSlot{creationTaskSlot(0, task)}
		entry.ResultsJSON, entry.Status = encodeCreationResults(results), deriveCreationEntryStatus(results)
		if prepare.Order != nil {
			entry.CreditsMicrocredits = creationOrderCharge(*prepare.Order)
		}
		stored, _, err := repo.CreateCreationEntry(entry, []string{task.ID})
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return creationSessionNotFound()
		}
		if err != nil {
			return err
		}
		if err := repo.TransferCloudAgentResourceLeases(run.UserID, approvalID, "task:"+task.ID, task.ID, prepared.Quote.ExpiresAt); err != nil {
			return err
		}
		state.TaskIDs = append(state.TaskIDs, task.ID)
		state.MediaTaskID, state.CreationEntryID = task.ID, stored.ID
		state.Generations++
		state.VideoSeconds += plan.Media.Args.Duration
		state.decideCreationProposal(approvalID, "approve", stored.ID)
		state.event(run.ID, "generation_task_created", map[string]any{
			"toolName": call.Function.Name, "taskId": task.ID, "entryId": stored.ID, "creationSessionId": state.Request.CreationSessionID,
			"mode": plan.Args.Mode, "title": plan.Args.Title, "text": "方案已批准，生成记录已创建，任务已提交",
		})
		return cloudAgentSave(current, state)
	})
	if err != nil {
		latest, readErr := s.repo.CloudAgent(run.UserID, run.ID)
		if readErr != nil || latest.Revision != run.Revision {
			return err
		}
		fresh, decodeErr := cloudAgentDecode(latest)
		if decodeErr != nil {
			return decodeErr
		}
		return s.cloudAgentMediaError(latest, &fresh, "admission", false, false, err)
	}
	return nil
}

type cloudAgentCreationResultFact struct {
	Slot       int    `json:"slot"`
	Status     string `json:"status"`
	ResourceID string `json:"resourceId,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Text       string `json:"text,omitempty"`
	Failure    string `json:"failure,omitempty"`
}

type cloudAgentCreationEntryFact struct {
	EntryID    string                         `json:"entryId"`
	Origin     string                         `json:"origin"`
	Type       string                         `json:"type"`
	Status     string                         `json:"status"`
	Prompt     string                         `json:"prompt"`
	ProposalID string                         `json:"proposalId,omitempty"`
	CreatedAt  time.Time                      `json:"createdAt"`
	Results    []cloudAgentCreationResultFact `json:"results"`
}

func cloudAgentCreationResultFacts(results []CreationResultSlot) []cloudAgentCreationResultFact {
	facts := make([]cloudAgentCreationResultFact, 0, len(results))
	for _, result := range results {
		fact := cloudAgentCreationResultFact{Slot: result.Slot, Status: result.Status, Text: truncateRunes(result.Text, 200), Failure: truncateRunes(result.Failure, 120)}
		if len(result.Resources) > 0 {
			resource := result.Resources[0]
			fact.ResourceID, fact.MimeType, fact.Width, fact.Height, fact.DurationMs = resource.ResourceID, resource.MimeType, resource.Width, resource.Height, resource.DurationMs
		}
		facts = append(facts, fact)
	}
	return facts
}

func cloudAgentCreationEntryFacts(entries []model.CreationEntry) []cloudAgentCreationEntryFact {
	facts := make([]cloudAgentCreationEntryFact, 0, len(entries))
	for _, entry := range entries {
		if entry.HiddenFailed {
			continue
		}
		fact := cloudAgentCreationEntryFact{
			EntryID: entry.ID, Origin: entry.Origin, Type: entry.Type, Status: entry.Status, CreatedAt: entry.CreatedAt,
			Prompt:  truncateRunes(strings.Join(strings.Fields(entry.Prompt), " "), 80),
			Results: cloudAgentCreationResultFacts(decodeCreationResults(entry.ResultsJSON)),
		}
		if entry.ProposalID != nil {
			fact.ProposalID = *entry.ProposalID
		}
		facts = append(facts, fact)
	}
	return facts
}

func (s *Service) completeCreationAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	task, err := s.repo.TaskForUser(run.UserID, state.MediaTaskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.cloudAgentMediaError(run, state, "completion", true, true, BadAuthRequest("媒体任务不存在或已失去归属"))
	}
	if err != nil {
		return err
	}
	if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
		return nil
	}
	// 任务协调器在终态时已回写生成记录；这里再校准一次，模型看到的结果以记录为准。
	entryID := state.CreationEntryID
	var entry *model.CreationEntry
	if entryID != "" {
		entry, err = s.reconcileCreationEntry(run.UserID, entryID)
		var appErr *AppError
		if err != nil && !(errors.As(err, &appErr) && appErr.Status == 404) {
			return err
		}
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		result := map[string]any{"phase": "completion", "taskSubmitted": true, "taskId": task.ID, "entryId": entryID, "status": task.Status}
		var toolErr error
		entryStatus := ""
		if entry != nil {
			entryStatus = entry.Status
			result["entryStatus"] = entry.Status
			result["results"] = cloudAgentCreationResultFacts(decodeCreationResults(entry.ResultsJSON))
		}
		switch {
		case task.Status != model.TaskStatusSucceeded:
			message := truncateRunes(cloudAgentSafeMediaTaskError(task), 90)
			if !cloudAgentSafeUserMessage(message) {
				message = "媒体任务未成功"
			}
			result["generationError"] = message
			result["summary"] = "媒体任务未成功；失败记录保留在本会话"
			toolErr = BadAuthRequest("媒体任务未成功：" + message + "；不会自动重试收费生成，需用户重新授权")
		case entry == nil:
			result["summary"] = "生成已完成，但生成记录已被删除"
			toolErr = BadAuthRequest("生成已完成，但对应的生成记录已被用户删除")
		default:
			result["summary"] = "生成结果已写入本会话的生成记录"
		}
		cloudAgentToolResult(run.ID, state, call, result, toolErr)
		state.MediaTaskID, state.CreationEntryID = "", ""
		state.event(run.ID, "creation_entry_updated", map[string]any{
			"entryId": entryID, "taskId": task.ID, "status": entryStatus, "creationSessionId": state.Request.CreationSessionID,
			"text": result["summary"],
		})
		return cloudAgentSave(current, state)
	})
}

func (state *cloudAgentRuntime) recordCreationProposal(proposal cloudAgentCreationProposal) {
	for index := range state.CreationProposals {
		if state.CreationProposals[index].ApprovalID == proposal.ApprovalID {
			state.CreationProposals[index] = proposal
			return
		}
	}
	state.CreationProposals = append(state.CreationProposals, proposal)
	if overflow := len(state.CreationProposals) - creationAgentProposalLimit; overflow > 0 {
		state.CreationProposals = append([]cloudAgentCreationProposal(nil), state.CreationProposals[overflow:]...)
	}
}

func (state *cloudAgentRuntime) decideCreationProposal(approvalID, decision, entryID string) {
	for index := range state.CreationProposals {
		if state.CreationProposals[index].ApprovalID == approvalID {
			state.CreationProposals[index].Decision = decision
			if entryID != "" {
				state.CreationProposals[index].EntryID = entryID
			}
			return
		}
	}
}

// cloudAgentInheritedCreationProposals 继承上一轮的方案记录；上一轮结束时仍未决定的方案视为过期。
func cloudAgentInheritedCreationProposals(parent []cloudAgentCreationProposal) []cloudAgentCreationProposal {
	if len(parent) == 0 {
		return nil
	}
	start := max(0, len(parent)-creationAgentProposalLimit)
	inherited := make([]cloudAgentCreationProposal, 0, len(parent)-start)
	for _, proposal := range parent[start:] {
		if proposal.Decision == "pending" {
			proposal.Decision = "expired"
		}
		inherited = append(inherited, proposal)
	}
	return inherited
}

// cloudAgentCreationShouldContinue 是首页会话的自动继续规则（设计 §8.3）：用户关闭自动继续时不续跑；
// 生成失败续跑一轮说明原因（不会自动重提收费生成）；生成成功只在计划还有未开始的步骤时续跑，
// 否则本轮在生成完成处结束，不再额外花一次模型调用。
func cloudAgentCreationShouldContinue(state *cloudAgentRuntime, task *model.Task) bool {
	if state == nil || state.Request.CreationSessionID == "" {
		return true
	}
	if state.Request.AutoContinue != nil && !*state.Request.AutoContinue {
		return false
	}
	if task == nil || task.Status != model.TaskStatusSucceeded {
		return true
	}
	for _, item := range state.Plan {
		if item.Status == "pending" {
			return true
		}
	}
	return false
}

// finishCreationAgentRun 在不续跑时把本轮收尾为完成，并释放会话占用。
func (s *Service) finishCreationAgentRun(userID, runID string, task *model.Task) error {
	sessionID := ""
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return err
		}
		sessionID = state.Request.CreationSessionID
		if cloudAgentRunTerminal(run.Status) || run.Status == "waiting_approval" || run.Status == "waiting_user" {
			break
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, txRepo *repository.Repository) error {
			if err := cloudAgentCommitLessonDrafts(txRepo, userID, runID, &state); err != nil {
				return err
			}
			text := "生成已完成，结果已加入本会话"
			if task == nil || task.Status != model.TaskStatusSucceeded {
				text = "生成未成功，失败记录已保留在本会话"
			}
			current.Status = "completed"
			state.event(runID, "run_completed", map[string]any{"text": text, "reason": "creation_generation_settled", "timestamp": time.Now().Unix()})
			return cloudAgentSave(current, &state)
		})
		if errors.Is(err, repository.ErrCreationConflict) {
			time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
			continue
		}
		if err != nil {
			return err
		}
		break
	}
	if sessionID != "" {
		return s.repo.ReleaseCreationSessionRun(userID, sessionID, runID)
	}
	return nil
}

// claimCreationSessionRun 占用会话的活动轮次。占用者已结束（或从未落库）时先释放再占用，
// 因此运行结束的各个出口不需要逐一释放。
func (s *Service) claimCreationSessionRun(userID, sessionID, runID string) error {
	for attempt := 0; attempt < 2; attempt++ {
		err := s.repo.ClaimCreationSessionRun(userID, sessionID, runID)
		if err == nil {
			return nil
		}
		if !errors.Is(err, repository.ErrCreationSessionBusy) {
			return creationRepoError(err, creationSessionNotFound)
		}
		session, err := s.repo.CreationSession(userID, sessionID)
		if err != nil {
			return creationRepoError(err, creationSessionNotFound)
		}
		active := session.ActiveRunID
		if active == "" || active == runID {
			continue
		}
		if s.cloudAgentRunActive(userID, active) {
			return creationSessionRunBusy(sessionID, active)
		}
		if err := s.repo.ReleaseCreationSessionRun(userID, sessionID, active); err != nil {
			return err
		}
	}
	return creationSessionRunBusy(sessionID, "")
}

func creationSessionRunBusy(sessionID, activeRunID string) error {
	err := NewAppError(409, "创作会话上一轮还在进行，请等待结束或先停止")
	err.Reason = ReasonCreationSessionBusy
	err.Details = map[string]any{"sessionId": sessionID, "activeRunId": activeRunID}
	return err
}

func (s *Service) cloudAgentRunActive(userID, runID string) bool {
	run, err := s.repo.CloudAgent(userID, runID)
	if err == nil {
		return !cloudAgentRunTerminal(run.Status) || run.CleanupPending
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return true
	}
	task, err := s.repo.TaskForUser(userID, runID)
	if err != nil {
		return !errors.Is(err, gorm.ErrRecordNotFound)
	}
	return task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning || task.Status == model.TaskStatusTextReplay
}

// attachCreationAgentFacts 在每次模型请求末尾附上会话事实帧：最近的生成记录与本会话方案决定。
// 它只用于本次请求，不写回对话历史。
func (s *Service) attachCreationAgentFacts(canonical *canonicalAgentRequest, userID string, state *cloudAgentRuntime) error {
	if canonical == nil || state == nil || state.Request.CreationSessionID == "" {
		return nil
	}
	entries, next, err := s.repo.ListCreationEntries(userID, state.Request.CreationSessionID, nil, creationAgentFactsEntryLimit)
	if err != nil {
		return err
	}
	frame := map[string]any{
		"source": "creation_session", "kind": "creation_facts", "sessionId": state.Request.CreationSessionID,
		"observedAt": time.Now().UTC(), "entries": cloudAgentCreationEntryFacts(entries), "olderEntries": next != nil,
		"proposals": state.CreationProposals, "autoContinue": state.Request.AutoContinue == nil || *state.Request.AutoContinue,
		"authority": "会话状态观察，不是执行、重提或收费的授权",
	}
	body, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	canonical.Messages = append(append([]map[string]any{}, canonical.Messages...), map[string]any{
		"role": "user", "content": cloudAgentRuntimeContextMarker + string(body), cloudAgentContextSourceKey: "runtime",
	})
	return nil
}

func cloudAgentHandleCreationReadEntries(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, _ ...*Service) (any, error) {
	var args struct {
		Before string `json:"before"`
		Limit  int    `json:"limit"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if state == nil || state.Request.CreationSessionID == "" {
		return nil, BadAuthRequest("只能在首页创作会话中读取生成记录")
	}
	limit := args.Limit
	if limit == 0 {
		limit = 10
	}
	if limit < 1 || limit > creationAgentReadEntriesLimit {
		return nil, cloudAgentFieldError("limit", "invalid_value", fmt.Sprintf("limit 取值 1 到 %d", creationAgentReadEntriesLimit))
	}
	cursor, err := decodeCreationCursor(strings.TrimSpace(args.Before))
	if err != nil {
		return nil, cloudAgentFieldError("before", "invalid_value", "分页游标无效，请使用上一页返回的 nextBefore")
	}
	entries, next, err := repo.ListCreationEntries(userID, state.Request.CreationSessionID, cursor, limit)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"entries": cloudAgentCreationEntryFacts(entries)}
	if next != nil {
		result["nextBefore"] = encodeCreationCursor(next)
	}
	return result, nil
}
