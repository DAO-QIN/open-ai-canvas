package database

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var creationSessionTables = []any{&model.CreationSession{}, &model.CreationEntry{}, &model.CreationEntryTask{}, &model.CreationAgentEvent{}}

// forEachCreationMigrationDB 在 SQLite 临时库上运行；配置 CANVAS_TEST_POSTGRES_DSN 时再在独立 PostgreSQL schema 上运行。
func forEachCreationMigrationDB(t *testing.T, run func(*testing.T, *gorm.DB)) {
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "creation-migration.db")), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := db.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
		run(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
		if dsn == "" {
			t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
		}
		base, err := Open(Config{Driver: "postgres", DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		baseSQL, _ := base.DB()
		schemaName := fmt.Sprintf("creation_sessions_migration_%d", time.Now().UnixNano())
		if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := base.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error; err != nil {
				t.Error(err)
			}
			_ = baseSQL.Close()
		})
		testDSN, err := postgresDSNWithSearchPath(dsn, schemaName)
		if err != nil {
			t.Fatal(err)
		}
		db, err := Open(Config{Driver: "postgres", DSN: testDSN})
		if err != nil {
			t.Fatal(err)
		}
		dbSQL, _ := db.DB()
		t.Cleanup(func() { _ = dbSQL.Close() })
		run(t, db)
	})
}

func TestCreationSessionsMigrationOnFreshDatabase(t *testing.T) {
	forEachCreationMigrationDB(t, func(t *testing.T, db *gorm.DB) {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		status, err := ReadSchemaStatus(db)
		if err != nil || !status.Ready || status.Current != 64 {
			t.Fatalf("unexpected schema status: %+v, %v", status, err)
		}
		for _, table := range creationSessionTables {
			if !db.Migrator().HasTable(table) {
				t.Fatalf("missing table for %T", table)
			}
		}
		for _, column := range []string{"Target", "CreationSessionID"} {
			if !db.Migrator().HasColumn(&model.CloudAgentExecution{}, column) {
				t.Fatalf("missing cloud agent column %s", column)
			}
		}
	})
}

func TestCreationSessionsMigrationUpgradesExistingRuns(t *testing.T) {
	forEachCreationMigrationDB(t, func(t *testing.T, db *gorm.DB) {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		var existingMigrations []schemaMigration
		if err := db.Where("version <= ?", 63).Order("version").Find(&existingMigrations).Error; err != nil {
			t.Fatal(err)
		}
		// 还原成 Schema 63：删除新表和新列，再写一条旧运行。
		for _, table := range creationSessionTables {
			if err := db.Migrator().DropTable(table); err != nil {
				t.Fatal(err)
			}
		}
		// GORM 的 PostgreSQL DropIndex 在带 search_path 的连接上会拼出非法的 schema 前缀，这里用两种库通用的 SQL。
		if err := db.Exec("DROP INDEX IF EXISTS idx_cloud_agent_executions_creation_session_id").Error; err != nil {
			t.Fatal(err)
		}
		for _, column := range []string{"Target", "CreationSessionID"} {
			if err := db.Migrator().DropColumn(&model.CloudAgentExecution{}, column); err != nil {
				t.Fatal(err)
			}
		}
		if err := db.Exec("INSERT INTO cloud_agent_executions (id, user_id, status, revision, state_json) VALUES (?, ?, ?, ?, ?)", "old-run", "user", "completed", 3, `{"keep":true}`).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Exec("DELETE FROM schema_migrations WHERE version > 63").Error; err != nil {
			t.Fatal(err)
		}

		for range 2 {
			if err := MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
		}

		var preservedMigrations []schemaMigration
		if err := db.Where("version <= ?", 63).Order("version").Find(&preservedMigrations).Error; err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(existingMigrations, preservedMigrations) {
			t.Fatal("upgrade changed the existing migration ledger")
		}
		status, err := ReadSchemaStatus(db)
		if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
			t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
		}
		for _, table := range creationSessionTables {
			if !db.Migrator().HasTable(table) {
				t.Fatalf("missing table for %T", table)
			}
		}
		if !db.Migrator().HasIndex(&model.CloudAgentExecution{}, "CreationSessionID") {
			t.Fatal("missing creation session index on cloud agent runs")
		}
		var run model.CloudAgentExecution
		if err := db.First(&run, "id = ?", "old-run").Error; err != nil {
			t.Fatal(err)
		}
		if run.Target != model.CloudAgentTargetCanvas || run.OutputTarget() != model.CloudAgentTargetCanvas || run.CreationSessionID != "" || run.StateJSON != `{"keep":true}` || run.Revision != 3 {
			t.Fatalf("migration changed existing run: %+v", run)
		}
	})
}

func TestCloudAgentOutputTargetTreatsEmptyAsCanvas(t *testing.T) {
	for target, want := range map[string]string{"": model.CloudAgentTargetCanvas, "canvas": model.CloudAgentTargetCanvas, "creation": model.CloudAgentTargetCreation, "unknown": model.CloudAgentTargetCanvas} {
		if got := (model.CloudAgentExecution{Target: target}).OutputTarget(); got != want {
			t.Fatalf("OutputTarget(%q) = %q, want %q", target, got, want)
		}
	}
}
