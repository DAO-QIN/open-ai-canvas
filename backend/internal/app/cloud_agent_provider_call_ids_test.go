package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// 线上复现（诊断号 ag3f4b5d140ca95df4745f975d2a934885）：中转线路把思考签名编码进工具调用 ID，
// ID 长达数千字符，超过内部上限后整步被判为无效调用，运行以"Agent 执行中断"结束。
func longProviderCallID(seed string) string {
	return "call_" + strings.Repeat(seed, 4400/len(seed)+1)[:4378]
}

func TestCloudAgentInternalCallIDKeepsOrdinaryProviderIDs(t *testing.T) {
	for _, id := range []string{
		"", "call-1", "call_472251", "toolu_01ABCdef0123456789abcd", "call_123_mvveclem",
		"generate_media-1793451251530953162-29397", "fc_" + strings.Repeat("a", 61),
	} {
		if got := cloudAgentInternalCallID(id); got != id {
			t.Fatalf("ordinary id %q changed to %q", id, got)
		}
	}
}

func TestCloudAgentInternalCallIDAliasesOversizedOrUnsafeIDs(t *testing.T) {
	long := longProviderCallID("x0kN2lO1SGZZ")
	alias := cloudAgentInternalCallID(long)
	if !isCloudAgentProviderCallAlias(alias) || len(alias) > cloudAgentInternalCallIDMaxRunes {
		t.Fatalf("alias = %q", alias)
	}
	if again := cloudAgentInternalCallID(long); again != alias {
		t.Fatalf("alias is not deterministic: %q != %q", again, alias)
	}
	if other := cloudAgentInternalCallID(longProviderCallID("x0gSXLUJw04K")); other == alias {
		t.Fatal("different provider ids share one alias")
	}
	if cloudAgentInternalCallID(alias) != alias {
		t.Fatal("alias must be stable when normalized again")
	}
	// 65 个字符：仍在旧校验上限内，但会超出部分存储列，同样换成短 ID。
	if got := cloudAgentInternalCallID("c" + strings.Repeat("1", 64)); !isCloudAgentProviderCallAlias(got) {
		t.Fatalf("65-rune id not aliased: %q", got)
	}
	if got := cloudAgentInternalCallID("call\x01bad"); !isCloudAgentProviderCallAlias(got) {
		t.Fatalf("control-character id not aliased: %q", got)
	}
	if isCloudAgentProviderCallAlias("pcid_" + strings.Repeat("g", cloudAgentProviderCallIDHexLen)) {
		t.Fatal("non-hex alias accepted")
	}
}

func TestCloudAgentNormalizedProviderCallsPassValidation(t *testing.T) {
	var call cloudAgentCall
	call.ID = longProviderCallID("abc123")
	call.Function.Name = "generate_media"
	call.Function.Arguments = `{"prompt":"人像","mode":"image"}`
	calls := []cloudAgentCall{call}
	if err := validateCloudAgentCalls(calls); err == nil {
		t.Fatal("oversized provider id should fail before normalization")
	}
	normalized := cloudAgentNormalizeProviderCalls(calls)
	if err := validateCloudAgentCalls(normalized); err != nil {
		t.Fatalf("normalized calls rejected: %v", err)
	}
	if calls[0].ID != call.ID {
		t.Fatal("normalization mutated the source slice")
	}
	// 同一批里重复的上游 ID 仍然得到相同短 ID，重复检测保持有效。
	if err := validateCloudAgentCalls(cloudAgentNormalizeProviderCalls([]cloudAgentCall{call, call})); err == nil {
		t.Fatal("duplicate provider ids must stay duplicate after normalization")
	}
}

func TestCloudAgentProviderCallIDsFromResult(t *testing.T) {
	long := longProviderCallID("sig")
	result, _ := json.Marshal(map[string]any{"text": "", "toolCalls": []map[string]any{
		{"id": long, "function": map[string]any{"name": "generate_media", "arguments": "{}"}},
		{"id": "call_short", "function": map[string]any{"name": "plan_update", "arguments": "{}"}},
	}})
	found := map[string]string{}
	cloudAgentProviderCallIDsFromResult(string(result), found)
	if len(found) != 1 || found[cloudAgentInternalCallID(long)] != long {
		t.Fatalf("mapping = %#v", found)
	}
}

