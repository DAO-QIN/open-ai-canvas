// 首页创作会话的 Agent：会话级接口与公开事件。设计见 docs/design/home-agent.md §6.3、§7。
//
// 每条用户消息仍是一个内部轮次（cloud_agent_executions，target=creation），前端只面对会话。
// 内部事件在写入运行日志的同一事务里被整理成公开事件（projectCreationAgentJournal），
// 刷新恢复只需“快照 + after 续读”；流式正文不落库，由事件流按需附带。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func init() {
	repository.CloudAgentJournalAppended = projectCreationAgentJournal
}

const (
	creationAgentDefaultMaxCredits = 200
	creationAgentTextLimit         = 16000
	creationAgentEventsPageLimit   = 200
)

// CreationAgentItem 是一条公开事件；同一 id 的后续版本覆盖前一版本，按 position 排序展示。
type CreationAgentItem struct {
	ID        string          `json:"id"`
	Seq       int64           `json:"seq"`
	Position  int64           `json:"position"`
	Type      string          `json:"type"`
	TurnID    string          `json:"turnId,omitempty"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"createdAt"`
}

type CreationAgentSnapshotView struct {
	SessionID       string              `json:"sessionId"`
	Status          string              `json:"status"`
	LastSeq         int64               `json:"lastSeq"`
	Items           []CreationAgentItem `json:"items"`
	HistoryBefore   int64               `json:"historyBefore,omitempty"`
	ActiveRunID     string              `json:"activeRunId,omitempty"`
	AgentModel      map[string]string   `json:"agentModel,omitempty"`
	ReasoningEffort string              `json:"reasoningEffort,omitempty"`
}

type CreationAgentHistoryView struct {
	Items         []CreationAgentItem `json:"items"`
	HistoryBefore int64               `json:"historyBefore,omitempty"`
}

// CreationAgentLiveOutput 是正在流式生成、尚未落库的正文；不带序号，不参与续读。
type CreationAgentLiveOutput struct {
	RunID     string `json:"runId"`
	MessageID string `json:"messageId"`
	Text      string `json:"text"`
}

type CreationAgentEventsView struct {
	Items  []CreationAgentItem      `json:"items"`
	Status string                   `json:"status"`
	Live   *CreationAgentLiveOutput `json:"live,omitempty"`
}

type CreationAgentMessageRequest struct {
	RequestID       string                           `json:"requestId"`
	Text            string                           `json:"text"`
	References      []cloudAgentCreationReferenceArg `json:"references,omitempty"`
	LogicalModelID  string                           `json:"logicalModelId,omitempty"`
	ChannelID       string                           `json:"channelId,omitempty"`
	ChannelModelKey string                           `json:"channelModelKey,omitempty"`
	ReasoningMode   string                           `json:"reasoningMode,omitempty"`
	SkillIDs        []string                         `json:"skillIds,omitempty"`
	AutoContinue    *bool                            `json:"autoContinue,omitempty"`
	MaxCredits      float64                          `json:"maxCredits,omitempty"`
}

type CreationAgentMessageResult struct {
	Accepted  bool   `json:"accepted"`
	Seq       int64  `json:"seq"`
	RunID     string `json:"runId,omitempty"`
	Duplicate bool   `json:"duplicate,omitempty"`
	Delivered string `json:"delivered"` // run：新开轮次；interjection：作为插话送达当前轮次
}

type CreationAgentAnswerRequest struct {
	RequestID       string         `json:"requestId"`
	SelectedOptions []string       `json:"selectedOptions,omitempty"`
	Answers         map[string]any `json:"answers,omitempty"`
	Answer          string         `json:"answer,omitempty"`
	UseDefaults     bool           `json:"useRecommendedDefaults,omitempty"`
}

type CreationAgentDecisionRequest struct {
	DecisionID    string                   `json:"decisionId"`
	Approve       bool                     `json:"approve"`
	Reason        string                   `json:"reason,omitempty"`
	QuoteVersion  int                      `json:"quoteVersion,omitempty"`
	ExpectedQuote string                   `json:"expectedCreditsMicrocredits,omitempty"`
	Settings      *CloudAgentMediaSettings `json:"settings,omitempty"`
}

type CreationAgentDecisionResult struct {
	Proposal CreationAgentItem  `json:"proposal"`
	Entry    *CreationEntryView `json:"entry,omitempty"`
}

func creationAgentItem(event model.CreationAgentEvent) CreationAgentItem {
	return CreationAgentItem{ID: event.ItemID, Seq: event.Seq, Position: event.Position, Type: event.Type, TurnID: event.TurnID, Data: json.RawMessage(event.DataJSON), CreatedAt: event.CreatedAt}
}

