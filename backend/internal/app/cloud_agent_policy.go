package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/prompts"
	"yingce/backend/internal/skills"
)

const (
	cloudAgentCompilerVersion              = "cloud-agent-policy-compiler/v6"
	cloudAgentDefaultReasoning             = "off"
	cloudAgentCreationCapabilitySetVersion = "creation-agent-capabilities/v9"
)

const cloudAgentCreationCapabilityGuide = "首页创作能力：当前会话对话与规划、按所选模型生成图片/视频/音频、独立图片整批提交及多图修改、已授权附件引用、电商计划审核和本会话任务查询。可用技能由目录发现并按需读取。个人长期记忆来自本轮冻结的记忆文件，可用 memory_update 按用户当前模式更新；记忆仅供参考，不代替用户要求、能力核验或收费授权。当前入口没有画布数据和画布操作工具。"

func cloudAgentCreationCapabilitySetHash() string {
	return agentProfileHash(cloudAgentCreationCapabilityGuide)
}

type cloudAgentPolicySnapshot struct {
	SystemPolicyID       string `json:"systemPolicyId"`
	SystemPolicyVersion  int    `json:"systemPolicyVersion"`
	SystemPolicyHash     string `json:"systemPolicyHash"`
	MediaPolicyID        string `json:"mediaPolicyId"`
	MediaPolicyVersion   int    `json:"mediaPolicyVersion"`
	MediaPolicyHash      string `json:"mediaPolicyHash"`
	CapabilitySetVersion string `json:"capabilitySetVersion"`
	CapabilitySetHash    string `json:"capabilitySetHash"`
	ReasoningMode        string `json:"reasoningMode"`
	CompilerVersion      string `json:"compilerVersion"`
	ProfileRevision      string `json:"profileRevision,omitempty"`
	ProfileHash          string `json:"profileHash,omitempty"`
	// SystemSegments 记录编译出来的系统提示由哪些块组成。压力读数把它摊开上报，
	// 排查时不必再从提示词正文反推"系统提示里谁是画布摘要、谁是个人记忆"。
	SystemSegments []cloudAgentContextSegment `json:"systemSegments,omitempty"`
}

// cloudAgentContextSegment 是系统提示里的一块（编译期按写入顺序量出来的）。
type cloudAgentContextSegment struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Bytes  int    `json:"bytes"`
	Tokens int    `json:"tokens"`
	// ScaledTokens 是按上游实测锚点比例校准后的读数；没有锚点时与 Tokens 相同。
	ScaledTokens int `json:"scaledTokens,omitempty"`
}

// cloudAgentSegmentRecorder 在编译系统提示时逐块量尺寸：它只记录"上一次标记之后追加了
// 多少字节"，因此分段合计与最终 system 正文逐字节一致（含块之间的标题与分隔符）。
type cloudAgentSegmentRecorder struct {
	segments []cloudAgentContextSegment
	last     int
}

func (r *cloudAgentSegmentRecorder) mark(builder *strings.Builder, key, label string) {
	end := builder.Len()
	if size := end - r.last; size > 0 {
		text := builder.String()[r.last:end]
		r.segments = append(r.segments, cloudAgentContextSegment{Key: key, Label: label, Bytes: size, Tokens: estimateCloudAgentTokens([]byte(text))})
	}
	r.last = end
}

// cloudAgentRecordSystemSegment 登记"编译之后"追加进系统提示的块（当前是个人记忆索引），
// 让分段合计与实际 system 桶一致；同 key 重复调用只保留最新一次，因此它既能在创建运行时
// 登记，也能在每一步幂等补登记。
func cloudAgentRecordSystemSegment(policy *cloudAgentPolicySnapshot, key, label, text string) {
	if policy == nil || strings.TrimSpace(text) == "" {
		return
	}
	segment := cloudAgentContextSegment{Key: key, Label: label, Bytes: len(text), Tokens: estimateCloudAgentTokens([]byte(text))}
	for index := range policy.SystemSegments {
		if policy.SystemSegments[index].Key == key {
			policy.SystemSegments[index] = segment
			return
		}
	}
	policy.SystemSegments = append(policy.SystemSegments, segment)
}

type cloudAgentProfileSnapshot struct {
	Revision string              `json:"revision"`
	Hash     string              `json:"hash"`
	Layers   []AgentProfileLayer `json:"layers"`
}

func cloudAgentReasoningMode(req CloudAgentRequest) string {
	mode := strings.ToLower(strings.TrimSpace(req.ReasoningMode))
	if mode == "off" || mode == "auto" || mode == "deep" {
		return mode
	}
	return cloudAgentDefaultReasoning
}

