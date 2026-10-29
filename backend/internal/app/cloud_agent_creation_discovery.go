package app

import agenttool "yingce/backend/internal/agent/tool"

// Shared discovery contracts are also exposed on the creation surface.
func cloudAgentCreationDiscoveryTools(req CloudAgentRequest) []map[string]any {
	tools := []map[string]any{}
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	add := func(name, description string, properties map[string]any, required ...string) {
		if !agenttool.Of(name).Allowed(cloudAgentToolScope(req, false)) {
			return
		}
		if required == nil {
			required = []string{}
		}
		tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": name, "description": description, "parameters": map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}}})
	}
	add("skill_market_search", "已装技能都不适用且任务需要专业工作法时，在技能市场找未安装的技能；只返回候选。", map[string]any{"keyword": str("需要的工作法"), "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 5}}, "keyword")
	add("skill_recommend", "把 skill_market_search 返回的技能推荐给用户安装；界面显示安装卡片由用户决定，每轮一次。", map[string]any{
		"skillIds": map[string]any{"type": "array", "minItems": 1, "maxItems": 3, "items": str("skill_market_search 返回的 skillId")},
		"reason":   map[string]any{"type": "string", "maxLength": 200, "description": "告诉用户装了能改善什么"},
	}, "skillIds", "reason")
	add("memory_update",
		"维护跨会话长期记忆。用户纠正你、说明偏好或要求记住，或你确认了可复用做法时调用；按顺序执行、按整批结果查容量，相近条目用 replace 合并。不记一次性细节、ID、链接。",
		map[string]any{
			"operations": map[string]any{"type": "array", "minItems": 1, "maxItems": agentMemoryOpsMax, "items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"action":  map[string]any{"type": "string", "enum": []string{"add", "replace", "remove"}},
					"id":      str("replace/remove 必填：条目 ID"),
					"section": map[string]any{"type": "string", "enum": []string{"user", "notes"}, "description": "add 必填：user=关于用户，notes=工作笔记"},
					"text":    map[string]any{"type": "string", "maxLength": agentMemoryEntryMaxRunes, "description": "add/replace 必填：一两句话，跨会话仍成立"},
				},
				"required": []string{"action"}, "additionalProperties": false,
			}},
			"reason": map[string]any{"type": "string", "maxLength": agentMemoryReasonMaxRunes, "description": "可选：为什么这样改，会显示给用户"},
		},
		"operations")
	return tools
}
