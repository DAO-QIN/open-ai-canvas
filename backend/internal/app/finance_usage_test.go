package app

import (
	"errors"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newCreditUsageTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.Task{}, &model.LogicalModel{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

type creditUsageFixture struct {
	id         string
	userID     string
	entryType  model.CreditLedgerType
	amount     int64
	at         time.Time
	capability string
	// model 写在账单与流水上，与真实结算一致。
	model   string
	task    *model.Task
	noOrder bool
}

func seedCreditUsage(t *testing.T, db *gorm.DB, items []creditUsageFixture) {
	t.Helper()
	for _, item := range items {
		userID := item.userID
		if userID == "" {
			userID = "user-1"
		}
		orderID := ""
		if !item.noOrder {
			orderID = "order-" + item.id
			taskID := ""
			if item.task != nil {
				item.task.UserID = userID
				if err := db.Create(item.task).Error; err != nil {
					t.Fatal(err)
				}
				taskID = item.task.ID
			}
			order := model.BillingOrder{ID: orderID, UserID: userID, IdempotencyKey: "usage:" + item.id, TaskID: taskID, Model: item.model, Capability: item.capability, Status: model.BillingStatusSettled}
			if err := db.Create(&order).Error; err != nil {
				t.Fatal(err)
			}
		}
		entry := model.CreditLedgerEntry{ID: "entry-" + item.id, UserID: userID, Type: item.entryType, AmountMicrocredits: item.amount, BillingOrderID: orderID, Model: item.model, CreatedAt: item.at}
		if err := db.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestCreditUsageGroupsConsumptionByLocalDayAndAgentOrigin(t *testing.T) {
	svc, db := newCreditUsageTestService(t)
	cst := time.FixedZone("CST", 8*3600)
	submission := "submission-1"
	seedCreditUsage(t, db, []creditUsageFixture{
		// 本地 10-27 23:30，UTC 仍是 10-27。
		{id: "canvas-image", entryType: model.CreditLedgerConsume, amount: -2_000_000, at: time.Date(2026, 10, 27, 23, 30, 0, 0, cst), capability: "image", model: "nano-banana-pro", task: &model.Task{ID: "task-canvas", Operation: "text_to_image"}},
		// 本地 10-28 00:10 = UTC 10-27 16:10，必须落在本地 10-28。
		{id: "agent-video", entryType: model.CreditLedgerConsume, amount: -3_000_000, at: time.Date(2026, 10, 27, 16, 10, 0, 0, time.UTC), capability: "video", model: "veo-3", task: &model.Task{ID: "task-agent-video", Operation: "text_to_video", AgentRunID: "run-1"}},
		{id: "agent-step", entryType: model.CreditLedgerConsume, amount: -1_500_000, at: time.Date(2026, 10, 28, 9, 0, 0, 0, cst), capability: "text", model: "gemini-3-pro", task: &model.Task{ID: "task-agent-step", Operation: "cloud_agent_step"}},
		{id: "creation", entryType: model.CreditLedgerConsume, amount: -500_000, at: time.Date(2026, 10, 26, 12, 0, 0, 0, cst), capability: "image", model: "nano-banana-pro", task: &model.Task{ID: "task-creation", Operation: "text_to_image", CreationSubmissionID: &submission}},
		{id: "proxy", entryType: model.CreditLedgerConsume, amount: -700_000, at: time.Date(2026, 10, 26, 13, 0, 0, 0, cst), capability: "image", model: "gpt-image-1"},
		{id: "orphan", entryType: model.CreditLedgerConsume, amount: -100_000, at: time.Date(2026, 10, 26, 14, 0, 0, 0, cst), noOrder: true},
		{id: "first-day", entryType: model.CreditLedgerConsume, amount: -250_000, at: time.Date(2025, 10, 29, 0, 30, 0, 0, cst), capability: "audio"},
		// 以下都不是消耗或不在窗口内。
		{id: "refund", entryType: model.CreditLedgerRefund, amount: 2_000_000, at: time.Date(2026, 10, 28, 10, 0, 0, 0, cst), capability: "image"},
		{id: "reserve", entryType: model.CreditLedgerReserve, amount: 0, at: time.Date(2026, 10, 28, 10, 0, 0, 0, cst), capability: "image"},
		{id: "admin", entryType: model.CreditLedgerAdminAdjust, amount: -5_000_000, at: time.Date(2026, 10, 28, 10, 0, 0, 0, cst), noOrder: true},
		{id: "topup", entryType: model.CreditLedgerPaymentTopup, amount: 10_000_000, at: time.Date(2026, 10, 28, 10, 0, 0, 0, cst), noOrder: true},
		{id: "free", entryType: model.CreditLedgerConsume, amount: 0, at: time.Date(2026, 10, 25, 10, 0, 0, 0, cst), capability: "image"},
		{id: "before-window", entryType: model.CreditLedgerConsume, amount: -900_000, at: time.Date(2025, 10, 28, 23, 59, 0, 0, cst), capability: "image"},
		{id: "after-today", entryType: model.CreditLedgerConsume, amount: -900_000, at: time.Date(2026, 10, 29, 0, 5, 0, 0, cst), capability: "image"},
		{id: "other-user", userID: "user-2", entryType: model.CreditLedgerConsume, amount: -900_000, at: time.Date(2026, 10, 28, 10, 0, 0, 0, cst), capability: "image"},
	})

	// 前台模型名称：未登记的编码（代理调用的 gpt-image-1、gemini-3-pro）返回空名称，由前端显示编码。
	for _, item := range []model.LogicalModel{{ID: "lm-nano", Code: "nano-banana-pro", Name: "Nano Banana Pro"}, {ID: "lm-veo", Code: "veo-3", Name: "Veo 3"}} {
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}

	report, err := svc.creditUsageAt(&model.User{ID: "user-1"}, 480, time.Date(2026, 10, 28, 12, 0, 0, 0, cst))
	if err != nil {
		t.Fatalf("creditUsageAt() error = %v", err)
	}
	if report.From != "2025-10-29" || report.To != "2026-10-28" || report.Days != 365 || report.TimezoneOffset != 480 {
		t.Fatalf("window = %s..%s days=%d offset=%d", report.From, report.To, report.Days, report.TimezoneOffset)
	}
	want := []CreditUsageDay{
		{Date: "2025-10-29", TotalMicrocredits: 250_000, Count: 1},
		{Date: "2026-10-26", TotalMicrocredits: 1_300_000, AgentMicrocredits: 500_000, Count: 3, AgentCount: 1},
		{Date: "2026-10-27", TotalMicrocredits: 2_000_000, Count: 1},
		{Date: "2026-10-28", TotalMicrocredits: 4_500_000, AgentMicrocredits: 4_500_000, Count: 2, AgentCount: 2},
	}
	if len(report.Daily) != len(want) {
		t.Fatalf("daily = %#v, want %#v", report.Daily, want)
	}
	for index := range want {
		if report.Daily[index] != want[index] {
			t.Fatalf("daily[%d] = %#v, want %#v", index, report.Daily[index], want[index])
		}
	}
	wantCategories := []CreditUsageCategory{
		{Capability: "image", TotalMicrocredits: 3_200_000, AgentMicrocredits: 500_000, Count: 3, AgentCount: 1},
		{Capability: "video", TotalMicrocredits: 3_000_000, AgentMicrocredits: 3_000_000, Count: 1, AgentCount: 1},
		{Capability: "text", TotalMicrocredits: 1_500_000, AgentMicrocredits: 1_500_000, Count: 1, AgentCount: 1},
		{Capability: "audio", TotalMicrocredits: 250_000, Count: 1},
		{Capability: "other", TotalMicrocredits: 100_000, Count: 1},
	}
	if len(report.Categories) != len(wantCategories) {
		t.Fatalf("categories = %#v, want %#v", report.Categories, wantCategories)
	}
	for index := range wantCategories {
		if report.Categories[index] != wantCategories[index] {
			t.Fatalf("categories[%d] = %#v, want %#v", index, report.Categories[index], wantCategories[index])
		}
	}
	// 模型构成跨日合并；没有记录模型的消耗按类型各成一行（编码为空）。
	wantModels := []CreditUsageModel{
		{Model: "veo-3", Name: "Veo 3", Capability: "video", TotalMicrocredits: 3_000_000, AgentMicrocredits: 3_000_000, Count: 1, AgentCount: 1},
		{Model: "nano-banana-pro", Name: "Nano Banana Pro", Capability: "image", TotalMicrocredits: 2_500_000, AgentMicrocredits: 500_000, Count: 2, AgentCount: 1},
		{Model: "gemini-3-pro", Capability: "text", TotalMicrocredits: 1_500_000, AgentMicrocredits: 1_500_000, Count: 1, AgentCount: 1},
		{Model: "gpt-image-1", Capability: "image", TotalMicrocredits: 700_000, Count: 1},
		{Model: "", Capability: "audio", TotalMicrocredits: 250_000, Count: 1},
		{Model: "", Capability: "other", TotalMicrocredits: 100_000, Count: 1},
	}
	if len(report.Models) != len(wantModels) {
		t.Fatalf("models = %#v, want %#v", report.Models, wantModels)
	}
	for index := range wantModels {
		if report.Models[index] != wantModels[index] {
			t.Fatalf("models[%d] = %#v, want %#v", index, report.Models[index], wantModels[index])
		}
	}
}

func TestCreditUsageCountsEveryAgentOperation(t *testing.T) {
	svc, db := newCreditUsageTestService(t)
	cst := time.FixedZone("CST", 8*3600)
	at := time.Date(2026, 10, 28, 9, 0, 0, 0, cst)
	items := []creditUsageFixture{}
	for _, operation := range creditUsageAgentOperations {
		items = append(items, creditUsageFixture{id: operation, entryType: model.CreditLedgerConsume, amount: -1_000_000, at: at, capability: "text", task: &model.Task{ID: "task-" + operation, Operation: operation}})
	}
	items = append(items, creditUsageFixture{id: "plain-text", entryType: model.CreditLedgerConsume, amount: -1_000_000, at: at, capability: "text", task: &model.Task{ID: "task-plain-text", Operation: "text"}})
	seedCreditUsage(t, db, items)
	report, err := svc.creditUsageAt(&model.User{ID: "user-1"}, 480, time.Date(2026, 10, 28, 12, 0, 0, 0, cst))
	if err != nil {
		t.Fatalf("creditUsageAt() error = %v", err)
	}
	agents := int64(len(creditUsageAgentOperations))
	if len(report.Daily) != 1 || report.Daily[0].Count != agents+1 || report.Daily[0].AgentCount != agents || report.Daily[0].AgentMicrocredits != agents*1_000_000 {
		t.Fatalf("daily = %#v", report.Daily)
	}
}

func TestCreditUsageUsesRequestedOffsetForTodayAndWindow(t *testing.T) {
	svc, db := newCreditUsageTestService(t)
	seedCreditUsage(t, db, []creditUsageFixture{
		// UTC 10-28 02:00 在 UTC-5 是 10-27 21:00。
		{id: "west", entryType: model.CreditLedgerConsume, amount: -1_000_000, at: time.Date(2026, 10, 28, 2, 0, 0, 0, time.UTC), capability: "image"},
	})
	report, err := svc.creditUsageAt(&model.User{ID: "user-1"}, -300, time.Date(2026, 10, 28, 3, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("creditUsageAt() error = %v", err)
	}
	if report.To != "2026-10-27" || report.From != "2025-10-28" {
		t.Fatalf("window = %s..%s, want 2025-10-28..2026-10-27", report.From, report.To)
	}
	if len(report.Daily) != 1 || report.Daily[0].Date != "2026-10-27" || report.Daily[0].TotalMicrocredits != 1_000_000 {
		t.Fatalf("daily = %#v", report.Daily)
	}
}

func TestCreditUsageRejectsInvalidRequests(t *testing.T) {
	svc, _ := newCreditUsageTestService(t)
	if _, err := svc.creditUsageAt(nil, 480, time.Now()); err == nil {
		t.Fatal("anonymous usage request was accepted")
	}
	for _, offset := range []int{-721, 841} {
		_, err := svc.creditUsageAt(&model.User{ID: "user-1"}, offset, time.Now())
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 400 {
			t.Fatalf("offset %d error = %v, want 400", offset, err)
		}
	}
	report, err := svc.creditUsageAt(&model.User{ID: "user-1"}, 840, time.Now())
	// 空报告的数组必须是 [] 而不是 null，前端可以直接遍历。
	if err != nil || report.Daily == nil || report.Categories == nil || report.Models == nil || len(report.Daily) != 0 || len(report.Categories) != 0 || len(report.Models) != 0 {
		t.Fatalf("empty report = %#v err=%v", report, err)
	}
}

func TestFloorDivInt64RoundsTowardNegativeInfinity(t *testing.T) {
	for _, tc := range []struct{ value, divisor, want int64 }{{86399, 86400, 0}, {86400, 86400, 1}, {-1, 86400, -1}, {-86400, 86400, -1}, {-86401, 86400, -2}} {
		if got := floorDivInt64(tc.value, tc.divisor); got != tc.want {
			t.Fatalf("floorDivInt64(%d, %d) = %d, want %d", tc.value, tc.divisor, got, tc.want)
		}
	}
}