func creationAgentItems(events []model.CreationAgentEvent) []CreationAgentItem {
	items := make([]CreationAgentItem, 0, len(events))
	for _, event := range events {
		items = append(items, creationAgentItem(event))
	}
	return items
}

// ---- 公开事件整理 ----

type creationAgentProjector struct {
	tx        *repository.Repository
	run       *model.CloudAgentExecution
	sessionID string
	inputs    []repository.CreationAgentEventInput
	latest    map[string]map[string]any
	question  bool
}

func projectCreationAgentJournal(tx *repository.Repository, run *model.CloudAgentExecution, records []model.CloudAgentEventRecord) error {
	if tx == nil || run == nil || run.OutputTarget() != model.CloudAgentTargetCreation || run.CreationSessionID == "" {
		return nil
	}
	session, err := tx.CreationSession(run.UserID, run.CreationSessionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 会话已删除：Agent 运行照常推进，只是不再产生公开事件。
		return nil
	}
	if err != nil {
		return err
	}
	p := &creationAgentProjector{tx: tx, run: run, sessionID: session.ID, latest: map[string]map[string]any{}}
	for _, record := range records {
		var event CloudAgentEvent
		if json.Unmarshal([]byte(record.EventJSON), &event) != nil {
			continue
		}
		if err := p.project(event); err != nil {
			return err
		}
	}
	if status := p.status(); status != session.AgentStatus {
		p.add("state", "state", map[string]any{"status": status}, status)
	}
	if len(p.inputs) == 0 {
		return nil
	}
	_, err = tx.AppendCreationAgentEvents(run.UserID, session.ID, p.inputs)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	return err
}

func (p *creationAgentProjector) add(itemID, kind string, data map[string]any, status string) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	p.latest[itemID] = data
	p.inputs = append(p.inputs, repository.CreationAgentEventInput{ItemID: itemID, Type: kind, RunID: p.run.ID, TurnID: p.run.ID, DataJSON: string(raw), Status: status})
}

// previous 返回同一条内容此前的版本，用于在其上合并更新（每个版本都是完整内容）。
func (p *creationAgentProjector) previous(itemID string) (map[string]any, error) {
	if data, ok := p.latest[itemID]; ok {
		return cloneCreationAgentData(data), nil
	}
	event, err := p.tx.LatestCreationAgentItem(p.run.UserID, p.sessionID, itemID)
	if err != nil || event == nil {
		return nil, err
	}
	data := map[string]any{}
	if err := json.Unmarshal([]byte(event.DataJSON), &data); err != nil {
		return nil, nil
	}
	return data, nil
}

// runApproval 返回本轮最近一张方案卡的 ID（一轮同时最多一张待处理方案）。
func (p *creationAgentProjector) runApproval() (string, map[string]any, error) {
	for index := len(p.inputs) - 1; index >= 0; index-- {
		if p.inputs[index].Type == "approval" {
			return p.inputs[index].ItemID, cloneCreationAgentData(p.latest[p.inputs[index].ItemID]), nil
		}
	}
	event, err := p.tx.LatestCreationAgentItemForRun(p.run.UserID, p.sessionID, p.run.ID, "approval")
	if err != nil || event == nil {
		return "", nil, err
	}
	data := map[string]any{}
	if err := json.Unmarshal([]byte(event.DataJSON), &data); err != nil {
		return "", nil, nil
	}
	return event.ItemID, data, nil
}

func cloneCreationAgentData(data map[string]any) map[string]any {
	clone := make(map[string]any, len(data))
	for key, value := range data {
		clone[key] = value
	}
	return clone
}

func (p *creationAgentProjector) status() string {
	switch p.run.Status {
	case "waiting_approval":
		return model.CreationAgentStatusApproval
	case "waiting_user":
		return model.CreationAgentStatusInput
	case "completed", "rejected":
		if p.question {
			return model.CreationAgentStatusInput
		}
		return model.CreationAgentStatusReady
	case "failed":
		return model.CreationAgentStatusError
	case "cancelled":
		return model.CreationAgentStatusStopped
	default:
		if p.run.MediaTaskID != "" {
			return model.CreationAgentStatusWaiting
		}
		return model.CreationAgentStatusRunning
	}
}

var creationAgentHiddenTools = map[string]bool{
	agenttool.PlanUpdate: true, agenttool.AskUser: true, agenttool.CreationGenerateMedia: true,
}

