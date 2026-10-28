package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 同一组数据分别在 SQLite（时间存为带偏移文本）和真实 PostgreSQL（timestamptz）上按本地日分组。
func TestCreditUsageBucketsByInstant(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		testCreditUsageBucketsByInstant(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("credit_usage_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			connection, _ := admin.DB()
			_ = connection.Close()
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), config)
		if err != nil {
			t.Fatal(err)
		}
		connection, _ := db.DB()
		t.Cleanup(func() { _ = connection.Close() })
		testCreditUsageBucketsByInstant(t, db)
	})
}

func testCreditUsageBucketsByInstant(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.Task{}, &model.LogicalModel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "task-agent-video", UserID: "user-1", Operation: "cloud_agent_step"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, order := range []model.BillingOrder{
		{ID: "order-image", UserID: "user-1", IdempotencyKey: "usage:image", Model: "nano-banana-pro", Capability: "image", Status: model.BillingStatusSettled},
		{ID: "order-image-2", UserID: "user-1", IdempotencyKey: "usage:image-2", Model: "seedream-4", Capability: "image", Status: model.BillingStatusSettled},
		{ID: "order-video", UserID: "user-1", IdempotencyKey: "usage:video", TaskID: "task-agent-video", Model: "veo-3", Capability: "video", Status: model.BillingStatusSettled},
	} {
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}
	cst := time.FixedZone("CST", 8*3600)
	// 同一天的消耗分别以 UTC 和 +08:00 文本存储，只能按时刻而不是文本划日。
	// 模型优先取流水上的值（结算时的最终模型），流水为空才回落到账单。
	for _, entry := range []model.CreditLedgerEntry{
		{ID: "utc-text", UserID: "user-1", Type: model.CreditLedgerConsume, AmountMicrocredits: -1_000_000, BillingOrderID: "order-image", CreatedAt: time.Date(2026, 10, 27, 16, 30, 0, 0, time.UTC)},
		{ID: "cst-text", UserID: "user-1", Type: model.CreditLedgerConsume, AmountMicrocredits: -2_000_000, BillingOrderID: "order-image", Model: "nano-banana-pro", CreatedAt: time.Date(2026, 10, 28, 0, 30, 0, 0, cst)},
		{ID: "second-image-model", UserID: "user-1", Type: model.CreditLedgerConsume, AmountMicrocredits: -600_000, BillingOrderID: "order-image-2", Model: "seedream-4", CreatedAt: time.Date(2026, 10, 28, 9, 0, 0, 0, cst)},
		{ID: "same-day-video", UserID: "user-1", Type: model.CreditLedgerConsume, AmountMicrocredits: -5_000_000, BillingOrderID: "order-video", Model: "veo-3", CreatedAt: time.Date(2026, 10, 28, 20, 0, 0, 0, cst)},
		{ID: "previous-day", UserID: "user-1", Type: model.CreditLedgerConsume, AmountMicrocredits: -4_000_000, BillingOrderID: "order-image", Model: "nano-banana-legacy", CreatedAt: time.Date(2026, 10, 27, 23, 59, 0, 0, cst)},
		{ID: "outside", UserID: "user-1", Type: model.CreditLedgerConsume, AmountMicrocredits: -9_000_000, BillingOrderID: "order-image", CreatedAt: time.Date(2026, 10, 29, 0, 0, 0, 0, cst)},
	} {
		if err := db.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}
	from := time.Date(2026, 10, 27, 0, 0, 0, 0, cst)
	to := time.Date(2026, 10, 29, 0, 0, 0, 0, cst)
	rows, err := New(db).CreditUsage("user-1", from, to, 8*3600, []string{"cloud_agent_step"})
	if err != nil {
		t.Fatalf("CreditUsage() error = %v", err)
	}
	day27 := time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC).Unix() / 86400
	type key struct {
		day        int64
		capability string
		model      string
	}
	got := map[key]CreditUsageRow{}
	for _, row := range rows {
		got[key{row.DayIndex, row.Capability, row.Model}] = row
	}
	if len(rows) != 4 {
		t.Fatalf("rows = %#v", rows)
	}
	if row := got[key{day27, "image", "nano-banana-legacy"}]; row.TotalMicrocredits != 4_000_000 || row.EntryCount != 1 {
		t.Fatalf("day27 image = %#v", row)
	}
	if row := got[key{day27 + 1, "image", "nano-banana-pro"}]; row.TotalMicrocredits != 3_000_000 || row.EntryCount != 2 || row.AgentMicrocredits != 0 || row.AgentEntryCount != 0 {
		t.Fatalf("day28 nano banana = %#v", row)
	}
	if row := got[key{day27 + 1, "image", "seedream-4"}]; row.TotalMicrocredits != 600_000 || row.EntryCount != 1 {
		t.Fatalf("day28 seedream = %#v", row)
	}
	if row := got[key{day27 + 1, "video", "veo-3"}]; row.TotalMicrocredits != 5_000_000 || row.EntryCount != 1 || row.AgentMicrocredits != 5_000_000 || row.AgentEntryCount != 1 {
		t.Fatalf("day28 video = %#v", row)
	}

	// 名称：同一编码优先未归档的模型；只剩归档模型时取最近更新的；空名称不返回。
	older := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for _, item := range []model.LogicalModel{
		{ID: "lm-active", Code: "nano-banana-pro", Name: "Nano Banana Pro", UpdatedAt: older},
		{ID: "lm-archived-same-code", Code: "nano-banana-pro", Name: "旧名称", ArchivedAt: &older, UpdatedAt: newer},
		{ID: "lm-veo-old", Code: "veo-3", Name: "Veo 3（旧）", ArchivedAt: &older, UpdatedAt: older},
		{ID: "lm-veo-new", Code: "veo-3", Name: "Veo 3", ArchivedAt: &newer, UpdatedAt: newer},
		{ID: "lm-blank", Code: "seedream-4", Name: "  "},
	} {
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	names, err := New(db).LogicalModelNamesByCode([]string{"nano-banana-pro", "veo-3", "seedream-4", "unknown"})
	if err != nil {
		t.Fatalf("LogicalModelNamesByCode() error = %v", err)
	}
	if len(names) != 2 || names["nano-banana-pro"] != "Nano Banana Pro" || names["veo-3"] != "Veo 3" {
		t.Fatalf("names = %#v", names)
	}
}

