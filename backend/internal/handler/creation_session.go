package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// RegisterCreationSessionRoutes 注册首页创作会话与生成记录接口（docs/design/home-agent.md §6.1、§6.2）。
// 与 /creation-runs（画布创意互动）无关。
func RegisterCreationSessionRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/creation/sessions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, err := creationPageLimit(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		page, err := svc.ListCreationSessions(user.ID, c.Query("cursor"), limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, page)
	})
	r.POST("/creation/sessions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CreateCreationSessionRequest
		if !bindCreationJSON(c, &req, 4<<10, true) {
			return
		}
		session, err := svc.CreateCreationSession(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, session)
	})
	r.POST("/creation/sessions/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ImportCreationSessionsRequest
		if !bindCreationJSON(c, &req, 8<<20, false) {
			return
		}
		result, err := svc.ImportCreationSessions(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/creation/sessions/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		session, err := svc.CreationSession(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, session)
	})
	r.PATCH("/creation/sessions/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdateCreationSessionRequest
		if !bindCreationJSON(c, &req, 16<<10, false) {
			return
		}
		session, err := svc.UpdateCreationSession(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, session)
	})
	r.DELETE("/creation/sessions/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteCreationSession(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})
	r.GET("/creation/sessions/:id/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, err := creationPageLimit(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		page, err := svc.ListCreationEntries(user.ID, c.Param("id"), c.Query("before"), limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, page)
	})
	r.POST("/creation/sessions/:id/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SubmitCreationEntryRequest
		// 任务输入包含参考素材定位和完整参数，沿用 POST /tasks 的请求上限。
		if !bindCreationJSON(c, &req, 16<<20, false) {
			return
		}
		req.Tasks = withCreationTraceIDs(c, req.Tasks)
		entry, err := svc.SubmitCreationEntry(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, entry)
	})
	r.GET("/creation/entries/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		entry, err := svc.CreationEntry(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, entry)
	})
	r.POST("/creation/entries/:id/retry", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		entry, err := svc.RetryCreationEntry(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, entry)
	})
	r.POST("/creation/entries/:id/clear-failed", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		entry, err := svc.ClearCreationEntryFailed(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, entry)
	})
}

func creationPageLimit(c *gin.Context) (int, error) {
	raw := strings.TrimSpace(c.Query("limit"))
	if raw == "" {
		return 0, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 100 {
		return 0, errors.New("limit 必须是 1 到 100 的整数")
	}
	return limit, nil
}

// bindCreationJSON 限制请求体大小并解析 JSON；allowEmpty 时空请求体按零值处理。
func bindCreationJSON(c *gin.Context, target any, limit int64, allowEmpty bool) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	if allowEmpty && c.Request.ContentLength == 0 {
		return true
	}
	if err := c.ShouldBindJSON(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, http.StatusRequestEntityTooLarge, errors.New("请求内容过大"))
			return false
		}
		fail(c, http.StatusBadRequest, errors.New("请求格式错误"))
		return false
	}
	return true
}

// withCreationTraceIDs 让生成记录创建的任务带上与 POST /tasks 相同的请求追踪信息。
func withCreationTraceIDs(c *gin.Context, tasks []service.CreateTaskRequest) []service.CreateTaskRequest {
	for index := range tasks {
		tasks[index].TraceID = TraceID(c)
		tasks[index].RequestID = RequestID(c)
	}
	return tasks
}
