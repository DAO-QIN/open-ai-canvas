package ecommerce

import (
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"strings"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newID() string { return uuid.NewString() }
func (s *Service) Settings() (Settings, error) {
	value := DefaultSettings()
	setting, err := s.repo.SystemSettingOptional(SettingsKey)
	if err != nil {
		return value, err
	}
	if setting != nil {
		if err = json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return value, err
		}
	}
	return value, nil
}
func ValidateConfig(config Config) error {
	choices := []Selection{config.Planner, config.ImageModel}
	if config.ReviewModel != nil {
		choices = append(choices, *config.ReviewModel)
	}
	for _, choice := range choices {
		logical := choice.LogicalModelID != ""
		channel := choice.ChannelID != "" && choice.ChannelModelKey != ""
		if logical == channel || (logical && (choice.ChannelID != "" || choice.ChannelModelKey != "")) {
			return invalid("请选择一个平台模型")
		}
	}
	for _, out := range []Output{config.Hero, config.Detail} {
		if out.Count < 1 || out.Count > 20 || !validField(out.Size, 80, false) || !validField(out.Quality, 80, true) || (out.CopyMode != "none" && out.CopyMode != "typeset") {
			return invalid("套图数量、规格或文字模式无效")
		}
	}
	if config.TitleCount < 1 || config.TitleCount > 10 || config.TitleMaxLength < 10 || config.TitleMaxLength > 300 {
		return invalid("标题数量或长度无效")
	}
	for _, v := range []string{config.Style, config.Platform, config.Market, config.Language} {
		if !validField(v, 1200, false) {
			return invalid("风格、平台、市场或语言无效")
		}
	}
	for _, v := range []string{config.PlanningInstructions, config.RefinementInstructions, config.GenerationInstructions} {
		if !validField(v, 4000, true) {
			return invalid("专业创作要求最多 4000 字")
		}
	}
	return nil
}
func (s *Service) SaveSettings(actor *model.User, settings Settings) (Settings, error) {
	if actor == nil || actor.Role != "admin" {
		return Settings{}, kernel.Forbidden("仅管理员可以配置商品套图")
	}
	if settings.BatchLimit < 1 || settings.BatchLimit > 100 || settings.ProductConcurrency < 1 || settings.ProductConcurrency > 10 || settings.TextConcurrency < 1 || settings.TextConcurrency > 20 || settings.ImageConcurrency < 1 || settings.ImageConcurrency > 20 || settings.ProductImageConcurrency < 1 || settings.ProductImageConcurrency > settings.ImageConcurrency {
		return Settings{}, invalid("批次或编排限制无效")
	}
	if err := ValidateConfig(settings.Defaults); err != nil {
		return Settings{}, err
	}
	if err := s.host.ValidateConfig(actor.ID, settings.Defaults); err != nil {
		return Settings{}, err
	}
	if settings.Defaults.QualityCheck && !settings.ReviewAvailable {
		return Settings{}, invalid("默认开启智能质检前，请先开放质检能力")
	}
	if settings.ReviewAvailable {
		if err := s.host.ValidateReviewModel(actor.ID, settings.ReviewModel); err != nil {
			return Settings{}, err
		}
	}
	err := s.repo.MutateEcommerceSettings(func(current *model.SystemSetting, repo *repository.Repository) error {
		before := DefaultSettings()
		if current != nil {
			if e := json.Unmarshal([]byte(current.ValueJSON), &before); e != nil {
				return e
			}
		}
		if settings.Revision != before.Revision {
			return conflict("配置已更新，请刷新")
		}
		settings.Revision++
		return repo.SaveSystemSetting(&model.SystemSetting{Key: SettingsKey, ValueJSON: encode(settings), UpdatedBy: actor.ID})
	})
	return settings, err
}
func (s *Service) Import(userID string, req ImportRequest) (*BatchView, error) {
	settings, err := s.Settings()
	if err != nil {
		return nil, err
	}
	if !validField(req.OperationID, 120, false) || len(req.Items) < 1 || len(req.Items) > settings.BatchLimit {
		return nil, invalid("请上传 1 到批次上限数量的商品图片")
	}
	config := settings.Defaults
	if req.Config != nil {
		config = *req.Config
	}
	var batch *model.EcommerceBatch
	err = s.host.WithStorageLock(func() error {
		return s.repo.MutateEcommerce(userID, "", func(_ *model.EcommerceProduct, repo *repository.Repository) error {
			old, e := repo.EcommerceBatchOperation(userID, req.OperationID)
			if e == nil {
				if old.RequestHash != Hash(req) {
					return conflict("同一导入标识不能用于不同商品")
				}
				batch = old
				return nil
			}
			if !errors.Is(e, gorm.ErrRecordNotFound) {
				return e
			}
			if e := s.host.Require(repo, userID); e != nil {
				return e
			}
			if e := ValidateConfig(config); e != nil {
				return e
			}
			if e := s.host.ValidateConfig(userID, config); e != nil {
				return e
			}
			products := make([]model.EcommerceProduct, 0, len(req.Items))
			batch = &model.EcommerceBatch{ID: newID(), UserID: userID, OperationID: req.OperationID, RequestHash: Hash(req), Name: strings.TrimSpace(req.Name)}
			if !validField(batch.Name, 200, true) {
				return invalid("批次名称过长")
			}
			if batch.Name == "" {
				batch.Name = time.Now().Format("01-02 商品套图")
			}
			for _, item := range req.Items {
				if !validField(item.Name, 200, false) || !validField(item.SellingPoints, 8000, true) {
					return invalid("商品名称或卖点无效")
				}
				resource, e := repo.ResourceForUser(userID, item.ResourceID)
				if e != nil {
					return kernel.NotFound("图片不存在或不属于当前账号")
				}
				if resource.Kind != "image" || resource.Status != "ready" {
					return invalid("请使用已经上传完成的图片")
				}
				products = append(products, model.EcommerceProduct{ID: newID(), UserID: userID, BatchID: batch.ID, SourceResourceID: resource.ID, Name: strings.TrimSpace(item.Name), SellingPoints: strings.TrimSpace(item.SellingPoints), ConfigJSON: encode(config), Revision: 1})
			}
			if e := s.host.StorageQuota(repo, userID, int64(len(encode(products)))); e != nil {
				return e
			}
			return repo.CreateEcommerceBatch(batch, products)
		})
	})
	if err != nil {
		return nil, err
	}
	return s.Batch(userID, batch.ID)
}
func (s *Service) Batch(userID, id string) (*BatchView, error) {
	b, err := s.repo.EcommerceBatch(userID, id)
	if err != nil {
		return nil, readError(err)
	}
	products, _, err := s.repo.EcommerceProducts(userID, id, false, 1, 100)
	if err != nil {
		return nil, err
	}
	view := &BatchView{EcommerceBatch: *b, Products: []ProductView{}}
	for _, p := range products {
		v, e := s.productView(p, false)
		if e != nil {
			return nil, e
		}
		view.Products = append(view.Products, *v)
	}
	return view, nil
}
func (s *Service) Products(userID, batchID string, archived bool, page, size int) (*ProductPage, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	items, total, err := s.repo.EcommerceProducts(userID, batchID, archived, page, size)
	if err != nil {
		return nil, err
	}
	view := &ProductPage{Items: []ProductView{}, Total: total, Page: page, PageSize: size}
	for _, p := range items {
		v, e := s.productView(p, false)
		if e != nil {
			return nil, e
		}
		view.Items = append(view.Items, *v)
	}
	return view, nil
}
func (s *Service) Product(userID, id string) (*ProductView, error) {
	p, err := s.repo.EcommerceProduct(userID, id)
	if err != nil {
		return nil, readError(err)
	}
	return s.productView(*p, true)
}
func (s *Service) productView(p model.EcommerceProduct, history bool) (*ProductView, error) {
	v := &ProductView{EcommerceProduct: p, Runs: []model.EcommerceRun{}}
	if err := json.Unmarshal([]byte(p.ConfigJSON), &v.Config); err != nil {
		return nil, err
	}
	if p.CurrentRunID != "" {
		run, err := s.Run(p.UserID, p.ID, p.CurrentRunID)
		if err != nil {
			return nil, err
		}
		v.Run = run
	}
	if history {
		runs, err := s.repo.EcommerceRuns(p.UserID, p.ID)
		if err != nil {
			return nil, err
		}
		v.Runs = runs
	}
	return v, nil
}

