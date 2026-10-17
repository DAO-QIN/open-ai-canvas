package app

import (
	"errors"
	"strings"
	"testing"
)

func TestConsumerModelErrorsHideProtocolAndConfiguredChannelIdentities(t *testing.T) {
	for _, raw := range []string{
		"爱困视频协议仅适用于 omni-flash",
		"沧元 Midjourney 模型名与线路不匹配",
		"接口类型 secret-video 未安装声明式适配器",
		"CHANNEL_000037 模型暂不可用",
	} {
		if got := userFacingTaskError(raw); got != taskErrorModelConfigurationMessage {
			t.Fatalf("%q -> %q", raw, got)
		}
	}
	raw := "私有渠道甲：参考图最多 2 张，请减少图片后重试"
	got := redactModelServiceIdentities(raw, []string{"私有渠道甲"})
	if got != "模型服务：参考图最多 2 张，请减少图片后重试" {
		t.Fatalf("actionable reason lost: %q", got)
	}
	if raw != "私有渠道甲：参考图最多 2 张，请减少图片后重试" {
		t.Fatal("raw diagnostic changed")
	}
	if got := redactModelServiceIdentities("FAL request failed: 图片格式不支持", []string{"fal"}); got != "模型服务 request failed: 图片格式不支持" {
		t.Fatalf("provider name matched inside an ordinary word: %q", got)
	}
}

func TestConsumerModelErrorsUseInstalledProviderNames(t *testing.T) {
	svc := &Service{}
	err := errors.New("爱困 Gemini 视频 · omni-flash：参考图格式不支持")
	got := svc.consumerModelError(err.Error())
	if strings.Contains(got, "爱困") || !strings.Contains(got, "参考图格式不支持") {
		t.Fatalf("unsafe or unhelpful message: %q", got)
	}
	if !strings.Contains(err.Error(), "爱困") {
		t.Fatal("raw error must remain available for diagnostics")
	}
}
