package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 首页生成记录接口。设计见 docs/design/home-agent.md §6.2。
//
// 生成记录不自己组装供应商请求：客户端仍按现有方式准备任务输入，服务端逐个交给 CreateTask，
// 模型路由、能力校验、额度和计费全部沿用任务入口。每个槽位的任务 ID 由服务端从
// (用户, 记录, 槽位) 推导，重试同一操作时按主键复用已建任务，不会重复扣费。

const (
	creationPromptLimit      = 12000
	creationEntryTaskLimit   = 4
	creationReferenceLimit   = 14
	creationConfigBytesLimit = 16 << 10
	creationResultTextLimit  = 20000
	creationFailureTextLimit = 500
	creationMutateAttempts   = 4
)

var creationEntryTypes = map[string]bool{"image": true, "video": true, "text": true, "audio": true}

// CreationReference 是生成记录引用的素材。kind=resource 指本人资源；kind=entry_result 指本人生成记录的某个槽位。
type CreationReference struct {
	Kind       string `json:"kind"`
	ResourceID string `json:"resourceId,omitempty"`
	StorageKey string `json:"storageKey,omitempty"`
	EntryID    string `json:"entryId,omitempty"`
	Slot       *int   `json:"slot,omitempty"`
	Label      string `json:"label,omitempty"`
}

type CreationResultResource struct {
	ResourceID string `json:"resourceId"`
	StorageKey string `json:"storageKey"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	Bytes      int64  `json:"bytes,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
}

// CreationResultSlot 是生成记录的一个结果槽位。没有 taskId 的失败槽位表示任务未能创建（如积分不足）。
type CreationResultSlot struct {
	Slot      int                      `json:"slot"`
	TaskID    string                   `json:"taskId,omitempty"`
	Status    string                   `json:"status"`
	Resources []CreationResultResource `json:"resources,omitempty"`
	Text      string                   `json:"text,omitempty"`
	Failure   string                   `json:"failure,omitempty"`
}

