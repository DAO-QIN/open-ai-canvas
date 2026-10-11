package ecommerce

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// The fake supplies model responses only. Admission and settlement use the real
// task, credit-account, billing-order, transaction and orchestration code.
type workflowHost struct {
	db              *gorm.DB
	repo            *repository.Repository
	mu              sync.Mutex
	signature       string
	failAdmission   bool
	qualityResponse string
}

func (h *workflowHost) WithStorageLock(fn func() error) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	return fn()
}
func (h *workflowHost) Require(repo *repository.Repository, user string) error {
	ok, reason, err := repo.EcommerceEnabled(user)
	if err != nil {
		return err
	}
	if !ok {
		return kernel.Forbidden(reason)
	}
	return nil
}
func (h *workflowHost) ValidateConfig(_ string, config Config) error { return ValidateConfig(config) }
func (h *workflowHost) ValidateReviewModel(_ string, selection Selection) error {
	if selection.ChannelID == "" || selection.ChannelModelKey == "" {
		return invalid("review model required")
	}
	return nil
}
func (h *workflowHost) Prepare(user string, intent Intent, cap *int64) (*Prepared, error) {
	amount, taskType := int64(1000), "canvas_text"
	if strings.HasPrefix(intent.Kind, "image:") {
		amount, taskType = 2000, "canvas_image"
	}
	task := &model.Task{ID: newID(), UserID: user, Type: taskType, Operation: "ecommerce_" + intent.Kind, Status: model.TaskStatusQueued, InputJSON: encode(intent)}
	if intent.StageID != "" {
		task.EcommerceStepID = &intent.StageID
	}
	order := &model.BillingOrder{ID: newID(), UserID: user, TaskID: task.ID, IdempotencyKey: task.ID, AmountMicrocredits: amount, UnitPriceMicrocredits: amount, MultiplierBasisPoints: 10000, Quantity: 1, BillingMode: "fixed", Status: model.BillingStatusReserved}
	if cap != nil {
		order.ChargeLimitSet = true
		order.ChargeLimitMicrocredits = *cap
	}
	task.BillingOrderID = order.ID
	return &Prepared{Task: task, Order: order, Amount: amount, Signature: h.signature}, nil
}
func (h *workflowHost) Admit(repo *repository.Repository, p *Prepared) error {
	if err := repo.CreateTaskWithCreditReservation(p.Task, p.Order, 20); err != nil {
		return err
	}
	if h.failAdmission {
		return errors.New("injected failure after reservation")
	}
	return nil
}
func (*workflowHost) StorageQuota(*repository.Repository, string, int64) error { return nil }
func (*workflowHost) Wake()                                                    {}
func (*workflowHost) Completion(task *model.Task) (Completion, error) {
	var out Completion
	err := json.Unmarshal([]byte(task.ResultJSON), &out)
	return out, err
}
func (h *workflowHost) OpenResource(user, id string) (*model.Resource, io.ReadCloser, error) {
	r, err := h.repo.ResourceForUser(user, id)
	if err != nil {
		return nil, nil, err
	}
	return r, io.NopCloser(strings.NewReader("fixture-image")), nil
}

type workflowFixture struct {
	db      *gorm.DB
	repo    *repository.Repository
	host    *workflowHost
	svc     *Service
	product string
	config  Config
}

func workflowDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
func newWorkflow(t *testing.T) *workflowFixture { return workflowOnDB(t, workflowDB(t)) }
func TestEcommerceReconfirmationDoesNotAccumulateUnusedBudget(t *testing.T) {
	f := newWorkflow(t)
	p := f.action(t, Scope{Action: "auto"})
	ceiling := p.Run.BudgetMicrocredits
	p = f.action(t, Scope{Action: "continue"})
	if p.Run.BudgetMicrocredits != ceiling || f.taskCount(t) != 0 {
		t.Fatal("reconfirmation accumulated unused approval or created a task")
	}
	f.tick(t)
	f.complete(t, true)
	f.tick(t)
	p = f.action(t, Scope{Action: "continue"})
	if p.Run.BudgetMicrocredits != ceiling || p.Run.ActualMicrocredits == 0 {
		t.Fatal("reconfirmation lost completed charges or counted old pending steps twice")
	}
	var approvals int64
	if err := f.db.Model(&model.EcommerceAuthorization{}).Count(&approvals).Error; err != nil || approvals != 3 {
		t.Fatalf("original approval audit snapshots were lost: %d %v", approvals, err)
	}
	p = f.finish(t)
	if f.taskCount(t) != 19 || p.Run.BudgetMicrocredits != ceiling {
		t.Fatal("reconfirmation changed the original set's task count or price ceiling")
	}
}
func workflowOnDB(t *testing.T, db *gorm.DB) *workflowFixture {
	t.Helper()
	repo := repository.New(db)
	for _, id := range []string{"owner", "other"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.CreditAccount{UserID: id, AvailableMicrocredits: 1_000_000}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.SavePluginPlatformState(&model.PluginPlatformState{PluginID: PluginID, Available: true}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "source", UserID: "owner", Kind: "image", Status: "ready", MimeType: "image/png", Size: 13}).Error; err != nil {
		t.Fatal(err)
	}
	config := DefaultSettings().Defaults
	config.Planner = Selection{ChannelID: "vision", ChannelModelKey: "vision-model"}
	config.ImageModel = Selection{ChannelID: "image", ChannelModelKey: "image-model"}
	host := &workflowHost{db: db, repo: repo, signature: "price-v1"}
	svc := New(repo, host, "worker-one")
	batch, err := svc.Import("owner", ImportRequest{OperationID: "import-one", Items: []ImportItem{{ResourceID: "source", Name: "玻璃杯", SellingPoints: "手柄设计"}}, Config: &config})
	if err != nil {
		t.Fatal(err)
	}
	return &workflowFixture{db: db, repo: repo, host: host, svc: svc, product: batch.Products[0].ID, config: config}
}
func (f *workflowFixture) productView(t *testing.T) *ProductView {
	t.Helper()
	p, err := f.svc.Product("owner", f.product)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func (f *workflowFixture) action(t *testing.T, scope Scope) *ProductView {
	t.Helper()
	p := f.productView(t)
	q, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: scope})
	if err != nil {
		t.Fatal(err)
	}
	out, err := f.svc.Command("owner", p.ID, Command{Guard: Guard{Revision: p.Revision, OperationID: "command-" + q.ID}, Action: scope.Action, QuoteID: q.ID, BudgetMicrocredits: q.BudgetMicrocredits})
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func (f *workflowFixture) tick(t *testing.T) {
	t.Helper()
	if err := f.db.Model(&model.EcommerceRun{}).Where("user_id = ?", "owner").UpdateColumn("next_check_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func planFixture(slots []model.EcommerceSlot, config Config, kind string) Plan {
	p := Plan{ProductAnalysis: Analysis{Identity: "玻璃杯", VisibleFeatures: []string{"可见手柄"}, ConfirmedSellingPoints: []string{"手柄设计"}, Unknowns: []string{"容量未知"}}, VisualSystem: VisualSystem{ArtDirection: "真实商业摄影", Palette: "中性色", Lighting: "柔光", Typography: "清晰简洁"}, DesignVersion: 1, Screens: []Screen{}}
	for _, slot := range slots {
		if slot.Kind != kind || slot.RefinementJSON != "" || slot.SelectedVersionID != "" {
			continue
		}
		s := Screen{SlotID: slot.ID, Kind: kind, Title: "用途" + string(rune('A'+slot.Index)), Brief: "展示可见手柄", Design: Design{Evidence: "原商品图可见", Viewpoint: "front", Framing: "full", Pose: "upright", Layout: "center", Focus: "杯体", Crop: "完整主体", TextBlocks: []TextBlock{}}}
		if outputFor(config, kind).CopyMode == "typeset" {
			s.Copy = "手柄设计"
			s.Design.TextBlocks = []TextBlock{{Role: "headline", Text: s.Copy, Placement: "右上方"}}
		}
		p.Screens = append(p.Screens, s)
	}
	return p
}
func refineFixture(plan Plan, slot model.EcommerceSlot) Refinement {
	var screen Screen
	for _, item := range plan.Screens {
		if item.SlotID == slot.ID {
			screen = item
		}
	}
	visual := map[string]string{}
	for _, key := range visualKeys {
		visual[key] = "遵循已确认方案"
	}
	return Refinement{SlotID: slot.ID, Kind: slot.Kind, Title: screen.Title, Copy: screen.Copy, VisualPlan: visual, GenerationPrompt: "准确呈现杯子与可见手柄"}
}
func (f *workflowFixture) complete(t *testing.T, settle bool) {
	t.Helper()
	tasks := []model.Task{}
	if err := f.db.Where("user_id = ? AND status = ?", "owner", model.TaskStatusQueued).Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	for _, task := range tasks {
		if task.EcommerceStepID == nil {
			t.Fatal("missing stage link")
		}
		step, err := f.repo.EcommerceStep("owner", *task.EcommerceStepID)
		if err != nil {
			t.Fatal(err)
		}
		var intent Intent
		if err := json.Unmarshal([]byte(task.InputJSON), &intent); err != nil {
			t.Fatal(err)
		}
		result := Completion{}
		slots, err := f.repo.EcommerceSlots("owner", step.RunID)
		if err != nil {
			t.Fatal(err)
		}
		switch step.Kind {
		case "quality":
			result.Text = encode(QualityReport{Verdict: "pass", Summary: "商品一致，未发现明显问题", Issues: []QualityIssue{}})
			if f.host.qualityResponse != "" {
				result.Text = f.host.qualityResponse
			}
		case "title":
			result.Text = encode(map[string]any{"titles": []string{"手柄杯", "日常杯", "简洁杯"}})
		case "plan":
			result.Text = encode(planFixture(slots, intent.Config, step.BranchKind))
		case "refine":
			branch, err := findBranch(f.repo, "owner", step.RunID, step.BranchKind)
			if err != nil {
				t.Fatal(err)
			}
			var plan Plan
			if err = json.Unmarshal([]byte(branch.AcceptedPlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			for _, slot := range slots {
				if slot.ID == step.SlotID {
					result.Text = encode(refineFixture(plan, slot))
				}
			}
		case "image":
			result.ResourceID = newID()
			if err := f.db.Create(&model.Resource{ID: result.ResourceID, UserID: "owner", Kind: "image", Status: "ready", MimeType: "image/png", Size: 13}).Error; err != nil {
				t.Fatal(err)
			}
		default:
			t.Fatalf("unexpected kind %s", step.Kind)
		}
		if err := f.db.Model(&task).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": encode(result)}).Error; err != nil {
			t.Fatal(err)
		}
		if settle {
			if err := f.repo.SettleBillingOrder(task.BillingOrderID, "mock-provider"); err != nil {
				t.Fatal(err)
			}
		}
	}
}
func (f *workflowFixture) finish(t *testing.T) *ProductView {
	t.Helper()
	for i := 0; i < 80; i++ {
		f.tick(t)
		f.complete(t, true)
		p := f.productView(t)
		if p.Run.Status == "completed" || p.Run.Status == "completed_with_warnings" || p.Run.Status == "review" {
			return p
		}
	}
	t.Fatalf("did not finish: %+v", f.productView(t).Run)
	return nil
}
func (f *workflowFixture) taskCount(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := f.db.Model(&model.Task{}).Where("user_id = ?", "owner").Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}
func TestEcommerceAutomaticWorkflowUsesNineteenBillableChildrenAndRetainsVersions(t *testing.T) {
	f := newWorkflow(t)
	p := f.productView(t)
	q, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "auto"}})
	if err != nil {
		t.Fatal(err)
	}
	if q.TextCalls != 11 || q.ImageCalls != 8 {
		t.Fatalf("quote: %+v", q)
	}
	cmd := Command{Guard: Guard{Revision: p.Revision, OperationID: "double-click"}, Action: "auto", QuoteID: q.ID, BudgetMicrocredits: q.BudgetMicrocredits}
	for i := 0; i < 2; i++ {
		if _, err = f.svc.Command("owner", p.ID, cmd); err != nil {
			t.Fatal(err)
		}
	}
	p = f.finish(t)
	if p.Run.Status != "completed" || len(p.Run.Titles) != 3 || f.taskCount(t) != 19 {
		t.Fatalf("completion status=%s tasks=%d", p.Run.Status, f.taskCount(t))
	}
	account, err := f.repo.CreditAccount("owner")
	if err != nil {
		t.Fatal(err)
	}
	if account.ReservedMicrocredits != 0 || account.AvailableMicrocredits != 973000 || p.Run.ActualMicrocredits != 27000 || p.Run.OccupiedMicrocredits != 27000 {
		t.Fatalf("ledger/account/run: %+v %+v", account, p.Run)
	}
	old := p.Run.Slots[0].SelectedVersionID
	slotID := p.Run.Slots[0].ID
	f.action(t, Scope{Action: "redo-image", SlotID: slotID})
	p = f.finish(t)
	var selected SlotView
	for _, slot := range p.Run.Slots {
		if slot.ID == slotID {
			selected = slot
		}
	}
	if len(selected.Versions) != 2 || selected.SelectedVersionID == old || len(p.Run.Titles) != 3 || f.taskCount(t) != 20 {
		t.Fatal("single-image redo replaced other results or charged extra children")
	}
	refs, err := f.repo.EcommerceResourceReferences("owner", []string{selected.Versions[0].ResourceID, selected.Versions[1].ResourceID})
	if err != nil || len(refs) != 2 {
		t.Fatalf("historical media references: %v %v", refs, err)
	}
}
func TestEcommerceReviewRequiresSeparateBranchAuthorization(t *testing.T) {
	f := newWorkflow(t)
	f.action(t, Scope{Action: "planning"})
	p := f.finish(t)
	if p.Run.Status != "review" || f.taskCount(t) != 3 {
		t.Fatal("review dispatched images before approval")
	}
	f.action(t, Scope{Action: "generate", Branches: []string{"hero"}})
	for i := 0; i < 35; i++ {
		f.tick(t)
		f.complete(t, true)
	}
	p = f.productView(t)
	hero, detail := 0, 0
	for _, slot := range p.Run.Slots {
		if slot.SelectedVersionID != "" {
			if slot.Kind == "hero" {
				hero++
			} else {
				detail++
			}
		}
	}
	if hero != 3 || detail != 0 || f.taskCount(t) != 9 {
		t.Fatalf("branch scope: hero=%d detail=%d children=%d", hero, detail, f.taskCount(t))
	}
	f.action(t, Scope{Action: "generate", Branches: []string{"detail"}})
	if p = f.finish(t); p.Run.Status != "completed" || f.taskCount(t) != 19 {
		t.Fatal("second branch failed")
	}
}
func TestEcommerceClosingFinishesSubmittedTasksAndNeedsExplicitResume(t *testing.T) {
	for _, gate := range []string{"platform", "personal", "account"} {
		t.Run(gate, func(t *testing.T) {
			f := newWorkflow(t)
			f.action(t, Scope{Action: "auto"})
			f.tick(t)
			set := func(enabled bool) {
				var err error
				switch gate {
				case "platform":
					err = f.repo.SavePluginPlatformState(&model.PluginPlatformState{PluginID: PluginID, Available: enabled})
				case "personal":
					err = f.repo.SaveUserPluginState(&model.UserPluginState{UserID: "owner", PluginID: PluginID, Enabled: enabled})
				default:
					status := model.UserStatusDisabled
					if enabled {
						status = model.UserStatusActive
					}
					err = f.db.Model(&model.User{}).Where("id = ?", "owner").Update("status", status).Error
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			set(false)
			f.complete(t, true)
			f.tick(t)
			p := f.productView(t)
			if p.Run.Status != "paused" || f.taskCount(t) != 1 || len(p.Run.Titles) != 3 {
				t.Fatal("closure did not retain submitted title")
			}
			var output bytes.Buffer
			if err := f.svc.Export(context.Background(), "owner", []string{p.ID}, &output); err != nil {
				t.Fatal(err)
			}
			if _, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len())); err != nil {
				t.Fatal(err)
			}
			if _, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "continue"}}); err == nil {
				t.Fatal("closed module admitted quote")
			}
			set(true)
			f.tick(t)
			if f.taskCount(t) != 1 || f.productView(t).Run.Status != "paused" {
				t.Fatal("opening resumed without authorization")
			}
			f.svc = New(f.repo, f.host, "restarted-worker")
			f.action(t, Scope{Action: "continue"})
			if p = f.finish(t); p.Run.Status != "completed" || f.taskCount(t) != 19 {
				t.Fatal("manual resume duplicated/missed tasks")
			}
		})
	}
}
func TestEcommercePluginCenterDoesNotGateOfficialCreation(t *testing.T) {
	f := newWorkflow(t)
	setCenter := func(enabled bool) {
		if err := f.repo.SaveSystemSetting(&model.SystemSetting{Key: "feature_availability", ValueJSON: encode(map[string]bool{"pluginCenterEnabled": enabled})}); err != nil {
			t.Fatal(err)
		}
	}
	setCenter(false)
	f.action(t, Scope{Action: "auto"})
	f.tick(t)
	setCenter(true)
	f.complete(t, true)
	f.tick(t)
	setCenter(false)
	if p := f.finish(t); p.Run.Status != "completed" || f.taskCount(t) != 19 {
		t.Fatal("plugin center interrupted independent product creation")
	}
}
func TestEcommerceAtomicAdmissionRollsBackOnFailureAndInsufficientCredits(t *testing.T) {
	for _, failure := range []string{"after-reservation", "balance"} {
		t.Run(failure, func(t *testing.T) {
			f := newWorkflow(t)
			if failure == "balance" {
				if err := f.db.Model(&model.CreditAccount{}).Where("user_id = ?", "owner").UpdateColumn("available_microcredits", 500).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				f.host.failAdmission = true
			}
			f.action(t, Scope{Action: "auto"})
			f.tick(t)
			p := f.productView(t)
			var orders int64
			if err := f.db.Model(&model.BillingOrder{}).Where("user_id = ?", "owner").Count(&orders).Error; err != nil {
				t.Fatal(err)
			}
			account, err := f.repo.CreditAccount("owner")
			if err != nil {
				t.Fatal(err)
			}
			if p.Run.Status != "blocked" || f.taskCount(t) != 0 || orders != 0 || account.ReservedMicrocredits != 0 || p.Run.OccupiedMicrocredits != 0 {
				t.Fatalf("partial admission survived: tasks=%d orders=%d account=%+v run=%+v", f.taskCount(t), orders, account, p.Run)
			}
			f.host.failAdmission = false
			if failure == "balance" {
				if err := f.db.Model(&model.CreditAccount{}).Where("user_id = ?", "owner").UpdateColumn("available_microcredits", 1_000_000).Error; err != nil {
					t.Fatal(err)
				}
			}
			f.action(t, Scope{Action: "continue"})
			if p = f.finish(t); p.Run.Status != "completed" || f.taskCount(t) != 19 {
				t.Fatal("recovery failed")
			}
		})
	}
}
func TestEcommercePriceChangeBlocksAndSettlementIsReconciledBeforeCompletion(t *testing.T) {
	f := newWorkflow(t)
	f.action(t, Scope{Action: "auto"})
	f.host.signature = "price-v2"
	f.tick(t)
	if f.productView(t).Run.Status != "blocked" || f.taskCount(t) != 0 {
		t.Fatal("stale price admitted")
	}
	f.action(t, Scope{Action: "continue"})
	for i := 0; i < 55; i++ {
		f.tick(t)
		f.complete(t, false)
	}
	p := f.productView(t)
	if p.Run.Status != "settling" || f.taskCount(t) != 19 {
		t.Fatalf("premature completion: %s", p.Run.Status)
	}
	tasks := []model.Task{}
	if err := f.db.Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	for _, task := range tasks {
		if err := f.repo.SettleBillingOrder(task.BillingOrderID, "provider"); err != nil {
			t.Fatal(err)
		}
	}
	f.tick(t)
	if p = f.productView(t); p.Run.Status != "completed" || p.Run.ActualMicrocredits != 27000 {
		t.Fatal("late settlement abandoned")
	}
}
func TestEcommercePermissionsAndUncertainResultsNeverCreatePaidRetries(t *testing.T) {
	f := newWorkflow(t)
	f.action(t, Scope{Action: "auto"})
	f.tick(t)
	tasks := []model.Task{}
	if err := f.db.Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	task := tasks[0]
	if err := f.db.Model(&task).Updates(map[string]any{"status": model.TaskStatusFailed, "execution_diagnostic_json": encode(map[string]string{"submissionOutcome": "unknown"})}).Error; err != nil {
		t.Fatal(err)
	}
	f.tick(t)
	p := f.productView(t)
	var step model.EcommerceStep
	for _, item := range p.Run.Steps {
		if item.TaskID != nil && *item.TaskID == task.ID {
			step = item
		}
	}
	if step.Status != "uncertain" {
		t.Fatalf("unknown submission was %s", step.Status)
	}
	if _, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "retry-step", StepID: step.ID}}); err == nil {
		t.Fatal("paid retry of uncertain request")
	}
	if _, err := f.svc.Product("other", p.ID); err == nil {
		t.Fatal("cross-user read")
	}
	if _, err := f.svc.Quote("other", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "continue"}}); err == nil {
		t.Fatal("cross-user quote")
	}
	if _, err := f.svc.Command("other", p.ID, Command{Guard: Guard{Revision: p.Revision, OperationID: newID()}, Action: "pause"}); err == nil {
		t.Fatal("cross-user mutation")
	}
	var output bytes.Buffer
	if err := f.svc.Export(context.Background(), "other", []string{p.ID}, &output); err == nil || output.Len() != 0 {
		t.Fatal("cross-user export leaked bytes")
	}
	req := ImportRequest{OperationID: "foreign", Items: []ImportItem{{ResourceID: "source", Name: "foreign"}}, Config: &f.config}
	if _, err := f.svc.Import("other", req); err == nil {
		t.Fatal("cross-user reference")
	}
}
