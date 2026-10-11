package promotion

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type Service struct{ repo *repository.Repository }

func New(repo *repository.Repository) *Service { return &Service{repo: repo} }

var codePattern = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{10}$`)
var requestPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,80}$`)
var amountPattern = regexp.MustCompile(`^[1-9][0-9]{0,15}$`)

func invalidInvite() error {
	err := kernel.BadAuthRequest("邀请码无效或推广已暂停，请清除或更换邀请码后重试")
	err.Reason = kernel.ReasonInvalidInviteCode
	return err
}

func userRequired(user *model.User) error {
	if user == nil || user.ID == "" {
		return kernel.Unauthorized("请先登录")
	}
	if user.Status != model.UserStatusActive {
		return kernel.Forbidden("账号不可用")
	}
	return nil
}

func adminRequired(user *model.User) error {
	if user == nil || user.ID == "" {
		return kernel.Unauthorized("请先登录")
	}
	if user.Role != model.UserRoleAdmin || user.Status == model.UserStatusDisabled {
		return kernel.Forbidden("需要管理员权限")
	}
	return nil
}

func (s *Service) Policy() (*model.PromotionPolicy, error) {
	setting, err := s.repo.PromotionPolicySetting()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &model.PromotionPolicy{}, nil
	}
	if err != nil {
		return nil, err
	}
	var policy model.PromotionPolicy
	if err := json.Unmarshal([]byte(setting.ValueJSON), &policy); err != nil {
		return nil, err
	}
	if err := validatePolicy(policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

func validatePolicy(policy model.PromotionPolicy) error {
	if policy.RatioBPS < 0 || policy.RatioBPS > 10000 || policy.FreezeDays < 0 || policy.FreezeDays > 365 || policy.Version < 0 {
		return kernel.BadAuthRequest("比例须为 0～10000 基点，冻结期须为 0～365 天，版本须有效")
	}
	return nil
}

func audit(actor *model.User, action, target, id, summary string, metadata any) (*model.AdminAuditEvent, error) {
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	return &model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: actor.ID, Action: action, TargetType: target, TargetID: id, Summary: summary, MetadataJSON: string(encoded), CreatedAt: time.Now()}, nil
}

func mapError(err error) error {
	switch {
	case errors.Is(err, repository.ErrPromotionRequestConflict):
		result := kernel.NewAppError(409, err.Error())
		result.Code = kernel.CodeIdempotencyConflict
		result.Reason = kernel.ReasonIdempotencyConflict
		return result
	case errors.Is(err, repository.ErrPromotionConflict):
		return kernel.NewAppError(409, err.Error())
	case errors.Is(err, repository.ErrPromotionInsufficient):
		result := kernel.NewAppError(409, err.Error())
		result.Reason = kernel.ReasonPromotionInsufficient
		return result
	case errors.Is(err, repository.ErrPaymentCreditOverflow):
		result := kernel.NewAppError(409, "积分钱包余额超过上限，请先使用部分积分")
		result.Reason = kernel.ReasonCreditBalanceOverflow
		return result
	case errors.Is(err, gorm.ErrRecordNotFound):
		return kernel.NotFound("记录不存在")
	default:
		return err
	}
}

func (s *Service) AdminPolicy(actor *model.User) (*model.PromotionPolicy, error) {
	if err := adminRequired(actor); err != nil {
		return nil, err
	}
	return s.Policy()
}

func (s *Service) UpdatePolicy(actor *model.User, policy model.PromotionPolicy) (*model.PromotionPolicy, error) {
	if err := adminRequired(actor); err != nil {
		return nil, err
	}
	if err := validatePolicy(policy); err != nil {
		return nil, err
	}
	if policy.Version == math.MaxInt64 {
		return nil, kernel.BadAuthRequest("配置版本已达到上限")
	}
	before, err := s.Policy()
	if err != nil {
		return nil, err
	}
	expected := policy.Version
	policy.Version++
	event, err := audit(actor, "promotion.policy.update", "system_setting", model.PromotionPolicySettingKey, "更新邀请返利规则", map[string]any{"before": before, "after": policy})
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdatePromotionPolicy(policy, expected, event); err != nil {
		return nil, mapError(err)
	}
	return &policy, nil
}