func cloudAgentReasoningEnabled(mode string) bool { return mode == "auto" || mode == "deep" }

func cloudAgentCapabilityGuide() string {
	var b strings.Builder
	b.WriteString("节点能力速查（由服务端能力注册表生成，只用于自主路由，不是工具授权）：\n")
	for _, descriptor := range canvasCapabilityRegistry.List() {
		b.WriteString("- ")
		b.WriteString(descriptor.Label)
		b.WriteString("（")
		b.WriteString(descriptor.Type)
		b.WriteString("）：")
		b.WriteString(descriptor.Purpose)
		if variant := descriptor.Variant; variant != nil {
			fmt.Fprintf(&b, " 画布识别：type=%s 且 workflowKind=%s，读取结果 kind=%s；不能用 add_node 新建。", variant.BaseType, variant.WorkflowKind, descriptor.Type)
		}
		if len(descriptor.GoodFor) > 0 {
			b.WriteString(" 适合：")
			b.WriteString(strings.Join(descriptor.GoodFor, "、"))
			b.WriteString("。")
		}
		if len(descriptor.NotIdealFor) > 0 {
			b.WriteString(" 不适合：")
			b.WriteString(strings.Join(descriptor.NotIdealFor, "、"))
			b.WriteString("。")
		}
		if len(descriptor.Tradeoffs) > 0 {
			b.WriteString(" 维护取舍：")
			b.WriteString(strings.Join(descriptor.Tradeoffs, "；"))
			b.WriteString("。")
		}
		connection, _ := json.Marshal(map[string]any{
			"inputKind": descriptor.InputKind, "canSource": descriptor.Connection.CanSource,
			"canTarget": descriptor.Connection.CanTarget, "canReference": descriptor.Connection.CanReference,
			"acceptedInputKinds": descriptor.Connection.AcceptedInputKinds,
			"rejectedInputKinds": descriptor.Connection.RejectedInputKinds,
			"maxInputCount":      descriptor.Connection.MaxInputCount,
		})
		b.WriteString(" 连线能力：")
		b.Write(connection)
		b.WriteString("\n")
	}
	return b.String()
}