var creationAgentToolLabels = map[string]string{
	agenttool.ModelList: "查询可用模型", agenttool.CreationReadEntries: "查看本会话作品", agenttool.TaskGet: "查看任务状态",
	agenttool.SkillSearch: "查找技能", agenttool.SkillReadFile: "阅读技能", agenttool.RecallLessons: "查阅经验",
	agenttool.RememberLesson: "记录经验", agenttool.AgentProfileRead: "读取偏好",
}

func (p *creationAgentProjector) project(event CloudAgentEvent) error {
	payload := event.Payload
	runID := p.run.ID
	switch event.Type {
	case "assistant_message":
		text := strings.TrimSpace(stringValue(payload["text"]))
		if text == "" {
			return nil
		}
		p.add("msg:"+runID+":"+stringValue(payload["messageId"]), "message", map[string]any{"role": "assistant", "text": text}, "")
	case "reasoning_message":
		text := strings.TrimSpace(stringValue(payload["text"]))
		if text == "" {
			return nil
		}
		p.add("reasoning:"+runID+":"+stringValue(payload["messageId"]), "output", map[string]any{"kind": "reasoning", "status": "completed", "text": text}, "")
	case "tool_completed", "tool_failed":
		name := stringValue(payload["toolName"])
		if name == agenttool.CreationGenerateMedia && event.Type == "tool_failed" {
			handled, err := p.failApproval(stringValue(payload["text"]))
			if err != nil || handled {
				return err
			}
			// 方案还没进入审批就被准入拒绝：按普通工具失败行展示原因。
			p.add("tool:"+runID+":"+stringValue(payload["callId"]), "output", map[string]any{
				"kind": "tool", "status": "failed", "toolName": name, "callId": stringValue(payload["callId"]),
				"label": "准备生成方案", "text": truncateRunes(stringValue(payload["text"]), 300),
			}, "")
			return nil
		}
		if creationAgentHiddenTools[name] {
			return nil
		}
		status := "completed"
		if event.Type == "tool_failed" {
			status = "failed"
		}
		label := creationAgentToolLabels[name]
		if label == "" {
			label = name
		}
		data := map[string]any{"kind": "tool", "status": status, "toolName": name, "callId": stringValue(payload["callId"]), "label": label}
		if status == "failed" {
			data["text"] = truncateRunes(stringValue(payload["text"]), 300)
		}
		p.add("tool:"+runID+":"+stringValue(payload["callId"]), "output", data, "")
	case "plan_updated":
		items := creationMaps(payload["items"])
		steps := make([]map[string]any, 0, len(items))
		completed, current := 0, -1
		for index, item := range items {
			status := stringValue(item["status"])
			switch status {
			case "done":
				status = "completed"
				completed++
			case "doing":
				status = "in_progress"
				if current < 0 {
					current = index
				}
			default:
				status = "pending"
			}
			steps = append(steps, map[string]any{"id": stringValue(item["id"]), "step": stringValue(item["title"]), "status": status})
		}
		if current < 0 && completed < len(steps) {
			current = completed
		}
		p.add("plan", "plan", map[string]any{"steps": steps, "completedCount": completed, "currentIndex": current}, "")
	case "user_question":
		p.question = true
		data := map[string]any{"id": "question:" + runID, "runId": runID, "status": "pending"}
		for _, key := range []string{"kind", "question", "options", "fields", "questionId", "allowFreeform", "round", "maxRounds"} {
			if value, ok := payload[key]; ok {
				data[key] = value
			}
		}
		p.add("question:"+runID, "question", data, "")
	case "approval_requested":
		return p.requestApproval(payload)
	case "approval_decided":
		itemID := "approval:" + stringValue(payload["approvalId"])
		data, err := p.previous(itemID)
		if err != nil || data == nil {
			return err
		}
		if stringValue(payload["decision"]) == "reject" {
			data["status"] = "rejected"
			if reason := strings.TrimSpace(stringValue(payload["reason"])); reason != "" {
				data["reason"] = truncateRunes(reason, 300)
			}
		} else {
			data["status"] = "submitting"
			p.refreshApprovalForm(data, payload)
		}
		p.add(itemID, "approval", data, "")
	case "generation_task_created":
		entryID := stringValue(payload["entryId"])
		if entryID == "" {
			return nil
		}
		itemID, data, err := p.runApproval()
		if err != nil {
			return err
		}
		if data != nil {
			data["status"], data["entryId"] = "submitted", entryID
			p.add(itemID, "approval", data, "")
		}
		return p.addEntry(entryID)
	case "creation_entry_updated":
		entryID := stringValue(payload["entryId"])
		if entryID == "" {
			return nil
		}
		entryStatus := stringValue(payload["status"])
		itemID, data, err := p.runApproval()
		if err != nil {
			return err
		}
		if data != nil && stringValue(data["entryId"]) == entryID {
			data["status"] = "completed"
			if entryStatus != model.CreationEntryStatusSucceeded && entryStatus != model.CreationEntryStatusPartial {
				data["status"] = "failed"
			}
			p.add(itemID, "approval", data, "")
		}
		return p.addEntry(entryID)
	case "context_pressure":
		p.add("context:"+runID, "context", map[string]any{
			"used": payload["estimatedInputTokens"], "window": payload["contextWindowTokens"], "ratio": payload["pressureRatio"],
		}, "")
	case "context_compacted":
		p.add(fmt.Sprintf("activity:%s:%d", runID, event.Seq), "activity", map[string]any{"text": "对话较长，已整理上下文后继续"}, "")
	case "run_failed":
		text := truncateRunes(firstNonEmpty(stringValue(payload["text"]), "本轮运行失败"), 300)
		p.add(fmt.Sprintf("activity:%s:%d", runID, event.Seq), "activity", map[string]any{"text": text, "tone": "error"}, "")
		return p.addUsage()
	case "run_cancelled":
		p.add(fmt.Sprintf("activity:%s:%d", runID, event.Seq), "activity", map[string]any{"text": "已停止本轮"}, "")
		return p.addUsage()
	case "run_completed":
		return p.addUsage()
	}
	return nil
}

