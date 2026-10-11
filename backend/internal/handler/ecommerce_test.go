package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceActivationHTTPIndependentOfPluginCenter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "activation.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.PluginPlatformState{}, &model.UserPluginState{}, &model.EcommerceRun{}); err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{
		&model.User{ID: "owner", Username: "owner", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "other", Username: "other", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "session", UserID: "owner", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"pluginCenterEnabled":false}`},
		&model.PluginPlatformState{PluginID: model.EcommercePluginID, Available: true},
		&model.UserPluginState{ID: "other-state", UserID: "other", PluginID: model.EcommercePluginID, Enabled: true},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := repository.New(db)
	svc := service.New(repo, t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterEcommerceRoutes(router.Group("/api"), svc)
	call := func(body string, loggedIn bool, want int) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPut, "/api/ecommerce/activation", bytes.NewBufferString(body))
		request.Header.Set("Content-Type", "application/json")
		if loggedIn {
			request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.test-token"})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("activation returned %d, want %d: %s", response.Code, want, response.Body.String())
		}
	}
	call(`{"enabled":true}`, false, http.StatusUnauthorized)
	for _, invalid := range []string{`{}`, `{"enabled":null}`, `{"enabled":"false"}`} {
		call(invalid, true, http.StatusBadRequest)
	}
	call(`{"enabled":false,"userId":"other","pluginId":"other-plugin"}`, true, http.StatusOK)
	state, err := repo.UserPluginState("owner", model.EcommercePluginID)
	if err != nil || state == nil || state.Enabled {
		t.Fatalf("personal opt-out not saved: %+v %v", state, err)
	}
	other, err := repo.UserPluginState("other", model.EcommercePluginID)
	if err != nil || other == nil || !other.Enabled {
		t.Fatalf("another user's choice changed: %+v %v", other, err)
	}
	call(`{"enabled":true}`, true, http.StatusOK)
	state, err = repo.UserPluginState("owner", model.EcommercePluginID)
	if err != nil || state == nil || !state.Enabled {
		t.Fatalf("personal opt-in not saved: %+v %v", state, err)
	}
	if err := repo.SavePluginPlatformState(&model.PluginPlatformState{PluginID: model.EcommercePluginID, Available: false}); err != nil {
		t.Fatal(err)
	}
	call(`{"enabled":true}`, true, http.StatusForbidden)
}
