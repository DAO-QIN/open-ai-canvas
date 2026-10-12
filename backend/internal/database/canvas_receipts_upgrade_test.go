package database

import (
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestCanvasReceiptsUpgradePreservesDeployedMigrationsAndTasks(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:canvas-receipts-upgrade?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.CanvasMutationReceipt{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&schemaMigration{}, "version = ?", 52).Error; err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before[len(before)-2].Name != "invitation_rebates" || before[len(before)-1].Name != "official_ecommerce_studio" {
		t.Fatal("deployed migrations 50 and 51 must retain their identity")
	}
	stepID := "retired-step"
	task := model.Task{ID: "existing-task", UserID: "existing-user", EcommerceStepID: &stepID}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Where("version <= ?", 51).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("existing migration names, checksums or applied timestamps changed")
	}
	var preserved model.Task
	if err := db.First(&preserved, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("existing task changed: %v", err)
	}
	if !task.CreatedAt.Equal(preserved.CreatedAt) || !task.UpdatedAt.Equal(preserved.UpdatedAt) {
		t.Fatal("existing task timestamps changed")
	}
	task.CreatedAt, task.UpdatedAt = preserved.CreatedAt, preserved.UpdatedAt
	if !reflect.DeepEqual(task, preserved) {
		t.Fatal("existing task content changed")
	}
	if !db.Migrator().HasTable(&model.CanvasMutationReceipt{}) || !db.Migrator().HasIndex(&model.CanvasMutationReceipt{}, "idx_canvas_mutation_receipt_identity") {
		t.Fatal("canvas receipt table or idempotency index missing")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 52 {
		t.Fatalf("upgraded schema not ready: %+v %v", status, err)
	}
}
