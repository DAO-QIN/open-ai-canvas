package database

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func ecommerceRemovalTestDB(t *testing.T, driver string) *gorm.DB {
	t.Helper()
	if driver == "sqlite" {
		db, err := Open(Config{Driver: driver, DSN: fmt.Sprintf("file:remove-ecommerce-%d?mode=memory&cache=shared", time.Now().UnixNano())})
		if err != nil {
			t.Fatal(err)
		}
		conn, _ := db.DB()
		t.Cleanup(func() { _ = conn.Close() })
		return db
	}
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: driver, DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	t.Cleanup(func() { _ = baseSQL.Close() })
	name := fmt.Sprintf("ecommerce_removal_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + name + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec(`DROP SCHEMA "` + name + `" CASCADE`).Error; err != nil {
			t.Error(err)
		}
	})
	testDSN, err := postgresDSNWithSearchPath(dsn, name)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: driver, DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	t.Cleanup(func() { _ = conn.Close() })
	return db
}

func assertEcommerceSchemaRemoved(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, table := range ecommerceTablesV51 {
		if db.Migrator().HasTable(table) {
			t.Errorf("retired table recreated: %s", table)
		}
	}
	if db.Migrator().HasColumn(&ecommerceTaskV51{}, "EcommerceStepID") || db.Migrator().HasIndex(&ecommerceTaskV51{}, "EcommerceStepID") {
		t.Error("retired task column or unique index remains")
	}
	for _, entity := range []any{&model.PluginPlatformState{}, &model.UserPluginState{}} {
		var count int64
		if err := db.Model(entity).Where("plugin_id = ?", ecommercePluginID).Count(&count).Error; err != nil || count != 0 {
			t.Errorf("retired plugin state remains: %T %d %v", entity, count, err)
		}
	}
}

func TestEcommerceRemovalFreshAndUpgrade(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		for _, version := range []int64{0, 51, 52} {
			t.Run(fmt.Sprintf("%s/from-%d", driver, version), func(t *testing.T) {
				db := ecommerceRemovalTestDB(t, driver)
				if version == 0 {
					if err := MigrateSchema(db); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := db.AutoMigrate(&schemaMigration{}); err != nil {
						t.Fatal(err)
					}
					for _, migration := range schemaMigrations {
						if migration.version > version {
							break
						}
						if err := migration.apply(db); err != nil {
							t.Fatalf("prepare migration %d: %v", migration.version, err)
						}
						if err := db.Create(&schemaMigration{Version: migration.version, Name: migration.name, Checksum: migration.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
							t.Fatal(err)
						}
					}
					for _, entity := range []any{
						&EcommerceProduct{ID: "test-product", UserID: "owner", SourceResourceID: "shared-source"},
						&EcommerceImageVersion{ID: "test-version", TaskID: "already-removed-test-task", ResourceID: "generated-image"},
						&model.UserPluginState{ID: "retired-user-state", UserID: "owner", PluginID: ecommercePluginID},
					} {
						if err := db.Create(entity).Error; err != nil {
							t.Fatal(err)
						}
					}
				}
				var before []schemaMigration
				if err := db.Order("version").Find(&before).Error; err != nil {
					t.Fatal(err)
				}
				task := model.Task{ID: "ordinary-task", UserID: "owner", Operation: "image_to_image", Status: model.TaskStatusFailed, InputJSON: `{"resourceId":"shared-source"}`, BillingOrderID: "ordinary-order"}
				for _, entity := range []any{
					&task,
					&model.Resource{ID: "shared-source", UserID: "owner"},
					&model.Resource{ID: "generated-image", UserID: "owner"},
					&model.Asset{ID: "shared-asset", UserID: "owner", PayloadJSON: `{"resourceId":"shared-source"}`},
					&model.BillingOrder{ID: "ordinary-order", UserID: "owner", TaskID: task.ID, Status: model.BillingStatusSettled},
					&model.CreditLedgerEntry{ID: "ledger", UserID: "owner", BillingOrderID: "ordinary-order", AmountMicrocredits: 10},
					&model.PluginPlatformState{PluginID: "other-plugin", Available: true},
				} {
					if err := db.Create(entity).Error; err != nil {
						t.Fatal(err)
					}
				}
				// Compare persisted timestamps: PostgreSQL stores microsecond precision.
				if err := db.First(&task, "id = ?", task.ID).Error; err != nil {
					t.Fatal(err)
				}
				for range 2 {
					if err := MigrateSchema(db); err != nil {
						t.Fatal(err)
					}
				}
				var after []schemaMigration
				if err := db.Where("version <= ?", before[len(before)-1].Version).Order("version").Find(&after).Error; err != nil || !reflect.DeepEqual(before, after) {
					t.Fatalf("published migration identities or timestamps changed: %v", err)
				}
				var stored model.Task
				if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
					t.Fatal(err)
				}
				if !task.CreatedAt.Equal(stored.CreatedAt) || !task.UpdatedAt.Equal(stored.UpdatedAt) {
					t.Fatal("ordinary task timestamps changed")
				}
				task.CreatedAt, task.UpdatedAt = stored.CreatedAt, stored.UpdatedAt
				if !reflect.DeepEqual(task, stored) {
					t.Fatal("ordinary failed image task changed")
				}
				for _, entity := range []any{&model.Asset{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
					var count int64
					if err := db.Model(entity).Count(&count).Error; err != nil || count != 1 {
						t.Fatalf("shared business record removed: %T %d %v", entity, count, err)
					}
				}
				var resources int64
				if err := db.Model(&model.Resource{}).Count(&resources).Error; err != nil || resources != 2 {
					t.Fatalf("migration must leave physical resource deletion to reference checks: %d %v", resources, err)
				}
				var state model.PluginPlatformState
				if err := db.First(&state, "plugin_id = ?", "other-plugin").Error; err != nil || !state.Available {
					t.Fatalf("unrelated plugin state changed: %v", err)
				}
				assertEcommerceSchemaRemoved(t, db)
				if err := db.AutoMigrate(Models()...); err != nil {
					t.Fatal(err)
				}
				assertEcommerceSchemaRemoved(t, db)
				if status, err := ReadSchemaStatus(db); err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
					t.Fatalf("cleaned schema not ready: %+v %v", status, err)
				}
			})
		}
	}
}