type titleState struct {
	Current  []string   `json:"current"`
	Versions [][]string `json:"versions"`
}

func (s *Service) Run(userID, productID, runID string) (*RunView, error) {
	p, err := s.repo.EcommerceProduct(userID, productID)
	if err != nil {
		return nil, readError(err)
	}
	run, err := s.repo.EcommerceRun(userID, runID)
	if err != nil {
		return nil, readError(err)
	}
	if run.ProductID != p.ID {
		return nil, kernel.NotFound("轮次不存在")
	}
	v := &RunView{EcommerceRun: *run, Titles: []string{}, TitleHistory: [][]string{}, Branches: []BranchView{}, Slots: []SlotView{}, Steps: []model.EcommerceStep{}}
	if err = json.Unmarshal([]byte(run.ConfigJSON), &v.Config); err != nil {
		return nil, err
	}
	state := titleState{Current: []string{}, Versions: [][]string{}}
	if run.TitlesJSON != "" {
		if err = json.Unmarshal([]byte(run.TitlesJSON), &state); err != nil {
			return nil, err
		}
	}
	v.Titles = state.Current
	v.TitleHistory = state.Versions
	branches, err := s.repo.EcommerceBranches(userID, run.ID)
	if err != nil {
		return nil, err
	}
	for _, branch := range branches {
		b := BranchView{EcommerceBranch: branch, History: []Plan{}}
		if branch.ConfigJSON != "" {
			if err = json.Unmarshal([]byte(branch.ConfigJSON), &b.Config); err != nil {
				return nil, err
			}
		}
		if branch.PlanJSON != "" {
			if err = json.Unmarshal([]byte(branch.PlanJSON), &b.Plan); err != nil {
				return nil, err
			}
		}
		if branch.AcceptedPlanJSON != "" {
			if err = json.Unmarshal([]byte(branch.AcceptedPlanJSON), &b.AcceptedPlan); err != nil {
				return nil, err
			}
		}
		if branch.PlanHistoryJSON != "" {
			if err = json.Unmarshal([]byte(branch.PlanHistoryJSON), &b.History); err != nil {
				return nil, err
			}
		}
		v.Branches = append(v.Branches, b)
	}
	slots, err := s.repo.EcommerceSlots(userID, run.ID)
	if err != nil {
		return nil, err
	}
	versions, err := s.repo.EcommerceVersions(userID, run.ID)
	if err != nil {
		return nil, err
	}
	v.Steps, err = s.repo.EcommerceSteps(userID, run.ID)
	if err != nil {
		return nil, err
	}
	for _, slot := range slots {
		out := SlotView{EcommerceSlot: slot, Versions: []model.EcommerceImageVersion{}, QualityChecks: []QualityCheckView{}}
		if slot.RefinementJSON != "" {
			if err = json.Unmarshal([]byte(slot.RefinementJSON), &out.Refinement); err != nil {
				return nil, err
			}
		}
		if slot.DraftJSON != "" {
			if err = json.Unmarshal([]byte(slot.DraftJSON), &out.Draft); err != nil {
				return nil, err
			}
		}
		for _, version := range versions {
			if version.SlotID == slot.ID {
				out.Versions = append(out.Versions, version)
			}
		}
		out.QualityChecks = qualityCheckViews(v.Steps, out.Versions)
		v.Slots = append(v.Slots, out)
	}
	v.Steps, err = s.repo.EcommerceSteps(userID, run.ID)
	if err != nil {
		return nil, err
	}
	auths, err := s.repo.EcommerceAuthorizations(userID, run.ID)
	if err != nil {
		return nil, err
	}
	for _, a := range auths {
		v.OccupiedMicrocredits += a.OccupiedMicrocredits
	}
	v.BudgetMicrocredits, err = authorizedBudgetForSteps(auths, v.Steps)
	if err != nil {
		return nil, err
	}
	for _, step := range v.Steps {
		v.ActualMicrocredits += step.ActualMicrocredits
	}
	return v, nil
}

