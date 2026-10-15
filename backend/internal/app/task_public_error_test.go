package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestPublicTaskErrorMessage(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"", ""},
		{"当前模型至少需要 1 张参考图片，请添加后重试。", "当前模型至少需要 1 张参考图片，请添加后重试。"},
		{"声明式协议任务失败（任务 private-id）：缺少必填参数：ref_image_0", publicModelParameterError},
		{"模型请求失败；上游：RequestParameterIsWrong: ref_audio_0", publicModelParameterError},
		{"模型接口不存在，请检查渠道配置", publicModelServiceError},
		{"POST https://private.example/worker?token=secret HTTP 401", publicModelServiceError},
		{"模型请求失败；上游：图片中包含不支持的内容，请更换图片。", "图片中包含不支持的内容，请更换图片。"},
		{"内容审核未通过 sensitive_words_detected", "内容审核未通过，请修改提示词或参考素材后重新生成。"},
	} {
		if got := publicTaskErrorMessage(tc.raw); got != tc.want {
			t.Errorf("input %q: got %q, want %q", tc.raw, got, tc.want)
		}
	}
}

func TestTaskPublicProjectionRetainsInternalDiagnostics(t *testing.T) {
	raw := "声明式协议任务失败（任务 private-id）：缺少必填参数：ref_image_0"
	diagnosticJSON, _ := json.Marshal(model.TaskExecutionDiagnostic{SafeMessage: raw, WritebackMessage: "渠道地址失效"})
	task := model.Task{ID: "platform-task", Error: raw, ProviderCancelError: "渠道鉴权失败", ExecutionDiagnosticJSON: string(diagnosticJSON)}
	output := taskForOutput(task)
	if output.Error != publicModelParameterError || output.ProviderCancelError != publicModelServiceError || output.Diagnostic.SafeMessage != publicModelParameterError || output.Diagnostic.WritebackMessage != publicModelServiceError {
		t.Fatalf("public projection exposes internal errors: %+v", output)
	}
	if task.Error != raw || task.ExecutionDiagnosticJSON != string(diagnosticJSON) || !strings.Contains(task.ProviderCancelError, "渠道") {
		t.Fatal("public projection modified the stored diagnostic")
	}
	if summary := taskSummaryForOutput(task); summary.ProviderCancelError != publicModelServiceError {
		t.Fatalf("summary exposes internal cancellation error: %+v", summary)
	}
	log := model.TaskLog{Level: "error", Message: "任务处理失败", Payload: raw}
	publicLog := taskLogForOutput(log)
	if publicLog.Payload != "" || publicLog.Message != log.Message || log.Payload != raw {
		t.Fatal("public logs must hide the payload while preserving internal logs")
	}
}
