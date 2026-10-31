package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// 上游工具调用 ID 的兼容层。
//
// 不同供应商、中转线路返回的工具调用 ID 格式差异很大：有的只有十几个字符，
// 有的把思考签名等不透明数据编码进 ID，长达数千字符。运行时内部（Pi 会话、
// 回执、记忆修订、资源租约、事件）只使用不超过 cloudAgentInternalCallIDMaxRunes
// 的稳定 ID；超长或不合规的上游 ID 换成由原值哈希得到的短 ID，发回上游前再
// 还原成原值，保证上游能识别自己签发的 ID。规则与模型、渠道和 ID 前缀无关。

const (
	// 运行时内部调用 ID 的上限：低于记忆修订（120）与资源租约（160，含运行 ID 前缀）的存储列宽。
	cloudAgentInternalCallIDMaxRunes = 64
	cloudAgentProviderCallIDPrefix   = "pcid_"
	cloudAgentProviderCallIDHexLen   = 40
)

// cloudAgentInternalCallID 返回运行时内部使用的调用 ID。合规的短 ID 原样返回；
// 空 ID 保持为空（仍按无效调用处理）；其余由原值确定性地映射为短 ID。
func cloudAgentInternalCallID(id string) string {
	if id == "" || cloudAgentInternalCallIDValid(id) {
		return id
	}
	sum := sha256.Sum256([]byte(id))
	return cloudAgentProviderCallIDPrefix + hex.EncodeToString(sum[:])[:cloudAgentProviderCallIDHexLen]
}

func cloudAgentInternalCallIDValid(id string) bool {
	return utf8.RuneCountInString(id) <= cloudAgentInternalCallIDMaxRunes && validateCloudAgentID(id, "工具调用 ID", cloudAgentInternalCallIDMaxRunes) == nil
}