// Reconfirmation replaces unsubmitted steps' approval. Count each step's
// current price ceiling once while retaining every original audit snapshot.
func authorizedBudgetForSteps(auths []model.EcommerceAuthorization, steps []model.EcommerceStep) (int64, error) {
	counts := map[string]map[string]int64{}
	for _, step := range steps {
		if step.AuthorizationID == "" || step.Status == "superseded" && step.TaskID == nil {
			continue
		}
		if counts[step.AuthorizationID] == nil {
			counts[step.AuthorizationID] = map[string]int64{}
		}
		counts[step.AuthorizationID][priceKey(step)]++
	}
	var total int64
	for _, auth := range auths {
		if auth.RevokedAt != nil || len(counts[auth.ID]) == 0 {
			continue
		}
		var prices []Price
		if err := json.Unmarshal([]byte(auth.PricesJSON), &prices); err != nil {
			return 0, invalid("授权报价快照无效")
		}
		var ceiling int64
		for _, price := range prices {
			ceiling += counts[auth.ID][price.Key] * price.CapMicrocredits
		}
		if ceiling > auth.BudgetMicrocredits {
			ceiling = auth.BudgetMicrocredits
		}
		total += ceiling
	}
	return total, nil
}
func checkGuard(product *model.EcommerceProduct, guard Guard) error {
	if !validField(guard.OperationID, 120, false) {
		return invalid("操作标识无效")
	}
	if guard.Revision != product.Revision {
		return conflict("商品已更新，请刷新后继续")
	}
	return nil
}
func readError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("商品记录不存在或不属于当前账号")
	}
	return err
}
func (s *Service) UpdateProduct(userID, id string, req ProductRequest) (*ProductView, error) {
	err := s.host.WithStorageLock(func() error {
		return s.repo.MutateEcommerce(userID, id, func(p *model.EcommerceProduct, repo *repository.Repository) error {
			if replay, e := replayed(repo, userID, id, req.OperationID, req); e != nil || replay {
				return e
			}
			if err := checkGuard(p, req.Guard); err != nil {
				return err
			}
			if req.Archived != nil {
				p.Archived = *req.Archived
				if p.Archived {
					if e := repo.PauseEcommerceProduct(userID, p.ID, "商品已归档"); e != nil {
						return e
					}
				}
			} else {
				if !validField(req.Name, 200, false) || !validField(req.SellingPoints, 8000, true) {
					return invalid("商品名称或卖点无效")
				}
				p.Name = strings.TrimSpace(req.Name)
				p.SellingPoints = strings.TrimSpace(req.SellingPoints)
				if req.Config != nil {
					if e := ValidateConfig(*req.Config); e != nil {
						return e
					}
					if e := s.host.ValidateConfig(userID, *req.Config); e != nil {
						return e
					}
					p.ConfigJSON = encode(req.Config)
				}
			}
			p.Revision++
			if e := s.host.StorageQuota(repo, userID, int64(len(encode(req)))); e != nil {
				return e
			}
			return remember(repo, userID, id, req.OperationID, req)
		})
	})
	if err != nil {
		return nil, err
	}
	return s.Product(userID, id)
}
func (s *Service) DeleteDraft(userID, id string, guard Guard) error {
	return s.repo.MutateEcommerce(userID, "", func(_ *model.EcommerceProduct, repo *repository.Repository) error {
		if replay, e := replayed(repo, userID, id, guard.OperationID, guard); e != nil || replay {
			return e
		}
		p, e := repo.EcommerceProduct(userID, id)
		if e != nil {
			return readError(e)
		}
		if err := checkGuard(p, guard); err != nil {
			return err
		}
		if p.CurrentRunID != "" {
			return conflict("有生成记录的商品请归档")
		}
		if e := repo.DeleteEcommerceDraft(userID, id); e != nil {
			return e
		}
		return remember(repo, userID, id, guard.OperationID, guard)
	})
}
func replayed(repo *repository.Repository, userID, productID, operationID string, request any) (bool, error) {
	old, err := repo.EcommerceOperation(userID, operationID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if old.ProductID != productID || old.RequestHash != Hash(request) {
		return false, conflict("操作标识已用于其它请求")
	}
	return true, nil
}
func remember(repo *repository.Repository, userID, productID, operationID string, request any) error {
	return repo.SaveEcommerceOperation(&model.EcommerceOperation{ID: newID(), UserID: userID, ProductID: productID, OperationID: operationID, RequestHash: Hash(request), ResponseJSON: encode(map[string]string{"productId": productID})})
}
func (s *Service) Presets(userID string) ([]PresetView, error) {
	items, err := s.repo.EcommercePresets(userID)
	if err != nil {
		return nil, err
	}
	out := []PresetView{}
	for _, item := range items {
		v := PresetView{EcommercePreset: item}
		if err := json.Unmarshal([]byte(item.ConfigJSON), &v.Config); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}
func (s *Service) SavePreset(userID string, req PresetRequest) (*PresetView, error) {
	if !validField(req.Name, 120, false) || !validField(req.OperationID, 120, false) {
		return nil, invalid("预设名称无效")
	}
	if err := ValidateConfig(req.Config); err != nil {
		return nil, err
	}
	var saved model.EcommercePreset
	err := s.host.WithStorageLock(func() error {
		return s.repo.MutateEcommerce(userID, "", func(_ *model.EcommerceProduct, repo *repository.Repository) error {
			items, e := repo.EcommercePresets(userID)
			if e != nil {
				return e
			}
			saved = model.EcommercePreset{ID: newID(), UserID: userID, Name: strings.TrimSpace(req.Name), Revision: 1, ConfigJSON: encode(req.Config)}
			found := false
			for _, item := range items {
				if item.Name == saved.Name {
					found = true
					if replay, e := replayed(repo, userID, item.ID, req.OperationID, req); e != nil || replay {
						saved = item
						return e
					}
					if item.Revision != req.Revision {
						return conflict("预设已更新")
					}
					saved.ID = item.ID
					saved.CreatedAt = item.CreatedAt
					saved.Revision = item.Revision + 1
				}
			}
			if !found && req.Revision != 0 {
				return conflict("预设不存在，请重新保存")
			}
			if e := s.host.ValidateConfig(userID, req.Config); e != nil {
				return e
			}
			if e := s.host.StorageQuota(repo, userID, int64(len(saved.ConfigJSON))); e != nil {
				return e
			}
			if e := repo.SaveEcommercePreset(&saved); e != nil {
				return e
			}
			return remember(repo, userID, saved.ID, req.OperationID, req)
		})
	})
	if err != nil {
		return nil, err
	}
	return &PresetView{EcommercePreset: saved, Config: req.Config}, nil
}
func (s *Service) DeletePreset(userID, id string, guard Guard) error {
	if !validField(guard.OperationID, 120, false) {
		return invalid("操作标识无效")
	}
	return s.repo.MutateEcommerce(userID, "", func(_ *model.EcommerceProduct, repo *repository.Repository) error {
		if replay, e := replayed(repo, userID, id, guard.OperationID, guard); e != nil || replay {
			return e
		}
		items, e := repo.EcommercePresets(userID)
		if e != nil {
			return e
		}
		for _, item := range items {
			if item.ID == id {
				if item.Revision != guard.Revision {
					return conflict("预设已更新，请刷新")
				}
				if e = repo.DeleteEcommercePreset(userID, id); e != nil {
					return e
				}
				return remember(repo, userID, id, guard.OperationID, guard)
			}
		}
		return kernel.NotFound("预设不存在或不属于当前账号")
	})
}

// Personal defaults share the versioned preset store and the same ownership,
// quota and operation-deduplication contract.
func (s *Service) Preferences(userID string) (*PresetView, error) {
	items, err := s.Presets(userID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].Name == "default" {
			return &items[i], nil
		}
	}
	settings, err := s.Settings()
	if err != nil {
		return nil, err
	}
	return &PresetView{EcommercePreset: model.EcommercePreset{UserID: userID, Name: "default"}, Config: settings.Defaults}, nil
}
func (s *Service) SavePreferences(userID string, req PresetRequest) (*PresetView, error) {
	req.Name = "default"
	return s.SavePreset(userID, req)
}
