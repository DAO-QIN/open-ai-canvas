package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func TestLibTVGalleryOpenAPIParsesAndDescribesRoutes(t *testing.T) {
	var spec struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	for path, method := range map[string]string{
		"/libtv/gallery":      "get",
		"/libtv/featured":     "get",
		"/libtv/works/{uuid}": "get",
		"/canvas-projects/{id}/import/libtv-template": "post",
	} {
		if spec.Paths[path][method] == nil {
			t.Fatalf("OpenAPI missing %s %s", method, path)
		}
	}
}

func TestLibTVTemplateImportRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterLibTVRoutes(router.Group("/api"), &service.Service{})
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/api/canvas-projects/canvas/import/libtv-template"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"uuid":"11111111111111111111111111111111"}`)))
			var body struct{ Code int }
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || recorder.Code != http.StatusUnauthorized || body.Code == 0 {
				t.Fatalf("unauthenticated request = %d %s, %v", recorder.Code, recorder.Body.String(), err)
			}
		})
	}
}

func TestLibTVGalleryReaderUsesGuestIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/api/libtv/gallery", nil)
	c.Request.RemoteAddr = "203.0.113.9:1234"
	if got := libTVGalleryReader(c, nil); got == nil || got.ID != "guest:203.0.113.9" {
		t.Fatalf("guest reader = %#v", got)
	}
	user := &model.User{ID: "u1"}
	if got := libTVGalleryReader(c, user); got != user {
		t.Fatalf("logged-in reader replaced: %#v", got)
	}
}
