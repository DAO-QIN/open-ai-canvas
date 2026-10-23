package database

import (
	"path/filepath"
	"reflect"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAgentMemoryProposalMigrationPreservesExistingMemories(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "memory-migration.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var existingMigrations []schemaMigration
	if err := db.Where("version <= ?", 60).Order("version").Find(&existingMigrations).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AgentLesson{ID: "existing", AuthorUserID: "user", Topic: "existing memory", Status: model.AgentLessonStatusApproved, Source: "preserve source"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.AgentMemoryProposal{}, &model.AgentMemoryRevision{}} {
		if err := db.Migrator().DropTable(table); err != nil {
			t.Fatal(err)
		}
	}
	for _, column := range []string{"CompactProposalID", "CompactCursor"} {
		if err := db.Migrator().DropColumn(&model.AgentMemorySetting{}, column); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec("DELETE FROM schema_migrations WHERE version > 60").Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var preservedMigrations []schemaMigration
	if err := db.Where("version <= ?", 60).Order("version").Find(&preservedMigrations).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(existingMigrations, preservedMigrations) {
		t.Fatal("upgrade changed the existing migration ledger")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
	for _, table := range []any{&model.AgentMemoryProposal{}, &model.AgentMemoryRevision{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table for %T", table)
		}
	}
	for _, column := range []string{"CompactProposalID", "CompactCursor"} {
		if !db.Migrator().HasColumn(&model.AgentMemorySetting{}, column) {
			t.Fatalf("missing settings column %s", column)
		}
	}
	var lesson model.AgentLesson
	if err := db.First(&lesson, "id = ?", "existing").Error; err != nil || lesson.Source != "preserve source" || lesson.Status != model.AgentLessonStatusApproved {
		t.Fatalf("migration changed existing memory: %+v %v", lesson, err)
	}
}
