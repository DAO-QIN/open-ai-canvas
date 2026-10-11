package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrPromotionConflict        = errors.New("推广记录已变化，请刷新后重试")
	ErrPromotionInsufficient    = errors.New("可转入返利不足")
	ErrPromotionRequestConflict = errors.New("请求标识已用于不同的转入金额")
)

// RegistrationHook runs inside the transaction that creates the account and
// consumes its verification. Domain validation can therefore fail atomically.
type RegistrationHook func(*Repository) error

func createRegistrationUser(tx *gorm.DB, user *model.User, hooks []RegistrationHook) error {
	if err := tx.Create(user).Error; err != nil {
		return err
	}
	for _, hook := range hooks {
		if hook != nil {
			if err := hook(New(tx)); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Repository) PromotionPolicySetting() (*model.SystemSetting, error) {
	var setting model.SystemSetting
	err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).First(&setting, "key = ?", model.PromotionPolicySettingKey).Error
	return &setting, err
}

func (r *Repository) UpdatePromotionPolicy(value model.PromotionPolicy, expected int64, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		seed := model.SystemSetting{Key: model.PromotionPolicySettingKey, ValueJSON: `{"enabled":false,"ratioBps":0,"freezeDays":0,"version":0}`}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
			return err
		}
		var current model.SystemSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "key = ?", seed.Key).Error; err != nil {
			return err
		}
		var before model.PromotionPolicy
		if err := json.Unmarshal([]byte(current.ValueJSON), &before); err != nil {
			return err
		}
		if before.Version != expected {
			return ErrPromotionConflict
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		result := tx.Model(&current).Where("value_json = ?", current.ValueJSON).Updates(map[string]any{"value_json": string(encoded), "updated_by": audit.ActorUserID, "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPromotionConflict
		}
		audit.MetadataJSON, err = promotionChangeMetadata(before, value)
		if err != nil {
			return err
		}
		return tx.Create(audit).Error
	})
}

func (r *Repository) PromotionProfile(userID string) (*model.PromotionProfile, error) {
	profile := model.PromotionProfile{UserID: userID}
	err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).First(&profile, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &profile, nil
	}
	return &profile, err
}

func (r *Repository) PromotionProfileByCode(code string) (*model.PromotionProfile, error) {
	var profile model.PromotionProfile
	err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).First(&profile, "invite_code = ?", code).Error
	return &profile, err
}

func (r *Repository) CreatePromotionCode(userID, code string) (*model.PromotionProfile, error) {
	var profile model.PromotionProfile
	err := r.db.Transaction(func(tx *gorm.DB) error {
		seed := model.PromotionProfile{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&profile, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if profile.Paused {
			return ErrPromotionConflict
		}
		if profile.InviteCode != nil {
			return nil
		}
		result := tx.Model(&profile).Where("invite_code IS NULL AND paused = ?", false).Updates(map[string]any{"invite_code": code, "version": gorm.Expr("version + 1"), "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPromotionConflict
		}
		return tx.First(&profile, "user_id = ?", userID).Error
	})
	return &profile, err
}

func (r *Repository) UpdatePromotionProfile(value model.PromotionProfile, expected int64, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		seed := model.PromotionProfile{UserID: value.UserID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
			return err
		}
		var before model.PromotionProfile
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&before, "user_id = ?", value.UserID).Error; err != nil {
			return err
		}
		if before.Version != expected {
			return ErrPromotionConflict
		}
		updatedAt := time.Now()
		result := tx.Model(&model.PromotionProfile{}).Where("user_id = ? AND version = ?", value.UserID, expected).
			Updates(map[string]any{"paused": value.Paused, "ratio_override_bps": value.RatioOverrideBPS, "version": expected + 1, "updated_at": updatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPromotionConflict
		}
		after := before
		after.Paused, after.RatioOverrideBPS, after.Version = value.Paused, value.RatioOverrideBPS, expected+1
		after.UpdatedAt = updatedAt
		var err error
		audit.MetadataJSON, err = promotionChangeMetadata(before, after)
		if err != nil {
			return err
		}
		return tx.Create(audit).Error
	})
}

