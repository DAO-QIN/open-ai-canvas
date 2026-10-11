package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"os"
	"strconv"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func ecommerceActor(svc *service.Service, write bool, fn func(*gin.Context, *model.User)) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if write {
			policy, available := loadRuntimePolicy(c, svc)
			if !available || !enforceRateLimit(c, "ecommerce:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		}
		fn(c, user)
	}
}
func ecommerceReply(c *gin.Context, value any, err error) {
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, value)
}
func ecommerceBind(c *gin.Context, value any) bool {
	if err := c.ShouldBindJSON(value); err != nil {
		fail(c, http.StatusBadRequest, err)
		return false
	}
	return true
}
func RegisterEcommerceRoutes(r *gin.RouterGroup, svc *service.Service) {
	group := r.Group("/ecommerce")
	group.GET("/options", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) { v, e := svc.EcommerceOptions(u); ecommerceReply(c, v, e) }))
	group.PUT("/activation", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req struct {
			Enabled *bool `json:"enabled" binding:"required"`
		}
		if !ecommerceBind(c, &req) {
			return
		}
		state, err := svc.SetUserPluginEnabled(u, model.EcommercePluginID, *req.Enabled)
		ecommerceReply(c, gin.H{"state": state}, err)
	}))
	group.GET("/preferences", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) { v, e := svc.EcommercePreferences(u.ID); ecommerceReply(c, v, e) }))
	group.PUT("/preferences", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommercePresetRequest
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.SaveEcommercePreferences(u.ID, req)
		ecommerceReply(c, v, e)
	}))
	group.GET("/presets", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) { v, e := svc.EcommercePresets(u.ID); ecommerceReply(c, v, e) }))
	group.PUT("/presets", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommercePresetRequest
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.SaveEcommercePreset(u.ID, req)
		ecommerceReply(c, v, e)
	}))
	group.DELETE("/presets/:id", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		revision, _ := strconv.ParseInt(c.Query("revision"), 10, 64)
		guard := service.EcommerceGuard{Revision: revision, OperationID: c.Query("operationId")}
		ecommerceReply(c, gin.H{"deleted": true}, svc.DeleteEcommercePreset(u.ID, c.Param("id"), guard))
	}))
	group.POST("/batches", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommerceImportRequest
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.ImportEcommerceBatch(u.ID, req)
		ecommerceReply(c, v, e)
	}))
	group.GET("/batches", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) { v, e := svc.EcommerceBatches(u.ID); ecommerceReply(c, v, e) }))
	group.GET("/batches/:id", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) {
		v, e := svc.EcommerceBatch(u.ID, c.Param("id"))
		ecommerceReply(c, v, e)
	}))
	group.POST("/batch-commands", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req struct {
			Items []service.EcommerceBatchCommandItem `json:"items"`
		}
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.BatchCommandEcommerce(u.ID, req.Items)
		ecommerceReply(c, v, e)
	}))
	group.GET("/products", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) {
		page, _ := strconv.Atoi(c.Query("page"))
		size, _ := strconv.Atoi(c.Query("pageSize"))
		v, e := svc.EcommerceProducts(u.ID, c.Query("batchId"), c.Query("archived") == "true", page, size)
		ecommerceReply(c, v, e)
	}))
	group.GET("/products/:id", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) {
		v, e := svc.EcommerceProduct(u.ID, c.Param("id"))
		ecommerceReply(c, v, e)
	}))
	group.PUT("/products/:id", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommerceProductRequest
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.UpdateEcommerceProduct(u.ID, c.Param("id"), req)
		ecommerceReply(c, v, e)
	}))
	group.DELETE("/products/:id", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		revision, _ := strconv.ParseInt(c.Query("revision"), 10, 64)
		req := service.EcommerceGuard{Revision: revision, OperationID: c.Query("operationId")}
		ecommerceReply(c, gin.H{"deleted": true}, svc.DeleteEcommerceDraft(u.ID, c.Param("id"), req))
	}))
	group.GET("/products/:id/runs/:runId", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) {
		v, e := svc.EcommerceRun(u.ID, c.Param("id"), c.Param("runId"))
		ecommerceReply(c, v, e)
	}))
	group.POST("/products/:id/quote", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommerceQuoteRequest
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.QuoteEcommerce(u.ID, c.Param("id"), req)
		ecommerceReply(c, v, e)
	}))
	group.POST("/products/:id/commands", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommerceCommand
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.CommandEcommerce(u.ID, c.Param("id"), req)
		ecommerceReply(c, v, e)
	}))
	group.POST("/products/:id/steps/:stepId/recover", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		v, e := svc.RecoverEcommerceStep(c.Request.Context(), u.ID, c.Param("id"), c.Param("stepId"))
		ecommerceReply(c, v, e)
	}))
	group.POST("/products/:id/runs/:runId/export", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		ecommerceArchive(c, func(file *os.File) error {
			return svc.ExportEcommerceRun(c.Request.Context(), u.ID, c.Param("id"), c.Param("runId"), file)
		})
	}))
	group.POST("/export", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req struct {
			ProductIDs []string `json:"productIds"`
		}
		if !ecommerceBind(c, &req) {
			return
		}
		ecommerceArchive(c, func(file *os.File) error { return svc.ExportEcommerce(c.Request.Context(), u.ID, req.ProductIDs, file) })
	}))
	admin := r.Group("/admin/ecommerce")
	admin.GET("/settings", ecommerceActor(svc, false, func(c *gin.Context, u *model.User) { v, e := svc.EcommerceSettings(u); ecommerceReply(c, v, e) }))
	admin.PUT("/settings", ecommerceActor(svc, true, func(c *gin.Context, u *model.User) {
		var req service.EcommerceSettings
		if !ecommerceBind(c, &req) {
			return
		}
		v, e := svc.UpdateEcommerceSettings(u, req)
		ecommerceReply(c, v, e)
	}))
}
func ecommerceArchive(c *gin.Context, write func(*os.File) error) {
	file, e := os.CreateTemp("", "yingce-ecommerce-*.zip")
	if e != nil {
		failService(c, e)
		return
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if e = write(file); e != nil {
		failService(c, e)
		return
	}
	if e = file.Close(); e != nil {
		failService(c, e)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "application/zip")
	c.FileAttachment(file.Name(), "商品套图.zip")
}
