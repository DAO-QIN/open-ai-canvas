package app

// 创作页逐项方案卡：把待确认的批次或单项媒体整理成每项一张卡（提示词、参数、单项报价），
// 并处理确认前的两种调整：改写提示词与参数（重新准入、重新报价、轮换审批 ID），
// 以及确认时移出部分项（不重新报价，其余项沿用已冻结的准备态）。
// 卡片只是展示与编辑入口；执行仍以服务端准备态、批准哈希和预算校验为准。

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	cloudAgentProposalPromptMaxRunes = 8000
	cloudAgentProposalSpecMaxRunes   = 40
	cloudAgentProposalMaxEdits       = 20
)

// CloudAgentApprovalItemEdit 是方案卡上的一次改写；省略的字段保持原值，空字符串表示交给模型默认。
type CloudAgentApprovalItemEdit struct {
	ItemID          string  `json:"itemId"`
	Prompt          *string `json:"prompt,omitempty"`
	Size            *string `json:"size,omitempty"`
	Quality         *string `json:"quality,omitempty"`
	DurationSeconds *int    `json:"durationSeconds,omitempty"`
}

func cloudAgentProposalCredits(microcredits int64) float64 {
	return math.Round(float64(microcredits)/float64(CreditScale)*10000) / 10000
}

// cloudAgentProposalModelNames 把批次里的模型选择翻译成展示名；同一选择只查一次目录，查不到时回退到任务模型键。
func (s *Service) cloudAgentProposalModelNames(items []cloudAgentCommerceBatchItem) map[string]string {
	names := map[string]string{}
	cache := map[string]string{}
	for _, item := range items {
		key := strings.Join([]string{item.Args.Mode, item.Args.LogicalModelID, item.Args.ChannelID, item.Args.ChannelModelKey}, "\x00")
		name, ok := cache[key]
		if !ok {
			if resolved, err := s.cloudAgentMediaModelName(item.Args); err == nil {
				name = resolved
			}
			cache[key] = name
		}
		if name == "" {
			name = item.Request.Model
		}
		names[item.ItemID] = name
	}
	return names
}

func cloudAgentProposalQuality(args cloudAgentMediaArgs) string {
	if strings.TrimSpace(args.Quality) != "" {
		return args.Quality
	}
	return args.ImageResolution
}

// cloudAgentDecorateBatchPreview 给批次审批补上逐项方案卡；editable/skippable 只对普通多图批次开放。
// rawPrompts 是模型写下的原始提示词：执行用的提示词已拼上参考素材说明，直接给用户改会在重新准入时重复拼接。
func (s *Service) cloudAgentDecorateBatchPreview(preview *cloudAgentApprovalPreview, batch *cloudAgentCommerceBatch, rawPrompts map[string]string, editable bool) {
	if preview == nil || batch == nil {
		return
	}
	names := s.cloudAgentProposalModelNames(batch.Items)
	proposals := make([]cloudAgentApprovalProposal, 0, len(batch.Items))
	for _, item := range batch.Items {
		credits := 0.0
		if item.Prepared != nil {
			credits = cloudAgentProposalCredits(item.Prepared.Quote.AmountMicrocredits)
		}
		title := strings.TrimSpace(item.Args.Title)
		if title == "" {
			title = "生成项 " + item.ItemID
		}
		prompt := strings.TrimSpace(rawPrompts[item.ItemID])
		if prompt == "" {
			prompt = item.Args.Prompt
		}
		proposals = append(proposals, cloudAgentApprovalProposal{
			ItemID: item.ItemID, Title: truncateRunes(title, 120), Mode: item.Args.Mode, Prompt: prompt,
			Size: item.Args.Size, Quality: cloudAgentProposalQuality(item.Args), DurationSeconds: item.Args.Duration,
			Model: names[item.ItemID], Credits: credits, ReferenceCount: len(item.Args.AttachmentResourceIDs), TaskID: item.TaskID,
		})
	}
	preview.Proposals = proposals
	preview.TotalCredits = cloudAgentProposalCredits(batch.QuoteMicrocredits)
	preview.Editable, preview.Skippable = editable, editable
}

// cloudAgentCreationParametersLocked 表示本轮该媒体使用手动参数：准入时会用用户设置覆盖画幅与质量。
func cloudAgentCreationParametersLocked(state *cloudAgentRuntime, mode string) bool {
	if state == nil || state.Request.MediaSettings == nil {
		return false
	}
	choice := state.Request.MediaSettings.Image
	if mode == "video" {
		choice = state.Request.MediaSettings.Video
	}
	return choice != nil && choice.ParameterMode == "manual"
}

