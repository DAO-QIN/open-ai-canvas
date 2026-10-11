package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"time"
	"yingce/backend/internal/model"
)

var ErrEcommerceConflict = errors.New("商品数据已更新，请刷新后重试")

// Admission uses a savepoint inside the user transaction. A blocked step may
// be recorded only after all of its task, reservation and linkage writes roll back.
func (r *Repository) AdmitEcommerceStep(fn func(*Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error { return fn(New(tx)) })
}

// Serialize a user's admission across products as well as each product's CAS.
// The transaction repository must be used for steps, tasks and reservations.
func (r *Repository) MutateEcommerce(userID, productID string, fn func(*model.EcommerceProduct, *Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		locked := tx.Model(&model.User{}).Where("id = ?", userID).UpdateColumn("id", gorm.Expr("id"))
		if locked.Error != nil {
			return locked.Error
		}
		if locked.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		scoped := New(tx)
		var product *model.EcommerceProduct
		if productID != "" {
			var err error
			product, err = scoped.EcommerceProduct(userID, productID)
			if err != nil {
				return err
			}
		}
		if err := fn(product, scoped); err != nil {
			return err
		}
		if product != nil && product.ID != "" {
			return tx.Save(product).Error
		}
		return nil
	})
}
func (r *Repository) EcommerceProduct(userID, id string) (*model.EcommerceProduct, error) {
	var item model.EcommerceProduct
	err := r.db.First(&item, "user_id = ? AND id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) EcommerceStep(userID, id string) (*model.EcommerceStep, error) {
	var item model.EcommerceStep
	err := r.db.First(&item, "user_id = ? AND id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) EcommerceProducts(userID, batchID string, archived bool, page, size int) ([]model.EcommerceProduct, int64, error) {
	items := []model.EcommerceProduct{}
	var total int64
	q := r.db.Model(&model.EcommerceProduct{}).Where("user_id = ? AND archived = ?", userID, archived)
	if batchID != "" {
		q = q.Where("batch_id = ?", batchID)
	}
	if err := q.Count(&total).Error; err != nil {
		return items, 0, err
	}
	err := q.Order("created_at DESC, id").Offset((page - 1) * size).Limit(size).Find(&items).Error
	return items, total, err
}
func (r *Repository) EcommerceBatches(userID string) ([]model.EcommerceBatch, error) {
	items := []model.EcommerceBatch{}
	return items, r.db.Where("user_id = ?", userID).Order("created_at DESC").Limit(100).Find(&items).Error
}
func (r *Repository) EcommerceBatch(userID, id string) (*model.EcommerceBatch, error) {
	var item model.EcommerceBatch
	err := r.db.First(&item, "user_id = ? AND id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) EcommerceBatchOperation(userID, id string) (*model.EcommerceBatch, error) {
	var item model.EcommerceBatch
	err := r.db.First(&item, "user_id = ? AND operation_id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) CreateEcommerceBatch(item *model.EcommerceBatch, products []model.EcommerceProduct) error {
	if err := r.db.Create(item).Error; err != nil {
		return err
	}
	return r.db.Create(&products).Error
}
func (r *Repository) DeleteEcommerceDraft(userID, id string) error {
	var count int64
	if err := r.db.Model(&model.EcommerceRun{}).Where("user_id = ? AND product_id = ?", userID, id).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrEcommerceConflict
	}
	return r.db.Delete(&model.EcommerceProduct{}, "user_id = ? AND id = ?", userID, id).Error
}
func (r *Repository) EcommerceRun(userID, id string) (*model.EcommerceRun, error) {
	var item model.EcommerceRun
	err := r.db.First(&item, "user_id = ? AND id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) EcommerceRuns(userID, productID string) ([]model.EcommerceRun, error) {
	items := []model.EcommerceRun{}
	err := r.db.Where("user_id = ? AND product_id = ?", userID, productID).Order("number DESC").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommerceRun(item *model.EcommerceRun) error {
	// Command updates must never overwrite a concurrently acquired worker lease.
	if item.CreatedAt.IsZero() {
		return r.db.Create(item).Error
	}
	return r.db.Omit("LeaseOwner", "LeaseEpoch", "LeaseExpiresAt").Save(item).Error
}
func (r *Repository) EcommerceBranches(userID, runID string) ([]model.EcommerceBranch, error) {
	items := []model.EcommerceBranch{}
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).Order("kind").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommerceBranch(item *model.EcommerceBranch) error {
	return r.db.Save(item).Error
}
func (r *Repository) EcommerceSlots(userID, runID string) ([]model.EcommerceSlot, error) {
	items := []model.EcommerceSlot{}
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).Order("kind DESC, \"index\"").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommerceSlot(item *model.EcommerceSlot) error { return r.db.Save(item).Error }
func (r *Repository) EcommerceVersions(userID, runID string) ([]model.EcommerceImageVersion, error) {
	items := []model.EcommerceImageVersion{}
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).Order("number DESC").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommerceVersion(item *model.EcommerceImageVersion) error {
	return r.db.Save(item).Error
}
func (r *Repository) EcommerceSteps(userID, runID string) ([]model.EcommerceStep, error) {
	items := []model.EcommerceStep{}
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).Order("created_at, id").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommerceStep(item *model.EcommerceStep) error { return r.db.Save(item).Error }
func (r *Repository) EcommerceQuote(userID, id string) (*model.EcommerceQuote, error) {
	var item model.EcommerceQuote
	err := r.db.First(&item, "user_id = ? AND id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) SaveEcommerceQuote(item *model.EcommerceQuote) error {
	return r.db.Save(item).Error
}
func (r *Repository) EcommerceAuthorizations(userID, runID string) ([]model.EcommerceAuthorization, error) {
	items := []model.EcommerceAuthorization{}
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).Order("created_at DESC, id").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommerceAuthorization(item *model.EcommerceAuthorization) error {
	return r.db.Save(item).Error
}
func (r *Repository) EcommerceOperation(userID, id string) (*model.EcommerceOperation, error) {
	var item model.EcommerceOperation
	err := r.db.First(&item, "user_id = ? AND operation_id = ?", userID, id).Error
	return &item, err
}
func (r *Repository) SaveEcommerceOperation(item *model.EcommerceOperation) error {
	return r.db.Create(item).Error
}
func (r *Repository) EcommercePresets(userID string) ([]model.EcommercePreset, error) {
	items := []model.EcommercePreset{}
	err := r.db.Where("user_id = ?", userID).Order("name").Find(&items).Error
	return items, err
}
func (r *Repository) SaveEcommercePreset(item *model.EcommercePreset) error {
	return r.db.Save(item).Error
}
func (r *Repository) DeleteEcommercePreset(userID, id string) error {
	return r.db.Delete(&model.EcommercePreset{}, "user_id = ? AND id = ?", userID, id).Error
}

// SHARE locks fence platform and personal toggles against atomic admission.
func (r *Repository) EcommerceEnabled(userID string) (bool, string, error) {
	var user model.User
	if err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).First(&user, "id = ?", userID).Error; err != nil {
		return false, "", err
	}
	if user.Status != model.UserStatusActive {
		return false, "账号不可用，已暂停后续派发", nil
	}
	var state model.PluginPlatformState
	if err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).First(&state, "plugin_id = ?", model.EcommercePluginID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, "商品套图暂未开放", nil
		}
		return false, "", err
	}
	if !state.Available {
		return false, "商品套图暂未开放", nil
	}
	var personal model.UserPluginState
	if err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).First(&personal, "user_id = ? AND plugin_id = ?", userID, model.EcommercePluginID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return true, "", nil
		}
		return false, "", err
	}
	if !personal.Enabled {
		return false, "你已停用商品套图，请先在商品套图工作区启用", nil
	}
	return true, "", nil
}
func (r *Repository) PauseEcommerce(userID, reason string) error {
	q := r.db.Model(&model.EcommerceRun{}).Where("status IN ?", []string{"queued", "planning", "generating", "review", "blocked"})
	if userID != "" {
		q = q.Where("user_id = ?", userID)
	}
	return q.Updates(map[string]any{"status": "paused", "pause_reason": reason, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
}
func (r *Repository) PauseEcommerceProduct(userID, productID, reason string) error {
	return r.db.Model(&model.EcommerceRun{}).Where("user_id = ? AND product_id = ? AND status NOT IN ?", userID, productID, []string{"completed", "completed_with_warnings", "archived"}).Updates(map[string]any{"status": "paused", "pause_reason": reason, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
}
func (r *Repository) MutateEcommerceSettings(fn func(*model.SystemSetting, *Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		initial := model.SystemSetting{Key: "ecommerce_studio", ValueJSON: `{"revision":1}`}
		if e := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&initial).Error; e != nil {
			return e
		}
		var current model.SystemSetting
		if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "key = ?", "ecommerce_studio").Error; e != nil {
			return e
		}
		return fn(&current, New(tx))
	})
}
func (r *Repository) EcommerceDefaultEnabledUserCount() (int64, error) {
	var count int64
	err := r.db.Model(&model.User{}).Where("id NOT IN (?)", r.db.Model(&model.UserPluginState{}).Select("user_id").Where("plugin_id = ? AND enabled = ?", model.EcommercePluginID, false)).Count(&count).Error
	return count, err
}
func (r *Repository) ClaimEcommerceRuns(owner string, limit int) ([]model.EcommerceRun, error) {
	items := []model.EcommerceRun{}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		q := tx.Where("next_check_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at < ?) AND status NOT IN ?", now, now, []string{"completed", "completed_with_warnings", "archived"}).Order("next_check_at, user_id, created_at").Limit(limit)
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		candidates := []model.EcommerceRun{}
		if err := q.Find(&candidates).Error; err != nil {
			return err
		}
		until := now.Add(45 * time.Second)
		for _, run := range candidates {
			claim := tx.Model(&model.EcommerceRun{}).Where("id = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)", run.ID, now).Updates(map[string]any{"lease_owner": owner, "lease_epoch": gorm.Expr("lease_epoch + 1"), "lease_expires_at": until})
			if claim.Error != nil {
				return claim.Error
			}
			if claim.RowsAffected == 1 {
				run.LeaseOwner = owner
				run.LeaseEpoch++
				run.LeaseExpiresAt = &until
				items = append(items, run)
			}
		}
		return nil
	})
	return items, err
}
func (r *Repository) FinishEcommerceLease(userID, id, owner string, epoch int64, next time.Time) error {
	return r.db.Model(&model.EcommerceRun{}).Where("user_id = ? AND id = ? AND lease_owner = ? AND lease_epoch = ?", userID, id, owner, epoch).Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil, "next_check_at": next}).Error
}

