package promotion

import (
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openPromotionDB(t *testing.T, driver string) *gorm.DB {
	t.Helper()
	config := &gorm.Config{TranslateError: true, Logger: logger.Default.LogMode(logger.Silent)}
	var db *gorm.DB
	var err error
	if driver == "postgres" {
		dsn := os.Getenv("PROMOTION_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("PROMOTION_TEST_POSTGRES_DSN is not configured")
		}
		admin, openErr := gorm.Open(postgres.Open(dsn), config)
		if openErr != nil {
			t.Fatal(openErr)
		}
		schema := "promotion_test_" + kernel.NewID()
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		if strings.Contains(dsn, "://") {
			parsed, parseErr := url.Parse(dsn)
			if parseErr != nil {
				t.Fatal(parseErr)
			}
			query := parsed.Query()
			query.Set("search_path", schema)
			parsed.RawQuery = query.Encode()
			dsn = parsed.String()
		} else {
			dsn += " search_path=" + schema
		}
		db, err = gorm.Open(postgres.Open(dsn), config)
		t.Cleanup(func() {
			if db != nil {
				if sqlDB, e := db.DB(); e == nil {
					_ = sqlDB.Close()
				}
			}
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			if sqlDB, e := admin.DB(); e == nil {
				_ = sqlDB.Close()
			}
		})
	} else {
		db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "promotion.db")+"?_busy_timeout=10000&_journal_mode=WAL"), config)
		t.Cleanup(func() {
			if db != nil {
				if sqlDB, e := db.DB(); e == nil {
					_ = sqlDB.Close()
				}
			}
		})
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.AdminAuditEvent{}, &model.EmailVerificationCode{}, &model.AuthVerification{}, &model.UserIdentity{},
		&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.TopupProduct{}, &model.PaymentOrder{},
		&model.PromotionProfile{}, &model.Invitation{}, &model.CommissionRecord{}, &model.PromotionTransfer{}, &model.CommissionAllocation{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedPromotion(t *testing.T, db *gorm.DB, days int) (*Service, *model.User, *model.User, *model.User) {
	t.Helper()
	repo := repository.New(db)
	svc := New(repo)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	inviter := &model.User{ID: "promoter", Username: "promoter", Role: model.UserRoleUser, Status: model.UserStatusActive}
	invitee := &model.User{ID: "invited", Username: "invitee-private", Email: "secret@example.com", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create([]*model.User{admin, inviter}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdatePolicy(admin, model.PromotionPolicy{Enabled: true, RatioBPS: 500, FreezeDays: days}); err != nil {
		t.Fatal(err)
	}
	profile, err := svc.CreateCode(inviter)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateRegisteredUser(invitee, func(tx *repository.Repository) error { return New(tx).BindInvitation(invitee, *profile.InviteCode) }); err != nil {
		t.Fatal(err)
	}
	return svc, admin, inviter, invitee
}

func newOrder(t *testing.T, db *gorm.DB, svc *Service, user *model.User, snapshot bool) *model.PaymentOrder {
	t.Helper()
	id := kernel.NewID()
	product := model.TopupProduct{ID: id, Name: "1200 credits", Enabled: true, AmountFen: 10000, CreditsMicrocredits: 1200_000_000}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	order := &model.PaymentOrder{ID: id, UserID: user.ID, IdempotencyKey: id, MerchantOrderNo: id, ProductID: product.ID, ProductName: product.Name,
		ProviderID: "test", CreditsMicrocredits: product.CreditsMicrocredits, AmountFen: product.AmountFen, Currency: "CNY", Status: model.PaymentOrderPending}
	repo := repository.New(db)
	var err error
	if snapshot {
		order, _, err = repo.CreatePaymentOrderWithProductReservation(order, func(tx *repository.Repository) (*model.PaymentPromotionSnapshot, error) {
			return New(tx).Snapshot(user.ID, order.CreditsMicrocredits)
		})
	} else {
		order, _, err = repo.CreatePaymentOrderWithProductReservation(order)
	}
	if err != nil {
		t.Fatal(err)
	}
	return order
}

func complete(t *testing.T, db *gorm.DB, order *model.PaymentOrder) {
	t.Helper()
	_, _, err := repository.New(db).CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, repository.PaymentEvidence{ProviderTradeNo: "trade-" + order.ID, AmountFen: order.AmountFen, Currency: order.Currency})
	if err != nil {
		t.Fatal(err)
	}
}

func runPromotionWorkflow(t *testing.T, driver string) {
	t.Run("invitation_is_single_level_and_immutable", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, admin, inviter, invitee := seedPromotion(t, db, 0)
		profile, _ := repository.New(db).PromotionProfile(inviter.ID)
		if err := svc.BindInvitation(inviter, *profile.InviteCode); err == nil {
			t.Fatal("self invitation accepted")
		}
		if err := svc.BindInvitation(invitee, *profile.InviteCode); err == nil {
			t.Fatal("existing invitation rebound")
		}
		promoters, err := svc.Profiles(admin, "prom", 1, 20)
		if err != nil || promoters.Total != 1 || promoters.Items[0].UserID != inviter.ID {
			t.Fatalf("admin profiles=%+v err=%v", promoters, err)
		}
		literal, err := svc.Profiles(admin, "%", 1, 20)
		if err != nil || literal.Total != 0 {
			t.Fatalf("keyword escaped incorrectly: %+v err=%v", literal, err)
		}
		if _, err := svc.UpdateProfile(admin, inviter.ID, ProfileRequest{Version: profile.Version, Paused: true}); err != nil {
			t.Fatal(err)
		}
		if valid, err := svc.ValidateCode(*profile.InviteCode); err != nil || valid {
			t.Fatalf("paused invite valid=%v err=%v", valid, err)
		}
		if _, err := svc.UpdateProfile(admin, inviter.ID, ProfileRequest{Version: profile.Version}); err == nil {
			t.Fatal("stale personal config accepted")
		}
		invitation, err := repository.New(db).InvitationForUser(invitee.ID)
		if err != nil || invitation.InviterID != inviter.ID {
			t.Fatalf("pause changed ownership: %+v %v", invitation, err)
		}
	})
	t.Run("v49_upgrade_preserves_old_orders", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		if err := database.MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		legacy := &model.PaymentOrder{ID: "legacy-order", UserID: "legacy-user", IdempotencyKey: "legacy", MerchantOrderNo: "legacy", ProviderID: "test", AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 100, Status: model.PaymentOrderPending}
		if err := db.Create(legacy).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.CreditAccount{UserID: legacy.UserID, AvailableMicrocredits: 25}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Migrator().DropTable(&model.CommissionAllocation{}, &model.PromotionTransfer{}, &model.CommissionRecord{}, &model.Invitation{}, &model.PromotionProfile{}); err != nil {
			t.Fatal(err)
		}
		if err := db.Migrator().DropColumn(&model.PaymentOrder{}, "PromotionSnapshot"); err != nil {
			t.Fatal(err)
		}
		if err := db.Migrator().DropColumn(&model.OAuthState{}, "InviteCode"); err != nil {
			t.Fatal(err)
		}
		if err := db.Exec("DELETE FROM schema_migrations WHERE version = ?", 50).Error; err != nil {
			t.Fatal(err)
		}
		var previous struct{ Checksum string }
		if err := db.Table("schema_migrations").First(&previous, "version = ?", 49).Error; err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if err := database.MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
		}
		status, err := database.ReadSchemaStatus(db)
		if err != nil || !status.Ready || status.Current != 50 {
			t.Fatalf("migration status=%+v err=%v", status, err)
		}
		var latest struct{ Checksum string }
		if err := db.Table("schema_migrations").First(&latest, "version = ?", 49).Error; err != nil || latest.Checksum != previous.Checksum {
			t.Fatalf("old checksum changed: %+v %v", latest, err)
		}
		persisted, err := repository.New(db).PaymentOrder(legacy.ID)
		if err != nil || persisted.PromotionSnapshot != nil || persisted.CreditsMicrocredits != 100 {
			t.Fatalf("legacy order=%+v err=%v", persisted, err)
		}
		complete(t, db, legacy)
		account, err := repository.New(db).CreditAccount(legacy.UserID)
		if err != nil || account.AvailableMicrocredits != 125 {
			t.Fatalf("legacy wallet=%+v err=%v", account, err)
		}
		var commissions int64
		if err := db.Model(&model.CommissionRecord{}).Count(&commissions).Error; err != nil || commissions != 0 {
			t.Fatalf("legacy commissions=%d err=%v", commissions, err)
		}
	})
	t.Run("payment_concurrency_and_order_snapshot_reuse", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, _, inviter, invitee := seedPromotion(t, db, 0)
		order := newOrder(t, db, svc, invitee, true)
		reused, created, err := repository.New(db).CreatePaymentOrderWithProductReservation(order, func(*repository.Repository) (*model.PaymentPromotionSnapshot, error) {
			t.Error("duplicate order recalculated promotion snapshot")
			return nil, errors.New("must not calculate")
		})
		if err != nil || created || reused.ID != order.ID || reused.PromotionSnapshot.AmountMicrocredits != 60000000 {
			t.Fatalf("order reuse=%+v created=%v err=%v", reused, created, err)
		}
		var wg sync.WaitGroup
		for range 12 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, _, _ = repository.New(db).CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, repository.PaymentEvidence{ProviderTradeNo: "trade-" + order.ID, AmountFen: order.AmountFen, Currency: order.Currency})
			}()
		}
		wg.Wait()
		// SQLite may reject a competing writer; the durable retry uses this same entry.
		complete(t, db, order)
		view, err := svc.Overview(inviter)
		if err != nil || view.TotalMicrocredits != "60000000" {
			t.Fatalf("concurrent credit=%+v err=%v", view, err)
		}
		account, err := repository.New(db).CreditAccount(invitee.ID)
		if err != nil || account.AvailableMicrocredits != order.CreditsMicrocredits {
			t.Fatalf("payer wallet=%+v err=%v", account, err)
		}
		var count int64
		if err := db.Model(&model.CommissionRecord{}).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("duplicate commissions=%d err=%v", count, err)
		}
	})
	t.Run("audit_failure_rolls_back_admin_mutations", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, admin, inviter, invitee := seedPromotion(t, db, 0)
		order := newOrder(t, db, svc, invitee, true)
		complete(t, db, order)
		policy, _ := svc.Policy()
		profile, _ := repository.New(db).PromotionProfile(inviter.ID)
		if err := db.Callback().Create().Before("gorm:create").Register("test:fail_audit", func(tx *gorm.DB) {
			if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "AdminAuditEvent" {
				tx.AddError(errors.New("audit unavailable"))
			}
		}); err != nil {
			t.Fatal(err)
		}
		defer db.Callback().Create().Remove("test:fail_audit")
		change := *policy
		change.RatioBPS = 1000
		if _, err := svc.UpdatePolicy(admin, change); err == nil {
			t.Fatal("policy committed without audit")
		}
		zero := int64(0)
		if _, err := svc.UpdateProfile(admin, inviter.ID, ProfileRequest{Version: profile.Version, Paused: true, RatioOverrideBPS: &zero}); err == nil {
			t.Fatal("profile committed without audit")
		}
		records, _ := svc.Records(inviter, 1, 20)
		if err := svc.Void(admin, records.Items[0].ID, "audit failure"); err == nil {
			t.Fatal("void committed without audit")
		}
		afterPolicy, _ := svc.Policy()
		afterProfile, _ := repository.New(db).PromotionProfile(inviter.ID)
		view, _ := svc.Overview(inviter)
		if *afterPolicy != *policy || afterProfile.Paused || afterProfile.RatioOverrideBPS != nil || afterProfile.Version != profile.Version || view.AvailableMicrocredits != "60000000" || view.VoidedMicrocredits != "0" {
			t.Fatalf("partial admin commit: policy=%+v profile=%+v view=%+v", afterPolicy, afterProfile, view)
		}
	})
	t.Run("default_and_read_only", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc := New(repository.New(db))
		user := &model.User{ID: "user", Username: "user", Status: model.UserStatusActive}
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
		view, err := svc.Overview(user)
		if err != nil || view.CanPromote || view.Policy.RatioBPS != 0 || view.Policy.FreezeDays != 0 || view.TotalMicrocredits != "0" {
			t.Fatalf("overview=%+v err=%v", view, err)
		}
		if _, err := svc.CreateCode(user); err == nil {
			t.Fatal("default campaign created a code")
		}
		var count int64
		db.Model(&model.PromotionProfile{}).Count(&count)
		if count != 0 {
			t.Fatal("GET mutated profiles")
		}
	})
	t.Run("freeze_idempotency_void_and_privacy", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, admin, inviter, invitee := seedPromotion(t, db, 3)
		order := newOrder(t, db, svc, invitee, true)
		complete(t, db, order)
		complete(t, db, order)
		view, err := svc.Overview(inviter)
		if err != nil || view.TotalMicrocredits != "60000000" || view.FrozenMicrocredits != "60000000" {
			t.Fatalf("view=%+v err=%v", view, err)
		}
		persisted, _ := repository.New(db).PaymentOrder(order.ID)
		recordsBefore, _ := svc.Records(inviter, 1, 20)
		if persisted.CreditedAt == nil || !recordsBefore.Items[0].AvailableAt.Equal(persisted.CreditedAt.Add(3*24*time.Hour)) {
			t.Fatal("freeze does not start at credit posting time")
		}
		request := TransferRequest{RequestID: "stable_request_123", AmountMicrocredits: "40000000"}
		if _, err := svc.Transfer(inviter, request); err == nil {
			t.Fatal("frozen funds transferred")
		}
		if err := db.Model(&model.CommissionRecord{}).Where("payment_order_id = ?", order.ID).Update("available_at", time.Now().Add(-time.Second)).Error; err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		errorsCh := make(chan error, 12)
		for i := 0; i < 12; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); _, err := svc.Transfer(inviter, request); errorsCh <- err }()
		}
		wg.Wait()
		close(errorsCh)
		for err := range errorsCh {
			if err != nil {
				t.Fatal(err)
			}
		}
		changed := request
		changed.AmountMicrocredits = "1"
		if _, err := svc.Transfer(inviter, changed); err == nil {
			t.Fatal("same key accepted different amount")
		}
		account, err := repository.New(db).CreditAccount(inviter.ID)
		if err != nil || account.AvailableMicrocredits != 40000000 {
			t.Fatalf("account=%+v err=%v", account, err)
		}
		records, err := svc.Records(inviter, 1, 20)
		if err != nil || records.Total != 1 {
			t.Fatalf("records=%+v err=%v", records, err)
		}
		if err := svc.Void(admin, records.Items[0].ID, "test refund"); err != nil {
			t.Fatal(err)
		}
		view, err = svc.Overview(inviter)
		if err != nil || view.TransferredMicrocredits != "40000000" || view.VoidedMicrocredits != "20000000" || view.AvailableMicrocredits != "0" || view.FrozenMicrocredits != "0" {
			t.Fatalf("totals=%+v err=%v", view, err)
		}
		invites, err := svc.Invitations(inviter, 1, 20)
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(invites)
		if strings.Contains(string(encoded), invitee.Email) || strings.Contains(string(encoded), invitee.Username) {
			t.Fatalf("private identity leaked: %s", encoded)
		}
		var count int64
		db.Model(&model.PromotionTransfer{}).Count(&count)
		if count != 1 {
			t.Fatalf("transfers=%d", count)
		}
		db.Model(&model.CommissionAllocation{}).Count(&count)
		if count != 1 {
			t.Fatalf("allocations=%d", count)
		}
		ledger, total, err := repository.New(db).CreditLedger(inviter.ID, "income", 20, 0)
		if err != nil || total != 1 || ledger[0].Type != model.CreditLedgerPromotionTransfer {
			t.Fatalf("income total=%d err=%v", total, err)
		}
	})
	t.Run("snapshots_overrides_pause_and_legacy", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, admin, inviter, invitee := seedPromotion(t, db, 0)
		old := newOrder(t, db, svc, invitee, true)
		profile, _ := repository.New(db).PromotionProfile(inviter.ID)
		zero := int64(0)
		profile, err := svc.UpdateProfile(admin, inviter.ID, ProfileRequest{Version: profile.Version, RatioOverrideBPS: &zero})
		if err != nil {
			t.Fatal(err)
		}
		noReward := newOrder(t, db, svc, invitee, true)
		if noReward.PromotionSnapshot.Eligible || noReward.PromotionSnapshot.RatioBPS != 0 {
			t.Fatal("explicit zero inherited global rate")
		}
		profile, err = svc.UpdateProfile(admin, inviter.ID, ProfileRequest{Version: profile.Version})
		if err != nil {
			t.Fatal(err)
		}
		inherited := newOrder(t, db, svc, invitee, true)
		if inherited.PromotionSnapshot.RatioBPS != 500 || !inherited.PromotionSnapshot.Eligible {
			t.Fatal("cleared override did not inherit")
		}
		if _, err := svc.UpdateProfile(admin, inviter.ID, ProfileRequest{Version: profile.Version, Paused: true}); err != nil {
			t.Fatal(err)
		}
		paused := newOrder(t, db, svc, invitee, true)
		policy, _ := svc.Policy()
		policy.Enabled = false
		if _, err := svc.UpdatePolicy(admin, *policy); err != nil {
			t.Fatal(err)
		}
		disabled := newOrder(t, db, svc, invitee, true)
		legacy := newOrder(t, db, svc, invitee, false)
		for _, order := range []*model.PaymentOrder{old, noReward, inherited, paused, disabled, legacy} {
			complete(t, db, order)
		}
		view, err := svc.Overview(inviter)
		if err != nil || view.CanPromote || view.TotalMicrocredits != "120000000" || view.AvailableMicrocredits != "120000000" {
			t.Fatalf("view=%+v err=%v", view, err)
		}
		if _, err := svc.Transfer(inviter, TransferRequest{RequestID: "after_pause_123", AmountMicrocredits: "120000000"}); err != nil {
			t.Fatal("existing earnings locked by pause:", err)
		}
		if _, err := svc.UpdatePolicy(admin, model.PromotionPolicy{Version: 0}); err == nil {
			t.Fatal("stale policy accepted")
		}
		if _, err := svc.AdminPolicy(inviter); err == nil {
			t.Fatal("non-admin policy access")
		}
		if err := svc.Void(inviter, "unknown", "reason"); err == nil {
			t.Fatal("non-admin void")
		}
	})
	t.Run("transaction_failures_can_retry", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, _, inviter, invitee := seedPromotion(t, db, 0)
		order := newOrder(t, db, svc, invitee, true)
		if err := db.Callback().Create().Before("gorm:create").Register("test:fail_commission", func(tx *gorm.DB) {
			if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "CommissionRecord" {
				tx.AddError(errors.New("commission unavailable"))
			}
		}); err != nil {
			t.Fatal(err)
		}
		_, _, err := repository.New(db).CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, repository.PaymentEvidence{ProviderTradeNo: "trade-" + order.ID, AmountFen: order.AmountFen, Currency: order.Currency})
		if err == nil {
			t.Fatal("commission failure was swallowed")
		}
		persisted, _ := repository.New(db).PaymentOrder(order.ID)
		if persisted.Status == model.PaymentOrderCredited || persisted.LastError == "" {
			t.Fatal("partial payment committed")
		}
		var count int64
		db.Model(&model.CreditLedgerEntry{}).Count(&count)
		if count != 0 {
			t.Fatal("partial ledger committed")
		}
		_ = db.Callback().Create().Remove("test:fail_commission")
		complete(t, db, order)
		persisted, _ = repository.New(db).PaymentOrder(order.ID)
		if persisted.LastError != "" {
			t.Fatal("successful retry retained failure diagnostic")
		}
		if err := db.Callback().Create().Before("gorm:create").Register("test:fail_transfer_ledger", func(tx *gorm.DB) {
			if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "CreditLedgerEntry" {
				tx.AddError(errors.New("wallet unavailable"))
			}
		}); err != nil {
			t.Fatal(err)
		}
		request := TransferRequest{RequestID: "retry_wallet_123", AmountMicrocredits: "60000000"}
		if _, err := svc.Transfer(inviter, request); err == nil {
			t.Fatal("wallet failure was swallowed")
		}
		view, _ := svc.Overview(inviter)
		if view.AvailableMicrocredits != "60000000" || view.TransferredMicrocredits != "0" {
			t.Fatalf("partial allocation=%+v", view)
		}
		if _, err := svc.TransferResult(inviter, request.RequestID); err == nil {
			t.Fatal("failed transfer receipt committed")
		}
		_ = db.Callback().Create().Remove("test:fail_transfer_ledger")
		if _, err := svc.Transfer(inviter, request); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("concurrent_requests_and_void", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, admin, inviter, invitee := seedPromotion(t, db, 0)
		order := newOrder(t, db, svc, invitee, true)
		complete(t, db, order)
		records, _ := svc.Records(inviter, 1, 20)
		var wg sync.WaitGroup
		wg.Add(3)
		for _, id := range []string{"concurrent_111", "concurrent_222"} {
			go func(id string) {
				defer wg.Done()
				_, _ = svc.Transfer(inviter, TransferRequest{RequestID: id, AmountMicrocredits: "40000000"})
			}(id)
		}
		go func() { defer wg.Done(); _ = svc.Void(admin, records.Items[0].ID, "concurrent cancellation") }()
		wg.Wait()
		view, err := svc.Overview(inviter)
		if err != nil {
			t.Fatal(err)
		}
		var record model.CommissionRecord
		db.First(&record, "id = ?", records.Items[0].ID)
		if record.TransferredMicrocredits+record.VoidedMicrocredits != record.AmountMicrocredits || record.TransferredMicrocredits > 40000000 || view.AvailableMicrocredits != "0" {
			t.Fatalf("overspent record=%+v view=%+v", record, view)
		}
		account, _ := repository.New(db).CreditAccount(inviter.ID)
		if account.AvailableMicrocredits != record.TransferredMicrocredits {
			t.Fatal("wallet and allocations diverged")
		}
	})
	t.Run("balance_limit_rolls_back", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		svc, _, inviter, invitee := seedPromotion(t, db, 0)
		complete(t, db, newOrder(t, db, svc, invitee, true))
		if err := db.Create(&model.CreditAccount{UserID: inviter.ID, AvailableMicrocredits: 9007199254740991}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.Transfer(inviter, TransferRequest{RequestID: "overflow_123", AmountMicrocredits: "1"}); err == nil {
			t.Fatal("balance overflow accepted")
		}
		view, _ := svc.Overview(inviter)
		if view.TransferredMicrocredits != "0" {
			t.Fatal("failed transfer deducted funds")
		}
	})
	t.Run("registration_rollback", func(t *testing.T) {
		db := openPromotionDB(t, driver)
		_, _, _, _ = seedPromotion(t, db, 0)
		repo := repository.New(db)
		user := &model.User{ID: "invalid-invite-user", Username: "invalid-invite-user", Email: "new@example.com", Status: model.UserStatusActive}
		code := model.EmailVerificationCode{ID: "verification", Email: user.Email, ExpiresAt: time.Now().Add(time.Hour)}
		if err := db.Create(&code).Error; err != nil {
			t.Fatal(err)
		}
		hook := func(tx *repository.Repository) error { return New(tx).BindInvitation(user, "INVALID") }
		if err := repo.CreateUserWithEmailVerification(user, code.ID, time.Now(), hook); err == nil {
			t.Fatal("invalid invitation accepted")
		}
		if _, err := repo.User(user.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatal("failed registration created a user")
		}
		db.First(&code, "id = ?", code.ID)
		if code.UsedAt != nil {
			t.Fatal("failed registration consumed code")
		}
		identity := &model.UserIdentity{ID: "oauth-test", UserID: user.ID, Provider: "linuxdo", Subject: "subject"}
		if err := repo.CreateOAuthUser(user, identity, hook); err == nil {
			t.Fatal("invalid OAuth invitation accepted")
		}
		if _, err := repo.UserIdentity("linuxdo", "subject"); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatal("partial OAuth identity committed")
		}
	})
}

