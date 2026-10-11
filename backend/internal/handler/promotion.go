package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterPromotionRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/public/invite-code/:code", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !enforceRateLimit(c, "invite-code:"+c.ClientIP(), 30, time.Minute) {
			return
		}
		valid, err := svc.ValidatePromotionCode(c.Param("code"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"valid": valid})
	})
	// All promotion data is private; the switch only gates new business in the
	// domain so disabling a campaign cannot hide or lock existing earnings.
	private := r.Group("/promotion")
	private.Use(promotionAuthentication(svc))
	private.GET("/overview", func(c *gin.Context) {
		value, err := svc.PromotionOverview(promotionUser(c))
		promotionResponse(c, value, err)
	})
	private.POST("/code", func(c *gin.Context) {
		value, err := svc.CreatePromotionCode(promotionUser(c))
		promotionResponse(c, value, err)
	})
	private.GET("/invitations", func(c *gin.Context) {
		page, size := promotionPaging(c)
		value, err := svc.PromotionInvitations(promotionUser(c), page, size)
		promotionResponse(c, value, err)
	})
	private.GET("/records", func(c *gin.Context) {
		page, size := promotionPaging(c)
		value, err := svc.PromotionRecords(promotionUser(c), page, size)
		promotionResponse(c, value, err)
	})
	private.GET("/transfers", func(c *gin.Context) {
		page, size := promotionPaging(c)
		value, err := svc.PromotionTransfers(promotionUser(c), page, size)
		promotionResponse(c, value, err)
	})
	private.GET("/transfers/:requestId", func(c *gin.Context) {
		value, err := svc.PromotionTransferResult(promotionUser(c), c.Param("requestId"))
		promotionResponse(c, value, err)
	})
	private.POST("/transfers", func(c *gin.Context) {
		if !enforceRateLimit(c, "promotion-transfer:"+promotionUser(c).ID, 20, time.Minute) {
			return
		}
		var request service.PromotionTransferRequest
		if !promotionBind(c, &request) {
			return
		}
		value, err := svc.TransferPromotion(promotionUser(c), request)
		promotionResponse(c, value, err)
	})
	admin := r.Group("/admin/promotion")
	admin.Use(promotionAuthentication(svc))
	admin.Use(func(c *gin.Context) {
		if err := svc.RequireAdmin(promotionUser(c)); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	})
	admin.GET("/policy", func(c *gin.Context) {
		value, err := svc.AdminPromotionPolicy(promotionUser(c))
		promotionResponse(c, value, err)
	})
	admin.PUT("/policy", func(c *gin.Context) {
		var request struct {
			Enabled    *bool  `json:"enabled"`
			RatioBPS   *int64 `json:"ratioBps"`
			FreezeDays *int   `json:"freezeDays"`
			Version    *int64 `json:"version"`
		}
		if !promotionBind(c, &request) {
			return
		}
		if request.Enabled == nil || request.RatioBPS == nil || request.FreezeDays == nil || request.Version == nil {
			failService(c, kernel.BadAuthRequest("请提交完整的推广规则和配置版本"))
			return
		}
		value, err := svc.UpdatePromotionPolicy(promotionUser(c), service.PromotionPolicy{Enabled: *request.Enabled, RatioBPS: *request.RatioBPS, FreezeDays: *request.FreezeDays, Version: *request.Version})
		promotionResponse(c, value, err)
	})
	admin.GET("/profiles", func(c *gin.Context) {
		page, size := promotionPaging(c)
		value, err := svc.AdminPromotionProfiles(promotionUser(c), c.Query("keyword"), page, size)
		promotionResponse(c, value, err)
	})
	admin.PUT("/profiles/:userId", func(c *gin.Context) {
		var request struct {
			Paused           *bool           `json:"paused"`
			Version          *int64          `json:"version"`
			RatioOverrideBPS json.RawMessage `json:"ratioOverrideBps"`
		}
		if !promotionBind(c, &request) {
			return
		}
		var ratio *int64
		if request.Paused == nil || request.Version == nil || len(request.RatioOverrideBPS) == 0 || json.Unmarshal(request.RatioOverrideBPS, &ratio) != nil {
			failService(c, kernel.BadAuthRequest("请提交暂停状态、个人比例（整数或 null）和配置版本"))
			return
		}
		value, err := svc.UpdatePromotionProfile(promotionUser(c), c.Param("userId"), service.PromotionProfileRequest{Paused: *request.Paused, Version: *request.Version, RatioOverrideBPS: ratio})
		promotionResponse(c, value, err)
	})
	admin.GET("/records", func(c *gin.Context) {
		page, size := promotionPaging(c)
		value, err := svc.AdminPromotionRecords(promotionUser(c), c.Query("userId"), page, size)
		promotionResponse(c, value, err)
	})
	admin.POST("/records/:id/void", func(c *gin.Context) {
		var request struct {
			Reason string `json:"reason"`
		}
		if !promotionBind(c, &request) {
			return
		}
		err := svc.VoidPromotionCommission(promotionUser(c), c.Param("id"), request.Reason)
		promotionResponse(c, gin.H{"voided": true}, err)
	})
}

func promotionAuthentication(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Set("promotionUser", user)
		c.Next()
	}
}
func promotionUser(c *gin.Context) *model.User { return c.MustGet("promotionUser").(*model.User) }
func promotionPaging(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.Query("page"))
	size, _ := strconv.Atoi(c.Query("pageSize"))
	return page, size
}
func promotionBind(c *gin.Context, value any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if err := c.ShouldBindJSON(value); err != nil {
		fail(c, http.StatusBadRequest, err)
		return false
	}
	return true
}
func promotionResponse(c *gin.Context, value any, err error) {
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, value)
}
