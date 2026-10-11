package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestPromotionHTTPPermissionsPrivacyAndHistory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("REDIS_URL", "")
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "promotion.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.AdminAuditEvent{}, &model.CreditAccount{}, &model.CreditLedgerEntry{},
		&model.PromotionProfile{}, &model.Invitation{}, &model.CommissionRecord{}, &model.PromotionTransfer{}, &model.CommissionAllocation{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"admin", "owner", "other", "invitee"} {
		role := model.UserRoleUser
		if id == "admin" {
			role = model.UserRoleAdmin
		}
		if err := db.Create(&model.User{ID: id, Username: id + "-private-name", Email: id + "@example.invalid", Phone: "+8613800138000", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	code := "ABCDEFGHJK"
	if err := db.Create(&model.PromotionProfile{UserID: "owner", InviteCode: &code}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Invitation{InviterID: "owner", InviteeID: "invitee", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create([]model.CommissionRecord{
		{ID: "owner-record", PaymentOrderID: "owner-order", InviterID: "owner", InviteeID: "invitee", AmountMicrocredits: 50, AvailableAt: time.Now().Add(-time.Hour)},
		{ID: "other-record", PaymentOrderID: "other-order", InviterID: "other", AmountMicrocredits: 111, AvailableAt: time.Now().Add(-time.Hour)},
	}).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	previousRuntime := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previousRuntime) })
	RegisterPromotionRoutes(router.Group("/api"), svc)
	call := func(user, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.RemoteAddr = "192.0.2.53:5130"
		if user != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/api/promotion/overview", "/api/promotion/records", "/api/promotion/transfers"} {
		if w := call("", http.MethodGet, path, ""); w.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous read: %d %s", w.Code, w.Body.String())
		}
	}
	for _, endpoint := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/admin/promotion/policy", ""},
		{http.MethodPut, "/api/admin/promotion/policy", `{"enabled":true,"ratioBps":500,"version":0}`},
		{http.MethodGet, "/api/admin/promotion/profiles", ""},
		{http.MethodPut, "/api/admin/promotion/profiles/owner", `{"paused":true,"version":0}`},
		{http.MethodGet, "/api/admin/promotion/records", ""},
		{http.MethodPost, "/api/admin/promotion/records/owner-record/void", `{"reason":"test"}`},
	} {
		if w := call("owner", endpoint.method, endpoint.path, endpoint.body); w.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s: %d %s", endpoint.path, w.Code, w.Body.String())
		}
	}
	w := call("other", http.MethodGet, "/api/promotion/overview", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"enabled":false`) || !strings.Contains(w.Body.String(), `"ratioBps":0`) {
		t.Fatalf("default policy: %d %s", w.Code, w.Body.String())
	}
	var profiles int64
	if err := db.Model(&model.PromotionProfile{}).Count(&profiles).Error; err != nil || profiles != 1 {
		t.Fatalf("read created profile: %d %v", profiles, err)
	}
	w = call("owner", http.MethodPost, "/api/promotion/code", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("disabled campaign created code: %d", w.Code)
	}
	w = call("", http.MethodGet, "/api/public/invite-code/"+code, "")
	if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), `"data":{"valid":false}`) {
		t.Fatalf("anonymous validation: %d %s", w.Code, w.Body.String())
	}
	w = call("owner", http.MethodGet, "/api/promotion/records?userId=other", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"amountMicrocredits":"50"`) || strings.Contains(w.Body.String(), "other-record") || strings.Contains(w.Body.String(), "inviteeId") {
		t.Fatalf("record isolation: %d %s", w.Code, w.Body.String())
	}
	w = call("owner", http.MethodGet, "/api/promotion/invitations", "")
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "@example.invalid") || strings.Contains(w.Body.String(), "13800138000") || strings.Contains(w.Body.String(), "invitee-private-name") {
		t.Fatalf("contact privacy: %d %s", w.Code, w.Body.String())
	}
	for _, payload := range []string{`{"requestId":"request-513","amountMicrocredits":40}`, `{"requestId":"request-513","amountMicrocredits":"0"}`, `{"requestId":"request-513","amountMicrocredits":"9007199254740992"}`} {
		if w := call("owner", http.MethodPost, "/api/promotion/transfers", payload); w.Code != http.StatusBadRequest {
			t.Fatalf("invalid transfer: %d %s", w.Code, w.Body.String())
		}
	}
	payload := `{"requestId":"request-513","amountMicrocredits":"40"}`
	w = call("owner", http.MethodPost, "/api/promotion/transfers", payload)
	if w.Code != http.StatusOK {
		t.Fatalf("disabled campaign blocked historical transfer: %d %s", w.Code, w.Body.String())
	}
	first := w.Body.String()
	w = call("owner", http.MethodPost, "/api/promotion/transfers", payload)
	if w.Code != http.StatusOK || w.Body.String() != first {
		t.Fatalf("retry changed result: %d %s", w.Code, w.Body.String())
	}
	w = call("owner", http.MethodPost, "/api/promotion/transfers", strings.Replace(payload, `"40"`, `"41"`, 1))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), `"reason":"idempotency_conflict"`) {
		t.Fatalf("changed retry: %d %s", w.Code, w.Body.String())
	}
	w = call("other", http.MethodGet, "/api/promotion/transfers/request-513", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("foreign receipt: %d %s", w.Code, w.Body.String())
	}
	w = call("owner", http.MethodGet, "/api/promotion/transfers/request-513", "")
	if w.Code != http.StatusOK || w.Body.String() != first {
		t.Fatalf("recover receipt: %d %s", w.Code, w.Body.String())
	}
	w = call("admin", http.MethodPost, "/api/admin/promotion/records/owner-record/void", `{"reason":"manual adjustment"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("void remaining: %d %s", w.Code, w.Body.String())
	}
	w = call("owner", http.MethodGet, "/api/promotion/overview", "")
	for _, field := range []string{`"totalMicrocredits":"50"`, `"transferredMicrocredits":"40"`, `"voidedMicrocredits":"10"`, `"availableMicrocredits":"0"`} {
		if !strings.Contains(w.Body.String(), field) {
			t.Fatalf("conservation missing %s: %s", field, w.Body.String())
		}
	}
	w = call("admin", http.MethodPut, "/api/admin/promotion/policy", `{"enabled":true,"ratioBps":500,"freezeDays":1,"version":0}`)
	if w.Code != http.StatusOK {
		t.Fatalf("policy update: %d %s", w.Code, w.Body.String())
	}
	w = call("admin", http.MethodPut, "/api/admin/promotion/policy", `{"enabled":false,"ratioBps":0,"freezeDays":0,"version":0}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("stale policy overwrote: %d %s", w.Code, w.Body.String())
	}
	for _, incomplete := range []string{`{}`, `{"version":1}`, `{"enabled":false,"ratioBps":0,"freezeDays":0}`} {
		if w := call("admin", http.MethodPut, "/api/admin/promotion/policy", incomplete); w.Code != http.StatusBadRequest {
			t.Fatalf("incomplete policy accepted: %d %s", w.Code, w.Body.String())
		}
	}
	w = call("admin", http.MethodPut, "/api/admin/promotion/profiles/owner", `{"paused":true,"version":0}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing override silently reset profile: %d %s", w.Code, w.Body.String())
	}
	w = call("admin", http.MethodPut, "/api/admin/promotion/profiles/owner", `{"paused":false,"version":0,"ratioOverrideBps":0}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"ratioOverrideBps":0`) {
		t.Fatalf("explicit zero override: %d %s", w.Code, w.Body.String())
	}
	w = call("admin", http.MethodPut, "/api/admin/promotion/profiles/owner", `{"paused":false,"version":1,"ratioOverrideBps":null}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"ratioOverrideBps":null`) {
		t.Fatalf("inherit override: %d %s", w.Code, w.Body.String())
	}
	w = call("", http.MethodGet, "/api/public/invite-code/"+code, "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"data":{"valid":true}`) || strings.Contains(w.Body.String(), "owner") {
		t.Fatalf("validation projection: %d %s", w.Code, w.Body.String())
	}
}
