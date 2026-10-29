package handler

import (
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterAdminCreationMetricsRoutes 挂载创作体验指标。管理员权限与统计窗口都在 service 校验。
func RegisterAdminCreationMetricsRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/creation-metrics", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminCreationMetrics(c.Request.Context(), actor, c.Query("window"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
