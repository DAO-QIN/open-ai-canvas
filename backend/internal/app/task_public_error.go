package app

import (
	"regexp"
	"strings"
)

const publicModelServiceError = "模型服务处理失败，请稍后重试或换用其他模型。"
const publicModelParameterError = "当前模型不支持这组参数或参考素材，请调整输入或切换模型后重试。"

var publicErrorProtocolWrapper = regexp.MustCompile(`^声明式协议任务失败（任务 [^）]*）：`)
var publicErrorParameterDetails = regexp.MustCompile(`(?i)ref_(?:image|audio)_\d+|first_frame|last_frame|RequestParameterIsWrong|缺少必填参数|invalid.?parameter|不支持参数|超出支持范围`)
var publicErrorInternalDetails = regexp.MustCompile(`(?i)https?://|file://|authorization|api[ _-]?key|token|cookie|secret|\bHTTP\s*\d{3}\b|\b(?:GET|POST|PUT|DELETE)\s|dial tcp|no such host|connection refused|traceback|stack trace|渠道|供应商|声明式协议|workflow_id|task_id|upstream_error|invalid_request_error|internal_server_error|[{}\r\n]`)

// Only public copies are projected. Stored task errors and administrator API
// call logs keep the original diagnostic, including protocol response details.
func publicTaskErrorMessage(raw string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return ""
	}
	message = publicErrorProtocolWrapper.ReplaceAllString(message, "")
	if isContentModerationFailure(message) {
		return "内容审核未通过，请修改提示词或参考素材后重新生成。"
	}
	if index := strings.Index(message, "；上游："); index >= 0 {
		message = strings.TrimSpace(message[index+len("；上游："):])
	}
	if publicErrorParameterDetails.MatchString(message) {
		return publicModelParameterError
	}
	if publicErrorInternalDetails.MatchString(message) {
		return publicModelServiceError
	}
	return truncateRunes(message, 240)
}