func cloudAgentImageBatchRawPrompts(call cloudAgentCall) map[string]string {
	var args struct {
		Items []struct {
			ID     string `json:"id"`
			Prompt string `json:"prompt"`
		} `json:"items"`
	}
	prompts := map[string]string{}
	if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil {
		for _, item := range args.Items {
			prompts[item.ID] = item.Prompt
		}
	}
	return prompts
}

func (s *Service) cloudAgentImageBatchApprovalPreview(state *cloudAgentRuntime, call cloudAgentCall, batch *cloudAgentCommerceBatch) cloudAgentApprovalPreview {
	preview := cloudAgentImageBatchPreview(batch)
	editable := len(state.RetryReplay) == 0
	for _, item := range batch.Items {
		editable = editable && item.Args.Mode == "image"
	}
	s.cloudAgentDecorateBatchPreview(&preview, batch, cloudAgentImageBatchRawPrompts(call), editable)
	preview.ParametersLocked = cloudAgentCreationParametersLocked(state, "image")
	return preview
}

func (s *Service) cloudAgentCommerceBatchApprovalPreview(plan *cloudAgentCommercePlan, batch *cloudAgentCommerceBatch, maxCredits float64) cloudAgentApprovalPreview {
	preview := cloudAgentCommerceBatchPreview(plan, batch, maxCredits)
	prompts := map[string]string{}
	for _, item := range plan.Items {
		prompts[item.ID] = item.Prompt
	}
	// 整套方案的交付项互有依赖、版本固定；调整走"按备注修改方案"，卡片只读。
	s.cloudAgentDecorateBatchPreview(&preview, batch, prompts, false)
	return preview
}

// cloudAgentMediaProposalEditable 只有普通单项媒体可以在卡片里改写；套图交付项和失败重试保持原方案。
func cloudAgentMediaProposalEditable(state *cloudAgentRuntime, plan *cloudAgentMediaPlan) bool {
	return state.Request.Surface == "creation" && state.CommercePlan == nil && plan != nil && plan.CommerceItemID == "" && plan.CommerceRetryFailedTaskID == "" && (plan.Args.Mode == "image" || plan.Args.Mode == "video")
}

func cloudAgentDecorateMediaPreview(preview *cloudAgentApprovalPreview, state *cloudAgentRuntime, call cloudAgentCall, plan *cloudAgentMediaPlan, modelName string, prepared *cloudAgentPreparedMedia) {
	if preview == nil || plan == nil || prepared == nil || state.Request.Surface != "creation" {
		return
	}
	title := strings.TrimSpace(plan.Args.Title)
	if title == "" {
		title = map[string]string{"video": "生成视频", "audio": "生成音频"}[plan.Args.Mode]
		if title == "" {
			title = "生成图片"
		}
	}
	var raw struct {
		Prompt string `json:"prompt"`
	}
	prompt := plan.Args.Prompt
	if json.Unmarshal([]byte(call.Function.Arguments), &raw) == nil && strings.TrimSpace(raw.Prompt) != "" {
		prompt = raw.Prompt
	}
	credits := cloudAgentProposalCredits(prepared.Quote.AmountMicrocredits)
	preview.Proposals = []cloudAgentApprovalProposal{{
		ItemID: "media", Title: truncateRunes(title, 120), Mode: plan.Args.Mode, Prompt: prompt,
		Size: plan.Args.Size, Quality: cloudAgentProposalQuality(plan.Args), DurationSeconds: plan.Args.Duration,
		Model: modelName, Credits: credits, ReferenceCount: len(plan.Args.AttachmentResourceIDs),
	}}
	preview.TotalCredits = credits
	preview.Editable = cloudAgentMediaProposalEditable(state, plan)
	preview.ParametersLocked = cloudAgentCreationParametersLocked(state, plan.Args.Mode)
}