// isCloudAgentProviderCallAlias 判断 ID 是否是兼容层生成的短 ID。
func isCloudAgentProviderCallAlias(id string) bool {
	if len(id) != len(cloudAgentProviderCallIDPrefix)+cloudAgentProviderCallIDHexLen || !strings.HasPrefix(id, cloudAgentProviderCallIDPrefix) {
		return false
	}
	for _, r := range id[len(cloudAgentProviderCallIDPrefix):] {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// cloudAgentNormalizeProviderCalls 把模型结果里的上游调用 ID 换成内部 ID（返回新切片）。
func cloudAgentNormalizeProviderCalls(calls []cloudAgentCall) []cloudAgentCall {
	if len(calls) == 0 {
		return calls
	}
	normalized := make([]cloudAgentCall, len(calls))
	for index, call := range calls {
		call.ID = cloudAgentInternalCallID(call.ID)
		normalized[index] = call
	}
	return normalized
}

// cloudAgentProviderCallIDsFromResult 从一次模型步骤的原始结果中收集「短 ID → 上游原值」。
func cloudAgentProviderCallIDsFromResult(resultJSON string, into map[string]string) {
	if !strings.Contains(resultJSON, "toolCalls") && !strings.Contains(resultJSON, "tool_calls") {
		return
	}
	var result struct {
		ToolCalls []cloudAgentCall `json:"toolCalls"`
		Legacy    []cloudAgentCall `json:"tool_calls"`
	}
	if json.Unmarshal([]byte(resultJSON), &result) != nil {
		return
	}
	for _, call := range append(result.ToolCalls, result.Legacy...) {
		if alias := cloudAgentInternalCallID(call.ID); alias != call.ID {
			into[alias] = call.ID
		}
	}
}

// canonicalAgentProviderCallAliases 列出会话里出现的兼容层短 ID。
func canonicalAgentProviderCallAliases(messages []map[string]interface{}) []string {
	seen := map[string]bool{}
	var aliases []string
	add := func(id string) {
		if isCloudAgentProviderCallAlias(id) && !seen[id] {
			seen[id] = true
			aliases = append(aliases, id)
		}
	}
	for _, message := range messages {
		add(stringField(message, "call_id"))
		add(stringField(message, "tool_call_id"))
		for _, call := range canonicalAgentToolCalls(message["tool_calls"]) {
			add(stringField(call, "id"))
		}
	}
	return aliases
}

// restoreCanonicalAgentProviderCallIDs 返回把短 ID 还原成上游原值后的请求副本；
// 不修改原请求（原请求会写入任务记录并用于上下文估算）。没有对应原值的 ID 保持不变。
func restoreCanonicalAgentProviderCallIDs(source *canonicalAgentRequest, mapping map[string]string) *canonicalAgentRequest {
	if source == nil || len(mapping) == 0 {
		return source
	}
	restore := func(value interface{}) (string, bool) {
		id, _ := value.(string)
		original, ok := mapping[id]
		return original, ok && original != ""
	}
	copied := *source
	copied.Messages = make([]map[string]interface{}, len(source.Messages))
	for index, message := range source.Messages {
		next, cloned := message, false
		cloneOnce := func() {
			if !cloned {
				next, cloned = cloneStringAnyMap(message), true
			}
		}
		for _, key := range []string{"call_id", "tool_call_id"} {
			if original, ok := restore(message[key]); ok {
				cloneOnce()
				next[key] = original
			}
		}
		if rawCalls, present := message["tool_calls"]; present && rawCalls != nil {
			calls := canonicalAgentToolCalls(rawCalls)
			changed := false
			for _, call := range calls {
				if original, ok := restore(call["id"]); ok {
					call["id"] = original
					changed = true
				}
			}
			if changed {
				cloneOnce()
				wire := make([]interface{}, len(calls))
				for callIndex, call := range calls {
					wire[callIndex] = call
				}
				next["tool_calls"] = wire
			}
		}
		copied.Messages[index] = next
	}
	return &copied
}

// cloudAgentProviderCallIDCache 缓存「短 ID → 上游原值」。短 ID 由原值哈希得到，
// 条目永不失效；超过上限时整体清空，按需从任务记录重新读取。
var cloudAgentProviderCallIDCache = struct {
	sync.Mutex
	values map[string]string
}{values: map[string]string{}}

const cloudAgentProviderCallIDCacheLimit = 4096

// cloudAgentProviderCallIDs 为本次模型请求找出会话中短 ID 对应的上游原值。
// 会话里没有短 ID 时直接返回，不查询数据库。
func (s *Service) cloudAgentProviderCallIDs(userID string, run *model.CloudAgentExecution, canonical *canonicalAgentRequest) map[string]string {
	if run == nil || canonical == nil {
		return nil
	}
	aliases := canonicalAgentProviderCallAliases(canonical.Messages)
	if len(aliases) == 0 {
		return nil
	}
	mapping := make(map[string]string, len(aliases))
	missing := false
	cloudAgentProviderCallIDCache.Lock()
	for _, alias := range aliases {
		if original, ok := cloudAgentProviderCallIDCache.values[alias]; ok {
			mapping[alias] = original
		} else {
			missing = true
		}
	}
	cloudAgentProviderCallIDCache.Unlock()
	if !missing {
		return mapping
	}
	tasks, err := s.repo.CloudAgentModelStepResults(userID, []string{run.ID}, run.SessionID, run.ConversationID, []string{cloudAgentStepOperation, cloudAgentOperation})
	if err != nil {
		log.Printf("[Agent] provider call id lookup failed run=%s: %v", run.ID, err)
		return mapping
	}
	found := map[string]string{}
	for _, task := range tasks {
		cloudAgentProviderCallIDsFromResult(task.ResultJSON, found)
	}
	cloudAgentProviderCallIDCache.Lock()
	if len(cloudAgentProviderCallIDCache.values)+len(found) > cloudAgentProviderCallIDCacheLimit {
		cloudAgentProviderCallIDCache.values = map[string]string{}
	}
	for alias, original := range found {
		cloudAgentProviderCallIDCache.values[alias] = original
	}
	cloudAgentProviderCallIDCache.Unlock()
	unresolved := 0
	for _, alias := range aliases {
		if original, ok := found[alias]; ok {
			mapping[alias] = original
		} else if _, ok := mapping[alias]; !ok {
			unresolved++
		}
	}
	if unresolved > 0 {
		log.Printf("[Agent] provider call id unresolved run=%s count=%d", run.ID, unresolved)
	}
	return mapping
}
