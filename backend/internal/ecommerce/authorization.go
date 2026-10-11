package ecommerce

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type authorizationScope struct {
	Scope
	StepIDs []string `json:"stepIds"`
}

func productSnapshot(p *model.EcommerceProduct) map[string]any {
	return map[string]any{"name": p.Name, "confirmedSellingPoints": p.SellingPoints, "sourceResourceId": p.SourceResourceID}
}
func runConfig(run *model.EcommerceRun) (Config, error) {
	var config Config
	err := json.Unmarshal([]byte(run.ConfigJSON), &config)
	return config, err
}
func isNewRun(action string) bool {
	return slices.Contains([]string{"planning", "auto", "redo-review", "redo-auto"}, action)
}
func priceKey(step model.EcommerceStep) string {
	switch step.Kind {
	case "plan":
		return "plan:" + step.BranchKind
	case "image":
		return "image:" + step.BranchKind
	default:
		return step.Kind
	}
}
func newStep(run *model.EcommerceRun, kind, branch, slot string, generation int) model.EcommerceStep {
	key := fmt.Sprintf("%s:%s:%s:%d", kind, branch, slot, generation)
	return model.EcommerceStep{ID: newID(), UserID: run.UserID, ProductID: run.ProductID, RunID: run.ID, Kind: kind, BranchKind: branch, SlotID: slot, Generation: generation, StageKey: key, Status: "pending"}
}
func addImageSteps(run *model.EcommerceRun, slot model.EcommerceSlot, refine bool) []model.EcommerceStep {
	steps := []model.EcommerceStep{}
	if refine {
		steps = append(steps, newStep(run, "refine", slot.Kind, slot.ID, slot.Generation))
	}
	steps = append(steps, newStep(run, "image", slot.Kind, slot.ID, slot.Generation))
	return steps
}
func (s *Service) newRun(repo *repository.Repository, p *model.EcommerceProduct, config Config, action string) (*model.EcommerceRun, []model.EcommerceStep, error) {
	old, err := repo.EcommerceRuns(p.UserID, p.ID)
	if err != nil {
		return nil, nil, err
	}
	if p.CurrentRunID != "" {
		if e := repo.PauseEcommerceProduct(p.UserID, p.ID, "已开始新轮次；原轮次仅收尾"); e != nil {
			return nil, nil, e
		}
	}
	mode := "review"
	if action == "auto" || action == "redo-auto" {
		mode = "auto"
	}
	run := &model.EcommerceRun{ID: newID(), UserID: p.UserID, ProductID: p.ID, Number: len(old) + 1, Revision: 1, Status: "queued", Mode: mode, ConfigJSON: encode(config), ProductSnapshotJSON: encode(productSnapshot(p)), TitlesJSON: encode(titleState{Current: []string{}, Versions: [][]string{}})}
	if err := repo.SaveEcommerceRun(run); err != nil {
		return nil, nil, err
	}
	steps := []model.EcommerceStep{newStep(run, "title", "", "", 1)}
	for _, kind := range []string{"hero", "detail"} {
		branch := &model.EcommerceBranch{ID: newID(), UserID: p.UserID, RunID: run.ID, Kind: kind, Revision: 1, Status: "pending", PlanHistoryJSON: "[]", ConfigJSON: encode(config)}
		if err := repo.SaveEcommerceBranch(branch); err != nil {
			return nil, nil, err
		}
		steps = append(steps, newStep(run, "plan", kind, "", 1))
		for i := 1; i <= outputFor(config, kind).Count; i++ {
			slot := model.EcommerceSlot{ID: newID(), UserID: p.UserID, RunID: run.ID, Kind: kind, Index: i, Revision: 1, Status: "pending", Generation: 1}
			if err := repo.SaveEcommerceSlot(&slot); err != nil {
				return nil, nil, err
			}
			steps = append(steps, addImageSteps(run, slot, true)...)
		}
	}
	for i := range steps {
		if err := repo.SaveEcommerceStep(&steps[i]); err != nil {
			return nil, nil, err
		}
	}
	p.CurrentRunID = run.ID
	p.ConfigJSON = encode(config)
	return run, steps, nil
}
func prospectiveKeys(config Config, scope Scope) (map[string]int, error) {
	keys := map[string]int{}
	if isNewRun(scope.Action) {
		keys["plan:hero"] = 1
		keys["plan:detail"] = 1
		keys["title"] = 1
		if scope.Action == "auto" || scope.Action == "redo-auto" {
			keys["refine"] = config.Hero.Count + config.Detail.Count
			keys["image:hero"] = config.Hero.Count
			keys["image:detail"] = config.Detail.Count
		}
		return keys, nil
	}
	return keys, nil
}
func (s *Service) quotedSteps(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, scope Scope) ([]model.EcommerceStep, error) {
	if run == nil {
		return nil, invalid("请先生成方案")
	}
	steps, err := repo.EcommerceSteps(p.UserID, run.ID)
	if err != nil {
		return nil, err
	}
	out := []model.EcommerceStep{}
	switch scope.Action {
	case "generate":
		if len(scope.Branches) == 0 || len(scope.Branches) > 2 {
			return nil, invalid("请选择主图或详情方案")
		}
		branches, e := repo.EcommerceBranches(p.UserID, run.ID)
		if e != nil {
			return nil, e
		}
		for _, kind := range scope.Branches {
			found := false
			for _, b := range branches {
				if b.Kind == kind && (b.Status == "review" || b.Status == "approved") {
					found = true
				}
			}
			if !found {
				return nil, conflict("所选分支的方案尚未就绪")
			}
		}
		for _, step := range steps {
			if step.TaskID == nil && step.Status == "pending" && (step.Kind == "refine" || step.Kind == "image") && slices.Contains(scope.Branches, step.BranchKind) {
				out = append(out, step)
			}
		}
	case "continue", "apply-config":
		for _, step := range steps {
			if step.TaskID == nil && step.Status == "pending" {
				out = append(out, step)
			}
		}
		if run.Mode == "review" {
			branches, e := repo.EcommerceBranches(p.UserID, run.ID)
			if e != nil {
				return nil, e
			}
			out = slices.DeleteFunc(out, func(step model.EcommerceStep) bool {
				if step.Kind == "plan" || step.Kind == "title" {
					return false
				}
				for _, b := range branches {
					if b.Kind == step.BranchKind {
						return b.ApprovedAt == nil
					}
				}
				return true
			})
		}
	case "redo-image":
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return nil, e
		}
		found := false
		for _, slot := range slots {
			if slot.ID == scope.SlotID {
				found = true
				if slot.RefinementJSON == "" && slot.DraftJSON == "" {
					return nil, conflict("请先完成单图细化")
				}
				for _, step := range steps {
					if step.SlotID == slot.ID && (step.Status == "submitted" || step.Status == "uncertain") {
						return nil, conflict("原任务正在执行或结果待核对，请先查询原任务")
					}
				}
				out = addImageSteps(run, model.EcommerceSlot{ID: slot.ID, Kind: slot.Kind, Generation: slot.Generation + 1}, false)
			}
		}
		if !found {
			return nil, invalid("图片槽位不存在")
		}
	case "redo-titles":
		generation := 1
		for _, step := range steps {
			if step.Kind == "title" && (step.Status == "submitted" || step.Status == "uncertain") {
				return nil, conflict("原标题任务正在执行或结果待核对")
			}
		}
		for _, step := range steps {
			if step.Kind == "title" && step.Generation >= generation {
				generation = step.Generation + 1
			}
		}
		out = append(out, newStep(run, "title", "", "", generation))
	case "append":
		config, e := runConfig(run)
		if e != nil {
			return nil, e
		}
		if scope.AdditionalHero < 0 || scope.AdditionalDetail < 0 || scope.AdditionalHero+scope.AdditionalDetail < 1 || config.Hero.Count+scope.AdditionalHero > 20 || config.Detail.Count+scope.AdditionalDetail > 20 {
			return nil, invalid("补充数量无效，每个分支最多 20 张")
		}
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return nil, e
		}
		for _, slot := range slots {
			if slot.RefinementJSON == "" {
				return nil, conflict("请先完成现有图片的细化，再追加图片")
			}
		}
		for _, kind := range []string{"hero", "detail"} {
			count := scope.AdditionalHero
			if kind == "detail" {
				count = scope.AdditionalDetail
			}
			if count == 0 {
				continue
			}
			branch, e := findBranch(repo, p.UserID, run.ID, kind)
			if e != nil {
				return nil, e
			}
			if branch.AcceptedPlanJSON == "" {
				return nil, conflict("请先确认现有方案")
			}
			out = append(out, newStep(run, "plan", kind, "", int(branch.Revision)+1))
		}
	case "retry-step":
		for _, step := range steps {
			if step.ID == scope.StepID {
				if step.Status != "failed" {
					return nil, conflict("只能重试已明确失败的步骤；结果不明请恢复原任务")
				}
				generation := step.Generation + 1
				for _, other := range steps {
					if other.Kind == step.Kind && other.SlotID == step.SlotID && other.BranchKind == step.BranchKind && other.Generation >= generation {
						generation = other.Generation + 1
					}
				}
				retry := newStep(run, step.Kind, step.BranchKind, step.SlotID, generation)
				out = append(out, retry)
				if retry.Kind == "refine" {
					out = append(out, newStep(run, "image", retry.BranchKind, retry.SlotID, generation))
				}
			}
		}
		if len(out) == 0 {
			return nil, invalid("失败步骤不存在")
		}
	default:
		return nil, invalid("报价操作无效")
	}
	if len(out) == 0 {
		return nil, conflict("没有待授权的步骤")
	}
	return out, nil
}
func (s *Service) Quote(userID, productID string, req QuoteRequest) (*QuoteView, error) {
	var quote *QuoteView
	err := s.host.WithStorageLock(func() error {
		return s.repo.MutateEcommerce(userID, productID, func(p *model.EcommerceProduct, repo *repository.Repository) error {
			if req.Revision != p.Revision {
				return conflict("商品已更新，请刷新后重新报价")
			}
			if p.Archived {
				return conflict("请先取消归档")
			}
			if e := s.host.Require(repo, userID); e != nil {
				return e
			}
			var config Config
			var run *model.EcommerceRun
			var err error
			if e := json.Unmarshal([]byte(p.ConfigJSON), &config); e != nil {
				return e
			}
			if p.CurrentRunID != "" {
				run, err = repo.EcommerceRun(userID, p.CurrentRunID)
				if err != nil {
					return err
				}
				if !isNewRun(req.Action) {
					config, err = runConfig(run)
					if err != nil {
						return err
					}
				}
			}
			if req.Config != nil {
				if !isNewRun(req.Action) && req.Action != "apply-config" {
					return invalid("模型或规格变更必须显式应用并重新报价")
				}
				config = *req.Config
			}
			if e := ValidateConfig(config); e != nil {
				return e
			}
			if e := s.host.ValidateConfig(userID, config); e != nil {
				return e
			}
			// Freeze future defaults for a new round rather than reusing the
			// previous round's immutable settings.
			if isNewRun(req.Action) {
				req.Scope.Config = &config
			}
			keys, _ := prospectiveKeys(config, req.Scope)
			if !isNewRun(req.Action) {
				items, e := s.quotedSteps(repo, p, run, req.Scope)
				if e != nil {
					return e
				}
				for _, step := range items {
					keys[priceKey(step)]++
				}
			}
			prices := []Price{}
			estimated, budget := int64(0), int64(0)
			textCalls, imageCalls := 0, 0
			for _, key := range []string{"plan:hero", "plan:detail", "title", "refine", "image:hero", "image:detail"} {
				calls := keys[key]
				if calls == 0 {
					continue
				}
				kind := key
				prompt := TitlePrompt(productSnapshot(p), config)
				if key == "plan:hero" || key == "plan:detail" {
					prompt = MasterPrompt(productSnapshot(p), config, strings.TrimPrefix(key, "plan:"), nil, nil)
				}
				if key == "refine" {
					prompt = "根据已确认商品方案逐图细化；" + encode(productSnapshot(p))
				}
				if strings.HasPrefix(key, "image:") {
					prompt = "根据商品原图和已经确认的方案生成单张商品图片。"
					imageCalls += calls
				} else {
					textCalls += calls
				}
				prepared, e := s.host.Prepare(userID, Intent{Kind: kind, Config: config, ResourceID: p.SourceResourceID, Prompt: prompt}, nil)
				if e != nil {
					return e
				}
				capAmount := prepared.Amount
				if prepared.Estimated {
					upper, e := s.host.Prepare(userID, Intent{Kind: kind, Config: config, ResourceID: p.SourceResourceID, Prompt: strings.Repeat("商", 16000)}, nil)
					if e != nil {
						return e
					}
					capAmount = upper.Amount
				}
				if capAmount < 0 || capAmount > 1_000_000_000_000 || calls > 100 {
					return invalid("报价超出支持范围")
				}
				prices = append(prices, Price{Key: key, Signature: prepared.Signature, EstimatedMicrocredits: prepared.Amount, CapMicrocredits: capAmount, Calls: calls, Estimated: prepared.Estimated})
				estimated += prepared.Amount * int64(calls)
				budget += capAmount * int64(calls)
			}
			if budget > 1_000_000_000_000 || estimated < 0 || estimated > budget {
				return invalid("整套报价超出支持范围，请减少数量或更换模型")
			}
			q := model.EcommerceQuote{ID: newID(), UserID: userID, ProductID: p.ID, ProductRevision: p.Revision, ScopeJSON: encode(req.Scope), PricesJSON: encode(prices), EstimatedMicrocredits: estimated, BudgetMicrocredits: budget, TextCalls: textCalls, ImageCalls: imageCalls, ExpiresAt: expires()}
			if run != nil {
				q.RunID = run.ID
				q.RunRevision = run.Revision
			}
			q.Hash = Hash([]any{q.ScopeJSON, q.PricesJSON, q.ProductRevision, q.RunRevision})
			if e := s.host.StorageQuota(repo, userID, int64(len(q.ScopeJSON)+len(q.PricesJSON))); e != nil {
				return e
			}
			if e := repo.SaveEcommerceQuote(&q); e != nil {
				return e
			}
			quote = &QuoteView{EcommerceQuote: q, Scope: req.Scope, Prices: prices}
			return nil
		})
	})
	return quote, err
}
func (s *Service) authorize(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, quote *model.EcommerceQuote, scope Scope, steps []model.EcommerceStep, budget int64) error {
	if budget < quote.BudgetMicrocredits || budget < 0 || budget > 1_000_000_000_000 {
		return blocked("ecommerce_budget", "预算上限小于当前报价，请重新确认")
	}
	ids := []string{}
	for _, step := range steps {
		ids = append(ids, step.ID)
	}
	auth := &model.EcommerceAuthorization{ID: newID(), UserID: p.UserID, RunID: run.ID, QuoteID: quote.ID, ScopeJSON: encode(authorizationScope{Scope: scope, StepIDs: ids}), PricesJSON: quote.PricesJSON, BudgetMicrocredits: budget, ExpiresAt: time.Now().Add(2 * time.Hour)}
	if e := repo.SaveEcommerceAuthorization(auth); e != nil {
		return e
	}
	for i := range steps {
		step := &steps[i]
		step.AuthorizationID = auth.ID
		if e := repo.SaveEcommerceStep(step); e != nil {
			return e
		}
	}
	now := time.Now()
	quote.ConsumedAt = &now
	return repo.SaveEcommerceQuote(quote)
}
func (s *Service) Command(userID, productID string, req Command) (*ProductView, error) {
	err := s.host.WithStorageLock(func() error {
		return s.repo.MutateEcommerce(userID, productID, func(p *model.EcommerceProduct, repo *repository.Repository) error {
			if replay, e := replayed(repo, userID, productID, req.OperationID, req); e != nil || replay {
				return e
			}
			if e := checkGuard(p, req.Guard); e != nil {
				return e
			}
			var run *model.EcommerceRun
			var e error
			if p.CurrentRunID != "" {
				run, e = repo.EcommerceRun(userID, p.CurrentRunID)
				if e != nil {
					return e
				}
			}
			if req.Action == "pause" {
				if run == nil {
					return invalid("尚无运行轮次")
				}
				run.Status = "paused"
				run.PauseReason = "已暂停；已提交任务继续收尾"
				run.Revision++
				if e := repo.SaveEcommerceRun(run); e != nil {
					return e
				}
			} else if req.Action == "save-plan" || req.Action == "restore-plan" {
				if run == nil {
					return invalid("尚无策划方案")
				}
				if e := s.editPlan(repo, p, run, req); e != nil {
					return e
				}
			} else if req.Action == "save-draft" || req.Action == "select-version" {
				if run == nil {
					return invalid("尚无图片结果")
				}
				if e := s.editSlot(repo, p, run, req); e != nil {
					return e
				}
			} else {
				if req.QuoteID == "" {
					return invalid("请先取得本次操作的报价并确认预算")
				}
				if p.Archived {
					return conflict("请先取消归档")
				}
				if e := s.host.Require(repo, userID); e != nil {
					return e
				}
				quote, e := repo.EcommerceQuote(userID, req.QuoteID)
				if e != nil {
					return readError(e)
				}
				if quote.ProductID != p.ID || quote.ProductRevision != p.Revision || quote.ConsumedAt != nil || !quote.ExpiresAt.After(time.Now()) {
					return conflict("报价已变化、已使用或已过期，请重新确认")
				}
				var scope Scope
				if e := json.Unmarshal([]byte(quote.ScopeJSON), &scope); e != nil {
					return e
				}
				if scope.Action != req.Action {
					return invalid("操作与报价不匹配")
				}
				var config Config
				if run != nil {
					if quote.RunID != run.ID || quote.RunRevision != run.Revision {
						return conflict("运行状态已更新，请重新报价")
					}
					config, e = runConfig(run)
				} else {
					e = json.Unmarshal([]byte(p.ConfigJSON), &config)
				}
				if e != nil {
					return e
				}
				if scope.Config != nil {
					config = *scope.Config
				}
				steps := []model.EcommerceStep{}
				if isNewRun(req.Action) {
					if run != nil && req.Action != "redo-review" && req.Action != "redo-auto" {
						return conflict("已有轮次，请选择整套重做")
					}
					run, steps, e = s.newRun(repo, p, config, req.Action)
					if e != nil {
						return e
					}
					if run.Mode == "review" {
						steps = slices.DeleteFunc(steps, func(step model.EcommerceStep) bool { return step.Kind != "plan" && step.Kind != "title" })
					}
				} else {
					steps, e = s.quotedSteps(repo, p, run, scope)
					if e != nil {
						return e
					}
					if req.Action == "generate" {
						if e = s.acceptBranches(repo, p, run, scope.Branches); e != nil {
							return e
						}
					}
					if req.Action == "apply-config" {
						if e = s.applyConfig(repo, p, run, config); e != nil {
							return e
						}
					}
					if req.Action == "redo-image" {
						slots, e := repo.EcommerceSlots(userID, run.ID)
						if e != nil {
							return e
						}
						for _, slot := range slots {
							if slot.ID == scope.SlotID {
								slot.Generation++
								slot.Revision++
								slot.Status = "pending"
								if e := repo.SaveEcommerceSlot(&slot); e != nil {
									return e
								}
							}
						}
					}
					if req.Action == "retry-step" {
						if e = s.prepareRetry(repo, p, run, scope, steps); e != nil {
							return e
						}
					}
					if req.Action == "append" {
						if e = s.appendSlots(repo, p, run, scope); e != nil {
							return e
						}
					}
				}
				if e := s.authorize(repo, p, run, quote, scope, steps, req.BudgetMicrocredits); e != nil {
					return e
				}
				run.Status = "queued"
				run.PauseReason = ""
				run.Revision++
				run.NextCheckAt = time.Now()
				if e := repo.SaveEcommerceRun(run); e != nil {
					return e
				}
			}
			p.Revision++
			if e := s.host.StorageQuota(repo, userID, int64(len(encode(req))+32000)); e != nil {
				return e
			}
			return remember(repo, userID, productID, req.OperationID, req)
		})
	})
	if err != nil {
		return nil, readError(err)
	}
	s.host.Wake()
	return s.Product(userID, productID)
}
func (s *Service) BatchCommand(userID string, items []BatchCommandItem) ([]BatchResult, error) {
	settings, e := s.Settings()
	if e != nil {
		return nil, e
	}
	if len(items) < 1 || len(items) > settings.BatchLimit {
		return nil, invalid("批量操作数量超限")
	}
	out := []BatchResult{}
	seen := map[string]bool{}
	for _, item := range items {
		if seen[item.ProductID] {
			out = append(out, BatchResult{ProductID: item.ProductID, Status: "skipped", Reason: "同一商品重复选择"})
			continue
		}
		seen[item.ProductID] = true
		p, e := s.Command(userID, item.ProductID, item.Command)
		result := BatchResult{ProductID: item.ProductID, Status: "success", Product: p}
		if e != nil {
			result.Status = "failed"
			result.Reason = e.Error()
		}
		out = append(out, result)
	}
	return out, nil
}
func findBranch(repo *repository.Repository, userID, runID, kind string) (*model.EcommerceBranch, error) {
	items, e := repo.EcommerceBranches(userID, runID)
	if e != nil {
		return nil, e
	}
	for _, item := range items {
		if item.Kind == kind {
			return &item, nil
		}
	}
	return nil, invalid("策划分支不存在")
}
func (s *Service) acceptBranches(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, kinds []string) error {
	slots, e := repo.EcommerceSlots(p.UserID, run.ID)
	if e != nil {
		return e
	}
	config, e := runConfig(run)
	if e != nil {
		return e
	}
	for _, kind := range kinds {
		b, e := findBranch(repo, p.UserID, run.ID, kind)
		if e != nil {
			return e
		}
		branchConfig := config
		if b.ConfigJSON != "" {
			if e := json.Unmarshal([]byte(b.ConfigJSON), &branchConfig); e != nil {
				return e
			}
		}
		var plan Plan
		if e = json.Unmarshal([]byte(b.PlanJSON), &plan); e != nil {
			return invalid("方案无效")
		}
		if e = ValidatePlan(&plan, slots, branchConfig, kind); e != nil {
			return e
		}
		b.AcceptedPlanJSON = encode(plan)
		b.AcceptedRevision = b.Revision
		b.Status = "approved"
		now := time.Now()
		b.ApprovedAt = &now
		if e := repo.SaveEcommerceBranch(b); e != nil {
			return e
		}
		for _, screen := range plan.Screens {
			for i := range slots {
				slot := &slots[i]
				if slot.ID == screen.SlotID && slot.RefinementJSON == "" {
					slot.Title = screen.Title
					slot.Copy = screen.Copy
					slot.Revision++
					if e := repo.SaveEcommerceSlot(slot); e != nil {
						return e
					}
				}
			}
		}
	}
	return nil
}
func (s *Service) editPlan(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, req Command) error {
	b, e := findBranch(repo, p.UserID, run.ID, req.Branch)
	if e != nil {
		return e
	}
	if b.Revision != req.BranchRevision {
		return conflict("方案已更新")
	}
	if b.ApprovedAt != nil {
		return conflict("方案已确认；如需改动请整套重做")
	}
	if b.Status != "review" {
		return conflict("请等待策划完成")
	}
	plan := req.Plan
	if req.Action == "restore-plan" {
		var history []Plan
		if e := json.Unmarshal([]byte(b.PlanHistoryJSON), &history); e != nil {
			return e
		}
		if len(history) == 0 {
			return conflict("没有可恢复的策划版本")
		}
		plan = &history[len(history)-1]
	}
	if plan == nil {
		return invalid("请提交完整方案")
	}
	slots, e := repo.EcommerceSlots(p.UserID, run.ID)
	if e != nil {
		return e
	}
	config, e := runConfig(run)
	if e != nil {
		return e
	}
	if e := ValidatePlan(plan, slots, config, b.Kind); e != nil {
		return e
	}
	history := []Plan{}
	_ = json.Unmarshal([]byte(b.PlanHistoryJSON), &history)
	var old Plan
	_ = json.Unmarshal([]byte(b.PlanJSON), &old)
	history = append(history, old)
	b.PlanHistoryJSON = encode(history)
	b.PlanJSON = encode(plan)
	b.Revision++
	run.Revision++
	if e := repo.SaveEcommerceRun(run); e != nil {
		return e
	}
	return repo.SaveEcommerceBranch(b)
}
func (s *Service) editSlot(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, req Command) error {
	slots, e := repo.EcommerceSlots(p.UserID, run.ID)
	if e != nil {
		return e
	}
	for _, slot := range slots {
		if slot.ID != req.SlotID {
			continue
		}
		if slot.Revision != req.SlotRevision {
			return conflict("单图已更新")
		}
		if req.Action == "select-version" {
			versions, e := repo.EcommerceVersions(p.UserID, run.ID)
			if e != nil {
				return e
			}
			found := false
			for _, v := range versions {
				if v.ID == req.VersionID && v.SlotID == slot.ID {
					slot.SelectedVersionID = v.ID
					found = true
				}
			}
			if !found {
				return invalid("图片版本不存在")
			}
		} else {
			steps, e := repo.EcommerceSteps(p.UserID, run.ID)
			if e != nil {
				return e
			}
			for _, step := range steps {
				if step.SlotID == slot.ID && (step.Status == "submitted" || step.Status == "uncertain") {
					return conflict("本图任务正在执行或结果待核对")
				}
			}
			if req.Draft == nil || req.Draft.SlotID != slot.ID || req.Draft.Kind != slot.Kind || !validField(req.Draft.Prompt, 16000, false) || !validField(req.Draft.Copy, 4000, true) {
				return invalid("调整草稿无效")
			}
			config, e := runConfig(run)
			if e != nil {
				return e
			}
			if outputFor(config, slot.Kind).CopyMode == "none" && req.Draft.Copy != "" {
				return invalid("纯图不能添加排版文案")
			}
			var draft Refinement
			if slot.RefinementJSON == "" {
				return conflict("请先完成本图细化")
			}
			if e := json.Unmarshal([]byte(slot.RefinementJSON), &draft); e != nil {
				return e
			}
			draft.Prompt, draft.Copy = req.Draft.Prompt, req.Draft.Copy
			if !validField(imagePrompt(draft, config, slot.Kind), 16000, false) {
				return invalid("调整提示词与文案合计过长，请精简后再保存")
			}
			slot.DraftJSON = encode(draft)
		}
		slot.Revision++
		run.Revision++
		if e := repo.SaveEcommerceRun(run); e != nil {
			return e
		}
		return repo.SaveEcommerceSlot(&slot)
	}
	return invalid("图片槽位不存在")
}
func (s *Service) applyConfig(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, config Config) error {
	old, e := runConfig(run)
	if e != nil {
		return e
	}
	if old.Hero.Count != config.Hero.Count || old.Detail.Count != config.Detail.Count {
		return invalid("追加图片请使用补充策划；减少数量请新建轮次")
	}
	if old.Style != config.Style || old.Language != config.Language || old.Platform != config.Platform || old.Market != config.Market || old.Hero.CopyMode != config.Hero.CopyMode || old.Detail.CopyMode != config.Detail.CopyMode || old.PlanningInstructions != config.PlanningInstructions || old.RefinementInstructions != config.RefinementInstructions || old.GenerationInstructions != config.GenerationInstructions {
		return invalid("已经确认的视觉规则需通过新轮次重新策划；此操作只调整未派发步骤的模型和规格")
	}
	steps, e := repo.EcommerceSteps(p.UserID, run.ID)
	if e != nil {
		return e
	}
	for _, step := range steps {
		if step.TaskID != nil {
			continue
		}
		step.RequestJSON = ""
		if e := repo.SaveEcommerceStep(&step); e != nil {
			return e
		}
	}
	run.ConfigJSON = encode(config)
	p.ConfigJSON = encode(config)
	return nil
}
func (s *Service) prepareRetry(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, scope Scope, steps []model.EcommerceStep) error {
	all, e := repo.EcommerceSteps(p.UserID, run.ID)
	if e != nil {
		return e
	}
	for _, old := range all {
		if old.ID == scope.StepID || (len(steps) > 0 && steps[0].SlotID != "" && old.SlotID == steps[0].SlotID && old.TaskID == nil) {
			old.Status = "superseded"
			if e := repo.SaveEcommerceStep(&old); e != nil {
				return e
			}
		}
	}
	for i := range steps {
		step := &steps[i]
		if step.Kind == "image" || step.Kind == "refine" {
			slots, e := repo.EcommerceSlots(p.UserID, run.ID)
			if e != nil {
				return e
			}
			for _, slot := range slots {
				if slot.ID == step.SlotID {
					slot.Generation = step.Generation
					slot.Status = "pending"
					slot.Revision++
					if step.Kind == "refine" {
						slot.RefinementJSON = ""
					}
					if e := repo.SaveEcommerceSlot(&slot); e != nil {
						return e
					}
				}
			}
		}
		if step.Kind == "plan" {
			b, e := findBranch(repo, p.UserID, run.ID, step.BranchKind)
			if e != nil {
				return e
			}
			if b.ApprovedAt != nil {
				return conflict("已接受的方案不能付费重试")
			}
			b.Status = "pending"
			if e := repo.SaveEcommerceBranch(b); e != nil {
				return e
			}
		}
	}
	return nil
}
func (s *Service) appendSlots(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, scope Scope) error {
	config, e := runConfig(run)
	if e != nil {
		return e
	}
	run.Mode = "review"
	for _, kind := range []string{"hero", "detail"} {
		count := scope.AdditionalHero
		if kind == "detail" {
			count = scope.AdditionalDetail
		}
		if count == 0 {
			continue
		}
		offset := outputFor(config, kind).Count
		for i := 1; i <= count; i++ {
			slot := model.EcommerceSlot{ID: newID(), UserID: p.UserID, RunID: run.ID, Kind: kind, Index: offset + i, Revision: 1, Status: "pending", Generation: 1}
			if e := repo.SaveEcommerceSlot(&slot); e != nil {
				return e
			}
			for _, step := range addImageSteps(run, slot, true) {
				if e := repo.SaveEcommerceStep(&step); e != nil {
					return e
				}
			}
		}
		if kind == "hero" {
			config.Hero.Count += count
		} else {
			config.Detail.Count += count
		}
		branch, e := findBranch(repo, p.UserID, run.ID, kind)
		if e != nil {
			return e
		}
		branch.Status = "pending"
		branch.Revision++
		if e := repo.SaveEcommerceBranch(branch); e != nil {
			return e
		}
	}
	run.ConfigJSON = encode(config)
	p.ConfigJSON = encode(config)
	return nil
}
