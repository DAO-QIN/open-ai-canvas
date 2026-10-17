package app

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const taskErrorModelConfigurationMessage = "当前模型配置暂不可用，请换用其他模型或联系管理员。"

var taskErrorModelConfigurationPattern = regexp.MustCompile(`(?i)(?:协议.{0,40}(?:仅适用|只支持|仅支持)|模型名.{0,30}不匹配|接口类型.{0,80}未安装|\b(?:CHANNEL|MODEL)_\d+|protocol\s+\S+\s+(?:not found|not installed))`)

// 使用真实注册名称投影错误文案；原错误仍留在管理员请求和任务诊断中。
func (s *Service) consumerModelError(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return raw
	}
	identities := []string{}
	if s.repo != nil {
		if channels, err := s.repo.SystemChannels(true); err == nil {
			for _, channel := range channels {
				identities = append(identities, channel.Name)
			}
		}
	}
	if registry := s.protocolRegistry(); registry != nil {
		for _, provider := range registry.List("", "", true) {
			identities = append(identities, provider.ID, provider.Name)
			// 注册名称惯例为“渠道名 模型名”或“渠道名 · 模型名”。
			if words := strings.FieldsFunc(provider.Name, func(r rune) bool { return r == ' ' || r == '·' || r == '｜' }); len(words) > 1 {
				identities = append(identities, words[0])
			}
		}
	}
	return redactModelServiceIdentities(raw, identities)
}

func redactModelServiceIdentities(raw string, identities []string) string {
	if strings.TrimSpace(raw) == "" {
		return raw
	}
	if taskErrorModelConfigurationPattern.MatchString(raw) {
		return taskErrorModelConfigurationMessage
	}
	identities = append([]string(nil), identities...)
	sort.Slice(identities, func(i, j int) bool { return len(identities[i]) > len(identities[j]) })
	for _, identity := range identities {
		identity = strings.TrimSpace(identity)
		if utf8.RuneCountInString(identity) < 2 || identity == "模型服务" {
			continue
		}
		pattern := regexp.QuoteMeta(identity)
		if isIdentityWordByte(identity[0]) {
			pattern = `\b` + pattern
		}
		if isIdentityWordByte(identity[len(identity)-1]) {
			pattern += `\b`
		}
		raw = regexp.MustCompile(`(?i)` + pattern).ReplaceAllString(raw, "模型服务")
	}
	return sanitizeUserVisibleError(raw)
}

func isIdentityWordByte(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' || value >= '0' && value <= '9' || value == '_'
}