func validateCloudAgentApprovalItemEdits(edits []CloudAgentApprovalItemEdit) error {
	if len(edits) == 0 || len(edits) > cloudAgentProposalMaxEdits {
		return BadAuthRequest(fmt.Sprintf("每次最多修改 %d 个方案项", cloudAgentProposalMaxEdits))
	}
	seen := map[string]bool{}
	spec := func(value *string, label string) error {
		if value == nil {
			return nil
		}
		trimmed := strings.TrimSpace(*value)
		if utf8.RuneCountInString(trimmed) > cloudAgentProposalSpecMaxRunes || strings.ContainsAny(trimmed, "\x00\r\n\t") {
			return BadAuthRequest(label + "格式无效")
		}
		*value = trimmed
		return nil
	}
	for index := range edits {
		edit := &edits[index]
		edit.ItemID = strings.TrimSpace(edit.ItemID)
		if edit.ItemID == "" || len(edit.ItemID) > 80 || seen[edit.ItemID] {
			return BadAuthRequest("方案项标识无效或重复")
		}
		seen[edit.ItemID] = true
		if edit.Prompt == nil && edit.Size == nil && edit.Quality == nil && edit.DurationSeconds == nil {
			return BadAuthRequest("请提供要修改的内容")
		}
		if edit.Prompt != nil {
			prompt := strings.TrimSpace(*edit.Prompt)
			if prompt == "" || !utf8.ValidString(prompt) || strings.ContainsRune(prompt, 0) {
				return BadAuthRequest("请填写生成方案")
			}
			if utf8.RuneCountInString(prompt) > cloudAgentProposalPromptMaxRunes {
				return BadAuthRequest(fmt.Sprintf("生成方案最多 %d 字", cloudAgentProposalPromptMaxRunes))
			}
			*edit.Prompt = prompt
		}
		if err := spec(edit.Size, "画幅"); err != nil {
			return err
		}
		if err := spec(edit.Quality, "质量"); err != nil {
			return err
		}
		if edit.DurationSeconds != nil && (*edit.DurationSeconds < 0 || *edit.DurationSeconds > 120) {
			return BadAuthRequest("视频时长须在 0–120 秒之间")
		}
	}
	return nil
}

// cloudAgentEditImageBatchCall 在原调用参数上改写指定项，其他字段原样保留。
func cloudAgentEditImageBatchCall(call cloudAgentCall, edits []CloudAgentApprovalItemEdit) (cloudAgentCall, []string, error) {
	var args map[string]any
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
		return call, nil, BadAuthRequest("方案内容无法解析，请重新规划")
	}
	items, _ := args["items"].([]any)
	byID := map[string]map[string]any{}
	for _, raw := range items {
		if item, ok := raw.(map[string]any); ok {
			byID[stringValue(item["id"])] = item
		}
	}
	titles := make([]string, 0, len(edits))
	set := func(item map[string]any, key string, value *string) {
		if value == nil {
			return
		}
		if *value == "" {
			delete(item, key)
			return
		}
		item[key] = *value
	}
	for _, edit := range edits {
		item := byID[edit.ItemID]
		if item == nil {
			return call, nil, creationConflict("方案项已变化，请刷新后重试")
		}
		if edit.DurationSeconds != nil {
			return call, nil, BadAuthRequest("图片方案不支持设置时长")
		}
		set(item, "prompt", edit.Prompt)
		set(item, "size", edit.Size)
		set(item, "quality", edit.Quality)
		titles = append(titles, stringValue(item["title"]))
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return call, nil, err
	}
	call.Function.Arguments = string(raw)
	return call, titles, nil
}

func cloudAgentEditMediaCall(call cloudAgentCall, edits []CloudAgentApprovalItemEdit) (cloudAgentCall, error) {
	if len(edits) != 1 || edits[0].ItemID != "media" {
		return call, creationConflict("方案项已变化，请刷新后重试")
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
		return call, BadAuthRequest("方案内容无法解析，请重新规划")
	}
	edit := edits[0]
	if edit.Prompt != nil {
		args["prompt"] = *edit.Prompt
	}
	for key, value := range map[string]*string{"size": edit.Size, "quality": edit.Quality} {
		if value == nil {
			continue
		}
		if *value == "" {
			delete(args, key)
		} else {
			args[key] = *value
		}
	}
	if edit.DurationSeconds != nil {
		if stringValue(args["mode"]) != "video" {
			return call, BadAuthRequest("图片方案不支持设置时长")
		}
		args["durationSeconds"] = *edit.DurationSeconds
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return call, err
	}
	call.Function.Arguments = string(raw)
	return call, nil
}

func cloudAgentAppendUnique(values []string, additions ...string) []string {
	for _, value := range additions {
		value = strings.TrimSpace(value)
		if value != "" && !cloudAgentContainsString(values, value) {
			values = append(values, value)
		}
	}
	return values
}