func (p *creationAgentProjector) requestApproval(payload map[string]any) error {
	approvalID := stringValue(payload["approvalId"])
	if approvalID == "" {
		return nil
	}
	preview, _ := payload["preview"].(map[string]any)
	data := map[string]any{
		"id": approvalID, "runId": p.run.ID, "status": "pending", "toolName": stringValue(payload["toolName"]),
		"title": stringValue(preview["title"]), "description": stringValue(preview["description"]), "modelName": stringValue(payload["modelName"]),
		"quoteVersion": 1,
	}
	if items := creationMaps(preview["items"]); len(items) > 0 {
		data["summary"], data["details"] = stringValue(items[0]["summary"]), items[0]["details"]
	}
	p.refreshApprovalForm(data, payload)
	if references, ok := payload["references"]; ok {
		form, _ := data["form"].(map[string]any)
		if form != nil {
			form["references"] = references
		}
	}
	p.add("approval:"+approvalID, "approval", data, "")
	return nil
}

// refreshApprovalForm 把方案参数和报价写入方案卡；审批时改参数后再次调用以更新。
func (p *creationAgentProjector) refreshApprovalForm(data, payload map[string]any) {
	args, _ := payload["arguments"].(map[string]any)
	if args != nil {
		form, _ := data["form"].(map[string]any)
		if form == nil {
			form = map[string]any{"references": []any{}}
		}
		form["type"], form["prompt"], form["title"], form["count"] = args["mode"], args["prompt"], args["title"], 1
		config := map[string]any{}
		for _, key := range []string{"logicalModelId", "channelId", "channelModelKey", "size", "quality", "imageResolution", "durationSeconds", "videoGenerateAudio"} {
			if value, ok := args[key]; ok && value != nil && value != "" {
				config[key] = value
			}
		}
		form["config"] = config
		data["form"] = form
	}
	if prepared, ok := payload["prepared"].(map[string]any); ok {
		if quote, ok := prepared["quote"].(map[string]any); ok {
			data["creditsMicrocredits"] = creationAgentMicrocreditString(quote["amountMicrocredits"])
			data["quoteExpiresAt"] = quote["expiresAt"]
		}
	}
	if name := stringValue(payload["modelName"]); name != "" {
		data["modelName"] = name
	}
}

func creationAgentMicrocreditString(value any) string {
	switch number := value.(type) {
	case float64:
		return strconv.FormatInt(int64(number), 10)
	case json.Number:
		return number.String()
	case int64:
		return strconv.FormatInt(number, 10)
	default:
		return "0"
	}
}

func (p *creationAgentProjector) failApproval(text string) (bool, error) {
	itemID, data, err := p.runApproval()
	if err != nil || data == nil {
		return false, err
	}
	switch stringValue(data["status"]) {
	case "pending", "submitting":
		data["status"] = "failed"
		data["error"] = truncateRunes(firstNonEmpty(text, "方案未能提交"), 300)
		p.add(itemID, "approval", data, "")
		return true, nil
	}
	return false, nil
}

