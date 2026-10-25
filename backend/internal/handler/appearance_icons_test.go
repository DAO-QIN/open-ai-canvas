package handler

import (
	"bytes"
	"fmt"
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
	for _, path := range []string{"/api/public/appearance/icon/favicon.ico", appearance.FaviconURL, appearance.AppleTouchIconURL, "/api/public/appearance/icon/favicon-16.png", strings.Replace(appearance.FaviconURL, "favicon.ico", "favicon-32.png", 1), strings.Replace(appearance.FaviconURL, "favicon.ico", "favicon-48.png", 1)} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK || rec.Header().Get("ETag") == "" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
		if strings.Contains(path, "/icons/") && !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("content version must be immutable")
		}
		if strings.Contains(path, "/icon/") && rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("mutable bootstrap must not be stored by browsers or CDNs")
		}
		if strings.HasSuffix(path, ".png") {
			size := 180
			for _, candidate := range []int{16, 32, 48} {
				if strings.HasSuffix(path, fmt.Sprintf("favicon-%d.png", candidate)) {
					size = candidate
				}
			}
			img, e := png.Decode(bytes.NewReader(rec.Body.Bytes()))
			if e != nil || img.Bounds().Dx() != size || img.Bounds().Dy() != size {
				t.Fatalf("PNG icon %s: %v", path, e)
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