func promotionChangeMetadata(before, after any) (string, error) {
	encoded, err := json.Marshal(map[string]any{"before": before, "after": after})
	return string(encoded), err
}

func (r *Repository) CreateInvitation(value *model.Invitation) error { return r.db.Create(value).Error }

func (r *Repository) InvitationForUser(userID string) (*model.Invitation, error) {
	var value model.Invitation
	err := r.db.First(&value, "invitee_id = ?", userID).Error
	return &value, err
}

type PromotionInviteRow struct {
	InviteeID string
	Username  string
	CreatedAt time.Time
}

func (r *Repository) PromotionInvitations(userID string, limit, offset int) ([]PromotionInviteRow, int64, error) {
	items := []PromotionInviteRow{}
	var total int64
	query := r.db.Model(&model.Invitation{}).Where("inviter_id = ?", userID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("invitations.invitee_id, users.username, invitations.created_at").
		Joins("LEFT JOIN users ON users.id = invitations.invitee_id").Order("invitations.created_at DESC, invitations.invitee_id").Limit(limit).Offset(offset).Scan(&items).Error
	return items, total, err
}

// ScanCommissionAmounts avoids SQL SUM overflow for lifetime totals.
func (r *Repository) ScanCommissionAmounts(userID string, visit func(model.CommissionRecord)) error {
	rows, err := r.db.Model(&model.CommissionRecord{}).Select("amount_microcredits, transferred_microcredits, voided_microcredits, available_at").Where("inviter_id = ?", userID).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item model.CommissionRecord
		if err := r.db.ScanRows(rows, &item); err != nil {
			return err
		}
		visit(item)
	}
	return rows.Err()
}

