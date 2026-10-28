package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWalletUsageHTTPContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.Task{}, &model.LogicalModel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "user", Username: "user", Email: "user@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "user", UserID: "user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditLedgerEntry{ID: "entry", UserID: "user", Type: model.CreditLedgerConsume, AmountMicrocredits: -1_500_000, Model: "nano-banana-pro", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.LogicalModel{ID: "lm", Code: "nano-banana-pro", Name: "Nano Banana Pro"}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), svc)
	call := func(withSession bool, query string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/wallet/usage"+query, nil)
		if withSession {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "user.test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}

	if w := call(false, "?tzOffset=480"); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %s", w.Code, w.Body.String())
	}
	for _, query := range []string{"?tzOffset=abc", "?tzOffset=480.5", "?tzOffset=841"} {
		w := call(true, query)
		var body struct {
			Code   int    `json:"code"`
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != http.StatusBadRequest || body.Code == 0 || body.Reason != "invalid_argument" {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body.String())
		}
	}
	w := call(true, "?tzOffset=480")
	if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("usage: %d cache=%q %s", w.Code, w.Header().Get("Cache-Control"), w.Body.String())
	}
	var body struct {
		Code int                       `json:"code"`
		Data service.CreditUsageReport `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != 0 || body.Data.Days != 365 || body.Data.TimezoneOffset != 480 || len(body.Data.Daily) != 1 || body.Data.Daily[0].TotalMicrocredits != 1_500_000 {
		t.Fatalf("report = %#v", body)
	}
	// 没有账单的消耗归入 other 类型；模型取流水上的编码，名称取前台模型。
	if len(body.Data.Models) != 1 || body.Data.Models[0] != (service.CreditUsageModel{Model: "nano-banana-pro", Name: "Nano Banana Pro", Capability: "other", TotalMicrocredits: 1_500_000, Count: 1}) {
		t.Fatalf("models = %#v", body.Data.Models)
	}
}
