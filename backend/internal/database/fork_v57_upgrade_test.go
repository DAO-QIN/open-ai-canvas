package database

import (
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestForkV57UpgradePreservesLedgerBalancesAndTasks(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := ecommerceRemovalTestDB(t, driver)
			if err := MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			var ledgerBefore []schemaMigration
			if err := db.Where("version <= ?", 57).Order("version").Find(&ledgerBefore).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Where("version > ?", 57).Delete(&schemaMigration{}).Error; err != nil {
				t.Fatal(err)
			}
			for _, item := range []struct {
				entity any
				index  string
			}{
				{&model.ModelChannel{}, "idx_model_channels_catalog_provider_id"},
				{&model.ApiCallLog{}, "idx_api_logs_created_epoch"},
				{&model.Task{}, "idx_tasks_created_epoch"},
			} {
				if err := db.Exec(`DROP INDEX "` + item.index + `"`).Error; err != nil {
					t.Fatal(err)
				}
			}
			for _, item := range []struct {
				entity any
				column string
			}{
				{&model.ModelChannel{}, "CatalogProviderID"},
				{&model.ChannelModel{}, "CatalogModelKey"},
				{&model.ApiCallLog{}, "CreatedAtEpoch"},
				{&model.Task{}, "CreatedAtEpoch"},
			} {
				if err := db.Migrator().DropColumn(item.entity, item.column); err != nil {
					t.Fatal(err)
				}
			}
			createdAt := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
			if err := db.Table("tasks").Create(map[string]any{
				"id": "legacy-task", "user_id": "creator", "prompt": "preserved prompt",
				"status": model.TaskStatusSucceeded, "created_at": createdAt,
			}).Error; err != nil {
				t.Fatal(err)
			}
			account := model.CreditAccount{UserID: "creator", AvailableMicrocredits: 123456, ReservedMicrocredits: 789, Version: 7}
			if err := db.Create(&account).Error; err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := MigrateSchema(db); err != nil {
					t.Fatal(err)
				}
			}
			var ledgerAfter []schemaMigration
			if err := db.Where("version <= ?", 57).Order("version").Find(&ledgerAfter).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(ledgerBefore, ledgerAfter) {
				t.Fatal("existing migration identities or applied times changed")
			}
			var task model.Task
			if err := db.First(&task, "id = ?", "legacy-task").Error; err != nil {
				t.Fatal(err)
			}
			if task.Prompt != "preserved prompt" || task.Status != model.TaskStatusSucceeded {
				t.Fatal("existing task changed")
			}
			if driver == "sqlite" && task.CreatedAtEpoch != createdAt.Unix() {
				t.Fatalf("legacy timestamp was not backfilled: %d", task.CreatedAtEpoch)
			}
			var after model.CreditAccount
			if err := db.First(&after, "user_id = ?", account.UserID).Error; err != nil {
				t.Fatal(err)
			}
			if after.AvailableMicrocredits != account.AvailableMicrocredits || after.ReservedMicrocredits != account.ReservedMicrocredits || after.Version != account.Version {
				t.Fatal("credit balance changed during schema upgrade")
			}
			if !db.Migrator().HasColumn(&model.ModelChannel{}, "CatalogProviderID") || !db.Migrator().HasColumn(&model.ChannelModel{}, "CatalogModelKey") {
				t.Fatal("catalog source fields missing")
			}
			if status, err := ReadSchemaStatus(db); err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
				t.Fatalf("unexpected upgraded schema: %+v %v", status, err)
			}
		})
	}
}