func TestRestoreCanonicalAgentProviderCallIDsForEveryProtocol(t *testing.T) {
	long := longProviderCallID("Zx9")
	alias := cloudAgentInternalCallID(long)
	messages := []map[string]any{
		{"role": "user", "content": "生成一张人像"},
		{"role": "assistant", "content": []interface{}{
			map[string]interface{}{"type": "toolCall", "id": alias, "name": "generate_media", "arguments": map[string]interface{}{"prompt": "人像"}},
			map[string]interface{}{"type": "toolCall", "id": "call_keep", "name": "plan_update", "arguments": map[string]interface{}{"items": []interface{}{}}},
		}},
		{"role": "toolResult", "toolCallId": alias, "toolName": "generate_media", "content": []interface{}{map[string]interface{}{"type": "text", "text": "{\"taskId\":\"t1\"}"}}},
		{"role": "toolResult", "toolCallId": "call_keep", "toolName": "plan_update", "content": "{}"},
	}
	tools := runtimeToolSchemas([]map[string]any{
		{"name": "generate_media", "description": "生成媒体", "parameters": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "plan_update", "description": "更新清单", "parameters": map[string]any{"type": "object", "properties": map[string]any{}}},
	})
	canonical, err := canonicalFromRuntimeMessages(messages, tools, "你是创作助手")
	if err != nil {
		t.Fatal(err)
	}
	aliases := canonicalAgentProviderCallAliases(canonical.Messages)
	if len(aliases) != 1 || aliases[0] != alias {
		t.Fatalf("aliases = %#v", aliases)
	}
	before, _ := json.Marshal(canonical)
	restored := restoreCanonicalAgentProviderCallIDs(&canonical, map[string]string{alias: long})
	after, _ := json.Marshal(canonical)
	if string(before) != string(after) {
		t.Fatal("restoring ids mutated the persisted canonical request")
	}
	requests, err := expandCanonicalAgentRequest(restored, providerConfig{}, true)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]map[string]interface{}{
		"chatCompletion": requests.ChatCompletion, "responses": requests.Responses, "claude": requests.Claude, "gemini": requests.Gemini,
	} {
		raw, _ := json.Marshal(body)
		text := string(raw)
		if strings.Contains(text, alias) {
			t.Fatalf("%s body still carries the internal alias", name)
		}
		// Gemini 原生请求体只把 function_call 条目渲染为 functionCall（既有行为），
		// 聊天格式的 tool_calls 只在工具结果处带 ID；其余协议在调用与结果两处都带。
		want := 2
		if name == "gemini" {
			want = 1
		}
		if strings.Count(text, long) < want {
			t.Fatalf("%s body should carry the provider id %d time(s)", name, want)
		}
		if !strings.Contains(text, "call_keep") {
			t.Fatalf("%s body lost an ordinary id", name)
		}
	}
	if same := restoreCanonicalAgentProviderCallIDs(&canonical, nil); same != &canonical {
		t.Fatal("empty mapping should reuse the request")
	}
}