// cloudAgentWithUserAdjustments 把用户在方案卡上的调整写进工具结果，Agent 收尾时按实际提交的内容说明。
func cloudAgentWithUserAdjustments(result map[string]any, batch *cloudAgentCommerceBatch) map[string]any {
	if batch == nil || (len(batch.UserEdited) == 0 && len(batch.UserSkipped) == 0) {
		return result
	}
	if len(batch.UserEdited) > 0 {
		result["userEditedItems"] = batch.UserEdited
	}
	if len(batch.UserSkipped) > 0 {
		result["userSkippedItems"] = batch.UserSkipped
	}
	result["userAdjustment"] = "用户在确认前调整了方案：已按调整后的提示词与参数提交，移出的项未生成；收尾时按实际提交内容说明，不要补做移出的项。"
	return result
}

// carrySkippedProposals 让已移出的项在后续报价更新后仍以"已移出"出现在卡片里。
func carrySkippedProposals(previous cloudAgentApprovalPreview, next *cloudAgentApprovalPreview) {
	for _, proposal := range previous.Proposals {
		if proposal.Skipped {
			next.Proposals = append(next.Proposals, proposal)
		}
	}
}

// UpdateCloudAgentApprovalItems 用改写后的提示词与参数重新准入、重新报价，并轮换审批 ID：
// 旧页面拿着旧 ID 无法批准新价格。不调用模型、不提交任务、不扣费。返回新的审批 ID。
func (s *Service) UpdateCloudAgentApprovalItems(userID, id, approvalID string, edits []CloudAgentApprovalItemEdit) (string, error) {
	if err := validateCloudAgentApprovalItemEdits(edits); err != nil {
		return "", err
	}
	if err := s.repo.ReleaseExpiredCloudAgentResourceLeases(time.Now().UTC()); err != nil {
		return "", err
	}
	if _, _, err := s.cloudAgentTask(userID, id); err != nil {
		return "", err
	}
	for attempt := 0; attempt < 3; attempt++ {
		run, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return "", err
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil {
			return "", err
		}
		approval := state.Approval
		if state.Request.Surface != "creation" || run.Status != "waiting_approval" || approval == nil || approval.ID != approvalID || approval.Decision != "" {
			return "", creationConflict("待确认的方案已变化，请刷新后重试")
		}
		if !approval.Preview.Editable {
			return "", BadAuthRequest("当前方案不支持逐项修改，请填写备注修改方案")
		}
		renewed := *approval
		renewed.ID = id + "-edit-" + newID()
		var mediaPlan *cloudAgentMediaPlan
		var mediaRequest CreateTaskRequest
		var preparedTask *model.Task
		var preparation *creationTaskPreparation
		switch {
		case approval.Batch != nil && approval.Batch.Kind == "images" && len(state.RetryReplay) == 0:
			call, titles, err := cloudAgentEditImageBatchCall(approval.Call, edits)
			if err != nil {
				return "", err
			}
			minimum := 2
			if len(approval.Batch.UserSkipped) > 0 {
				minimum = 1
			}
			batch, err := s.prepareCloudAgentImageBatchItems(run, &state, call, minimum)
			if err != nil {
				return "", err
			}
			batch.UserSkipped = approval.Batch.UserSkipped
			batch.UserEdited = cloudAgentAppendUnique(append([]string(nil), approval.Batch.UserEdited...), titles...)
			renewed.Call, renewed.CallHash, renewed.Batch = call, cloudAgentApprovalCallHash(call), batch
			renewed.Preview = s.cloudAgentImageBatchApprovalPreview(&state, call, batch)
			carrySkippedProposals(approval.Preview, &renewed.Preview)
		case approval.Batch == nil && approval.Prepared != nil && approval.Call.Function.Name == "generate_media":
			call, err := cloudAgentEditMediaCall(approval.Call, edits)
			if err != nil {
				return "", err
			}
			mediaCall, identity, err := s.cloudAgentResolvedMediaCall(userID, &state, call)
			if err != nil {
				return "", err
			}
			req, plan, err := s.prepareCloudAgentMedia(run, &state, mediaCall)
			if err != nil {
				return "", err
			}
			plan.CommerceKey, plan.CommerceItemID = identity.TaskID, identity.ItemID
			plan.CommerceRetryFailedTaskID, plan.CommerceRetryPromptHash = identity.RetryFailedTaskID, identity.RetryPromptHash
			if !cloudAgentMediaProposalEditable(&state, plan) {
				return "", BadAuthRequest("当前方案不支持逐项修改，请填写备注修改方案")
			}
			preparation = &creationTaskPreparation{}
			req.creationPrepare = preparation
			preparedTask, err = s.prepareCloudAgentPreferredMedia(run, &state, &req, plan, 0)
			if err != nil {
				return "", err
			}
			if err := applyCloudAgentResolvedMediaDefaults(&req, plan, preparedTask); err != nil {
				return "", err
			}
			if plan.Args.Mode == "video" && state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds-plan.Args.Duration {
				return "", BadAuthRequest("视频时长超过本轮视频预算，请缩短时长")
			}
			if err := validateCloudAgentMediaBudget(plan.Args, &state); err != nil {
				return "", err
			}
			modelName, err := s.cloudAgentMediaModelName(plan.Args)
			if err != nil {
				return "", err
			}
			preview := cloudAgentMediaApprovalPreview(plan, modelName)
			preview.Description = approval.Preview.Description
			renewed.Call, renewed.CallHash, renewed.ModelName, renewed.Preview = call, cloudAgentApprovalCallHash(call), modelName, preview
			mediaPlan, mediaRequest = plan, req
		default:
			return "", BadAuthRequest("当前方案不支持逐项修改，请填写备注修改方案")
		}
		s.storageMu.Lock()
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if current.Status != "waiting_approval" {
				return creationConflict("审批状态已变化，请刷新后重试")
			}
			if err := repo.ReleaseCloudAgentResourceLeases(userID, approvalID); err != nil {
				return err
			}
			if renewed.Batch != nil {
				if err := leaseCloudAgentCommerceBatch(repo, userID, id, renewed.ID, renewed.Batch); err != nil {
					return err
				}
			} else {
				prepared, err := prepareCloudAgentMediaApproval(repo, userID, cloudAgentCreationMediaDocument(), mediaPlan, mediaRequest, preparedTask, preparation.Order)
				if err != nil {
					return err
				}
				if previous := approval.Prepared; previous != nil && previous.GenerationID != "" {
					prepared.GenerationID = previous.GenerationID
					prepared.Hash = creationHash(prepared)
				}
				if err := pinCloudAgentPreparedMedia(repo, userID, id, renewed.ID, prepared); err != nil {
					return err
				}
				renewed.Prepared = prepared
				cloudAgentDecorateMediaPreview(&renewed.Preview, &state, renewed.Call, mediaPlan, renewed.ModelName, prepared)
			}
			state.Calls[state.CallIndex] = renewed.Call
			state.Approval = &renewed
			payload := map[string]any{"approvalId": renewed.ID, "previousApprovalId": approvalID, "toolName": renewed.Call.Function.Name, "arguments": json.RawMessage(renewed.Call.Function.Arguments), "preview": renewed.Preview, "edited": true, "text": "已按你的修改重新报价"}
			if renewed.Batch != nil {
				cloudAgentImageBatchPlanEvent(&state, id, renewed.Batch)
				payload["planHash"] = renewed.Batch.PlanHash
			} else {
				payload["modelName"], payload["prepared"] = renewed.ModelName, renewed.Prepared.publicView()
			}
			state.event(id, "approval_requested", payload)
			return cloudAgentSave(current, &state)
		})
		s.storageMu.Unlock()
		if err == nil {
			return renewed.ID, nil
		}
		if !errors.Is(err, repository.ErrCreationConflict) {
			return "", err
		}
	}
	return "", creationConflict("方案正在更新，请稍后重试")
}

