package ecommerce

import (
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func enableQuality(t *testing.T, f *workflowFixture) {
	t.Helper()
	settings := DefaultSettings()
	settings.Defaults = f.config
	settings.ReviewAvailable = true
	settings.ReviewModel = Selection{ChannelID: "review", ChannelModelKey: "review-vision"}
	if err := f.repo.SaveSystemSetting(&model.SystemSetting{Key: SettingsKey, ValueJSON: encode(settings)}); err != nil {
		t.Fatal(err)
	}
	f.config.QualityCheck = true
	p := f.productView(t)
	if _, err := f.svc.UpdateProduct("owner", p.ID, ProductRequest{Guard: Guard{Revision: p.Revision, OperationID: "enable-quality"}, Name: p.Name, SellingPoints: p.SellingPoints, Config: &f.config}); err != nil {
		t.Fatal(err)
	}
}

func TestEcommerceQualityReportContract(t *testing.T) {
	for _, raw := range []string{
		`{"verdict":"pass","summary":"未发现明显问题","issues":[]}`,
		`{"verdict":"attention","summary":"文案有误","issues":[{"category":"text","evidence":"右上方文案与确认文案不一致","suggestion":"请核对文案后调整单图"}]}`,
		`{"verdict":"undetermined","summary":"品牌小字无法辨认","issues":[]}`,
	} {
		if _, err := CompileQuality(raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{
		`{"verdict":"pass","summary":"保证正确","issues":[{"category":"text","evidence":"文字错误","suggestion":"修改"}]}`,
		`{"verdict":"attention","summary":"有问题","issues":[]}`,
		`{"verdict":"approved","summary":"通过","issues":[]}`,
		`{"verdict":"pass","summary":"正常"}`,
		`{"verdict":"attention","summary":"有问题","issues":[{"category":"text","evidence":"","suggestion":"修改"}]}`,
	} {
		if _, err := CompileQuality(raw); err == nil {
			t.Fatalf("accepted invalid review: %s", raw)
		}
	}
}

func TestEcommerceQualityAutoBillingSnapshotAndVersion(t *testing.T) {
	f := newWorkflow(t)
	enableQuality(t, f)
	p := f.productView(t)
	quote, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "auto"}})
	if err != nil {
		t.Fatal(err)
	}
	if quote.TextCalls != 19 || quote.ImageCalls != 8 || quote.EstimatedMicrocredits != 35000 {
		t.Fatalf("incorrect quality quote: %+v", quote)
	}
	for _, price := range quote.Prices {
		if price.Key == "quality" && (price.Calls != 8 || price.ReviewModel == nil || price.ReviewModel.ChannelID != "review") {
			t.Fatal("reviewer not fixed in authorization")
		}
	}
	_, err = f.svc.Command("owner", p.ID, Command{Guard: Guard{Revision: p.Revision, OperationID: "quality-auto"}, Action: "auto", QuoteID: quote.ID, BudgetMicrocredits: quote.BudgetMicrocredits})
	if err != nil {
		t.Fatal(err)
	}
	// A later administrator change cannot silently change an approved model.
	settings, _ := f.svc.Settings()
	settings.ReviewModel.ChannelModelKey = "future-reviewer"
	if err := f.repo.SaveSystemSetting(&model.SystemSetting{Key: SettingsKey, ValueJSON: encode(settings)}); err != nil {
		t.Fatal(err)
	}
	p = f.finish(t)
	if p.Run.Status != "completed" || f.taskCount(t) != 27 || p.Run.ActualMicrocredits != 35000 {
		t.Fatalf("unexpected quality completion: %s/%d/%d", p.Run.Status, f.taskCount(t), p.Run.ActualMicrocredits)
	}
	for _, slot := range p.Run.Slots {
		if len(slot.QualityChecks) != 1 || slot.QualityChecks[0].VersionID != slot.SelectedVersionID || slot.QualityChecks[0].Report == nil {
			t.Fatal("review did not follow the generated version")
		}
	}
	for _, step := range p.Run.Steps {
		if step.Kind != "quality" {
			continue
		}
		var intent Intent
		if err := json.Unmarshal([]byte(step.RequestJSON), &intent); err != nil {
			t.Fatal(err)
		}
		if intent.ReviewModel.ChannelModelKey != "review-vision" || intent.ResourceID != "source" || intent.ResultResourceID == "" || intent.VersionID == "" || !strings.Contains(intent.Prompt, "手柄设计") {
			t.Fatal("review lost source, accepted facts, target or authorized model")
		}
	}
	before := f.taskCount(t)
	f.tick(t)
	if f.taskCount(t) != before {
		t.Fatal("completed reconciliation charged twice")
	}
}

