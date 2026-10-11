package ecommerce

import (
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

func ecommercePostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
	}
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("ecommerce_%d", time.Now().UnixNano())
	if err = admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
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
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), config)
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	return db
}
func TestEcommercePostgresLeaseFencingAndConcurrentAdmission(t *testing.T) {
	f := workflowOnDB(t, ecommercePostgres(t))
	p := f.productView(t)
	quote, err := f.svc.Quote("owner", p.ID, QuoteRequest{Revision: p.Revision, Scope: Scope{Action: "auto"}})
	if err != nil {
		t.Fatal(err)
	}
	cmd := Command{Guard: Guard{Revision: p.Revision, OperationID: "concurrent-double-click"}, Action: "auto", QuoteID: quote.ID, BudgetMicrocredits: quote.BudgetMicrocredits}
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		// Independent process-local locks leave serialization to PostgreSQL.
		host := &workflowHost{db: f.db, repo: f.repo, signature: "price-v1"}
		svc := New(f.repo, host, fmt.Sprintf("worker-%d", i))
		wg.Add(1)
		go func(svc *Service) { defer wg.Done(); _, err := svc.Command("owner", p.ID, cmd); errs <- err }(svc)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var authCount, runCount int64
	f.db.Model(&model.EcommerceAuthorization{}).Count(&authCount)
	f.db.Model(&model.EcommerceRun{}).Count(&runCount)
	if authCount != 1 || runCount != 1 {
		t.Fatalf("duplicate authorization/run: %d/%d", authCount, runCount)
	}
	type claimResult struct {
		runs []model.EcommerceRun
		err  error
	}
	claims := make(chan claimResult, 2)
	for _, owner := range []string{"worker-one", "worker-two"} {
		wg.Add(1)
		go func(owner string) {
			defer wg.Done()
			runs, err := f.repo.ClaimEcommerceRuns(owner, 2)
			claims <- claimResult{runs, err}
		}(owner)
	}
	wg.Wait()
	close(claims)
	claimed := []model.EcommerceRun{}
	for claim := range claims {
		if claim.err != nil {
			t.Fatal(claim.err)
		}
		claimed = append(claimed, claim.runs...)
	}
	if len(claimed) != 1 {
		t.Fatalf("lease claimed %d times", len(claimed))
	}
	old := claimed[0]
	if err = f.db.Model(&model.EcommerceRun{}).Where("id = ?", old.ID).UpdateColumn("lease_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	reclaimed, err := f.repo.ClaimEcommerceRuns("worker-new", 2)
	if err != nil || len(reclaimed) != 1 {
		t.Fatalf("crash recovery lease: %v %v", reclaimed, err)
	}
	stale := New(f.repo, f.host, old.LeaseOwner)
	if err = stale.advance(old); err != nil {
		t.Fatal(err)
	}
	if f.taskCount(t) != 0 {
		t.Fatal("expired worker admitted task")
	}
	fresh := New(f.repo, f.host, "worker-new")
	if err = fresh.advance(reclaimed[0]); err != nil {
		t.Fatal(err)
	}
	// Re-entry can advance the next stage, but cannot duplicate the first one.
	if err = fresh.advance(reclaimed[0]); err != nil {
		t.Fatal(err)
	}
	if f.taskCount(t) != 2 {
		t.Fatal("stage admission/capacity mismatch")
	}
	account, err := f.repo.CreditAccount("owner")
	if err != nil {
		t.Fatal(err)
	}
	if account.ReservedMicrocredits != 2000 {
		t.Fatalf("duplicate reservation: %+v", account)
	}
	if err = f.repo.FinishEcommerceLease("owner", old.ID, old.LeaseOwner, old.LeaseEpoch, time.Now()); err != nil {
		t.Fatal(err)
	}
	run, err := f.repo.EcommerceRun("owner", old.ID)
	if err != nil || run.LeaseOwner != "worker-new" {
		t.Fatal("stale release erased active lease")
	}
	if err = f.repo.FinishEcommerceLease("owner", run.ID, run.LeaseOwner, run.LeaseEpoch, time.Now()); err != nil {
		t.Fatal(err)
	}
	f.svc = fresh
	f.complete(t, true)
	if p = f.finish(t); p.Run.Status != "completed" || f.taskCount(t) != 19 {
		t.Fatal("PostgreSQL workflow failed after crash recovery")
	}
}