func (s *Service) validateCode(code string) (*model.PromotionProfile, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if !codePattern.MatchString(code) {
		return nil, invalidInvite()
	}
	policy, err := s.Policy()
	if err != nil {
		return nil, err
	}
	if !policy.Enabled {
		return nil, invalidInvite()
	}
	profile, err := s.repo.PromotionProfileByCode(code)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, invalidInvite()
	}
	if err != nil {
		return nil, err
	}
	if profile.Paused {
		return nil, invalidInvite()
	}
	user, err := s.repo.User(profile.UserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, invalidInvite()
	}
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, invalidInvite()
	}
	return profile, nil
}

func (s *Service) ValidateCode(code string) (bool, error) {
	_, err := s.validateCode(code)
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr.Reason == kernel.ReasonInvalidInviteCode {
		return false, nil
	}
	return err == nil, err
}

// BindInvitation is called with the registration transaction's repository.
func (s *Service) BindInvitation(user *model.User, code string) error {
	if strings.TrimSpace(code) == "" {
		return nil
	}
	profile, err := s.validateCode(code)
	if err != nil {
		return err
	}
	if profile.UserID == user.ID {
		return invalidInvite()
	}
	if _, err := s.repo.InvitationForUser(user.ID); err == nil {
		return invalidInvite()
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return s.repo.CreateInvitation(&model.Invitation{InviteeID: user.ID, InviterID: profile.UserID, CreatedAt: time.Now()})
}

func (s *Service) CreateCode(user *model.User) (*model.PromotionProfile, error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	policy, err := s.Policy()
	if err != nil {
		return nil, err
	}
	if !policy.Enabled {
		return nil, kernel.Forbidden("邀请推广暂未开放")
	}
	profile, err := s.repo.PromotionProfile(user.ID)
	if err != nil {
		return nil, err
	}
	if profile.Paused {
		return nil, kernel.Forbidden("推广资格已暂停")
	}
	if profile.InviteCode != nil {
		return profile, nil
	}
	for attempt := 0; attempt < 4; attempt++ {
		var bytes [6]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return nil, err
		}
		code := base32.NewEncoding("ABCDEFGHJKLMNPQRSTUVWXYZ23456789").WithPadding(base32.NoPadding).EncodeToString(bytes[:])
		profile, err := s.repo.CreatePromotionCode(user.ID, code)
		if err != nil {
			if existing, lookupErr := s.repo.PromotionProfileByCode(code); lookupErr == nil && existing.UserID != user.ID {
				continue
			}
		}
		return profile, mapError(err)
	}
	return nil, kernel.NewAppError(503, "邀请码生成冲突，请稍后重试")
}

// CalculateAmount avoids overflowing base*ratio at the maximum top-up size.
func CalculateAmount(base, ratio int64) (int64, error) {
	if base < 0 || ratio < 0 || ratio > 10000 {
		return 0, kernel.BadAuthRequest("返利计算参数无效")
	}
	return (base/10000)*ratio + (base%10000)*ratio/10000, nil
}

func (s *Service) Snapshot(userID string, credits int64) (*model.PaymentPromotionSnapshot, error) {
	policy, err := s.Policy()
	if err != nil {
		return nil, err
	}
	value := &model.PaymentPromotionSnapshot{Version: 1, PolicyVersion: policy.Version, BaseMicrocredits: credits, FreezeDays: policy.FreezeDays, ExclusionReason: "no_invitation"}
	invitation, err := s.repo.InvitationForUser(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return value, nil
	}
	if err != nil {
		return nil, err
	}
	value.InviterID = invitation.InviterID
	profile, err := s.repo.PromotionProfile(invitation.InviterID)
	if err != nil {
		return nil, err
	}
	value.ProfileVersion, value.RatioBPS = profile.Version, policy.RatioBPS
	if profile.RatioOverrideBPS != nil {
		value.RatioBPS = *profile.RatioOverrideBPS
	}
	if !policy.Enabled {
		value.ExclusionReason = "promotion_disabled"
		return value, nil
	}
	inviter, err := s.repo.User(invitation.InviterID)
	if err != nil {
		return nil, err
	}
	if profile.Paused || inviter.Status != model.UserStatusActive {
		value.ExclusionReason = "promoter_paused"
		return value, nil
	}
	if value.RatioBPS == 0 {
		value.ExclusionReason = "zero_ratio"
		return value, nil
	}
	value.AmountMicrocredits, err = CalculateAmount(credits, value.RatioBPS)
	if err != nil {
		return nil, err
	}
	if value.AmountMicrocredits == 0 {
		value.ExclusionReason = "rounded_to_zero"
		return value, nil
	}
	value.Eligible, value.ExclusionReason = true, ""
	return value, nil
}