func TestEcommerceQualityReviewModeRequiresSeparateApproval(t *testing.T) {
	f := newWorkflow(t)
	enableQuality(t, f)
	f.action(t, Scope{Action: "planning"})
	p := f.finish(t)
	if f.taskCount(t) != 3 || p.Run.Status != "review" {
		t.Fatal("quality dispatched before generation approval")
	}
	p = f.action(t, Scope{Action: "generate", Branches: []string{"hero"}})
	for i := 0; i < 40; i++ {
		f.tick(t)
		f.complete(t, true)
	}
	p = f.productView(t)
	if f.taskCount(t) != 12 {
		t.Fatalf("unapproved detail work charged: %d", f.taskCount(t))
	}
	for _, step := range p.Run.Steps {
		if step.BranchKind == "detail" && step.Kind != "plan" && step.TaskID != nil {
			t.Fatal("unapproved branch advanced")
		}
	}
}

func TestEcommerceQualityFailurePreservesImagesAndRetryTarget(t *testing.T) {
	f := newWorkflow(t)
	enableQuality(t, f)
	f.host.qualityResponse = `{"verdict":"pass","summary":"truncated"`
	f.action(t, Scope{Action: "auto"})
	p := f.finish(t)
	if p.Run.Status != "completed_with_warnings" || f.taskCount(t) != 27 {
		t.Fatal("failed review retried automatically or lost delivery")
	}
	var failed model.EcommerceStep
	for _, step := range p.Run.Steps {
		if step.Kind == "quality" && step.Status == "failed" {
			failed = step
			break
		}
	}
	if failed.ID == "" || failed.RawResponse != f.host.qualityResponse {
		t.Fatal("review raw response was not retained")
	}
	var old Intent
	_ = json.Unmarshal([]byte(failed.RequestJSON), &old)
	for _, slot := range p.Run.Slots {
		if slot.SelectedVersionID == "" {
			t.Fatal("failed review removed image")
		}
	}
	f.host.qualityResponse = ""
	f.action(t, Scope{Action: "retry-step", StepID: failed.ID})
	p = f.finish(t)
	if f.taskCount(t) != 28 {
		t.Fatal("review retry generated new images or double charged")
	}
	for _, step := range p.Run.Steps {
		if step.Kind == "quality" && step.Status == "succeeded" {
			var intent Intent
			_ = json.Unmarshal([]byte(step.RequestJSON), &intent)
			if intent.VersionID != old.VersionID || intent.ResultResourceID != old.ResultResourceID {
				t.Fatal("review retry changed its target")
			}
		}
	}
	f.action(t, Scope{Action: "redo-image", SlotID: failed.SlotID})
	p = f.finish(t)
	if f.taskCount(t) != 30 {
		t.Fatal("review retry collided with the next image generation stage")
	}
}

func TestEcommerceQualityAttentionRetainsDeliveryAndVersionHistory(t *testing.T) {
	f := newWorkflow(t)
	enableQuality(t, f)
	f.host.qualityResponse = `{"verdict":"attention","summary":"文字需要核对","issues":[{"category":"text","evidence":"右上角文字模糊","suggestion":"放大核对后决定是否调整"}]}`
	f.action(t, Scope{Action: "auto"})
	p := f.finish(t)
	if p.Run.Status != "completed_with_warnings" || f.taskCount(t) != 27 {
		t.Fatal("attention caused automatic paid regeneration")
	}
	slot := p.Run.Slots[0]
	oldID := slot.SelectedVersionID
	f.host.qualityResponse = ""
	f.action(t, Scope{Action: "redo-image", SlotID: slot.ID})
	p = f.finish(t)
	if f.taskCount(t) != 29 {
		t.Fatal("single-image redo did not quote one image and one review")
	}
	for _, next := range p.Run.Slots {
		if next.ID != slot.ID {
			continue
		}
		if len(next.Versions) != 2 || len(next.QualityChecks) != 2 {
			t.Fatal("version review history lost")
		}
		for _, check := range next.QualityChecks {
			if check.VersionID == oldID && check.Report.Verdict != "attention" {
				t.Fatal("old image inherited new verdict")
			}
			if check.VersionID == next.SelectedVersionID && check.Report.Verdict != "pass" {
				t.Fatal("new image inherited old verdict")
			}
		}
	}
}

func TestEcommerceQualityUnavailableStopsBeforePaidTasks(t *testing.T) {
	f := newWorkflow(t)
	f.config.QualityCheck = true
	p := f.productView(t)
	if _, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "auto", Config: &f.config}}); err == nil {
		t.Fatal("unconfigured quality was authorized")
	}
	if f.taskCount(t) != 0 {
		t.Fatal("rejected quality created paid tasks")
	}
}

func TestEcommerceQualityPostgresWorkflow(t *testing.T) {
	f := workflowOnDB(t, ecommercePostgres(t))
	enableQuality(t, f)
	f.action(t, Scope{Action: "auto"})
	p := f.finish(t)
	if p.Run.Status != "completed" || f.taskCount(t) != 27 {
		t.Fatal("postgres review workflow incomplete")
	}
}
