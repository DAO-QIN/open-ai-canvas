package app

import (
	"context"
	"encoding/json"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"path/filepath"
	"strings"
	"testing"
	"yingce/backend/internal/database"
	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func ecommerceTestService(t *testing.T) (*Service, *gorm.DB, *model.User, ecommerce.Config) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "ecommerce.db")+"?_journal_mode=WAL&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	return ecommerceTestServiceOnDB(t, db)
}
func ecommerceTestServiceOnDB(t *testing.T, db *gorm.DB) (*Service, *gorm.DB, *model.User, ecommerce.Config) {
	t.Helper()
	var err error
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	s := &Service{repo: repository.New(db), dataDir: t.TempDir(), workerID: "ecommerce-test", disablePiRuntime: true}
	user := &model.User{ID: "commerce-user", Username: "commerce-user", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	vision := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "vision-test")
	vision.Text.References.MaxImages = 2
	vision.Text.References.MaxImageBytes = 20 << 20
	image := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	image.Image.References.MaxImages = 2
	image.Image.Size.Values = []string{"1024x1024", "1024x1536"}
	image.Image.Size.Default = "1024x1024"
	config := ecommerce.DefaultSettings().Defaults
	config.Planner = ecommerce.Selection{ChannelID: "commerce-channel", ChannelModelKey: "vision-test"}
	config.ImageModel = ecommerce.Selection{ChannelID: "commerce-channel", ChannelModelKey: "image-test"}
	for _, item := range []any{user, &model.ModelChannel{ID: "commerce-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "commerce-test"}, &model.ChannelModel{ID: "commerce-vision", ChannelID: "commerce-channel", ModelKey: "vision-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, vision), BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}, &model.ChannelModel{ID: "commerce-image", ChannelID: "commerce-channel", ModelKey: "image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, image), BillingMode: "fixed_request", UnitPriceMicrocredits: 200, PriceConfigured: true, Enabled: true}, &model.ChannelModelPriceTier{ID: "commerce-text-tier", ChannelModelID: "commerce-vision", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}, &model.ChannelModelPriceTier{ID: "commerce-image-tier", ChannelModelID: "commerce-image", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 200, PriceConfigured: true, Enabled: true}, &model.CreditAccount{UserID: user.ID, AvailableMicrocredits: 10000}, &model.Resource{ID: "commerce-source", UserID: user.ID, Kind: "image", Status: "ready", MimeType: "image/png", Size: 100}, &model.SystemSetting{Key: "feature_availability", ValueJSON: "{\"frontendModelsEnabled\":true,\"creditsEnabled\":true,\"pluginCenterEnabled\":true}"}} {
		if err = db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, user, config
}
func TestEcommerceHostAdmissionReusesBillingAndKeepsProjectIDEmpty(t *testing.T) {
	s, db, user, config := ecommerceTestService(t)
	assertEcommerceHostAdmission(t, s, db, user, config)
}
func TestEcommerceQualityHostTwoImagesAndOwnership(t *testing.T) {
	s, db, user, config := ecommerceTestService(t)
	host := ecommerceHost{svc: s}
	if err := host.ValidateReviewModel(user.ID, config.Planner); err != nil {
		t.Fatal(err)
	}
	for _, resource := range []*model.Resource{
		{ID: "commerce-result", UserID: user.ID, Kind: "image", Status: "ready", MimeType: "image/png", Size: 120, Width: 4096, Height: 4096},
		{ID: "foreign-result", UserID: "other", Kind: "image", Status: "ready", MimeType: "image/png", Size: 120},
	} {
		if err := db.Create(resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	intent := ecommerce.Intent{Kind: "quality", Config: config, ReviewModel: config.Planner, ResourceID: "commerce-source", ResultResourceID: "commerce-result", VersionID: "version-one", StageID: "quality-step", Prompt: "检查原图与成图"}
	prepared, err := host.Prepare(user.ID, intent, nil)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(prepared.Task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	refs, ok := input["referenceImages"].([]any)
	if !ok || len(refs) != 2 || prepared.Task.ProjectID != "" || prepared.Task.Operation != "ecommerce_quality" || prepared.Task.Type != "canvas_text" {
		t.Fatal("quality did not use the host two-image text task contract")
	}
	if stringValue(refs[0].(map[string]any)["storageKey"]) != "resource:commerce-source" || stringValue(refs[1].(map[string]any)["storageKey"]) != "resource:commerce-result" {
		t.Fatal("review source/result order changed")
	}
	prompt := stringValue(input["prompt"])
	if !strings.Contains(prompt, `"result":{"height":4096,"width":4096}`) || !strings.Contains(prompt, `"source":{"height":0,"width":0}`) || !strings.Contains(prompt, "不能从模型预览猜测") || prepared.Task.Prompt != prompt {
		t.Fatal("review must use trusted resource dimensions and preserve unknown sizes")
	}
	intent.ResultResourceID = "foreign-result"
	if _, err := host.Prepare(user.ID, intent, nil); err == nil {
		t.Fatal("cross-user review resource accepted")
	}
	cm, err := s.repo.ChannelModelByKey(config.Planner.ChannelID, config.Planner.ChannelModelKey)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := DecodeModelCapabilityConfig(cm.CapabilityConfigJSON)
	if err != nil {
		t.Fatal(err)
	}
	profile.Text.References.MaxImages = 1
	if err := db.Model(cm).Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	if err := host.ValidateReviewModel(user.ID, config.Planner); err == nil {
		t.Fatal("one-image model accepted as reviewer")
	}
}
func TestEcommerceHostAdmissionWithPluginCenterClosed(t *testing.T) {
	s, db, user, config := ecommerceTestService(t)
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"frontendModelsEnabled":true,"creditsEnabled":true,"pluginCenterEnabled":false}`}); err != nil {
		t.Fatal(err)
	}
	assertEcommerceHostAdmission(t, s, db, user, config)
}
func TestEcommerceHostAdmissionWithRealCatalogPostgres(t *testing.T) {
	_, db := newProjectNameConflictPostgresService(t)
	s, db, user, config := ecommerceTestServiceOnDB(t, db)
	assertEcommerceHostAdmission(t, s, db, user, config)
}
func assertEcommerceHostAdmission(t *testing.T, s *Service, db *gorm.DB, user *model.User, config ecommerce.Config) {
	t.Helper()
	settings := ecommerce.DefaultSettings()
	settings.Defaults = config
	if _, err := s.UpdateEcommerceSettings(user, settings); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetPluginPlatformAvailability(user, ecommerce.PluginID, true); err != nil {
		t.Fatal(err)
	}
	batch, err := s.ImportEcommerceBatch(user.ID, ecommerce.ImportRequest{OperationID: "host-import", Items: []ecommerce.ImportItem{{ResourceID: "commerce-source", Name: "杯子"}}, Config: &config})
	if err != nil {
		t.Fatal(err)
	}
	p := batch.Products[0]
	quote, err := s.QuoteEcommerce(user.ID, p.ID, ecommerce.QuoteRequest{Revision: p.Revision, Scope: ecommerce.Scope{Action: "auto"}})
	if err != nil {
		t.Fatal(err)
	}
	if quote.TextCalls != 11 || quote.ImageCalls != 8 || quote.BudgetMicrocredits != 2700 {
		t.Fatalf("host quote: %+v", quote)
	}
	command := ecommerce.Command{Guard: ecommerce.Guard{Revision: p.Revision, OperationID: "host-approve"}, Action: "auto", QuoteID: quote.ID, BudgetMicrocredits: quote.BudgetMicrocredits}
	for i := 0; i < 2; i++ {
		if _, err = s.CommandEcommerce(user.ID, p.ID, command); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.ecommerceDomain().Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	var tasks []model.Task
	if err = db.Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 {
		t.Fatalf("admitted %d tasks", len(tasks))
	}
	task := tasks[0]
	if task.ProjectID != "" || task.Type != "canvas_text" || task.EcommerceStepID == nil || task.BillingOrderID == "" {
		t.Fatalf("task linkage: %+v", task)
	}
	var input map[string]any
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if refs, ok := input["referenceImages"].([]any); !ok || len(refs) != 1 {
		t.Fatal("original image omitted")
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		t.Fatal(err)
	}
	if !order.ChargeLimitSet || order.ChargeLimitMicrocredits != 100 {
		t.Fatalf("missing child cap: %+v", order)
	}
	var step model.EcommerceStep
	if err := db.First(&step, "id = ?", *task.EcommerceStepID).Error; err != nil {
		t.Fatal(err)
	}
	if len(step.PriceSignature) <= 64 || !json.Valid([]byte(step.PriceSignature)) {
		t.Fatal("complete host price snapshot was not retained")
	}
	if _, err = s.RetryTask(user.ID, task.ID); err == nil {
		t.Fatal("generic retry bypassed product approval")
	}
	if _, err = s.CreateTask(user.ID, CreateTaskRequest{Type: "canvas_text", Operation: "ecommerce_title", Prompt: "forged", Input: input}); err == nil {
		t.Fatal("public caller forged commerce task")
	}
}
func TestEcommercePlatformCannotOpenBeforeValidatedConfiguration(t *testing.T) {
	s, _, user, config := ecommerceTestService(t)
	if _, err := s.SetPluginPlatformAvailability(user, ecommerce.PluginID, true); err == nil {
		t.Fatal("unconfigured module opened")
	}
	settings := ecommerce.DefaultSettings()
	settings.Defaults = config
	if _, err := s.UpdateEcommerceSettings(user, settings); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetPluginPlatformAvailability(user, ecommerce.PluginID, true); err != nil {
		t.Fatal(err)
	}
	state, err := s.pluginStateForUser(user, ecommerce.PluginID, nil)
	if err != nil || !state.UserEnabled || !state.EffectiveEnabled {
		t.Fatalf("default user activation: %+v %v", state, err)
	}
	flags, err := s.FeatureAvailability()
	if err != nil || !flags.EcommerceEnabled {
		t.Fatalf("canonical projection: %+v %v", flags, err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"pluginCenterEnabled":false}`}); err != nil {
		t.Fatal(err)
	}
	user.Role = model.UserRoleUser
	state, err = s.pluginStateForUser(user, ecommerce.PluginID, nil)
	if err != nil || !state.EffectiveEnabled || !state.CanToggle {
		t.Fatalf("ordinary user blocked by unrelated plugin switch: %+v %v", state, err)
	}
	if _, err = s.SetUserPluginEnabled(user, ecommerce.PluginID, false); err != nil {
		t.Fatal(err)
	}
	state, err = s.pluginStateForUser(user, ecommerce.PluginID, nil)
	if err != nil || state.EffectiveEnabled || state.BlockedReason != "你已停用商品套图" {
		t.Fatalf("personal opt-out ignored: %+v %v", state, err)
	}
	if _, err = s.SetUserPluginEnabled(user, ecommerce.PluginID, true); err != nil {
		t.Fatal(err)
	}
	state, err = s.pluginStateForUser(user, ecommerce.PluginID, nil)
	if err != nil || !state.EffectiveEnabled {
		t.Fatalf("personal opt-in blocked by plugin switch: %+v %v", state, err)
	}
	flags, err = s.FeatureAvailability()
	if err != nil || !flags.EcommerceEnabled {
		t.Fatal("personal choice overwrote platform record")
	}
	user.Role = model.UserRoleAdmin
	if _, err = s.SetPluginPlatformAvailability(user, ecommerce.PluginID, false); err != nil {
		t.Fatal(err)
	}
	flags, err = s.FeatureAvailability()
	if err != nil || flags.EcommerceEnabled {
		t.Fatal("closed platform projection stale")
	}
}