func TestCreditUsageQueryUsesInstantRangeOnPostgres(t *testing.T) {
	capture := &sqlCaptureLogger{}
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  "host=localhost user=test dbname=test sslmode=disable",
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableAutomaticPing:   true,
		DryRun:                 true,
		Logger:                 capture,
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Fatalf("open dry-run postgres database: %v", err)
	}
	from := time.Date(2025, 10, 28, 16, 0, 0, 0, time.UTC)
	to := time.Date(2026, 10, 28, 16, 0, 0, 0, time.UTC)
	if _, err := New(db).CreditUsage("user-1", from, to, 8*3600, []string{"cloud_agent", "cloud_agent_step"}); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("CreditUsage() error = %v", err)
	}
	if len(capture.statements) != 1 {
		t.Fatalf("statements = %#v", capture.statements)
	}
	statement := capture.statements[0]
	for _, want := range []string{
		"CAST(FLOOR((EXTRACT(EPOCH FROM e.created_at) + CAST(28800 AS BIGINT)) / 86400) AS BIGINT) AS day_index",
		"COALESCE(o.capability, '') AS capability",
		"COALESCE(NULLIF(e.model, ''), o.model, '') AS model",
		"e.user_id = 'user-1' AND e.type = 'consume' AND e.amount_microcredits < 0",
		"e.created_at >= '2025-10-28 16:00:00",
		"e.created_at < '2026-10-28 16:00:00",
		"LEFT JOIN tasks t ON t.id = o.task_id",
		"COALESCE(t.operation, '') IN ('cloud_agent','cloud_agent_step')",
		"GROUP BY day_index, COALESCE(o.capability, ''), COALESCE(NULLIF(e.model, ''), o.model, '') ORDER BY day_index",
	} {
		if !strings.Contains(statement, want) {
			t.Fatalf("SQL missing %q:\n%s", want, statement)
		}
	}
	if strings.Contains(statement, "unixepoch") {
		t.Fatalf("postgres SQL must not use the SQLite epoch helper:\n%s", statement)
	}
}
