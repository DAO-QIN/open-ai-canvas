package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 首页本地历史导入（docs/design/home-agent.md §6.1）。浏览器里的旧会话一次性写入服务端；
// 按会话 ID 与消息 ID 去重，重复导入不产生重复记录。只接受本人的任务和资源，其他引用丢弃。

const (
	creationImportSessionLimit = 50
	creationImportMessageLimit = 400
)

type ImportCreationSessionsRequest struct {
	Sessions []ImportedCreationSession `json:"sessions"`
}

type ImportedCreationSession struct {
	ID        string                    `json:"id"`
	Title     string                    `json:"title"`
	UpdatedAt time.Time                 `json:"updatedAt"`
	Messages  []ImportedCreationMessage `json:"messages"`
}

type ImportedCreationMessage struct {
	ID                 string                       `json:"id"`
	Role               string                       `json:"role"`
	Mode               string                       `json:"mode"`
	Content            string                       `json:"content"`
	Status             string                       `json:"status"`
	CreatedAt          time.Time                    `json:"createdAt"`
	TaskIDs            []string                     `json:"taskIds"`
	ResultStorageKeys  []string                     `json:"resultStorageKeys"`
	Settings           map[string]any               `json:"settings"`
	Attachments        []ImportedCreationAttachment `json:"attachments"`
	ClientOperationID  string                       `json:"clientOperationId"`
	GenerationErrorMsg string                       `json:"error"`
}

type ImportedCreationAttachment struct {
	Name       string `json:"name"`
	StorageKey string `json:"storageKey"`
}

type ImportCreationSessionsResult struct {
	Imported []string                `json:"imported"`
	Skipped  []ImportCreationSkipped `json:"skipped"`
	Entries  map[string]int          `json:"entries"`
	Sessions []CreationSessionView   `json:"sessions"`
}

type ImportCreationSkipped struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// ImportCreationSessions 导入浏览器本地的首页会话。已导入过的会话只补写缺少的记录；
// 会话 ID 已被他人占用或已删除时跳过并说明原因。
func (s *Service) ImportCreationSessions(userID string, req ImportCreationSessionsRequest) (*ImportCreationSessionsResult, error) {
	if len(req.Sessions) == 0 || len(req.Sessions) > creationImportSessionLimit {
		return nil, BadAuthRequest("一次导入需要 1 到 50 个会话")
	}
	result := &ImportCreationSessionsResult{Imported: []string{}, Skipped: []ImportCreationSkipped{}, Entries: map[string]int{}, Sessions: []CreationSessionView{}}
	for _, imported := range req.Sessions {
		count, err := s.importCreationSession(userID, imported)
		var appErr *AppError
		if errors.As(err, &appErr) && appErr.Status < 500 {
			result.Skipped = append(result.Skipped, ImportCreationSkipped{ID: imported.ID, Reason: appErr.Message})
			continue
		}
		if err != nil {
			return nil, err
		}
		result.Imported = append(result.Imported, imported.ID)
		result.Entries[imported.ID] = count
		if view, err := s.CreationSession(userID, imported.ID); err == nil {
			result.Sessions = append(result.Sessions, *view)
		}
	}
	return result, nil
}

func (s *Service) importCreationSession(userID string, imported ImportedCreationSession) (int, error) {
	id := strings.TrimSpace(imported.ID)
	if err := validateCloudAgentID(id, "会话 ID", 36); err != nil {
		return 0, err
	}
	if len(imported.Messages) > creationImportMessageLimit {
		return 0, BadAuthRequest("单个会话的消息过多，无法导入")
	}
	title, err := normalizeCreationTitle(imported.Title)
	if err != nil {
		title = ""
	}
	if title == "" {
		title = creationSessionDefaultTitle
	}
	now := time.Now()
	activity := imported.UpdatedAt
	if activity.IsZero() || activity.After(now) {
		activity = now
	}
	session, err := s.repo.CreationSession(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		taken, existsErr := s.repo.CreationSessionExists(id)
		if existsErr != nil {
			return 0, existsErr
		}
		if taken {
			return 0, BadAuthRequest("会话 ID 已被占用或会话已删除")
		}
		session = &model.CreationSession{ID: id, UserID: userID, Title: title, Source: model.CreationSessionSourceLocalImport, CreatedAt: activity, UpdatedAt: activity}
		if err := s.repo.CreateCreationSession(session); err != nil {
			return 0, err
		}
	} else if err != nil {
		return 0, err
	} else if session.UpdatedAt.After(activity) {
		activity = session.UpdatedAt
	}

	count := 0
	lastPrompt := ""
	for _, message := range imported.Messages {
		if message.Role == "user" {
			lastPrompt = message.Content
			continue
		}
		if message.Role != "assistant" {
			continue
		}
		created, err := s.importCreationMessage(userID, id, lastPrompt, message, now)
		if err != nil {
			return count, err
		}
		if created {
			count++
		}
	}
	// 写入记录会刷新会话活动时间；导入的是历史，恢复为原有时间，保持列表顺序。
	if err := s.repo.SetCreationSessionActivity(userID, id, activity); err != nil {
		return count, err
	}
	return count, nil
}