func (p *creationAgentProjector) addEntry(entryID string) error {
	entry, err := p.tx.CreationEntry(p.run.UserID, entryID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	view := creationEntryView(*entry)
	raw, err := json.Marshal(view)
	if err != nil {
		return err
	}
	data := map[string]any{}
	if err := json.Unmarshal(raw, &data); err != nil {
		return err
	}
	p.add("entry:"+entryID, "result", data, "")
	return nil
}

// addUsage 在轮次结束时汇总本轮文本模型的扣费与 Token。
func (p *creationAgentProjector) addUsage() error {
	var state struct {
		TaskIDs []string `json:"taskIds"`
	}
	if json.Unmarshal([]byte(p.run.StateJSON), &state) != nil || len(state.TaskIDs) == 0 {
		return nil
	}
	orders, err := p.tx.BillingOrdersByTaskIDs(p.run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	credits, input, output, cached := int64(0), int64(0), int64(0), int64(0)
	for _, order := range orders {
		if normalizeCapability(order.Capability) != "text" {
			continue
		}
		credits += creationOrderCharge(order)
		input, output, cached = input+order.InputTokens, output+order.OutputTokens, cached+order.CachedTokens
	}
	p.add("usage:"+p.run.ID, "usage", map[string]any{"creditsMicrocredits": strconv.FormatInt(credits, 10), "inputTokens": input, "outputTokens": output, "cachedTokens": cached}, "")
	return nil
}

// ---- 会话级接口 ----

func creationAgentModelSelection(raw string) map[string]string {
	selection := map[string]string{}
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &selection) != nil {
		return nil
	}
	return selection
}

func (s *Service) CreationAgentSnapshot(userID, sessionID string) (*CreationAgentSnapshotView, error) {
	session, err := s.creationSessionForUser(userID, sessionID)
	if err != nil {
		return nil, err
	}
	rows, more, err := s.repo.CreationAgentSnapshot(userID, sessionID, 0, repository.CreationAgentSnapshotLimit)
	if err != nil {
		return nil, err
	}
	view := &CreationAgentSnapshotView{
		SessionID: session.ID, Status: firstNonEmpty(session.AgentStatus, model.CreationAgentStatusIdle), LastSeq: session.LastSeq,
		Items: creationAgentItems(rows), AgentModel: creationAgentModelSelection(session.AgentModel), ReasoningEffort: session.ReasoningEffort,
	}
	if more && len(rows) > 0 {
		view.HistoryBefore = rows[0].Position
	}
	if session.ActiveRunID != "" && s.cloudAgentRunActive(userID, session.ActiveRunID) {
		view.ActiveRunID = session.ActiveRunID
	}
	return view, nil
}

func (s *Service) CreationAgentHistory(userID, sessionID string, before int64, limit int) (*CreationAgentHistoryView, error) {
	if _, err := s.creationSessionForUser(userID, sessionID); err != nil {
		return nil, err
	}
	if before <= 0 {
		return nil, BadAuthRequest("before 必须是快照返回的 historyBefore")
	}
	rows, more, err := s.repo.CreationAgentSnapshot(userID, sessionID, before, limit)
	if err != nil {
		return nil, err
	}
	view := &CreationAgentHistoryView{Items: creationAgentItems(rows)}
	if more && len(rows) > 0 {
		view.HistoryBefore = rows[0].Position
	}
	return view, nil
}

// CreationAgentEvents 返回 after 之后的公开事件，以及当前轮次尚未落库的流式正文。
func (s *Service) CreationAgentEvents(userID, sessionID string, after int64) (*CreationAgentEventsView, error) {
	session, err := s.creationSessionForUser(userID, sessionID)
	if err != nil {
		return nil, err
	}
	view := &CreationAgentEventsView{Items: []CreationAgentItem{}, Status: firstNonEmpty(session.AgentStatus, model.CreationAgentStatusIdle)}
	if session.LastSeq > after {
		rows, err := s.repo.CreationAgentEventsAfter(userID, sessionID, after, creationAgentEventsPageLimit)
		if err != nil {
			return nil, err
		}
		view.Items = creationAgentItems(rows)
	}
	if session.ActiveRunID != "" && (view.Status == model.CreationAgentStatusRunning || view.Status == model.CreationAgentStatusReady) {
		view.Live = s.creationAgentLiveOutput(userID, session.ActiveRunID)
	}
	return view, nil
}

func (s *Service) creationAgentLiveOutput(userID, runID string) *CreationAgentLiveOutput {
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil || run.ActiveTaskID == "" || (run.Status != "running" && run.Status != "queued") {
		return nil
	}
	task, err := s.repo.TaskForUser(userID, run.ActiveTaskID)
	if err != nil || strings.TrimSpace(task.TextDraft) == "" {
		return nil
	}
	return &CreationAgentLiveOutput{RunID: runID, MessageID: task.ID, Text: task.TextDraft}
}

func validateCreationAgentRequestID(requestID string) error {
	if utf8.RuneCountInString(requestID) < 8 || validateCloudAgentID(requestID, "requestId", 80) != nil {
		return BadAuthRequest("需要 8–80 个字符的 requestId")
	}
	return nil
}

// SendCreationAgentMessage 受理一条用户消息：没有进行中的轮次时开新轮次（续接本会话上一轮），
// 有进行中的轮次时作为插话送达。同一 requestId 重复提交只受理一次。
func (s *Service) SendCreationAgentMessage(userID, sessionID string, req CreationAgentMessageRequest) (*CreationAgentMessageResult, error) {
	return s.sendCreationAgentMessage(userID, sessionID, req, "")
}

func (s *Service) sendCreationAgentMessage(userID, sessionID string, req CreationAgentMessageRequest, display string) (*CreationAgentMessageResult, error) {
	session, err := s.creationSessionForUser(userID, sessionID)
	if err != nil {
		return nil, err
	}
	req.RequestID = strings.TrimSpace(req.RequestID)
	if err := validateCreationAgentRequestID(req.RequestID); err != nil {
		return nil, err
	}
	text := strings.TrimSpace(req.Text)
	if err := validateCloudAgentPrompt(text, creationAgentTextLimit); err != nil {
		return nil, BadAuthRequest("消息需要 1–16000 个字符，且不能包含控制字符")
	}
	if len(req.References) > creationReferenceLimit {
		return nil, BadAuthRequest(fmt.Sprintf("附带素材最多 %d 个", creationReferenceLimit))
	}
	if len(req.References) > 0 {
		if _, _, err := cloudAgentCreationReferences(s.repo, userID, sessionID, req.References); err != nil {
			return nil, BadAuthRequest("附带的素材无效：" + cloudAgentSafeToolError(err))
		}
	}
	selection := map[string]string{}
	switch {
	case req.LogicalModelID != "":
		selection["logicalModelId"] = req.LogicalModelID
	case req.ChannelID != "" || req.ChannelModelKey != "":
		selection["channelId"], selection["channelModelKey"] = req.ChannelID, req.ChannelModelKey
	default:
		selection = creationAgentModelSelection(session.AgentModel)
	}
	if len(selection) == 0 {
		return nil, BadAuthRequest("请先选择 Agent 使用的文本模型")
	}
	prompt := text
	if len(req.References) > 0 {
		lines := make([]string, 0, len(req.References))
		for _, ref := range req.References {
			if ref.EntryID != "" && ref.Slot != nil {
				lines = append(lines, fmt.Sprintf("- 生成记录 entryId=%s slot=%d", ref.EntryID, *ref.Slot))
			} else {
				lines = append(lines, "- 用户附件 resourceId="+ref.ResourceID)
			}
		}
		prompt += "\n\n【用户附带素材，可作为 creation_generate_media 的 references】\n" + strings.Join(lines, "\n")
	}
	messageData := map[string]any{"role": "user", "text": firstNonEmpty(display, text), "requestId": req.RequestID}
	if len(req.References) > 0 {
		messageData["references"] = req.References
	}
	raw, _ := json.Marshal(messageData)
	result := &CreationAgentMessageResult{Accepted: true}
	events, err := s.repo.AppendCreationAgentEvents(userID, sessionID, []repository.CreationAgentEventInput{{
		ItemID: "msg:user:" + req.RequestID, Type: "message", DataJSON: string(raw), RequestID: req.RequestID,
	}})
	if errors.Is(err, repository.ErrCreationAgentRequestDuplicate) {
		result.Duplicate = true
	} else if err != nil {
		return nil, creationRepoError(err, creationSessionNotFound)
	}
	if len(events) > 0 {
		result.Seq = events[0].Seq
	}
	idempotencyKey := "creation:" + req.RequestID
	runID := cloudAgentID(userID, idempotencyKey)
	// 已受理过的同一消息：返回原轮次，不重复开轮。
	if result.Duplicate {
		if _, _, lookupErr := s.cloudAgentTask(userID, runID); lookupErr == nil {
			result.RunID, result.Delivered = runID, "run"
			return result, nil
		}
	}
	active := session.ActiveRunID
	if active != "" && active != runID && s.cloudAgentRunActive(userID, active) {
		if _, err := s.InterjectCloudAgent(userID, active, req.RequestID, prompt); err != nil {
			return nil, err
		}
		result.RunID, result.Delivered = active, "interjection"
		return result, nil
	}
	agentReq := CloudAgentRequest{
		CreationSessionID: sessionID, Prompt: prompt, PermissionMode: "auto", ContextScope: []string{},
		LogicalModelID: selection["logicalModelId"], ChannelID: selection["channelId"], ChannelModelKey: selection["channelModelKey"],
		ReasoningMode: req.ReasoningMode, SkillIDs: req.SkillIDs, AutoContinue: req.AutoContinue, IdempotencyKey: idempotencyKey,
	}
	agentReq.Budget.MaxCredits = req.MaxCredits
	if agentReq.Budget.MaxCredits <= 0 {
		agentReq.Budget.MaxCredits = creationAgentDefaultMaxCredits
	}
	parentID := s.creationAgentParent(userID, sessionID, active)
	run, err := s.CreateCloudAgentRun(userID, agentReq, parentID)
	if err != nil && parentID != "" {
		var appErr *AppError
		if errors.As(err, &appErr) && appErr.Status == 409 && appErr.Reason != ReasonCreationSessionBusy {
			// 上一轮历史无法续接（例如运行合同已升级）：在同一会话里重新开始，事实帧仍会带上会话作品。
			run, err = s.CreateCloudAgentRun(userID, agentReq, "")
		}
	}
	if err != nil {
		return nil, err
	}
	if encoded, marshalErr := json.Marshal(selection); marshalErr == nil {
		value := string(encoded)
		patch := repository.CreationSessionPatch{AgentModel: &value}
		if req.ReasoningMode != "" {
			patch.ReasoningEffort = &req.ReasoningMode
		}
		_ = s.repo.UpdateCreationSession(userID, sessionID, patch)
	}
	result.RunID, result.Delivered = run.ID, "run"
	return result, nil
}

// creationAgentParent 返回可以续接的上一轮：本会话最近占用过会话的轮次，且已结束。
func (s *Service) creationAgentParent(userID, sessionID, candidate string) string {
	if candidate == "" {
		return ""
	}
	run, err := s.repo.CloudAgent(userID, candidate)
	if err != nil || run.CreationSessionID != sessionID || !cloudAgentRunTerminal(run.Status) || run.CleanupPending {
		return ""
	}
	return run.ID
}

// AnswerCreationAgentQuestion 把选择题的回答作为下一条消息发出，并把问题卡标记为已回答。
func (s *Service) AnswerCreationAgentQuestion(userID, sessionID, questionID string, req CreationAgentAnswerRequest) (*CreationAgentMessageResult, error) {
	if _, err := s.creationSessionForUser(userID, sessionID); err != nil {
		return nil, err
	}
	event, err := s.repo.LatestCreationAgentItem(userID, sessionID, questionID)
	if err != nil {
		return nil, err
	}
	if event == nil || event.Type != "question" {
		return nil, NotFound("问题不存在")
	}
	question := map[string]any{}
	if err := json.Unmarshal([]byte(event.DataJSON), &question); err != nil {
		return nil, err
	}
	if stringValue(question["status"]) != "pending" {
		appErr := NewAppError(409, "这个问题已经回答过了")
		appErr.Reason = ReasonQuestionAnswered
		return nil, appErr
	}
	answer := strings.TrimSpace(req.Answer)
	labels := []string{}
	for _, selected := range req.SelectedOptions {
		for _, option := range creationMaps(question["options"]) {
			if selected == stringValue(option["id"]) || selected == stringValue(option["label"]) {
				labels = append(labels, stringValue(option["label"]))
			}
		}
	}
	if len(labels) == 0 && answer == "" && len(req.Answers) == 0 && !req.UseDefaults {
		return nil, BadAuthRequest("请选择选项或填写回答")
	}
	var prompt, display string
	formAnswer := map[string]any{}
	if strings.HasPrefix(answer, "{") && json.Unmarshal([]byte(answer), &formAnswer) == nil && formAnswer["type"] == "form_answer" {
		// 画布同款问题卡直接给出 form_answer：原样作为下一轮输入，展示成可读的选择摘要。
		prompt, display = answer, creationAgentFormAnswerSummary(formAnswer)
	} else if stringValue(question["kind"]) == "form" {
		payload := map[string]any{"type": "form_answer", "questionId": question["questionId"], "answers": req.Answers, "useRecommendedDefaults": req.UseDefaults}
		if answer != "" {
			payload["additionalNotes"] = answer
		}
		encoded, _ := json.Marshal(payload)
		prompt, display = string(encoded), "已提交选择"
		if req.UseDefaults {
			display = "按推荐设置继续"
		}
	} else {
		parts := append([]string{}, labels...)
		if answer != "" {
			parts = append(parts, answer)
		}
		prompt = strings.Join(parts, "；")
		display = prompt
	}
	result, err := s.sendCreationAgentMessage(userID, sessionID, CreationAgentMessageRequest{RequestID: req.RequestID, Text: prompt}, display)
	if err != nil {
		return nil, err
	}
	question["status"], question["selectedOptions"], question["answer"] = "answered", labels, answer
	raw, _ := json.Marshal(question)
	if _, err := s.repo.AppendCreationAgentEvents(userID, sessionID, []repository.CreationAgentEventInput{{ItemID: questionID, Type: "question", RunID: event.RunID, TurnID: event.TurnID, DataJSON: string(raw)}}); err != nil {
		return nil, err
	}
	return result, nil
}

func creationAgentFormAnswerSummary(answer map[string]any) string {
	if answer["useRecommendedDefaults"] == true {
		return "按推荐设置继续"
	}
	titles, _ := answer["fieldTitles"].(map[string]any)
	values, _ := answer["displayAnswers"].(map[string]any)
	if values == nil {
		values, _ = answer["answers"].(map[string]any)
	}
	parts := []string{}
	for key, value := range values {
		text := ""
		switch typed := value.(type) {
		case []any:
			items := []string{}
			for _, item := range typed {
				items = append(items, stringValue(item))
			}
			text = strings.Join(items, "、")
		default:
			text = stringValue(typed)
		}
		if text == "" {
			continue
		}
		if title := stringValue(titles[key]); title != "" {
			text = title + "：" + text
		}
		parts = append(parts, text)
	}
	if notes := strings.TrimSpace(stringValue(answer["additionalNotes"])); notes != "" {
		parts = append(parts, notes)
	}
	if len(parts) == 0 {
		return "已提交选择"
	}
	sort.Strings(parts)
	return strings.Join(parts, "；")
}

// DecideCreationAgentProposal 批准或拒绝一张方案卡，返回最新方案卡和（批准时）生成记录。
func (s *Service) DecideCreationAgentProposal(userID, sessionID, approvalID string, req CreationAgentDecisionRequest) (*CreationAgentDecisionResult, error) {
	if _, err := s.creationSessionForUser(userID, sessionID); err != nil {
		return nil, err
	}
	itemID := "approval:" + approvalID
	event, err := s.repo.LatestCreationAgentItem(userID, sessionID, itemID)
	if err != nil {
		return nil, err
	}
	if event == nil {
		return nil, NotFound("方案不存在")
	}
	proposal := map[string]any{}
	if err := json.Unmarshal([]byte(event.DataJSON), &proposal); err != nil {
		return nil, err
	}
	decision := "reject"
	if req.Approve {
		decision = "approve"
	}
	if stringValue(proposal["status"]) != "pending" {
		appErr := NewAppError(409, "方案已处理")
		appErr.Reason = ReasonProposalNotPending
		appErr.Details = map[string]any{"proposal": creationAgentItem(*event)}
		return nil, appErr
	}
	if req.Approve && req.Settings == nil && req.ExpectedQuote != "" && req.ExpectedQuote != stringValue(proposal["creditsMicrocredits"]) {
		appErr := NewAppError(409, "方案报价已变化，请确认新报价后再提交")
		appErr.Reason = ReasonQuoteChanged
		appErr.Details = map[string]any{"proposal": creationAgentItem(*event)}
		return nil, appErr
	}
	runID := stringValue(proposal["runId"])
	var settings []*CloudAgentMediaSettings
	if req.Settings != nil {
		settings = append(settings, req.Settings)
	}
	if err := s.DecideCloudAgentApproval(userID, runID, approvalID, decision, req.Reason, settings...); err != nil {
		return nil, err
	}
	latest, err := s.repo.LatestCreationAgentItem(userID, sessionID, itemID)
	if err != nil || latest == nil {
		return nil, err
	}
	result := &CreationAgentDecisionResult{Proposal: creationAgentItem(*latest)}
	data := map[string]any{}
	if json.Unmarshal([]byte(latest.DataJSON), &data) == nil {
		if entryID := stringValue(data["entryId"]); entryID != "" {
			if entry, err := s.CreationEntry(userID, entryID); err == nil {
				result.Entry = entry
			}
		}
	}
	return result, nil
}

// StopCreationAgent 停止当前轮次；已受理的生成任务不取消。
func (s *Service) StopCreationAgent(ctx context.Context, userID, sessionID string) error {
	session, err := s.creationSessionForUser(userID, sessionID)
	if err != nil {
		return err
	}
	if session.ActiveRunID == "" || !s.cloudAgentRunActive(userID, session.ActiveRunID) {
		return nil
	}
	return s.CancelCloudAgent(ctx, userID, session.ActiveRunID)
}
