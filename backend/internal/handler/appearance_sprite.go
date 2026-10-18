package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerSpriteRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/settings/appearance/sprite", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err = svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-sprite-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.SpriteMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UploadSpritePet(actor, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pet": result})
	})
	serve := func(admin bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			var actor *model.User
			if admin {
				var err error
				actor, err = currentUser(c, svc)
				if err != nil {
					failService(c, err)
					return
				}
				if err = svc.RequireAdmin(actor); err != nil {
					failService(c, err)
					return
				}
			}
			data, mime, err := svc.SpriteAsset(actor, c.Param("id"))
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("X-Content-Type-Options", "nosniff")
			c.Header("Cache-Control", "private, no-cache")
			c.Header("Content-Security-Policy", "default-src 'none'")
			c.Data(http.StatusOK, mime, data)
		}
	}
	r.GET("/public/appearance/sprite/:id", serve(false))
	r.GET("/admin/settings/appearance/sprite/:id", serve(true))
}