// importCreationMessage 把一条助手消息转成生成记录。只保留本人的任务和资源；
// 既没有任务也没有可用产物的媒体消息不导入。
func (s *Service) importCreationMessage(userID, sessionID, prompt string, message ImportedCreationMessage, now time.Time) (bool, error) {
	messageID := strings.TrimSpace(message.ID)
	if validateCloudAgentID(messageID, "消息 ID", 60) != nil {
		return false, nil
	}
	entryType := strings.TrimSpace(message.Mode)
	if entryType == "" {
		entryType = "text"
	}
	if !creationEntryTypes[entryType] {
		return false, nil
	}
	taskIDs := []string{}
	for _, taskID := range message.TaskIDs {
		taskID = strings.TrimSpace(taskID)
		if validateCloudAgentID(taskID, "任务 ID", 36) != nil {
			continue
		}
		if _, err := s.repo.TaskForUser(userID, taskID); err == nil {
			taskIDs = append(taskIDs, taskID)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
	}
	results := []CreationResultSlot{}
	status := model.CreationEntryStatusPending
	if len(taskIDs) == 0 {
		switch {
		case entryType == "text" && strings.TrimSpace(message.Content) != "":
			results = append(results, CreationResultSlot{Slot: 0, Status: model.CreationEntryStatusSucceeded, Text: truncateCreationText(message.Content, creationResultTextLimit)})
		default:
			resources := s.ownedImportResources(userID, message.ResultStorageKeys)
			if len(resources) == 0 {
				return false, nil
			}
			for slot, resource := range resources {
				results = append(results, CreationResultSlot{Slot: slot, Status: model.CreationEntryStatusSucceeded, Resources: []CreationResultResource{resource}})
			}
		}
		status = model.CreationEntryStatusSucceeded
	}
	if prompt = strings.TrimSpace(prompt); prompt == "" {
		prompt = strings.TrimSpace(message.Content)
	}
	prompt = truncateCreationText(prompt, creationPromptLimit)
	references := []CreationReference{}
	for _, attachment := range message.Attachments {
		for _, resource := range s.ownedImportResources(userID, []string{attachment.StorageKey}) {
			references = append(references, CreationReference{Kind: "resource", ResourceID: resource.ResourceID, StorageKey: resource.StorageKey, Label: truncateCreationText(strings.TrimSpace(attachment.Name), 80)})
		}
		if len(references) >= creationReferenceLimit {
			break
		}
	}
	config := message.Settings
	if config == nil {
		config = map[string]any{}
	}
	configJSON, err := json.Marshal(config)
	if err != nil || len(configJSON) > creationConfigBytesLimit {
		configJSON = []byte("{}")
	}
	referencesJSON, _ := json.Marshal(references)
	createdAt := message.CreatedAt
	if createdAt.IsZero() || createdAt.After(now) {
		createdAt = now
	}
	entry := &model.CreationEntry{
		ID: newID(), SessionID: sessionID, UserID: userID, Origin: model.CreationEntryOriginManual,
		ClientOperationID: "import:" + sessionID + ":" + messageID, Type: entryType, Prompt: prompt,
		ConfigJSON: string(configJSON), ReferencesJSON: string(referencesJSON), Status: status,
		ResultsJSON: encodeCreationResults(results), CreatedAt: createdAt,
	}
	stored, created, err := s.repo.CreateCreationEntry(entry, taskIDs)
	if err != nil {
		return false, err
	}
	if created && len(taskIDs) > 0 {
		if _, err := s.reconcileCreationEntry(userID, stored.ID); err != nil {
			return true, err
		}
	}
	return created, nil
}

func (s *Service) ownedImportResources(userID string, storageKeys []string) []CreationResultResource {
	resources := []CreationResultResource{}
	for _, key := range storageKeys {
		key = strings.TrimSpace(key)
		id := strings.TrimPrefix(key, "resource:")
		if id == key {
			id = resourceIDFromFileURL(key)
		}
		if validateCloudAgentID(id, "资源 ID", 64) != nil {
			continue
		}
		resource, err := s.repo.ResourceForUser(userID, id)
		if err != nil {
			continue
		}
		resources = append(resources, CreationResultResource{ResourceID: id, StorageKey: "resource:" + id, Width: resource.Width, Height: resource.Height, Bytes: resource.Size, MimeType: resource.MimeType, DurationMs: resource.DurationMs})
	}
	return resources
}