func (r *Repository) CommissionRecords(userID string, limit, offset int) ([]model.CommissionRecord, int64, error) {
	items := []model.CommissionRecord{}
	var total int64
	query := r.db.Model(&model.CommissionRecord{})
	if userID != "" {
		query = query.Where("inviter_id = ?", userID)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at DESC, id").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) PromotionTransfers(userID string, limit, offset int) ([]model.PromotionTransfer, int64, error) {
	items := []model.PromotionTransfer{}
	var total int64
	query := r.db.Model(&model.PromotionTransfer{}).Where("user_id = ?", userID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at DESC, id").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) PromotionTransferByRequest(userID, requestID string) (*model.PromotionTransfer, error) {
	var item model.PromotionTransfer
	err := r.db.First(&item, "user_id = ? AND request_id = ?", userID, requestID).Error
	return &item, err
}

func (r *Repository) TransferPromotion(value *model.PromotionTransfer, now time.Time) (*model.PromotionTransfer, error) {
	result := *value
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Writing before reading serializes SQLite writers as well as PostgreSQL
		// transfers for one owner. Every allocation still has a conditional guard.
		lock := tx.Model(&model.PromotionProfile{}).Where("user_id = ?", value.UserID).UpdateColumn("version", gorm.Expr("version"))
		if lock.Error != nil {
			return lock.Error
		}
		if lock.RowsAffected != 1 {
			return ErrPromotionInsufficient
		}
		var existing model.PromotionTransfer
		if err := tx.First(&existing, "user_id = ? AND request_id = ?", value.UserID, value.RequestID).Error; err == nil {
			if existing.AmountMicrocredits != value.AmountMicrocredits {
				return ErrPromotionRequestConflict
			}
			result = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Create(value).Error; err != nil {
			return err
		}
		var records []model.CommissionRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("inviter_id = ? AND available_at <= ? AND amount_microcredits > transferred_microcredits + voided_microcredits", value.UserID, now).
			Order("available_at, id").Find(&records).Error; err != nil {
			return err
		}
		remaining := value.AmountMicrocredits
		for _, record := range records {
			if remaining == 0 {
				break
			}
			amount := min(remaining, record.AmountMicrocredits-record.TransferredMicrocredits-record.VoidedMicrocredits)
			updated := tx.Model(&model.CommissionRecord{}).Where("id = ? AND amount_microcredits - transferred_microcredits - voided_microcredits >= ?", record.ID, amount).
				UpdateColumn("transferred_microcredits", gorm.Expr("transferred_microcredits + ?", amount))
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return ErrPromotionConflict
			}
			allocation := model.CommissionAllocation{ID: newRepositoryID(), TransferID: value.ID, CommissionID: record.ID, AmountMicrocredits: amount, CreatedAt: now}
			if err := tx.Create(&allocation).Error; err != nil {
				return err
			}
			remaining -= amount
		}
		if remaining != 0 {
			return ErrPromotionInsufficient
		}
		account := model.CreditAccount{UserID: value.UserID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		updated := tx.Model(&model.CreditAccount{}).Where("user_id = ? AND available_microcredits <= ?", value.UserID, maxPaymentCreditBalance-value.AmountMicrocredits).
			Updates(map[string]any{"available_microcredits": gorm.Expr("available_microcredits + ?", value.AmountMicrocredits), "version": gorm.Expr("version + 1"), "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrPaymentCreditOverflow
		}
		if err := tx.First(&account, "user_id = ?", value.UserID).Error; err != nil {
			return err
		}
		reference := "promotion-transfer:" + value.ID
		entry := model.CreditLedgerEntry{ID: newRepositoryID(), UserID: value.UserID, Type: model.CreditLedgerPromotionTransfer,
			AmountMicrocredits: value.AmountMicrocredits, AvailableDeltaMicrocredits: value.AmountMicrocredits,
			AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
			ReferenceKey: &reference, Note: "邀请返利转入积分", CreatedAt: now}
		return tx.Create(&entry).Error
	})
	return &result, err
}

func (r *Repository) VoidCommission(id, reason string, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// This is the first read on SQLite, so reserve its writer before reading.
		if tx.Dialector.Name() == "sqlite" {
			if err := tx.Exec("UPDATE commission_records SET updated_at = updated_at WHERE 1 = 0").Error; err != nil {
				return err
			}
		}
		var record model.CommissionRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&record, "id = ?", id).Error; err != nil {
			return err
		}
		remaining := record.AmountMicrocredits - record.TransferredMicrocredits - record.VoidedMicrocredits
		if remaining <= 0 {
			return ErrPromotionConflict
		}
		updated := tx.Model(&record).Where("transferred_microcredits = ? AND voided_microcredits = ?", record.TransferredMicrocredits, record.VoidedMicrocredits).
			Updates(map[string]any{"voided_microcredits": record.VoidedMicrocredits + remaining, "void_reason": reason, "voided_by": audit.ActorUserID, "updated_at": time.Now()})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrPromotionConflict
		}
		metadata, err := json.Marshal(map[string]any{"remainingMicrocredits": remaining, "reason": reason, "inviterId": record.InviterID})
		if err != nil {
			return err
		}
		audit.MetadataJSON = string(metadata)
		return tx.Create(audit).Error
	})
}

type AdminPromotionProfile struct {
	model.PromotionProfile
	Username   string           `json:"username"`
	UserStatus model.UserStatus `json:"userStatus"`
}

func (r *Repository) AdminPromotionProfiles(keyword string, limit, offset int) ([]AdminPromotionProfile, int64, error) {
	items := []AdminPromotionProfile{}
	var total int64
	query := r.db.Table("users").Joins("LEFT JOIN promotion_profiles ON promotion_profiles.user_id = users.id")
	if keyword != "" {
		pattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(keyword) + "%"
		query = query.Where("users.id = ? OR users.username LIKE ? ESCAPE '\\'", keyword, pattern)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("users.id AS user_id, users.username, users.status AS user_status, promotion_profiles.invite_code, COALESCE(promotion_profiles.paused, false) AS paused, promotion_profiles.ratio_override_bps, COALESCE(promotion_profiles.version, 0) AS version, promotion_profiles.created_at, promotion_profiles.updated_at").
		Order("users.created_at DESC, users.id").Limit(limit).Offset(offset).Scan(&items).Error
	return items, total, err
}