type Overview struct {
	Policy                  model.PromotionPolicy  `json:"policy"`
	Profile                 model.PromotionProfile `json:"profile"`
	EffectiveRatioBPS       int64                  `json:"effectiveRatioBps"`
	CanPromote              bool                   `json:"canPromote"`
	InviteCount             int64                  `json:"inviteCount"`
	TotalMicrocredits       string                 `json:"totalMicrocredits"`
	FrozenMicrocredits      string                 `json:"frozenMicrocredits"`
	AvailableMicrocredits   string                 `json:"availableMicrocredits"`
	TransferredMicrocredits string                 `json:"transferredMicrocredits"`
	VoidedMicrocredits      string                 `json:"voidedMicrocredits"`
	ServerTime              time.Time              `json:"serverTime"`
}

func (s *Service) Overview(user *model.User) (*Overview, error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	policy, err := s.Policy()
	if err != nil {
		return nil, err
	}
	profile, err := s.repo.PromotionProfile(user.ID)
	if err != nil {
		return nil, err
	}
	_, count, err := s.repo.PromotionInvitations(user.ID, 1, 0)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	var total, frozen, available, transferred, voided big.Int
	err = s.repo.ScanCommissionAmounts(user.ID, func(record model.CommissionRecord) {
		total.Add(&total, big.NewInt(record.AmountMicrocredits))
		transferred.Add(&transferred, big.NewInt(record.TransferredMicrocredits))
		voided.Add(&voided, big.NewInt(record.VoidedMicrocredits))
		remaining := big.NewInt(record.AmountMicrocredits - record.TransferredMicrocredits - record.VoidedMicrocredits)
		if record.AvailableAt.After(now) {
			frozen.Add(&frozen, remaining)
		} else {
			available.Add(&available, remaining)
		}
	})
	if err != nil {
		return nil, err
	}
	ratio := policy.RatioBPS
	if profile.RatioOverrideBPS != nil {
		ratio = *profile.RatioOverrideBPS
	}
	return &Overview{Policy: *policy, Profile: *profile, EffectiveRatioBPS: ratio, CanPromote: policy.Enabled && !profile.Paused, InviteCount: count,
		TotalMicrocredits: total.String(), FrozenMicrocredits: frozen.String(), AvailableMicrocredits: available.String(), TransferredMicrocredits: transferred.String(), VoidedMicrocredits: voided.String(), ServerTime: now}, nil
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

func paging(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if page > 1000000 {
		page = 1000000
	}
	if size <= 0 || size > 100 {
		size = 20
	}
	return page, size
}

type InviteView struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (s *Service) Invitations(user *model.User, page, size int) (*Page[InviteView], error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	page, size = paging(page, size)
	rows, total, err := s.repo.PromotionInvitations(user.ID, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	items := make([]InviteView, 0, len(rows))
	for _, row := range rows {
		name := []rune(row.Username)
		display := "用户***"
		if len(name) > 0 {
			display = string(name[0]) + "***"
			if len(name) > 1 {
				display += string(name[len(name)-1])
			}
		}
		items = append(items, InviteView{ID: row.InviteeID, DisplayName: display, CreatedAt: row.CreatedAt})
	}
	return &Page[InviteView]{Items: items, Total: total, Page: page, PageSize: size}, nil
}

func (s *Service) Records(user *model.User, page, size int) (*Page[model.CommissionRecord], error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	return s.records(user.ID, page, size)
}
func (s *Service) records(userID string, page, size int) (*Page[model.CommissionRecord], error) {
	page, size = paging(page, size)
	items, total, err := s.repo.CommissionRecords(userID, size, (page-1)*size)
	return &Page[model.CommissionRecord]{Items: items, Total: total, Page: page, PageSize: size}, err
}
func (s *Service) Transfers(user *model.User, page, size int) (*Page[model.PromotionTransfer], error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	page, size = paging(page, size)
	items, total, err := s.repo.PromotionTransfers(user.ID, size, (page-1)*size)
	return &Page[model.PromotionTransfer]{Items: items, Total: total, Page: page, PageSize: size}, err
}

type TransferRequest struct {
	RequestID          string `json:"requestId"`
	AmountMicrocredits string `json:"amountMicrocredits"`
}

func (s *Service) Transfer(user *model.User, request TransferRequest) (*model.PromotionTransfer, error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	if !requestPattern.MatchString(request.RequestID) || !amountPattern.MatchString(request.AmountMicrocredits) {
		return nil, kernel.BadAuthRequest("请输入有效的请求标识与正整数微积分金额")
	}
	amount, err := strconv.ParseInt(request.AmountMicrocredits, 10, 64)
	if err != nil || amount > 9007199254740991 {
		return nil, kernel.BadAuthRequest("转入金额超过允许范围")
	}
	value := &model.PromotionTransfer{ID: kernel.NewID(), UserID: user.ID, RequestID: request.RequestID, AmountMicrocredits: amount, CreatedAt: time.Now()}
	result, err := s.repo.TransferPromotion(value, value.CreatedAt)
	return result, mapError(err)
}
func (s *Service) TransferResult(user *model.User, requestID string) (*model.PromotionTransfer, error) {
	if err := userRequired(user); err != nil {
		return nil, err
	}
	if !requestPattern.MatchString(requestID) {
		return nil, kernel.BadAuthRequest("请求标识无效")
	}
	value, err := s.repo.PromotionTransferByRequest(user.ID, requestID)
	return value, mapError(err)
}

type ProfileRequest struct {
	Version          int64  `json:"version"`
	Paused           bool   `json:"paused"`
	RatioOverrideBPS *int64 `json:"ratioOverrideBps"`
}

func (s *Service) UpdateProfile(actor *model.User, userID string, request ProfileRequest) (*model.PromotionProfile, error) {
	if err := adminRequired(actor); err != nil {
		return nil, err
	}
	if request.Version < 0 || request.Version == math.MaxInt64 || (request.RatioOverrideBPS != nil && (*request.RatioOverrideBPS < 0 || *request.RatioOverrideBPS > 10000)) {
		return nil, kernel.BadAuthRequest("个人比例或版本无效")
	}
	if _, err := s.repo.User(userID); err != nil {
		return nil, mapError(err)
	}
	before, err := s.repo.PromotionProfile(userID)
	if err != nil {
		return nil, err
	}
	value := *before
	value.Paused, value.RatioOverrideBPS, value.Version = request.Paused, request.RatioOverrideBPS, request.Version+1
	event, err := audit(actor, "promotion.profile.update", "user", userID, "更新个人推广资格与比例", map[string]any{"before": before, "after": value})
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdatePromotionProfile(value, request.Version, event); err != nil {
		return nil, mapError(err)
	}
	return s.repo.PromotionProfile(userID)
}
func (s *Service) Profiles(actor *model.User, keyword string, page, size int) (*Page[repository.AdminPromotionProfile], error) {
	if err := adminRequired(actor); err != nil {
		return nil, err
	}
	if len(keyword) > 120 {
		return nil, kernel.BadAuthRequest("查询内容过长")
	}
	page, size = paging(page, size)
	items, total, err := s.repo.AdminPromotionProfiles(strings.TrimSpace(keyword), size, (page-1)*size)
	return &Page[repository.AdminPromotionProfile]{Items: items, Total: total, Page: page, PageSize: size}, err
}
func (s *Service) AdminRecords(actor *model.User, userID string, page, size int) (*Page[model.CommissionRecord], error) {
	if err := adminRequired(actor); err != nil {
		return nil, err
	}
	return s.records(strings.TrimSpace(userID), page, size)
}
func (s *Service) Void(actor *model.User, id, reason string) error {
	if err := adminRequired(actor); err != nil {
		return err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len([]rune(reason)) > 500 {
		return kernel.BadAuthRequest("请填写 1～500 字的作废原因")
	}
	event, err := audit(actor, "promotion.commission.void", "commission", id, "作废未转入的邀请返利", nil)
	if err != nil {
		return err
	}
	return mapError(s.repo.VoidCommission(id, reason, event))
}