func TestEcommerceRemovalRefusesLinkedTasks(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		for _, link := range []string{"column", "step", "version", "operation"} {
			t.Run(driver+"/"+link, func(t *testing.T) {
				db := ecommerceRemovalTestDB(t, driver)
				if err := db.AutoMigrate(&model.Task{}, &model.UserPluginState{}); err != nil {
					t.Fatal(err)
				}
				if err := migrateEcommerce(db); err != nil {
					t.Fatal(err)
				}
				task := model.Task{ID: "retired-task", UserID: "owner", Operation: "image_to_image", Status: model.TaskStatusFailed}
				if link == "operation" {
					task.Operation = "ecommerce_image"
				}
				if err := db.Create(&task).Error; err != nil {
					t.Fatal(err)
				}
				var err error
				switch link {
				case "column":
					err = db.Model(&task).UpdateColumn("ecommerce_step_id", "step").Error
				case "step":
					err = db.Create(&EcommerceStep{ID: "step", TaskID: &task.ID}).Error
				case "version":
					err = db.Create(&EcommerceImageVersion{ID: "version", TaskID: task.ID}).Error
				}
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Transaction(removeEcommerceStudio); err == nil || !strings.Contains(err.Error(), "任务") {
					t.Fatalf("task link could be erased and enable another charge: %v", err)
				}
				if !db.Migrator().HasTable("ecommerce_products") || !db.Migrator().HasColumn(&ecommerceTaskV51{}, "EcommerceStepID") {
					t.Fatal("refused removal changed the schema")
				}
				if err := db.Delete(&task).Error; err != nil {
					t.Fatal(err)
				}
				for range 2 {
					if err := db.Transaction(removeEcommerceStudio); err != nil {
						t.Fatal(err)
					}
				}
				assertEcommerceSchemaRemoved(t, db)
			})
		}
	}
}
