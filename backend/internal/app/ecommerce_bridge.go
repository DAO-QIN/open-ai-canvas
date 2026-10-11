package app

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"
	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type EcommerceImportRequest = ecommerce.ImportRequest
type EcommerceProductRequest = ecommerce.ProductRequest
type EcommerceGuard = ecommerce.Guard
type EcommerceQuoteRequest = ecommerce.QuoteRequest
type EcommerceCommand = ecommerce.Command
type EcommerceBatchCommandItem = ecommerce.BatchCommandItem
type EcommerceSettings = ecommerce.Settings
type EcommercePresetRequest = ecommerce.PresetRequest

type ecommerceHost struct{ svc *Service }

func (h ecommerceHost) WithStorageLock(fn func() error) error {
	h.svc.storageMu.Lock()
	defer h.svc.storageMu.Unlock()
	return fn()
}
func (h ecommerceHost) Require(repo *repository.Repository, userID string) error {
	enabled, reason, err := repo.EcommerceEnabled(userID)
	if err != nil {
		return err
	}
	if !enabled {
		return Forbidden(reason)
	}
	return nil
}
func ecommerceConfig(selection ecommerce.Selection, out *ecommerce.Output) map[string]any {
	config := map[string]any{}
	if selection.ChannelID != "" {
		config["channelId"] = selection.ChannelID
		config["channelModelKey"] = selection.ChannelModelKey
		config["model"] = selection.ChannelModelKey
	}
	if out != nil {
		config["size"] = out.Size
		config["quality"] = out.Quality
		config["count"] = "1"
	}
	return config
}
func (h ecommerceHost) ValidateConfig(userID string, config ecommerce.Config) error {
	if err := ecommerce.ValidateConfig(config); err != nil {
		return err
	}
	frontend, err := h.svc.FeatureEnabled(FeatureFrontendModels)
	if err != nil {
		return err
	}
	for _, role := range []struct {
		Selection ecommerce.Selection
		Cap       string
		Out       *ecommerce.Output
	}{{config.Planner, "text", nil}, {config.ImageModel, "image", &config.Hero}, {config.ImageModel, "image", &config.Detail}} {
		input := map[string]any{"mode": role.Cap, "prompt": "商品套图能力校验", "config": ecommerceConfig(role.Selection, role.Out), "referenceImages": []any{map[string]any{"storageKey": "resource:capability-check", "bytes": 1}}}
		_, resolved, e := h.svc.resolveTaskModelSelection(input, role.Selection.LogicalModelID, "canvas_"+role.Cap, "ecommerce_validate", frontend)
		if e != nil {
			return e
		}
		cfg, _ := resolved["config"].(map[string]any)
		cm, e := h.svc.repo.ChannelModelByKey(stringValue(cfg["channelId"]), stringValue(cfg["model"]))
		if e != nil {
			return e
		}
		profile, e := DecodeModelCapabilityConfig(cm.CapabilityConfigJSON)
		if e != nil || profile == nil {
			return BadAuthRequest("模型尚未配置有效能力")
		}
		if role.Cap == "text" && (profile.Text == nil || profile.Text.References.MaxImages < 1) {
			return BadAuthRequest("创作模型必须支持原图理解")
		}
		if role.Cap == "image" && (profile.Image == nil || profile.Image.References.MaxImages < 1) {
			return BadAuthRequest("生图模型必须支持商品参考图")
		}
		if e := h.svc.ValidateTaskCapability(resolved); e != nil {
			return e
		}
		if role.Out != nil && stringValue(cfg["size"]) != role.Out.Size {
			return BadAuthRequest("默认图片规格不在当前模型有效目录内")
		}
	}
	return nil
}
func (h ecommerceHost) ValidateReviewModel(_ string, selection ecommerce.Selection) error {
	logical := selection.LogicalModelID != ""
	channel := selection.ChannelID != "" && selection.ChannelModelKey != ""
	if logical == channel || (logical && (selection.ChannelID != "" || selection.ChannelModelKey != "")) {
		return BadAuthRequest("请选择一个质检模型")
	}
	frontend, err := h.svc.FeatureEnabled(FeatureFrontendModels)
	if err != nil {
		return err
	}
	input := map[string]any{"mode": "text", "prompt": "商品成图质检能力校验", "config": ecommerceConfig(selection, nil), "referenceImages": []any{map[string]any{"storageKey": "resource:quality-source", "bytes": 1}, map[string]any{"storageKey": "resource:quality-result", "bytes": 1}}}
	_, resolved, err := h.svc.resolveTaskModelSelection(input, selection.LogicalModelID, "canvas_text", "ecommerce_quality_validate", frontend)
	if err != nil {
		return err
	}
	cfg, _ := resolved["config"].(map[string]any)
	cm, err := h.svc.repo.ChannelModelByKey(stringValue(cfg["channelId"]), stringValue(cfg["model"]))
	if err != nil {
		return err
	}
	profile, err := DecodeModelCapabilityConfig(cm.CapabilityConfigJSON)
	if err != nil || profile == nil || profile.Text == nil || profile.Text.References.MaxImages < 2 {
		return BadAuthRequest("质检模型必须支持同时理解原图与成图（至少两张图片）")
	}
	return h.svc.ValidateTaskCapability(resolved)
}
func (h ecommerceHost) Prepare(userID string, intent ecommerce.Intent, cap *int64) (*ecommerce.Prepared, error) {
	if !utf8.ValidString(intent.Prompt) || utf8.RuneCountInString(intent.Prompt) > 16000 {
		return nil, BadAuthRequest("本步骤提示词过长，请简化方案后重新确认")
	}
	resource, err := h.svc.repo.ResourceForUser(userID, intent.ResourceID)
	if err != nil {
		return nil, NotFound("商品原图不存在或不属于当前账号")
	}
	if resource.Kind != "image" || resource.Status != "ready" {
		return nil, BadAuthRequest("商品原图尚未就绪")
	}
	mode := "text"
	selection := intent.Config.Planner
	var out *ecommerce.Output
	if intent.Kind == "quality" {
		selection = intent.ReviewModel
		if intent.StageID != "" && intent.VersionID == "" {
			return nil, BadAuthRequest("质检必须关联已经保存的成图版本")
		}
		if err := h.ValidateReviewModel(userID, selection); err != nil {
			return nil, err
		}
	}
	if strings.HasPrefix(intent.Kind, "image:") {
		mode = "image"
		selection = intent.Config.ImageModel
		if intent.Kind == "image:hero" {
			out = &intent.Config.Hero
		} else {
			out = &intent.Config.Detail
		}
	}
	config := ecommerceConfig(selection, out)
	reference := func(r *model.Resource) any {
		return map[string]any{"id": r.ID, "storageKey": "resource:" + r.ID, "mimeType": r.MimeType, "bytes": r.Size, "width": r.Width, "height": r.Height}
	}
	references := []any{reference(resource)}
	if intent.Kind == "quality" {
		// Before generation, quote the same two-image input shape using the
		// source as a placeholder. Admission requires the actual stored result.
		result := resource
		if intent.ResultResourceID != "" {
			result, err = h.svc.repo.ResourceForUser(userID, intent.ResultResourceID)
			if err != nil || result.Kind != "image" || result.Status != "ready" {
				return nil, BadAuthRequest("待质检成图不存在或不属于当前账号")
			}
		} else if intent.StageID != "" {
			return nil, BadAuthRequest("质检必须关联已经保存的成图版本")
		}
		references = append(references, reference(result))
	}
	input := map[string]any{"mode": mode, "prompt": intent.Prompt, "config": config, "referenceImages": references}
	if mode == "text" {
		config["maxOutputTokens"] = 8192
		input["maxOutputTokens"] = 8192
		input["textOptions"] = map[string]any{"stream": false, "maxOutputTokens": 8192}
	}
	maxCharge := int64(1_000_000_000_000)
	if cap != nil {
		maxCharge = *cap
	}
	req := CreateTaskRequest{Type: "canvas_" + mode, Operation: "ecommerce_" + strings.ReplaceAll(intent.Kind, ":", "_"), Prompt: intent.Prompt, LogicalModelID: selection.LogicalModelID, Input: input, admission: &taskAdmission{ID: newID(), MaxCharge: maxCharge}, callerHoldsStorageMu: true}
	task, order, signature, err := h.svc.prepareTaskAdmission(userID, req)
	if err != nil {
		return nil, err
	}
	if intent.StageID != "" {
		task.EcommerceStepID = &intent.StageID
	}
	var normalized map[string]any
	if err = json.Unmarshal([]byte(task.InputJSON), &normalized); err != nil {
		return nil, err
	}
	resolved, _ := normalized["config"].(map[string]any)
	if out != nil && (stringValue(resolved["size"]) != out.Size || out.Quality != "" && stringValue(resolved["quality"]) != out.Quality) {
		return nil, BadAuthRequest("模型解析后的规格已变化，请重新确认")
	}
	if err := h.svc.protectTaskSecrets(normalized); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	task.InputJSON = string(encoded)
	prepared := &ecommerce.Prepared{Task: task, Order: order, Signature: signature}
	if order != nil {
		prepared.Amount = order.AmountMicrocredits
		prepared.Estimated = order.BillingMode == "token"
		task.BillingOrderID = order.ID
		if cap != nil {
			order.ChargeLimitSet = true
			order.ChargeLimitMicrocredits = *cap
			task.AuthorizedChargeMicrocredits = *cap
		}
	}
	return prepared, nil
}
func (h ecommerceHost) Admit(repo *repository.Repository, prepared *ecommerce.Prepared) error {
	if prepared.Task.EcommerceStepID == nil {
		return BadAuthRequest("商品步骤关联缺失")
	}
	if err := checkCreationPriceSignature(repo, prepared.Task, prepared.Signature); err != nil {
		return err
	}
	policy, err := h.svc.RuntimePolicy()
	if err != nil {
		return err
	}
	if err := h.svc.requireStoredFileCapacityWhileLocked(prepared.Task.UserID, prepared.Task.Type, policy); err != nil {
		return err
	}
	return createTaskWithStorageQuotaRepository(repo, prepared.Task, prepared.Order, policy)
}
func (h ecommerceHost) StorageQuota(repo *repository.Repository, userID string, incoming int64) error {
	usage, err := repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	policy, err := h.svc.RuntimePolicy()
	if err != nil {
		return err
	}
	_, creationBytes, err := repo.CreationStorageUsage(userID)
	if err != nil {
		return err
	}
	return validateStructuredStorageQuotaWithPolicy(usage, "", false, creationBytes+incoming, policy.Resource)
}
func (h ecommerceHost) Completion(task *model.Task) (ecommerce.Completion, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(task.ResultJSON), &payload); err != nil {
		return ecommerce.Completion{}, err
	}
	if task.Type == "canvas_text" {
		return ecommerce.Completion{Text: stringValue(payload["text"])}, nil
	}
	images, ok := payload["images"].([]any)
	if !ok || len(images) != 1 {
		return ecommerce.Completion{}, BadAuthRequest("本步骤必须返回一张商品图")
	}
	image, ok := images[0].(map[string]any)
	if !ok {
		return ecommerce.Completion{}, BadAuthRequest("图片结果格式无效")
	}
	id := stringValue(image["resourceId"])
	if id == "" {
		id = strings.TrimPrefix(stringValue(image["storageKey"]), "resource:")
	}
	if id == "" {
		return ecommerce.Completion{}, BadAuthRequest("图片资源尚未入库")
	}
	return ecommerce.Completion{ResourceID: id}, nil
}
func (h ecommerceHost) OpenResource(userID, id string) (*model.Resource, io.ReadCloser, error) {
	return h.svc.OpenResource(userID, id)
}
func (h ecommerceHost) Wake() { h.svc.wakeTaskDispatcher() }
func (s *Service) ecommerceDomain() *ecommerce.Service {
	s.workerRuntimeMu.Lock()
	defer s.workerRuntimeMu.Unlock()
	if s.ecommerce == nil {
		s.ecommerce = ecommerce.New(s.repo, ecommerceHost{svc: s}, s.workerID+":ecommerce")
	}
	return s.ecommerce
}
func (s *Service) EcommerceOptions(actor *model.User) (map[string]any, error) {
	settings, e := s.ecommerceDomain().Settings()
	if e != nil {
		return nil, e
	}
	state, e := s.pluginStateForUser(actor, model.EcommercePluginID, s.Plugins())
	if e != nil {
		return nil, e
	}
	catalog, e := s.ModelCatalog(nil)
	if e != nil {
		return nil, e
	}
	presets, e := s.ecommerceDomain().Presets(actor.ID)
	if e != nil {
		return nil, e
	}
	return map[string]any{"defaults": settings.Defaults, "reviewAvailable": settings.ReviewAvailable, "batchLimit": settings.BatchLimit, "state": state, "catalog": catalog, "presets": presets}, nil
}
func (s *Service) EcommerceSettings(actor *model.User) (ecommerce.Settings, error) {
	if e := s.RequireAdmin(actor); e != nil {
		return ecommerce.Settings{}, e
	}
	return s.ecommerceDomain().Settings()
}
func (s *Service) UpdateEcommerceSettings(actor *model.User, req EcommerceSettings) (ecommerce.Settings, error) {
	if e := s.RequireAdmin(actor); e != nil {
		return ecommerce.Settings{}, e
	}
	value, e := s.ecommerceDomain().SaveSettings(actor, req)
	if e != nil {
		return value, e
	}
	e = s.appendAdminAudit(actor, "ecommerce.settings.update", "system_setting", ecommerce.SettingsKey, "更新商品套图模型与限制", value)
	return value, e
}
func (s *Service) ImportEcommerceBatch(userID string, req EcommerceImportRequest) (*ecommerce.BatchView, error) {
	return s.ecommerceDomain().Import(userID, req)
}
func (s *Service) EcommerceBatches(userID string) ([]model.EcommerceBatch, error) {
	return s.repo.EcommerceBatches(userID)
}
func (s *Service) EcommerceBatch(userID, id string) (*ecommerce.BatchView, error) {
	return s.ecommerceDomain().Batch(userID, id)
}
func (s *Service) EcommerceProducts(userID, batchID string, archived bool, page, size int) (*ecommerce.ProductPage, error) {
	return s.ecommerceDomain().Products(userID, batchID, archived, page, size)
}
func (s *Service) EcommerceProduct(userID, id string) (*ecommerce.ProductView, error) {
	return s.ecommerceDomain().Product(userID, id)
}
func (s *Service) UpdateEcommerceProduct(userID, id string, req EcommerceProductRequest) (*ecommerce.ProductView, error) {
	return s.ecommerceDomain().UpdateProduct(userID, id, req)
}
func (s *Service) DeleteEcommerceDraft(userID, id string, req EcommerceGuard) error {
	return s.ecommerceDomain().DeleteDraft(userID, id, req)
}
func (s *Service) EcommerceRun(userID, productID, runID string) (*ecommerce.RunView, error) {
	return s.ecommerceDomain().Run(userID, productID, runID)
}
func (s *Service) QuoteEcommerce(userID, id string, req EcommerceQuoteRequest) (*ecommerce.QuoteView, error) {
	return s.ecommerceDomain().Quote(userID, id, req)
}
func (s *Service) CommandEcommerce(userID, id string, req EcommerceCommand) (*ecommerce.ProductView, error) {
	return s.ecommerceDomain().Command(userID, id, req)
}
func (s *Service) BatchCommandEcommerce(userID string, req []EcommerceBatchCommandItem) ([]ecommerce.BatchResult, error) {
	return s.ecommerceDomain().BatchCommand(userID, req)
}
func (s *Service) EcommercePresets(userID string) ([]ecommerce.PresetView, error) {
	return s.ecommerceDomain().Presets(userID)
}
func (s *Service) EcommercePreferences(userID string) (*ecommerce.PresetView, error) {
	return s.ecommerceDomain().Preferences(userID)
}
func (s *Service) SaveEcommercePreferences(userID string, req EcommercePresetRequest) (*ecommerce.PresetView, error) {
	return s.ecommerceDomain().SavePreferences(userID, req)
}
func (s *Service) SaveEcommercePreset(userID string, req EcommercePresetRequest) (*ecommerce.PresetView, error) {
	return s.ecommerceDomain().SavePreset(userID, req)
}
func (s *Service) DeleteEcommercePreset(userID, id string, guard EcommerceGuard) error {
	return s.ecommerceDomain().DeletePreset(userID, id, guard)
}
func (s *Service) ExportEcommerce(ctx context.Context, userID string, ids []string, w io.Writer) error {
	return s.ecommerceDomain().Export(ctx, userID, ids, w)
}
func (s *Service) ExportEcommerceRun(ctx context.Context, userID, productID, runID string, w io.Writer) error {
	return s.ecommerceDomain().ExportRun(ctx, userID, productID, runID, w)
}
func (s *Service) RecoverEcommerceStep(ctx context.Context, userID, productID, stepID string) (*ProviderTaskQueryResult, error) {
	step, err := s.repo.EcommerceStep(userID, stepID)
	if err != nil || step.ProductID != productID || step.TaskID == nil {
		return nil, NotFound("商品步骤不存在")
	}
	task, err := s.repo.TaskForUser(userID, *step.TaskID)
	if err != nil {
		return nil, err
	}
	if task.EcommerceStepID == nil || *task.EcommerceStepID != step.ID {
		return nil, Forbidden("商品任务关联无效")
	}
	if task.Status == model.TaskStatusSucceeded || task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
		return &ProviderTaskQueryResult{Task: taskForOutput(*task), ProviderStatus: string(task.Status), Recovered: task.Status == model.TaskStatusSucceeded, BillingSettled: s.billingSettled(task)}, nil
	}
	if task.MediaRecoveryJSON != "" {
		recovered, err := s.RecoverTaskMedia(userID, task.ID)
		if err != nil {
			return nil, err
		}
		return &ProviderTaskQueryResult{Task: recovered, ProviderStatus: string(recovered.Status)}, nil
	}
	if task.Type != "canvas_image" {
		return nil, BadAuthRequest("原请求没有可安全查询的异步结果，请到任务中心核对费用后再处理")
	}
	return s.queryFailedProviderTask(ctx, task, userID)
}