func TestCloudAgentPiModelAcceptsOversizedProviderCallIDs(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	req := agentTestRequest()
	req.PermissionMode = "auto"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	runID := root.ID
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	type outcome struct {
		result any
		err    error
	}
	runStep := func(messages string) chan outcome {
		done := make(chan outcome, 1)
		payload := map[string]json.RawMessage{"messages": json.RawMessage(messages), "thinkingLevel": json.RawMessage(`"medium"`)}
		go func() {
			result, stepErr := s.cloudAgentPiModel(ctx, "user", runID, payload)
			done <- outcome{result, stepErr}
		}()
		return done
	}
	nextStep := func(skip string, done chan outcome) string {
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			stored, readErr := s.repo.CloudAgent("user", runID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			state, decodeErr := cloudAgentDecode(stored)
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			if state.ActiveTaskID != "" && state.ActiveTaskID != skip {
				task, taskErr := s.repo.TaskForUser("user", state.ActiveTaskID)
				if taskErr != nil {
					t.Fatal(taskErr)
				}
				if task.Operation == cloudAgentStepOperation {
					return state.ActiveTaskID
				}
			}
			select {
			case got := <-done:
				t.Fatalf("model bridge returned early: result=%v err=%v", got.result, got.err)
			case <-time.After(50 * time.Millisecond):
			}
		}
		t.Fatal("model step was never scheduled")
		return ""
	}
	finish := func(taskID, resultJSON string) {
		if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": resultJSON}).Error; err != nil {
			t.Fatal(err)
		}
	}
	wait := func(done chan outcome) map[string]any {
		select {
		case got := <-done:
			if got.err != nil {
				t.Fatalf("model bridge failed: %v", got.err)
			}
			result, _ := got.result.(map[string]any)
			return result
		case <-ctx.Done():
			t.Fatal("model bridge did not return")
		}
		return nil
	}

	long := longProviderCallID("x0kN2lO1SGZZV8Ct")
	alias := cloudAgentInternalCallID(long)
	firstDone := runStep(`[{"role":"user","content":"生成一张人像"}]`)
	first := nextStep("", firstDone)
	providerResult, _ := json.Marshal(map[string]any{"mode": "text", "text": "", "toolCalls": []map[string]any{
		{"id": long, "function": map[string]any{"name": "generate_media", "arguments": `{"prompt":"人像","mode":"image"}`}},
	}})
	finish(first, string(providerResult))
	firstResult := wait(firstDone)
	calls, _ := firstResult["toolCalls"].([]map[string]any)
	if len(calls) != 1 || calls[0]["id"] != alias {
		t.Fatalf("runtime should receive the internal alias, got %#v", firstResult["toolCalls"])
	}
	stored, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status == "failed" {
		t.Fatalf("run failed: %q", stored.FailureMessage)
	}

	history, _ := json.Marshal([]map[string]any{
		{"role": "user", "content": "生成一张人像"},
		{"role": "assistant", "content": []map[string]any{{"type": "toolCall", "id": alias, "name": "generate_media", "arguments": map[string]any{"prompt": "人像", "mode": "image"}}}},
		{"role": "toolResult", "toolCallId": alias, "toolName": "generate_media", "content": []map[string]any{{"type": "text", "text": `{"status":"submitted"}`}}},
	})
	secondDone := runStep(string(history))
	second := nextStep(first, secondDone)
	var task model.Task
	if err := db.First(&task, "id = ?", second).Error; err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.AgentRequests == nil || input.AgentRequests.ProviderCallIDs[alias] != long {
		t.Fatalf("next model step lacks the provider id mapping: %v", input.AgentRequests != nil)
	}
	canonicalJSON, _ := json.Marshal(input.AgentRequests.Canonical)
	if strings.Contains(string(canonicalJSON), long) {
		t.Fatal("persisted canonical history must keep the short id")
	}
	restored := restoreCanonicalAgentProviderCallIDs(input.AgentRequests.Canonical, input.AgentRequests.ProviderCallIDs)
	requests, err := expandCanonicalAgentRequest(restored, providerConfig{}, false)
	if err != nil {
		t.Fatal(err)
	}
	wire, _ := json.Marshal(requests.ChatCompletion)
	if strings.Count(string(wire), long) < 2 || strings.Contains(string(wire), alias) {
		t.Fatal("upstream request must carry the original provider id on the call and its result")
	}
	finish(second, `{"mode":"text","text":"已提交生成","toolCalls":[]}`)
	if result := wait(secondDone); result["text"] != "已提交生成" {
		t.Fatalf("unexpected second result: %#v", result)
	}
}
