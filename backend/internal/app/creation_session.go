package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 首页创作会话接口。设计见 docs/design/home-agent.md §6.1。

const (
	creationSessionTitleLimit   = 120
	creationSessionDefaultTitle = "新创作"
	creationSkillLimit          = 20
	creationIDLimit             = 80
)

var creationModes = map[string]bool{"agent": true, "image": true, "video": true, "text": true, "audio": true}

type CreationSessionView struct {
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	LastMode        string    `json:"lastMode"`
	AgentStatus     string    `json:"agentStatus"`
	AgentModel      string    `json:"agentModel"`
	ReasoningEffort string    `json:"reasoningEffort"`
	SkillIDs        []string  `json:"skillIds"`
	ActiveRunID     string    `json:"activeRunId,omitempty"`
	LastSeq         int64     `json:"lastSeq"`
	EntryCount      int       `json:"entryCount"`
	LatestEntryID   string    `json:"latestEntryId,omitempty"`
	CanvasID        string    `json:"canvasId,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type CreationSessionPage struct {
	Sessions   []CreationSessionView `json:"sessions"`
	NextCursor string                `json:"nextCursor,omitempty"`
}

type CreateCreationSessionRequest struct {
	Title string `json:"title"`
	Mode  string `json:"mode"`
}

// UpdateCreationSessionRequest 中 nil 字段表示不修改。
type UpdateCreationSessionRequest struct {
	Title           *string   `json:"title"`
	LastMode        *string   `json:"lastMode"`
	AgentModel      *string   `json:"agentModel"`
	ReasoningEffort *string   `json:"reasoningEffort"`
	SkillIDs        *[]string `json:"skillIds"`
}

type creationPageCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func creationSessionNotFound() error {
	err := NotFound("创作会话不存在或已删除")
	err.Reason = ReasonCreationSessionNotFound
	return err
}

func creationSessionBusy() error {
	err := NewAppError(409, "创作会话正在运行，请先停止后再删除")
	err.Reason = ReasonCreationSessionBusy
	return err
}

// creationRepoError 把仓储层的不存在和占用错误转换成带 reason 的业务错误。
func creationRepoError(err error, notFound func() error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return notFound()
	case errors.Is(err, repository.ErrCreationSessionBusy):
		return creationSessionBusy()
	default:
		return err
	}
}

func encodeCreationCursor(cursor *repository.CreationPageCursor) string {
	if cursor == nil {
		return ""
	}
	data, _ := json.Marshal(creationPageCursor{At: cursor.At, ID: cursor.ID})
	return base64.RawURLEncoding.EncodeToString(data)
}

func decodeCreationCursor(raw string) (*repository.CreationPageCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(data) > 512 {
		return nil, BadAuthRequest("分页游标无效")
	}
	var cursor creationPageCursor
	if err := json.Unmarshal(data, &cursor); err != nil || cursor.ID == "" || cursor.At.IsZero() {
		return nil, BadAuthRequest("分页游标无效")
	}
	return &repository.CreationPageCursor{At: cursor.At, ID: cursor.ID}, nil
}

func creationSessionView(session model.CreationSession) CreationSessionView {
	skills := []string{}
	if session.SkillIDsJSON != "" {
		_ = json.Unmarshal([]byte(session.SkillIDsJSON), &skills)
	}
	return CreationSessionView{
		ID: session.ID, Title: session.Title, LastMode: session.LastMode, AgentStatus: session.AgentStatus,
		AgentModel: session.AgentModel, ReasoningEffort: session.ReasoningEffort, SkillIDs: skills,
		ActiveRunID: session.ActiveRunID, LastSeq: session.LastSeq, EntryCount: session.EntryCount,
		LatestEntryID: session.LatestEntryID, CanvasID: session.CanvasID, CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt,
	}
}

func normalizeCreationTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if !utf8.ValidString(title) || strings.ContainsAny(title, "\x00\r\n") {
		return "", BadAuthRequest("会话标题包含无效字符")
	}
	if utf8.RuneCountInString(title) > creationSessionTitleLimit {
		return "", BadAuthRequest("会话标题不能超过 120 个字符")
	}
	return title, nil
}

func validateCreationMode(mode string, allowEmpty bool) error {
	if mode == "" && allowEmpty {
		return nil
	}
	if !creationModes[mode] {
		return BadAuthRequest("创作模式无效")
	}
	return nil
}

func validateCreationShortToken(value, label string, limit int) error {
	if len(value) > limit {
		return BadAuthRequest(label + "过长")
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' || r == ':' || r == '/') {
			return BadAuthRequest(label + "包含无效字符")
		}
	}
	return nil
}

// ListCreationSessions 按最近活动倒序分页列出本人的创作会话。
func (s *Service) ListCreationSessions(userID, cursor string, limit int) (*CreationSessionPage, error) {
	before, err := decodeCreationCursor(cursor)
	if err != nil {
		return nil, err
	}
	rows, next, err := s.repo.ListCreationSessions(userID, before, limit)
	if err != nil {
		return nil, err
	}
	page := &CreationSessionPage{Sessions: make([]CreationSessionView, 0, len(rows)), NextCursor: encodeCreationCursor(next)}
	for _, row := range rows {
		page.Sessions = append(page.Sessions, creationSessionView(row))
	}
	return page, nil
}

// CreateCreationSession 新建创作会话，ID 由服务端生成。
func (s *Service) CreateCreationSession(userID string, req CreateCreationSessionRequest) (*CreationSessionView, error) {
	title, err := normalizeCreationTitle(req.Title)
	if err != nil {
		return nil, err
	}
	if title == "" {
		title = creationSessionDefaultTitle
	}
	mode := strings.TrimSpace(req.Mode)
	if err := validateCreationMode(mode, true); err != nil {
		return nil, err
	}
	session := model.CreationSession{ID: newID(), UserID: userID, Title: title, LastMode: mode, Source: model.CreationSessionSourceServer}
	if err := s.repo.CreateCreationSession(&session); err != nil {
		return nil, err
	}
	view := creationSessionView(session)
	return &view, nil
}

// CreationSession 读取本人未删除的会话。
func (s *Service) CreationSession(userID, id string) (*CreationSessionView, error) {
	session, err := s.creationSessionForUser(userID, id)
	if err != nil {
		return nil, err
	}
	view := creationSessionView(*session)
	return &view, nil
}

func (s *Service) creationSessionForUser(userID, id string) (*model.CreationSession, error) {
	if validateCloudAgentID(id, "会话 ID", creationIDLimit) != nil {
		return nil, creationSessionNotFound()
	}
	session, err := s.repo.CreationSession(userID, id)
	if err != nil {
		return nil, creationRepoError(err, creationSessionNotFound)
	}
	return session, nil
}

// UpdateCreationSession 修改标题、模式和 Agent 设置。
func (s *Service) UpdateCreationSession(userID, id string, req UpdateCreationSessionRequest) (*CreationSessionView, error) {
	if _, err := s.creationSessionForUser(userID, id); err != nil {
		return nil, err
	}
	patch := repository.CreationSessionPatch{}
	if req.Title != nil {
		title, err := normalizeCreationTitle(*req.Title)
		if err != nil {
			return nil, err
		}
		if title == "" {
			return nil, BadAuthRequest("会话标题不能为空")
		}
		patch.Title = &title
	}
	if req.LastMode != nil {
		mode := strings.TrimSpace(*req.LastMode)
		if err := validateCreationMode(mode, false); err != nil {
			return nil, err
		}
		patch.LastMode = &mode
	}
	if req.AgentModel != nil {
		agentModel := strings.TrimSpace(*req.AgentModel)
		if err := validateCreationShortToken(agentModel, "Agent 模型", 160); err != nil {
			return nil, err
		}
		patch.AgentModel = &agentModel
	}
	if req.ReasoningEffort != nil {
		effort := strings.TrimSpace(*req.ReasoningEffort)
		if err := validateCreationShortToken(effort, "思考档位", 16); err != nil {
			return nil, err
		}
		patch.ReasoningEffort = &effort
	}
	if req.SkillIDs != nil {
		skills, err := normalizeCreationSkillIDs(*req.SkillIDs)
		if err != nil {
			return nil, err
		}
		encoded, _ := json.Marshal(skills)
		value := string(encoded)
		patch.SkillIDsJSON = &value
	}
	if err := s.repo.UpdateCreationSession(userID, id, patch); err != nil {
		return nil, creationRepoError(err, creationSessionNotFound)
	}
	return s.CreationSession(userID, id)
}

func normalizeCreationSkillIDs(values []string) ([]string, error) {
	if len(values) > creationSkillLimit {
		return nil, BadAuthRequest("一次最多选择 20 个技能")
	}
	seen := map[string]bool{}
	skills := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if err := validateCloudAgentID(value, "技能 ID", creationIDLimit); err != nil {
			return nil, err
		}
		if !seen[value] {
			seen[value] = true
			skills = append(skills, value)
		}
	}
	return skills, nil
}

// DeleteCreationSession 软删除会话；有运行中的 Agent 时拒绝。
func (s *Service) DeleteCreationSession(userID, id string) error {
	if _, err := s.creationSessionForUser(userID, id); err != nil {
		return err
	}
	return creationRepoError(s.repo.SoftDeleteCreationSession(userID, id, time.Now()), creationSessionNotFound)
}