type EcommerceCapacity struct {
	Products      int64
	Text          int64
	Images        int64
	ProductImages int64
}

func (r *Repository) EcommerceCapacity(userID, productID string) (EcommerceCapacity, error) {
	var out EcommerceCapacity
	q := r.db.Table("ecommerce_steps").Joins("JOIN tasks ON tasks.id = ecommerce_steps.task_id").Where("ecommerce_steps.user_id = ? AND (tasks.status IN ? OR (tasks.status = ? AND (tasks.provider_request_id <> '' OR tasks.media_recovery_json <> '') AND ecommerce_steps.status = ?))", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}, model.TaskStatusFailed, "uncertain")
	if err := q.Session(&gorm.Session{}).Distinct("ecommerce_steps.product_id").Count(&out.Products).Error; err != nil {
		return out, err
	}
	if err := q.Session(&gorm.Session{}).Where("tasks.type = ?", "canvas_text").Count(&out.Text).Error; err != nil {
		return out, err
	}
	if err := q.Session(&gorm.Session{}).Where("tasks.type = ?", "canvas_image").Count(&out.Images).Error; err != nil {
		return out, err
	}
	err := q.Session(&gorm.Session{}).Where("tasks.type = ? AND ecommerce_steps.product_id = ?", "canvas_image", productID).Count(&out.ProductImages).Error
	return out, err
}
func (r *Repository) EcommerceProductHasActiveTask(userID, productID string) (bool, error) {
	var count int64
	err := r.db.Table("ecommerce_steps").Joins("JOIN tasks ON tasks.id = ecommerce_steps.task_id").Where("ecommerce_steps.user_id = ? AND ecommerce_steps.product_id = ? AND tasks.status IN ?", userID, productID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error
	return count > 0, err
}
func (r *Repository) EcommerceStorageUsage(userID string) (int64, int64, error) {
	var count int64
	var total int64
	if !r.db.Migrator().HasTable(&model.EcommerceProduct{}) {
		return 0, 0, nil
	}
	if err := r.db.Model(&model.EcommerceProduct{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return 0, 0, err
	}
	// Account for raw responses and all historical snapshots, not just selected images.
	for _, table := range []struct {
		Name   string
		Fields string
	}{
		{"ecommerce_products", "name, selling_points, config_json"}, {"ecommerce_runs", "config_json, product_snapshot_json, titles_json"},
		{"ecommerce_branches", "plan_json, accepted_plan_json, plan_history_json, config_json"}, {"ecommerce_slots", "title, copy, refinement_json, draft_json"},
		{"ecommerce_steps", "request_json, raw_response, result_json, error"}, {"ecommerce_image_versions", "prompt, copy"},
		{"ecommerce_quotes", "scope_json, prices_json"}, {"ecommerce_authorizations", "scope_json, prices_json"}, {"ecommerce_operations", "response_json"}, {"ecommerce_presets", "config_json"},
	} {
		parts := []string{}
		for _, field := range strings.Split(table.Fields, ", ") {
			if r.db.Dialector.Name() == "postgres" {
				parts = append(parts, "COALESCE(OCTET_LENGTH("+field+"),0)")
			} else {
				parts = append(parts, "COALESCE(LENGTH(CAST("+field+" AS BLOB)),0)")
			}
		}
		var bytes int64
		if err := r.db.Table(table.Name).Select("COALESCE(SUM("+strings.Join(parts, "+")+"),0)").Where("user_id = ?", userID).Scan(&bytes).Error; err != nil {
			return 0, 0, err
		}
		total += bytes
	}
	return count, total, nil
}
func (r *Repository) EcommerceResourceReferences(userID string, ids []string) ([]ResourceDirectReference, error) {
	refs := []ResourceDirectReference{}
	if !r.db.Migrator().HasTable(&model.EcommerceProduct{}) {
		return refs, nil
	}
	products := []model.EcommerceProduct{}
	if err := r.db.Where("user_id = ? AND source_resource_id IN ?", userID, ids).Find(&products).Error; err != nil {
		return nil, err
	}
	for _, p := range products {
		refs = append(refs, ResourceDirectReference{Kind: "商品原图", ID: p.ID, Title: p.Name, ResourceID: p.SourceResourceID})
	}
	versions := []model.EcommerceImageVersion{}
	if err := r.db.Where("user_id = ? AND resource_id IN ?", userID, ids).Find(&versions).Error; err != nil {
		return nil, err
	}
	for _, v := range versions {
		refs = append(refs, ResourceDirectReference{Kind: "商品套图版本", ID: v.ID, Title: "商品图片", ResourceID: v.ResourceID})
	}
	return refs, nil
}