// trimCloudAgentBatchApproval 在确认前移出部分项：其余项的准备态与报价不变，只重算整批报价与调用哈希，
// 并轮换审批 ID。移出后至少保留一项；全部不需要时应直接拒绝。
func (s *Service) trimCloudAgentBatchApproval(userID, id, approvalID string, skipItemIDs []string) (string, error) {
	skip := map[string]bool{}
	for _, itemID := range skipItemIDs {
		itemID = strings.TrimSpace(itemID)
		if itemID == "" || len(itemID) > 80 {
			return "", BadAuthRequest("方案项标识无效")
		}
		skip[itemID] = true
	}
	if len(skip) == 0 || len(skip) > 20 {
		return "", BadAuthRequest("移出的方案项无效")
	}
	for attempt := 0; attempt < 3; attempt++ {
		run, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return "", err
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil {
			return "", err
		}
		approval := state.Approval
		if state.Request.Surface != "creation" || run.Status != "waiting_approval" || approval == nil || approval.ID != approvalID || approval.Decision != "" {
			return "", creationConflict("待确认的方案已变化，请刷新后重试")
		}
		if approval.Batch == nil || approval.Batch.Kind != "images" || !approval.Preview.Skippable || len(state.RetryReplay) > 0 {
			return "", BadAuthRequest("当前方案不支持移出单项，请直接确认或拒绝")
		}
		batch := *approval.Batch
		batch.Items = nil
		batch.QuoteMicrocredits = 0
		var skippedTitles []string
		for _, item := range approval.Batch.Items {
			if skip[item.ItemID] {
				skippedTitles = append(skippedTitles, item.Args.Title)
				delete(skip, item.ItemID)
				continue
			}
			batch.Items = append(batch.Items, item)
			if item.Prepared != nil {
				batch.QuoteMicrocredits += item.Prepared.Quote.AmountMicrocredits
			}
		}
		if len(skip) > 0 {
			return "", creationConflict("方案项已变化，请刷新后重试")
		}
		if len(batch.Items) == 0 {
			return "", BadAuthRequest("至少保留一项；都不需要时请选择不生成")
		}
		var args map[string]any
		if err := json.Unmarshal([]byte(approval.Call.Function.Arguments), &args); err != nil {
			return "", BadAuthRequest("方案内容无法解析，请重新规划")
		}
		kept := map[string]bool{}
		for _, item := range batch.Items {
			kept[item.ItemID] = true
		}
		items, _ := args["items"].([]any)
		filtered := make([]any, 0, len(batch.Items))
		for _, raw := range items {
			if item, ok := raw.(map[string]any); ok && kept[stringValue(item["id"])] {
				filtered = append(filtered, item)
			}
		}
		args["items"] = filtered
		call := approval.Call
		call.Function.Arguments = mustMarshal(args)
		batch.PlanHash = cloudAgentApprovalCallHash(call)
		batch.UserSkipped = cloudAgentAppendUnique(append([]string(nil), approval.Batch.UserSkipped...), skippedTitles...)
		renewed := *approval
		renewed.ID = id + "-trim-" + newID()
		renewed.Call, renewed.CallHash, renewed.Batch = call, cloudAgentApprovalCallHash(call), &batch
		renewed.Preview = s.cloudAgentImageBatchApprovalPreview(&state, call, &batch)
		for _, proposal := range approval.Preview.Proposals {
			if proposal.Skipped || !kept[proposal.ItemID] {
				proposal.Skipped = true
				renewed.Preview.Proposals = append(renewed.Preview.Proposals, proposal)
			}
		}
		s.storageMu.Lock()
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if current.Status != "waiting_approval" {
				return creationConflict("审批状态已变化，请刷新后重试")
			}
			if err := repo.ReleaseCloudAgentResourceLeases(userID, approvalID); err != nil {
				return err
			}
			if err := leaseCloudAgentCommerceBatch(repo, userID, id, renewed.ID, renewed.Batch); err != nil {
				return err
			}
			state.Calls[state.CallIndex] = call
			state.Approval = &renewed
			cloudAgentImageBatchPlanEvent(&state, id, renewed.Batch)
			state.event(id, "approval_requested", map[string]any{"approvalId": renewed.ID, "previousApprovalId": approvalID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": renewed.Preview, "planHash": batch.PlanHash, "edited": true, "text": fmt.Sprintf("已移出 %d 项，其余 %d 项待确认", len(skippedTitles), len(batch.Items))})
			return cloudAgentSave(current, &state)
		})
		s.storageMu.Unlock()
		if err == nil {
			return renewed.ID, nil
		}
		if !errors.Is(err, repository.ErrCreationConflict) {
			return "", err
		}
	}
	return "", creationConflict("方案正在更新，请稍后重试")
}

// ApproveCloudAgentApprovalItems 是方案卡上的"一键确认"：先移出用户不要的项，再按剩余项批准执行。
func (s *Service) ApproveCloudAgentApprovalItems(userID, id, approvalID string, skipItemIDs []string) error {
	if len(skipItemIDs) == 0 {
		return s.DecideCloudAgentApproval(userID, id, approvalID, "approve", "")
	}
	trimmed, err := s.trimCloudAgentBatchApproval(userID, id, approvalID, skipItemIDs)
	if err != nil {
		return err
	}
	return s.DecideCloudAgentApproval(userID, id, trimmed, "approve", "")
}
