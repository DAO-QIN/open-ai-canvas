package handler

import (
	"bytes"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestAppearanceIconRoutesBootstrapVersionCacheAndInvalidFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	appearance, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterAppearanceRoutes(router.Group("/api"), svc)
	for _, path := range []string{"/api/public/appearance/icon/favicon.ico", appearance.FaviconURL, appearance.AppleTouchIconURL} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK || rec.Header().Get("ETag") == "" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
		if strings.Contains(path, "/icons/") && !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("content version must be immutable")
		}
		if strings.HasSuffix(path, ".png") {
			img, e := png.Decode(bytes.NewReader(rec.Body.Bytes()))
			if e != nil || img.Bounds().Dx() != 180 {
				t.Fatalf("touch icon: %v", e)
			}
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("If-None-Match", rec.Header().Get("ETag"))
		next := httptest.NewRecorder()
		router.ServeHTTP(next, req)
		if next.Code != http.StatusNotModified || next.Body.Len() != 0 {
			t.Fatal("conditional request should return an empty 304")
		}
	}
	for _, path := range []string{"/api/public/appearance/icon/nope.png", "/api/public/appearance/icons/unpublished/favicon.png"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("invalid icon %s: %d", path, rec.Code)
		}
	}
}