func TestPromotionWorkflowSQLite(t *testing.T)   { runPromotionWorkflow(t, "sqlite") }
func TestPromotionWorkflowPostgres(t *testing.T) { runPromotionWorkflow(t, "postgres") }

func TestCalculateAmountAndLifetimeTotals(t *testing.T) {
	for _, value := range []int64{0, 1, 9999, 10000, 1_000_000_000_000_000, math.MaxInt64} {
		amount, err := CalculateAmount(value, 10000)
		if err != nil || amount != value {
			t.Fatalf("base=%d amount=%d err=%v", value, amount, err)
		}
	}
	if amount, _ := CalculateAmount(1, 500); amount != 0 {
		t.Fatal("rounding must floor")
	}
	if _, err := CalculateAmount(100, 10001); err == nil {
		t.Fatal("invalid ratio accepted")
	}
	db := openPromotionDB(t, "sqlite")
	svc, _, inviter, _ := seedPromotion(t, db, 0)
	for i := 0; i < 11; i++ {
		id := kernel.NewID()
		if err := db.Create(&model.CommissionRecord{ID: id, PaymentOrderID: id, InviterID: inviter.ID, AmountMicrocredits: 1_000_000_000_000_000_000, AvailableAt: time.Now().Add(-time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	view, err := svc.Overview(inviter)
	if err != nil || view.TotalMicrocredits != "11000000000000000000" || view.AvailableMicrocredits != view.TotalMicrocredits {
		t.Fatalf("big totals=%+v err=%v", view, err)
	}
}
