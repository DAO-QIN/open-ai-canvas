package ecommerce

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) RunWorker(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Tick(ctx); err != nil {
				slog.Warn("ecommerce orchestrator", "error", err)
			}
		}
	}
}
func (s *Service) Tick(ctx context.Context) error {
	runs, err := s.repo.ClaimEcommerceRuns(s.owner, 32)
	if err != nil {
		return err
	}
	for _, claimed := range runs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := s.advance(claimed)
		if err != nil {
			slog.Warn("ecommerce run reconcile", "product", claimed.ProductID, "run", claimed.ID, "error", err)
		}
		next := time.Now().Add(2 * time.Second)
		if claimed.Status == "paused" || claimed.Status == "review" || claimed.Status == "blocked" {
			next = time.Now().Add(10 * time.Second)
		}
		if e := s.repo.FinishEcommerceLease(claimed.UserID, claimed.ID, s.owner, claimed.LeaseEpoch, next); e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) advance(claimed model.EcommerceRun) error {
	return s.host.WithStorageLock(func() error {
		return s.repo.MutateEcommerce(claimed.UserID, claimed.ProductID, func(p *model.EcommerceProduct, repo *repository.Repository) error {
			run, err := repo.EcommerceRun(p.UserID, claimed.ID)
			if err != nil {
				return err
			}
			if run.LeaseOwner != s.owner || run.LeaseEpoch != claimed.LeaseEpoch || run.LeaseExpiresAt == nil || run.LeaseExpiresAt.Before(time.Now()) {
				return nil
			}
			steps, err := repo.EcommerceSteps(p.UserID, run.ID)
			if err != nil {
				return err
			}
			changed := false
			for i := range steps {
				step := &steps[i]
				if step.TaskID == nil {
					continue
				}
				task, e := repo.TaskForUser(p.UserID, *step.TaskID)
				if e != nil {
					return e
				}
				if task.EcommerceStepID == nil || *task.EcommerceStepID != step.ID {
					return errors.New("ecommerce task linkage mismatch")
				}
				if e := s.reconcileBilling(repo, step, task); e != nil {
					return e
				}
				if step.Status != "submitted" && step.Status != "uncertain" {
					continue
				}
				if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
					continue
				}
				if task.Status == model.TaskStatusSucceeded {
					completion, e := s.host.Completion(task)
					if e == nil {
						e = s.acceptResult(repo, p, run, step, completion)
					}
					if e != nil {
						step.Status = "failed"
						step.ErrorCode = "invalid_result"
						step.Error = "结果未通过结构校验，已保留原始响应；请调整后明确重试"
						if step.RawResponse == "" {
							step.RawResponse = completion.Text
						}
						if e := s.markFailedOutput(repo, p, run, *step); e != nil {
							return e
						}
					} else {
						step.Status = "succeeded"
						step.Error = ""
						step.ErrorCode = ""
					}
				} else {
					uncertain := task.MediaRecoveryJSON != "" || step.BillingStatus == string(model.BillingStatusUncertain)
					var diagnostic model.TaskExecutionDiagnostic
					_ = json.Unmarshal([]byte(task.ExecutionDiagnosticJSON), &diagnostic)
					if diagnostic.SubmissionOutcome == "unknown" || diagnostic.SubmissionOutcome == "uncertain" {
						uncertain = true
					}
					if uncertain {
						step.Status = "uncertain"
						step.ErrorCode = "result_uncertain"
						step.Error = "原任务结果待核对，请查询或恢复原任务，不要重复生成"
					} else {
						step.Status = "failed"
						step.ErrorCode = "model_failed"
						step.Error = "模型任务已失败，成品已保留；重试前需要重新确认费用"
					}
					if e := s.markFailedOutput(repo, p, run, *step); e != nil {
						return e
					}
				}
				if err := s.host.StorageQuota(repo, p.UserID, int64(len(step.RawResponse)+len(step.ResultJSON))); err != nil {
					return err
				}
				if e := repo.SaveEcommerceStep(step); e != nil {
					return e
				}
				changed = true
			}
			if changed {
				run.Revision++
				p.Revision++
			}
			if e := s.host.Require(repo, p.UserID); e != nil {
				if run.Status != "paused" {
					run.Status = "paused"
					run.PauseReason = "商品套图已关闭；已提交任务继续收尾，开放后请手动继续"
					run.Revision++
					p.Revision++
				}
				return repo.SaveEcommerceRun(run)
			}
			if p.Archived || p.CurrentRunID != run.ID || run.Status == "paused" || run.Status == "blocked" {
				return repo.SaveEcommerceRun(run)
			}
			settings, e := s.Settings()
			if e != nil {
				return e
			}
			// One pass admits at most one step per product, allowing other users and
			// products their next turn before this product fills its capacity.
			for i := range steps {
				step := &steps[i]
				if step.TaskID != nil || step.Status != "pending" || step.AuthorizationID == "" {
					continue
				}
				intent, ready, e := s.stepIntent(repo, p, run, *step)
				if e != nil {
					step.Status = "failed"
					step.ErrorCode = "invalid_plan"
					step.Error = e.Error()
					if e := repo.SaveEcommerceStep(step); e != nil {
						return e
					}
					changed = true
					continue
				}
				if !ready {
					continue
				}
				capacity, e := repo.EcommerceCapacity(p.UserID, p.ID)
				if e != nil {
					return e
				}
				active, e := repo.EcommerceProductHasActiveTask(p.UserID, p.ID)
				if e != nil {
					return e
				}
				if capacity.Products >= int64(settings.ProductConcurrency) && !active {
					break
				}
				if step.Kind == "image" {
					if capacity.Images >= int64(settings.ImageConcurrency) || capacity.ProductImages >= int64(settings.ProductImageConcurrency) {
						continue
					}
				} else if capacity.Text >= int64(settings.TextConcurrency) {
					continue
				}
				if e := s.admitStep(repo, p, run, step, intent); e != nil {
					if errors.Is(e, repository.ErrActiveTaskLimit) {
						break
					}
					slog.Warn("ecommerce step admission blocked", "product", p.ID, "run", run.ID, "step", step.ID, "error", e)
					run.Status = "blocked"
					run.PauseReason = safeBlock(e)
					run.Revision++
					p.Revision++
					break
				}
				s.host.Wake()
				changed = true
				break
			}
			if changed && run.Status != "blocked" {
				run.Revision++
			}
			if run.Status != "blocked" {
				status, e := s.deriveStatus(repo, p, run)
				if e != nil {
					return e
				}
				run.Status = status
			}
			return repo.SaveEcommerceRun(run)
		})
	})
}
func safeBlock(err error) string {
	var appErr *kernel.AppError
	if errors.As(err, &appErr) {
		return appErr.Message
	}
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return "积分不足，请补充积分后重新确认费用"
	}
	return "后续步骤暂未派发，请检查模型、预算或积分后重新确认；已完成结果已保留"
}
func (s *Service) reconcileBilling(repo *repository.Repository, step *model.EcommerceStep, task *model.Task) error {
	if task.BillingOrderID == "" {
		return nil
	}
	order, e := repo.BillingOrder(task.BillingOrderID)
	if e != nil {
		return e
	}
	if order.UserID != step.UserID || order.TaskID != task.ID {
		return errors.New("ecommerce billing linkage mismatch")
	}
	if step.BillingStatus == string(order.Status) && step.ActualMicrocredits == order.ActualAmountMicrocredits {
		return nil
	}
	occupied := step.ReservedMicrocredits
	if order.Status == model.BillingStatusSettled {
		occupied = order.ActualAmountMicrocredits
	} else if order.Status == model.BillingStatusRefunded {
		occupied = 0
	}
	if occupied != step.ReservedMicrocredits {
		auths, e := repo.EcommerceAuthorizations(step.UserID, step.RunID)
		if e != nil {
			return e
		}
		for _, auth := range auths {
			if auth.ID == step.AuthorizationID {
				auth.OccupiedMicrocredits += occupied - step.ReservedMicrocredits
				if auth.OccupiedMicrocredits < 0 {
					return errors.New("negative ecommerce budget occupancy")
				}
				if e := repo.SaveEcommerceAuthorization(&auth); e != nil {
					return e
				}
			}
		}
		step.ReservedMicrocredits = occupied
	}
	step.ActualMicrocredits = order.ActualAmountMicrocredits
	step.BillingStatus = string(order.Status)
	return repo.SaveEcommerceStep(step)
}
func (s *Service) admitStep(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, step *model.EcommerceStep, intent Intent) error {
	next := *step
	err := repo.AdmitEcommerceStep(func(scoped *repository.Repository) error {
		return s.admitStepTransaction(scoped, p, run, &next, intent)
	})
	if err == nil {
		*step = next
	}
	return err
}
func (s *Service) admitStepTransaction(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, step *model.EcommerceStep, intent Intent) error {
	auths, e := repo.EcommerceAuthorizations(p.UserID, run.ID)
	if e != nil {
		return e
	}
	var auth *model.EcommerceAuthorization
	for i := range auths {
		if auths[i].ID == step.AuthorizationID {
			auth = &auths[i]
		}
	}
	if auth == nil || auth.RevokedAt != nil || auth.ExpiresAt.Before(time.Now()) {
		return blocked("ecommerce_quote_expired", "授权已过期，请重新确认后续预算")
	}
	var scope authorizationScope
	if e := json.Unmarshal([]byte(auth.ScopeJSON), &scope); e != nil {
		return e
	}
	if !slices.Contains(scope.StepIDs, step.ID) {
		return blocked("ecommerce_scope", "该步骤超出已批准范围")
	}
	prices := []Price{}
	if e := json.Unmarshal([]byte(auth.PricesJSON), &prices); e != nil {
		return e
	}
	var price *Price
	for i := range prices {
		if prices[i].Key == priceKey(*step) {
			price = &prices[i]
		}
	}
	if price == nil {
		return blocked("ecommerce_scope", "该步骤没有获批报价")
	}
	intent.StageID = step.ID
	prepared, e := s.host.Prepare(p.UserID, intent, &price.CapMicrocredits)
	if e != nil {
		return e
	}
	if prepared.Signature != price.Signature {
		return blocked("ecommerce_price_changed", "模型或价格已变化，请重新确认后续费用")
	}
	if prepared.Amount > price.CapMicrocredits {
		return blocked("ecommerce_budget", "本步骤费用超过已批准上限，请重新报价")
	}
	// Occupy the charge ceiling, not a lower estimate; terminal settlement
	// releases the difference through the existing billing order.
	capAmount := price.CapMicrocredits
	if auth.OccupiedMicrocredits+capAmount > auth.BudgetMicrocredits {
		return blocked("ecommerce_budget", "本轮预算不足，请重新确认后续费用")
	}
	if e := s.host.Require(repo, p.UserID); e != nil {
		return e
	}
	if e := s.host.Admit(repo, prepared); e != nil {
		return e
	}
	step.TaskID = &prepared.Task.ID
	step.Status = "submitted"
	step.RequestJSON = encode(intent)
	step.PriceSignature = prepared.Signature
	step.ReservedMicrocredits = capAmount
	if prepared.Order != nil {
		step.BillingStatus = string(model.BillingStatusReserved)
	}
	auth.OccupiedMicrocredits += capAmount
	if e := repo.SaveEcommerceAuthorization(auth); e != nil {
		return e
	}
	if e := repo.SaveEcommerceStep(step); e != nil {
		return e
	}
	if step.SlotID != "" {
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return e
		}
		for _, slot := range slots {
			if slot.ID == step.SlotID {
				slot.Status = "submitted"
				slot.Revision++
				if e := repo.SaveEcommerceSlot(&slot); e != nil {
					return e
				}
			}
		}
	}
	slog.Info("ecommerce step admitted", "product", p.ID, "run", run.ID, "step", step.ID, "task", prepared.Task.ID, "billing", prepared.Task.BillingOrderID, "budget", capAmount)
	return nil
}
func (s *Service) stepIntent(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, step model.EcommerceStep) (Intent, bool, error) {
	config, e := runConfig(run)
	if e != nil {
		return Intent{}, false, e
	}
	product := map[string]any{}
	if e := json.Unmarshal([]byte(run.ProductSnapshotJSON), &product); e != nil {
		return Intent{}, false, e
	}
	intent := Intent{Kind: priceKey(step), Config: config, ResourceID: p.SourceResourceID}
	if step.Kind == "title" {
		intent.Prompt = TitlePrompt(product, config)
		return intent, true, nil
	}
	slots, e := repo.EcommerceSlots(p.UserID, run.ID)
	if e != nil {
		return intent, false, e
	}
	branch, e := findBranch(repo, p.UserID, run.ID, step.BranchKind)
	if e != nil {
		return intent, false, e
	}
	if step.Kind == "plan" {
		targets := []model.EcommerceSlot{}
		for _, slot := range slots {
			if slot.Kind == step.BranchKind && slot.RefinementJSON == "" && slot.SelectedVersionID == "" {
				targets = append(targets, slot)
			}
		}
		var previous *Plan
		if branch.AcceptedPlanJSON != "" {
			_ = json.Unmarshal([]byte(branch.AcceptedPlanJSON), &previous)
		}
		intent.Prompt = MasterPrompt(product, config, step.BranchKind, targets, previous)
		return intent, true, nil
	}
	if branch.ApprovedAt == nil {
		return intent, false, nil
	}
	for _, slot := range slots {
		if slot.ID != step.SlotID {
			continue
		}
		if step.Generation != slot.Generation {
			return intent, false, nil
		}
		if step.Kind == "refine" {
			var plan Plan
			if e := json.Unmarshal([]byte(branch.AcceptedPlanJSON), &plan); e != nil {
				return intent, false, e
			}
			snapshot := config
			if branch.ConfigJSON != "" {
				if e := json.Unmarshal([]byte(branch.ConfigJSON), &snapshot); e != nil {
					return intent, false, e
				}
			}
			intent.Prompt = RefinePrompt(product, snapshot, plan, slot)
			return intent, true, nil
		}
		if step.Kind == "image" {
			raw := slot.RefinementJSON
			if slot.DraftJSON != "" {
				raw = slot.DraftJSON
			}
			if raw == "" {
				return intent, false, nil
			}
			var refinement Refinement
			if e := json.Unmarshal([]byte(raw), &refinement); e != nil {
				return intent, false, e
			}
			intent.Prompt = imagePrompt(refinement, config, slot.Kind)
			intent.Copy = refinement.Copy
			return intent, true, nil
		}
	}
	return intent, false, invalid("步骤槽位不存在")
}
func (s *Service) acceptResult(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, step *model.EcommerceStep, result Completion) error {
	config, e := runConfig(run)
	if e != nil {
		return e
	}
	var submitted Intent
	if e := json.Unmarshal([]byte(step.RequestJSON), &submitted); e != nil {
		return e
	}
	config = submitted.Config
	step.RawResponse = result.Text
	switch step.Kind {
	case "title":
		titles, e := CompileTitles(result.Text, config)
		if e != nil {
			return e
		}
		state := titleState{Current: []string{}, Versions: [][]string{}}
		_ = json.Unmarshal([]byte(run.TitlesJSON), &state)
		if len(state.Current) > 0 {
			state.Versions = append(state.Versions, state.Current)
		}
		state.Current = titles
		run.TitlesJSON = encode(state)
		run.TitleRevision++
		step.ResultJSON = encode(titles)
	case "plan":
		branch, e := findBranch(repo, p.UserID, run.ID, step.BranchKind)
		if e != nil {
			return e
		}
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return e
		}
		targets := []model.EcommerceSlot{}
		for _, slot := range slots {
			if slot.Kind == step.BranchKind && slot.RefinementJSON == "" && slot.SelectedVersionID == "" {
				targets = append(targets, slot)
			}
		}
		plan, e := CompilePlan(result.Text, targets, config, step.BranchKind)
		if e != nil {
			return e
		}
		if branch.AcceptedPlanJSON != "" {
			var old Plan
			if e := json.Unmarshal([]byte(branch.AcceptedPlanJSON), &old); e != nil {
				return e
			}
			old.Screens = append(old.Screens, plan.Screens...)
			plan = &old
		}
		history := []Plan{}
		_ = json.Unmarshal([]byte(branch.PlanHistoryJSON), &history)
		if branch.PlanJSON != "" {
			var old Plan
			_ = json.Unmarshal([]byte(branch.PlanJSON), &old)
			history = append(history, old)
		}
		branch.PlanJSON = encode(plan)
		branch.PlanHistoryJSON = encode(history)
		branch.ConfigJSON = encode(config)
		branch.Revision++
		branch.Status = "review"
		branch.ApprovedAt = nil
		step.ResultJSON = encode(plan)
		if e := repo.SaveEcommerceBranch(branch); e != nil {
			return e
		}
		if run.Mode == "auto" {
			if e := s.acceptBranches(repo, p, run, []string{branch.Kind}); e != nil {
				return e
			}
		}
	case "refine":
		branch, e := findBranch(repo, p.UserID, run.ID, step.BranchKind)
		if e != nil {
			return e
		}
		var plan Plan
		if e := json.Unmarshal([]byte(branch.AcceptedPlanJSON), &plan); e != nil {
			return e
		}
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return e
		}
		for _, slot := range slots {
			if slot.ID == step.SlotID {
				refined, e := CompileRefinement(result.Text, plan, slot, config)
				if e != nil {
					return e
				}
				slot.RefinementJSON = encode(refined)
				slot.Title = refined.Title
				slot.Copy = refined.Copy
				slot.Status = "ready"
				slot.Revision++
				step.ResultJSON = encode(refined)
				return repo.SaveEcommerceSlot(&slot)
			}
		}
		return invalid("细化槽位不存在")
	case "image":
		resource, e := repo.ResourceForUser(p.UserID, result.ResourceID)
		if e != nil || resource.Status != "ready" || resource.Kind != "image" {
			return invalid("生成图片尚未保存到资源库")
		}
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return e
		}
		for _, slot := range slots {
			if slot.ID == step.SlotID {
				var intent Intent
				if e := json.Unmarshal([]byte(step.RequestJSON), &intent); e != nil {
					return e
				}
				version := &model.EcommerceImageVersion{ID: newID(), UserID: p.UserID, RunID: run.ID, SlotID: slot.ID, Number: step.Generation, TaskID: *step.TaskID, ResourceID: resource.ID, Prompt: intent.Prompt, Copy: intent.Copy}
				if e := repo.SaveEcommerceVersion(version); e != nil {
					return e
				}
				slot.SelectedVersionID = version.ID
				slot.Copy = intent.Copy
				slot.Status = "succeeded"
				slot.Revision++
				step.ResultJSON = encode(map[string]string{"resourceId": resource.ID, "versionId": version.ID})
				return repo.SaveEcommerceSlot(&slot)
			}
		}
		return invalid("图片槽位不存在")
	default:
		return invalid("步骤类型无效")
	}
	return nil
}
func (s *Service) markFailedOutput(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun, step model.EcommerceStep) error {
	if step.Kind == "plan" {
		b, e := findBranch(repo, p.UserID, run.ID, step.BranchKind)
		if e != nil {
			return e
		}
		if b.ApprovedAt == nil {
			b.Status = step.Status
			if e := repo.SaveEcommerceBranch(b); e != nil {
				return e
			}
		}
	}
	if step.SlotID != "" {
		slots, e := repo.EcommerceSlots(p.UserID, run.ID)
		if e != nil {
			return e
		}
		{
			for _, slot := range slots {
				if slot.ID == step.SlotID && slot.SelectedVersionID == "" {
					slot.Status = step.Status
					slot.Revision++
					if e := repo.SaveEcommerceSlot(&slot); e != nil {
						return e
					}
				}
			}
		}
	}
	return nil
}
func (s *Service) deriveStatus(repo *repository.Repository, p *model.EcommerceProduct, run *model.EcommerceRun) (string, error) {
	steps, e := repo.EcommerceSteps(p.UserID, run.ID)
	if e != nil {
		return "", e
	}
	active, failed, uncertain, pending, settling := false, false, false, false, false
	for _, step := range steps {
		switch step.Status {
		case "submitted":
			active = true
		case "uncertain":
			uncertain = true
		case "failed":
			failed = true
		case "pending":
			pending = true
		}
		if step.TaskID != nil && step.BillingStatus != "" && step.BillingStatus != string(model.BillingStatusSettled) && step.BillingStatus != string(model.BillingStatusRefunded) {
			settling = true
		}
	}
	if active {
		return "generating", nil
	}
	if uncertain {
		return "uncertain", nil
	}
	if settling {
		return "settling", nil
	}
	slots, e := repo.EcommerceSlots(p.UserID, run.ID)
	if e != nil {
		return "", e
	}
	allImages := len(slots) > 0
	for _, slot := range slots {
		if slot.SelectedVersionID == "" {
			allImages = false
		}
	}
	if allImages {
		if failed {
			return "completed_with_warnings", nil
		}
		if !pending {
			return "completed", nil
		}
	}
	branches, e := repo.EcommerceBranches(p.UserID, run.ID)
	if e != nil {
		return "", e
	}
	for _, b := range branches {
		if b.Status == "review" {
			return "review", nil
		}
	}
	if failed {
		return "failed", nil
	}
	return "queued", nil
}
