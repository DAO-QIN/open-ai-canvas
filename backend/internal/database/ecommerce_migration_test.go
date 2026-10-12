package database

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestEcommerceMigrationDefaultsClosedAndPreservesLegacyTaskIdentity(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:ecommerce-upgrade?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err = migrateSchemaV10(db); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.Task{ID: "legacy-task", UserID: "owner", ProjectID: "old-project"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = migrateEcommerce(db); err != nil {
		t.Fatal(err)
	}
	var state model.PluginPlatformState
	if err = db.First(&state, "plugin_id = ?", ecommercePluginID).Error; err != nil || state.Available {
		t.Fatalf("module published without configuration: %+v %v", state, err)
	}
	var task model.Task
	if err = db.First(&task, "id = ?", "legacy-task").Error; err != nil || task.ProjectID != "old-project" {
		t.Fatal("upgrade changed an existing task")
	}
	stepID := "unique-product-step"
	if err = db.Table("tasks").Create(map[string]any{"id": "product-task", "ecommerce_step_id": stepID}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Table("tasks").Create(map[string]any{"id": "duplicate-task", "ecommerce_step_id": stepID}).Error; err == nil {
		t.Fatal("duplicate stage admitted")
	}
	if err = db.Model(&state).Update("available", true).Error; err != nil {
		t.Fatal(err)
	}
	if err = migrateEcommerce(db); err != nil {
		t.Fatal(err)
	}
	if err = db.First(&state, "plugin_id = ?", ecommercePluginID).Error; err != nil || !state.Available {
		t.Fatal("repeated migration overwrote an administrator's state")
	}
}
