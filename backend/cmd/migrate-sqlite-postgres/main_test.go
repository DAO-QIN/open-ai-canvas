package main

import (
	"sync"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestMigrationListCoversSchemaModels(t *testing.T) {
	want := make(map[string]bool, len(database.Models()))
	cache := &sync.Map{}
	for _, value := range database.Models() {
		parsed, err := schema.Parse(value, cache, schema.NamingStrategy{})
		if err != nil {
			t.Fatal(err)
		}
		want[parsed.Table] = false
	}
	for _, migration := range migrations() {
		if _, exists := want[migration.name]; !exists {
			t.Fatalf("migration list contains unknown table %q", migration.name)
		}
		if want[migration.name] {
			t.Fatalf("migration list contains duplicate table %q", migration.name)
		}
		want[migration.name] = true
	}
	for table, covered := range want {
		if !covered {
			t.Errorf("migration list is missing table %q", table)
		}
	}
}

func TestCanvasHistoryCompositeKeyMigration(t *testing.T) {
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-source?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-target?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []*gorm.DB{source, target} {
		if err := db.AutoMigrate(&model.Resource{}, &model.CanvasSnapshotResource{}); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Resource{ID: "resource"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	refs := []model.CanvasSnapshotResource{{SnapshotID: "b", ResourceID: "resource"}, {SnapshotID: "a", ResourceID: "resource"}}
	if err := source.Create(&refs).Error; err != nil {
		t.Fatal(err)
	}
	count, err := migrateTable[model.CanvasSnapshotResource]("canvas_snapshot_resources").run(source, target, true)
	if err != nil || count != 2 {
		t.Fatalf("history refs not copied/verified: %d %v", count, err)
	}
}

func TestFreshMigrationPreservesSourceSequencesAndOfficialAvailability(t *testing.T) {
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:" + t.Name() + "-source?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:" + t.Name() + "-target?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(source); err != nil {
		t.Fatal(err)
	}
	if err := verifyMigrationCoverage(source); err != nil {
		t.Fatal(err)
	}
	if err := source.Model(&model.IDSequence{}).Where("name = ?", "id:MODEL").Update("value", 41).Error; err != nil {
		t.Fatal(err)
	}
	if err := source.Create(&model.PluginPlatformState{PluginID: "test-official-plugin", Available: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := target.Transaction(func(tx *gorm.DB) error {
		if err := createFreshMigrationSchema(tx); err != nil {
			return err
		}
		for _, migration := range migrations() {
			if _, err := migration.run(source, tx, true); err != nil {
				return err
			}
		}
		return database.ReconcilePrefixedIDSequences(tx)
	}); err != nil {
		t.Fatalf("fresh migration must copy populated sequence and official state snapshots: %v", err)
	}
	for _, migration := range migrations() {
		if _, err := migration.run(source, target, false); err != nil {
			t.Fatalf("repeat verification changed %s: %v", migration.name, err)
		}
	}
	id, err := database.AllocatePrefixedID(target, "MODEL")
	if err != nil || id != "MODEL_000042" {
		t.Fatalf("source sequence was not preserved: %s %v", id, err)
	}
	if err := source.Exec("DELETE FROM schema_migrations WHERE version = ?", database.CurrentSchemaVersion).Error; err != nil {
		t.Fatal(err)
	}
	if err := verifyMigrationCoverage(source); err == nil {
		t.Fatal("an old SQLite schema must be upgraded before row copying can discard retired task links")
	}
}
