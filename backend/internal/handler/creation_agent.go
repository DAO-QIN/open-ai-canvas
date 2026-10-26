package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// RegisterCreationAgentRoutes 注册首页创作会话的 Agent 接口（docs/design/home-agent.md §6.3、§7）。
func RegisterCreationAgentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/creation/sessions/:id/agent", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		snapshot, err := svc.CreationAgentSnapshot(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, snapshot)
	})
	r.GET("/creation/sessions/:id/agent/history", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		before, err := strconv.ParseInt(c.Query("before"), 10, 64)
		if err != nil || before <= 0 {
			fail(c, http.StatusBadRequest, errors.New("before 必须是正整数"))
			return
		}
		limit, err := creationPageLimit(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		history, err := svc.CreationAgentHistory(user.ID, c.Param("id"), before, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, history)
	})
	r.GET("/creation/sessions/:id/agent/events", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		after, err := creationAgentEventCursor(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		sessionID := c.Param("id")
		view, err := svc.CreationAgentEvents(user.ID, sessionID, after)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("X-Accel-Buffering", "no")
		_, _ = fmt.Fprint(c.Writer, ":connected\n\n")
		c.Writer.Flush()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		lastWrite, lastLive := time.Now(), ""
		for {
			if err != nil {
				writeCreationAgentSSE(c, "error", 0, gin.H{"message": "Agent 状态读取失败"})
				return
			}
			for _, item := range view.Items {
				if item.Seq > after {
					writeCreationAgentSSE(c, "agent", item.Seq, item)
					after = item.Seq
					lastWrite = time.Now()
				}
			}
			// 流式正文不落库，也不推进游标；内容没变时不重复发送。
			live := ""
			if view.Live != nil {
				live = view.Live.MessageID + ":" + view.Live.Text
			}
			if live != lastLive {
				writeCreationAgentSSE(c, "live", 0, view.Live)
				lastLive, lastWrite = live, time.Now()
			}
			if time.Since(lastWrite) >= 15*time.Second {
				_, _ = fmt.Fprint(c.Writer, ":heartbeat\n\n")
				c.Writer.Flush()
				lastWrite = time.Now()
			}
			select {
			case <-c.Request.Context().Done():
				return
			case <-ticker.C:
				view, err = svc.CreationAgentEvents(user.ID, sessionID, after)
			}
		}
	})
	r.POST("/creation/sessions/:id/agent/messages", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		var req service.CreationAgentMessageRequest
		if !bindCreationJSON(c, &req, 128<<10, false) {
			return
		}
		result, err := svc.SendCreationAgentMessage(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/creation/sessions/:id/agent/questions/:qid/answer", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		var req service.CreationAgentAnswerRequest
		if !bindCreationJSON(c, &req, 64<<10, false) {
			return
		}
		result, err := svc.AnswerCreationAgentQuestion(user.ID, c.Param("id"), c.Param("qid"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/creation/sessions/:id/agent/proposals/:pid/decision", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CreationAgentDecisionRequest
		if !bindCreationJSON(c, &req, 64<<10, false) {
			return
		}
		if len(req.Reason) > 2000 {
			fail(c, http.StatusBadRequest, errors.New("reason 过长"))
			return
		}
		result, err := svc.DecideCreationAgentProposal(user.ID, c.Param("id"), c.Param("pid"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/creation/sessions/:id/agent/stop", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.StopCreationAgent(c.Request.Context(), user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"accepted": true})
	})
}

// creationAgentEventCursor 读取 after 与 Last-Event-ID，两者都有时取较大值。
func creationAgentEventCursor(c *gin.Context) (int64, error) {
	cursor := int64(0)
	for _, raw := range []string{c.Query("after"), c.GetHeader("Last-Event-ID")} {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			return 0, errors.New("after 必须是非负整数")
		}
		cursor = max(cursor, value)
	}
	return cursor, nil
}

func writeCreationAgentSSE(c *gin.Context, event string, id int64, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	if id > 0 {
		_, _ = fmt.Fprintf(c.Writer, "id:%d\n", id)
	}
	_, _ = fmt.Fprintf(c.Writer, "event:%s\ndata:%s\n\n", event, data)
	c.Writer.Flush()
}