type CreationEntryView struct {
	ID                  string               `json:"id"`
	SessionID           string               `json:"sessionId"`
	Origin              string               `json:"origin"`
	ProposalID          string               `json:"proposalId,omitempty"`
	ClientOperationID   string               `json:"clientOperationId"`
	RetryOf             string               `json:"retryOf,omitempty"`
	Type                string               `json:"type"`
	Prompt              string               `json:"prompt"`
	Config              map[string]any       `json:"config"`
	References          []CreationReference  `json:"references"`
	CreditsMicrocredits string               `json:"creditsMicrocredits"`
	Status              string               `json:"status"`
	Results             []CreationResultSlot `json:"results"`
	HiddenFailed        bool                 `json:"hiddenFailed"`
	Revision            int64                `json:"revision"`
	CreatedAt           time.Time            `json:"createdAt"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

type CreationEntryPage struct {
	Entries    []CreationEntryView `json:"entries"`
	NextBefore string              `json:"nextBefore,omitempty"`
}

// SubmitCreationEntryRequest 是普通模式的一次生成。Tasks 是客户端按现有方式准备好的任务输入，每项一个槽位。
type SubmitCreationEntryRequest struct {
	ClientOperationID string              `json:"clientOperationId"`
	Type              string              `json:"type"`
	Prompt            string              `json:"prompt"`
	Config            map[string]any      `json:"config"`
	References        []CreationReference `json:"references"`
	Tasks             []CreateTaskRequest `json:"tasks"`
}

func creationEntryNotFound() error {
	err := NotFound("生成记录不存在或已删除")
	err.Reason = ReasonCreationEntryNotFound
	return err
}

func creationOperationConflict() error {
	err := NewAppError(409, "该操作编号已用于其他创作会话")
	err.Code = CodeIdempotencyConflict
	err.Reason = kernel.ReasonIdempotencyConflict
	return err
}

// creationSlotTaskID 由 (用户, 记录, 槽位) 推导任务 ID；重试同一操作时据此找回已建任务。
func creationSlotTaskID(userID, entryID string, slot int) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("creation-entry:"+userID+":"+entryID+":"+strconv.Itoa(slot))).String()
}

func truncateCreationText(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

// SubmitCreationEntry 写入一条普通模式生成记录并逐槽位创建任务。同一 clientOperationId 重复提交返回原记录，
// 只补建尚未创建的槽位。所有槽位都没能建出任务时返回第一个准入错误，记录保留为失败。
func (s *Service) SubmitCreationEntry(userID, sessionID string, req SubmitCreationEntryRequest) (*CreationEntryView, error) {
	if _, err := s.creationSessionForUser(userID, sessionID); err != nil {
		return nil, err
	}
	entry, err := s.newCreationEntry(userID, sessionID, req)
	if err != nil {
		return nil, err
	}
	stored, _, err := s.repo.CreateCreationEntry(entry, nil)
	if errors.Is(err, repository.ErrCreationEntryOperationConflict) {
		return nil, creationOperationConflict()
	}
	if err != nil {
		return nil, creationRepoError(err, creationSessionNotFound)
	}
	admissionErr := s.fillCreationEntryTasks(userID, stored, req.Tasks)
	reconciled, err := s.reconcileCreationEntry(userID, stored.ID)
	if err != nil {
		return nil, err
	}
	if admissionErr != nil {
		return nil, admissionErr
	}
	view := creationEntryView(*reconciled)
	return &view, nil
}

func (s *Service) newCreationEntry(userID, sessionID string, req SubmitCreationEntryRequest) (*model.CreationEntry, error) {
	operationID := strings.TrimSpace(req.ClientOperationID)
	if err := validateCloudAgentID(operationID, "操作编号", creationIDLimit); err != nil {
		return nil, err
	}
	entryType := strings.TrimSpace(req.Type)
	if !creationEntryTypes[entryType] {
		return nil, BadAuthRequest("生成类型无效")
	}
	prompt := strings.TrimSpace(req.Prompt)
	if !utf8.ValidString(prompt) || strings.ContainsRune(prompt, 0) {
		return nil, BadAuthRequest("提示词包含无效字符")
	}
	if utf8.RuneCountInString(prompt) > creationPromptLimit {
		return nil, BadAuthRequest(fmt.Sprintf("提示词不能超过 %d 个字符", creationPromptLimit))
	}
	if len(req.Tasks) == 0 || len(req.Tasks) > creationEntryTaskLimit {
		return nil, BadAuthRequest(fmt.Sprintf("一次生成需要 1 到 %d 个任务", creationEntryTaskLimit))
	}
	for index, task := range req.Tasks {
		if strings.TrimSpace(task.Type) != "canvas_"+entryType {
			return nil, BadAuthRequest(fmt.Sprintf("第 %d 个任务的类型与生成类型不一致", index+1))
		}
	}
	config := req.Config
	if config == nil {
		config = map[string]any{}
	}
	configJSON, err := json.Marshal(config)
	if err != nil || len(configJSON) > creationConfigBytesLimit {
		return nil, BadAuthRequest("生成参数无效或过大")
	}
	references, err := s.normalizeCreationReferences(userID, req.References)
	if err != nil {
		return nil, err
	}
	referencesJSON, _ := json.Marshal(references)
	return &model.CreationEntry{
		ID: newID(), SessionID: sessionID, UserID: userID, Origin: model.CreationEntryOriginManual,
		ClientOperationID: operationID, Type: entryType, Prompt: prompt, ConfigJSON: string(configJSON),
		ReferencesJSON: string(referencesJSON), Status: model.CreationEntryStatusPending, ResultsJSON: "[]",
	}, nil
}

// normalizeCreationReferences 只接受本人的资源和生成记录，并统一保存为稳定定位符。
func (s *Service) normalizeCreationReferences(userID string, values []CreationReference) ([]CreationReference, error) {
	if len(values) > creationReferenceLimit {
		return nil, BadAuthRequest(fmt.Sprintf("参考素材最多 %d 个", creationReferenceLimit))
	}
	references := make([]CreationReference, 0, len(values))
	for _, value := range values {
		label := truncateCreationText(strings.TrimSpace(value.Label), 80)
		switch strings.TrimSpace(value.Kind) {
		case "resource":
			resourceID := strings.TrimSpace(value.ResourceID)
			if resourceID == "" {
				resourceID = strings.TrimPrefix(strings.TrimSpace(value.StorageKey), "resource:")
			}
			if validateCloudAgentID(resourceID, "资源 ID", 64) != nil {
				return nil, BadAuthRequest("参考素材无效")
			}
			if _, err := s.repo.ResourceForUser(userID, resourceID); err != nil {
				return nil, BadAuthRequest("参考素材不存在或无权使用")
			}
			references = append(references, CreationReference{Kind: "resource", ResourceID: resourceID, StorageKey: "resource:" + resourceID, Label: label})
		case "entry_result":
			entryID := strings.TrimSpace(value.EntryID)
			if validateCloudAgentID(entryID, "生成记录 ID", creationIDLimit) != nil || value.Slot == nil || *value.Slot < 0 {
				return nil, BadAuthRequest("参考的生成结果无效")
			}
			entry, err := s.repo.CreationEntry(userID, entryID)
			if err != nil {
				return nil, BadAuthRequest("参考的生成结果不存在或无权使用")
			}
			slot := *value.Slot
			reference := CreationReference{Kind: "entry_result", EntryID: entryID, Slot: &slot, Label: label}
			for _, result := range decodeCreationResults(entry.ResultsJSON) {
				if result.Slot == slot && len(result.Resources) > 0 {
					reference.ResourceID = result.Resources[0].ResourceID
					reference.StorageKey = result.Resources[0].StorageKey
				}
			}
			if reference.ResourceID == "" {
				return nil, BadAuthRequest("参考的生成结果还没有可用作品")
			}
			references = append(references, reference)
		default:
			return nil, BadAuthRequest("参考素材类型无效")
		}
	}
	return references, nil
}

// fillCreationEntryTasks 为尚未建出任务的槽位创建任务。已关联、已存在或已记录准入失败的槽位跳过。
// 全部新尝试的槽位都失败且记录里没有任何任务时，返回第一个准入错误。
func (s *Service) fillCreationEntryTasks(userID string, entry *model.CreationEntry, tasks []CreateTaskRequest) error {
	links, err := s.repo.CreationEntryTasks(userID, entry.ID)
	if err != nil {
		return err
	}
	linked := map[int]bool{}
	for _, link := range links {
		linked[link.Slot] = true
	}
	recordedFailures := map[int]bool{}
	for _, result := range decodeCreationResults(entry.ResultsJSON) {
		if result.TaskID == "" && result.Status == model.CreationEntryStatusFailed {
			recordedFailures[result.Slot] = true
		}
	}
	failures := map[int]string{}
	var firstErr error
	for slot, request := range tasks {
		if linked[slot] || recordedFailures[slot] {
			continue
		}
		taskID := creationSlotTaskID(userID, entry.ID, slot)
		if _, err := s.repo.TaskForUser(userID, taskID); err == nil {
			if err := s.repo.AddCreationEntryTask(model.CreationEntryTask{EntryID: entry.ID, TaskID: taskID, Slot: slot, UserID: userID}); err != nil {
				return err
			}
			linked[slot] = true
			continue
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		request.fixedTaskID = taskID
		if _, createErr := s.CreateTask(userID, request); createErr != nil {
			// 并发重试时另一请求可能已建出同一任务，此时撞主键，按已存在处理。
			if _, findErr := s.repo.TaskForUser(userID, taskID); findErr != nil {
				failures[slot] = truncateCreationText(s.UserFacingErrorMessage(createErr), creationFailureTextLimit)
				if firstErr == nil {
					firstErr = createErr
				}
				continue
			}
		}
		if err := s.repo.AddCreationEntryTask(model.CreationEntryTask{EntryID: entry.ID, TaskID: taskID, Slot: slot, UserID: userID}); err != nil {
			return err
		}
		linked[slot] = true
	}
	if len(failures) > 0 {
		if _, err := s.mutateCreationEntry(userID, entry.ID, func(current *model.CreationEntry) error {
			results := decodeCreationResults(current.ResultsJSON)
			for slot, message := range failures {
				results = append(results, CreationResultSlot{Slot: slot, Status: model.CreationEntryStatusFailed, Failure: message})
			}
			current.ResultsJSON = encodeCreationResults(results)
			return nil
		}); err != nil {
			return err
		}
	}
	if firstErr != nil && len(linked) == 0 {
		return firstErr
	}
	return nil
}

// mutateCreationEntry 在修订号冲突时重读重试。
func (s *Service) mutateCreationEntry(userID, entryID string, fn func(*model.CreationEntry) error) (*model.CreationEntry, error) {
	var lastErr error
	for attempt := 0; attempt < creationMutateAttempts; attempt++ {
		entry, err := s.repo.MutateCreationEntry(userID, entryID, fn)
		if err == nil {
			return entry, nil
		}
		if !errors.Is(err, repository.ErrCreationConflict) {
			return nil, creationRepoError(err, creationEntryNotFound)
		}
		lastErr = err
	}
	return nil, lastErr
}

func decodeCreationResults(raw string) []CreationResultSlot {
	results := []CreationResultSlot{}
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &results)
	}
	return results
}

func encodeCreationResults(results []CreationResultSlot) string {
	sort.SliceStable(results, func(left, right int) bool { return results[left].Slot < results[right].Slot })
	encoded, _ := json.Marshal(results)
	return string(encoded)
}

func creationSlotStatus(status model.TaskStatus) string {
	switch status {
	case model.TaskStatusQueued:
		return model.CreationEntryStatusPending
	case model.TaskStatusSucceeded:
		return model.CreationEntryStatusSucceeded
	case model.TaskStatusFailed:
		return model.CreationEntryStatusFailed
	case model.TaskStatusCancelled:
		return model.CreationEntryStatusCancelled
	default:
		return model.CreationEntryStatusRunning
	}
}

// deriveCreationEntryStatus 按槽位汇总记录状态：有未结束槽位时为 running/pending；
// 全部结束时，全部成功为 succeeded，部分成功为 partial，没有成功时有失败为 failed，否则 cancelled。
func deriveCreationEntryStatus(results []CreationResultSlot) string {
	if len(results) == 0 {
		return model.CreationEntryStatusPending
	}
	counts := map[string]int{}
	for _, result := range results {
		counts[result.Status]++
	}
	switch {
	case counts[model.CreationEntryStatusRunning] > 0:
		return model.CreationEntryStatusRunning
	case counts[model.CreationEntryStatusPending] > 0:
		return model.CreationEntryStatusPending
	case counts[model.CreationEntryStatusSucceeded] == len(results):
		return model.CreationEntryStatusSucceeded
	case counts[model.CreationEntryStatusSucceeded] > 0:
		return model.CreationEntryStatusPartial
	case counts[model.CreationEntryStatusFailed] > 0:
		return model.CreationEntryStatusFailed
	default:
		return model.CreationEntryStatusCancelled
	}
}

func creationEntryFinished(status string) bool {
	switch status {
	case model.CreationEntryStatusSucceeded, model.CreationEntryStatusPartial, model.CreationEntryStatusFailed, model.CreationEntryStatusCancelled:
		return true
	}
	return false
}

// creationTaskSlot 从任务当前状态和结果构造槽位。
func creationTaskSlot(slot int, task *model.Task) CreationResultSlot {
	result := CreationResultSlot{Slot: slot, TaskID: task.ID, Status: creationSlotStatus(task.Status)}
	switch result.Status {
	case model.CreationEntryStatusSucceeded:
		result.Resources = creationTaskResources(task.ResultJSON)
		result.Text = truncateCreationText(creationTaskText(task.ResultJSON), creationResultTextLimit)
	case model.CreationEntryStatusFailed, model.CreationEntryStatusCancelled:
		result.Failure = truncateCreationText(strings.TrimSpace(task.Error), creationFailureTextLimit)
	}
	return result
}

func creationTaskText(raw string) string {
	var value struct {
		Text string `json:"text"`
	}
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &value) != nil {
		return ""
	}
	return value.Text
}

// creationTaskResources 按出现顺序取出任务结果中的全部产物资源。某层对象识别出资源后不再向下找，
// 避免把同一产物的封面、缩略图当成独立结果。
func creationTaskResources(raw string) []CreationResultResource {
	var value any
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &value) != nil {
		return nil
	}
	seen := map[string]bool{}
	resources := []CreationResultResource{}
	var walk func(any)
	walk = func(node any) {
		switch item := node.(type) {
		case []any:
			for _, child := range item {
				walk(child)
			}
		case map[string]any:
			if id := creationResourceIDFromMap(item); id != "" {
				if !seen[id] {
					seen[id] = true
					resources = append(resources, CreationResultResource{
						ResourceID: id, StorageKey: "resource:" + id,
						Width: int(creationNumber(item["width"])), Height: int(creationNumber(item["height"])),
						Bytes: creationNumber(item["bytes"]), MimeType: creationString(item["mimeType"]),
						DurationMs: creationNumber(item["durationMs"]),
					})
				}
				return
			}
			keys := make([]string, 0, len(item))
			for key := range item {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				walk(item[key])
			}
		}
	}
	walk(value)
	return resources
}

func creationResourceIDFromMap(item map[string]any) string {
	for _, key := range []string{"resourceId", "storageKey", "url", "dataUrl", "resultUrl", "outputUrl"} {
		text := strings.TrimSpace(creationString(item[key]))
		if text == "" {
			continue
		}
		if key == "resourceId" && validateCloudAgentID(text, "资源 ID", 64) == nil {
			return text
		}
		if strings.HasPrefix(text, "resource:") {
			if id := validCanvasResourceID(strings.TrimPrefix(text, "resource:")); id != "" {
				return id
			}
			continue
		}
		if id := resourceIDFromFileURL(text); id != "" {
			return id
		}
	}
	return ""
}

func creationString(value any) string {
	text, _ := value.(string)
	return text
}

func creationNumber(value any) int64 {
	switch number := value.(type) {
	case float64:
		return int64(number)
	case string:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(number), 10, 64)
		return parsed
	}
	return 0
}

// creationOrderCharge 返回一笔计费单的预计或实际扣费：已退款的扣除退款，已结算的取实际金额。
func creationOrderCharge(order model.BillingOrder) int64 {
	switch order.Status {
	case model.BillingStatusRefunded:
		return max(order.AmountMicrocredits-order.RefundedAmountMicrocredits, 0)
	case model.BillingStatusSettled:
		if order.ActualAmountMicrocredits > 0 {
			return order.ActualAmountMicrocredits
		}
		return max(order.AmountMicrocredits-order.RefundedAmountMicrocredits, 0)
	default:
		return order.AmountMicrocredits
	}
}

// reconcileCreationEntry 按关联任务的当前状态重算槽位、记录状态和扣费，有变化才写回。
func (s *Service) reconcileCreationEntry(userID, entryID string) (*model.CreationEntry, error) {
	entry, err := s.repo.CreationEntry(userID, entryID)
	if err != nil {
		return nil, creationRepoError(err, creationEntryNotFound)
	}
	links, err := s.repo.CreationEntryTasks(userID, entryID)
	if err != nil {
		return nil, err
	}
	results := []CreationResultSlot{}
	linkedSlots := map[int]bool{}
	orderIDs := []string{}
	for _, link := range links {
		linkedSlots[link.Slot] = true
		task, taskErr := s.repo.TaskForUser(userID, link.TaskID)
		if taskErr != nil {
			if !errors.Is(taskErr, gorm.ErrRecordNotFound) {
				return nil, taskErr
			}
			results = append(results, CreationResultSlot{Slot: link.Slot, TaskID: link.TaskID, Status: model.CreationEntryStatusFailed, Failure: "任务记录已不存在"})
			continue
		}
		results = append(results, creationTaskSlot(link.Slot, task))
		if task.BillingOrderID != "" {
			orderIDs = append(orderIDs, task.BillingOrderID)
		}
	}
	// 任务未能创建的槽位只记录在结果里，保留原失败信息。
	for _, result := range decodeCreationResults(entry.ResultsJSON) {
		if result.TaskID == "" && !linkedSlots[result.Slot] {
			results = append(results, result)
		}
	}
	credits := int64(0)
	if len(orderIDs) > 0 {
		orders, err := s.repo.BillingOrdersByIDs(orderIDs)
		if err != nil {
			return nil, err
		}
		for _, order := range orders {
			credits += creationOrderCharge(order)
		}
	}
	resultsJSON := encodeCreationResults(results)
	status := deriveCreationEntryStatus(results)
	if resultsJSON == entry.ResultsJSON && status == entry.Status && credits == entry.CreditsMicrocredits {
		return entry, nil
	}
	return s.mutateCreationEntry(userID, entryID, func(current *model.CreationEntry) error {
		current.ResultsJSON = resultsJSON
		current.Status = status
		current.CreditsMicrocredits = credits
		return nil
	})
}

// syncCreationEntriesForTask 在任务进入终态后回写引用它的生成记录；失败只记日志，读取时会再次校准。
func (s *Service) syncCreationEntriesForTask(userID, taskID string) error {
	links, err := s.repo.CreationEntryLinksForTask(taskID)
	if err != nil {
		return err
	}
	var syncErr error
	for _, link := range links {
		if link.UserID != userID {
			continue
		}
		if _, err := s.reconcileCreationEntry(userID, link.EntryID); err != nil {
			syncErr = errors.Join(syncErr, err)
		}
	}
	return syncErr
}

func (s *Service) creationEntryForUser(userID, entryID string) (*model.CreationEntry, error) {
	if validateCloudAgentID(entryID, "生成记录 ID", creationIDLimit) != nil {
		return nil, creationEntryNotFound()
	}
	entry, err := s.repo.CreationEntry(userID, entryID)
	if err != nil {
		return nil, creationRepoError(err, creationEntryNotFound)
	}
	// 会话已删除时，记录随会话一起不可见。
	if _, err := s.repo.CreationSession(userID, entry.SessionID); err != nil {
		return nil, creationRepoError(err, creationEntryNotFound)
	}
	return entry, nil
}

// ListCreationEntries 按创建时间倒序分页读取会话内的生成记录，未结束的记录先按任务状态校准。
func (s *Service) ListCreationEntries(userID, sessionID, before string, limit int) (*CreationEntryPage, error) {
	if _, err := s.creationSessionForUser(userID, sessionID); err != nil {
		return nil, err
	}
	cursor, err := decodeCreationCursor(before)
	if err != nil {
		return nil, err
	}
	rows, next, err := s.repo.ListCreationEntries(userID, sessionID, cursor, limit)
	if err != nil {
		return nil, err
	}
	page := &CreationEntryPage{Entries: make([]CreationEntryView, 0, len(rows)), NextBefore: encodeCreationCursor(next)}
	for _, row := range rows {
		if !creationEntryFinished(row.Status) {
			if reconciled, err := s.reconcileCreationEntry(userID, row.ID); err == nil {
				row = *reconciled
			} else {
				log.Printf("creation entry reconcile %s: %v", row.ID, err)
			}
		}
		page.Entries = append(page.Entries, creationEntryView(row))
	}
	return page, nil
}

// CreationEntry 读取单条生成记录，未结束时先校准。
func (s *Service) CreationEntry(userID, entryID string) (*CreationEntryView, error) {
	entry, err := s.creationEntryForUser(userID, entryID)
	if err != nil {
		return nil, err
	}
	if !creationEntryFinished(entry.Status) {
		if entry, err = s.reconcileCreationEntry(userID, entryID); err != nil {
			return nil, err
		}
	}
	view := creationEntryView(*entry)
	return &view, nil
}

// RetryCreationEntry 把记录中失败或已取消槽位的原任务重新排队，沿用任务重试的计费与校验。
// 任务未能创建的槽位无法原地重试，需要客户端重新提交。
func (s *Service) RetryCreationEntry(userID, entryID string) (*CreationEntryView, error) {
	entry, err := s.creationEntryForUser(userID, entryID)
	if err != nil {
		return nil, err
	}
	links, err := s.repo.CreationEntryTasks(userID, entry.ID)
	if err != nil {
		return nil, err
	}
	retried := 0
	var firstErr error
	for _, link := range links {
		task, err := s.repo.TaskForUser(userID, link.TaskID)
		if err != nil || (task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled) {
			continue
		}
		if _, err := s.RetryTask(userID, task.ID); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		retried++
	}
	if retried == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, BadAuthRequest("没有可重试的失败结果；未能开始的生成请重新提交")
	}
	reconciled, err := s.reconcileCreationEntry(userID, entry.ID)
	if err != nil {
		return nil, err
	}
	view := creationEntryView(*reconciled)
	return &view, nil
}

// ClearCreationEntryFailed 隐藏记录中的失败槽位，不删除任务和账务。
func (s *Service) ClearCreationEntryFailed(userID, entryID string) (*CreationEntryView, error) {
	if _, err := s.creationEntryForUser(userID, entryID); err != nil {
		return nil, err
	}
	entry, err := s.mutateCreationEntry(userID, entryID, func(current *model.CreationEntry) error {
		current.HiddenFailed = true
		return nil
	})
	if err != nil {
		return nil, err
	}
	view := creationEntryView(*entry)
	return &view, nil
}

func creationEntryView(entry model.CreationEntry) CreationEntryView {
	config := map[string]any{}
	_ = json.Unmarshal([]byte(entry.ConfigJSON), &config)
	references := []CreationReference{}
	_ = json.Unmarshal([]byte(entry.ReferencesJSON), &references)
	results := decodeCreationResults(entry.ResultsJSON)
	if entry.HiddenFailed {
		visible := results[:0]
		for _, result := range results {
			if result.Status != model.CreationEntryStatusFailed && result.Status != model.CreationEntryStatusCancelled {
				visible = append(visible, result)
			}
		}
		results = visible
	}
	proposalID := ""
	if entry.ProposalID != nil {
		proposalID = *entry.ProposalID
	}
	return CreationEntryView{
		ID: entry.ID, SessionID: entry.SessionID, Origin: entry.Origin, ProposalID: proposalID,
		ClientOperationID: entry.ClientOperationID, RetryOf: entry.RetryOf, Type: entry.Type, Prompt: entry.Prompt,
		Config: config, References: references, CreditsMicrocredits: strconv.FormatInt(entry.CreditsMicrocredits, 10),
		Status: entry.Status, Results: results, HiddenFailed: entry.HiddenFailed, Revision: entry.Revision,
		CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt,
	}
}