func compileCloudAgentPoliciesForIdentity(req CloudAgentRequest, agentName, platformName string, skillCatalog *cloudAgentSkillCatalog, canvasSummary string, profile cloudAgentProfileSnapshot, anchors ...cloudAgentCreativeAnchor) (string, cloudAgentPolicySnapshot, error) {
	system, media, err := prompts.LoadAgentPolicies()
	creation := req.Surface == "creation"
	if creation {
		system, media, err = prompts.LoadCreationAgentPolicies()
	}
	if err != nil {
		return "", cloudAgentPolicySnapshot{}, err
	}
	mode := cloudAgentReasoningMode(req)
	capabilityHash := cloudAgentCapabilitySetHash()
	capabilityVersion := cloudAgentCapabilitySetVersion
	if creation {
		capabilityHash, capabilityVersion = cloudAgentCreationCapabilitySetHash(), cloudAgentCreationCapabilitySetVersion
	}
	snapshot := cloudAgentPolicySnapshot{
		SystemPolicyID: system.ID, SystemPolicyVersion: system.Version, SystemPolicyHash: system.Hash,
		MediaPolicyID: media.ID, MediaPolicyVersion: media.Version, MediaPolicyHash: media.Hash,
		CapabilitySetVersion: capabilityVersion, CapabilitySetHash: capabilityHash,
		ReasoningMode: mode, CompilerVersion: cloudAgentCompilerVersion,
		ProfileRevision: profile.Revision, ProfileHash: profile.Hash,
	}
	var b strings.Builder
	var recorder cloudAgentSegmentRecorder
	b.WriteString(system.Text)
	b.WriteString("\n\n")
	recorder.mark(&b, "policy", "系统行为策略")
	b.WriteString(media.Text)
	b.WriteString("\n\n")
	recorder.mark(&b, "mediaPolicy", "媒体策略")
	if creation {
		b.WriteString(cloudAgentCreationCapabilityGuide)
		recorder.mark(&b, "capabilities", "首页创作能力")
		if req.OutputPreference == "concise" {
			b.WriteString("\n\n输出偏好：简洁。优先让用户看到图片和主要结果；正文只简短说明交付数量、关键规格、真实完成或失败状态及必要下一步。完整方案由审核卡承载，不在正文重复逐图方案、素材与事实清单、风格说明或大段结果表格。普通问答和必要澄清保持信息完整。结构化计划、逐图生成提示词、上图文案、费用与审批信息仍须完整准确，只精简用户可见的说明。用户本轮明确要求详细解释时优先满足该要求。")
			recorder.mark(&b, "outputPreference", "输出偏好")
		}
	} else {
		b.WriteString(cloudAgentCapabilityGuide())
		recorder.mark(&b, "capabilities", "节点能力与选型")
	}
	// Behavior belongs to versioned policies; the compiler only projects facts.
	identity := map[string]string{"name": firstNonEmpty(strings.TrimSpace(agentName), defaultCanvasAppearance().AgentName)}
	if creation {
		identity["platformName"] = firstNonEmpty(strings.TrimSpace(platformName), defaultAppearanceBrandName)
	}
	context := map[string]any{
		"source": "server_snapshot", "permissionMode": req.PermissionMode,
		"agentIdentity": identity,
		"reasoningMode": mode,
		"budget": map[string]any{
			"maxCredits": req.Budget.MaxCredits, "maxSteps": cloudAgentStepLimit(req),
			"maxGenerationTasks": req.Budget.MaxGenerationTasks, "maxVideoSeconds": req.Budget.MaxVideoSeconds,
		},
		"maxToolCalls": cloudAgentMaxToolCalls, "maxOutputBytes": cloudAgentMaxOutputBytes,
	}
	if creation {
		context["surface"] = "creation"
		context["dialogueImageInputEnabled"] = req.VisionEnabled
		if req.OutputPreference != "" {
			context["outputPreference"] = req.OutputPreference
		}
	}
	if !creation && strings.TrimSpace(canvasSummary) != "" {
		// Callers may provide a catalog for policy-contract tests or other
		// isolated compilation paths. The production run path deliberately
		// passes an empty value and places the catalog in canonical messages so
		// the stable system prefix remains cacheable.
		context["canvasSummary"] = canvasSummary
	}
	if !creation && len(anchors) > 0 {
		// User intent remains in user messages, never frozen into system context.
		context["referenceCandidates"] = anchors[0].ReferenceAssets
	}
	if skillCatalog != nil {
		context["skillCatalog"] = map[string]int{"installed": skillCatalog.Installed, "described": skillCatalog.Described, "namesOnly": skillCatalog.NamesOnly, "omitted": skillCatalog.Omitted}
	}
	layers := make([]map[string]any, 0, len(profile.Layers))
	if !creation {
		for _, layer := range profile.Layers {
			layers = append(layers, map[string]any{"scope": layer.Scope, "revision": layer.Revision, "hash": layer.Hash, "characters": utf8.RuneCountInString(layer.Content)})
		}
	}
	context["profileLayers"] = layers
	encoded, err := json.Marshal(context)
	if err != nil {
		return "", cloudAgentPolicySnapshot{}, fmt.Errorf("encode Agent execution context: %w", err)
	}
	b.WriteString("\n\n本轮执行上下文：\n")
	b.Write(encoded)
	recorder.mark(&b, "execution", "本轮执行上下文（事实快照）")
	if skillCatalog != nil && strings.TrimSpace(skillCatalog.Text) != "" {
		b.WriteString("\n\n")
		b.WriteString(skillCatalog.Text)
	}
	recorder.mark(&b, "skills", "可用技能目录")
	snapshot.SystemSegments = recorder.segments
	text := strings.TrimSpace(b.String())
	if text == "" {
		return "", cloudAgentPolicySnapshot{}, fmt.Errorf("compiled Agent policy is empty")
	}
	return text, snapshot, nil
}

func compileCloudAgentPolicies(req CloudAgentRequest, selected []cloudAgentSkill, summary string, profile cloudAgentProfileSnapshot, anchors ...cloudAgentCreativeAnchor) (string, cloudAgentPolicySnapshot, error) {
	entries := make([]skills.AgentSkillCatalogEntry, 0, len(selected))
	for _, skill := range selected {
		if err := validateCloudAgentSkillSurface(skill, req.Surface); err != nil {
			return "", cloudAgentPolicySnapshot{}, err
		}
		entries = append(entries, skills.AgentSkillCatalogEntry{SkillID: skill.ID, Name: skill.Name, Description: skill.Description, VersionID: skill.Version})
	}
	var catalog *cloudAgentSkillCatalog
	if len(entries) > 0 {
		built := buildCloudAgentSkillCatalog(entries, 4000)
		catalog = &built
	}
	return compileCloudAgentPoliciesForIdentity(req, defaultCanvasAppearance().AgentName, "", catalog, summary, profile, anchors...)
}
