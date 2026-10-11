package model

import "time"

const PromotionPolicySettingKey = "promotion_policy"

type PromotionPolicy struct {
	Enabled    bool  `json:"enabled"`
	RatioBPS   int64 `json:"ratioBps"`
	FreezeDays int   `json:"freezeDays"`
	Version    int64 `json:"version"`
}

type PromotionProfile struct {
	UserID           string    `json:"userId" gorm:"primaryKey;size:36"`
	InviteCode       *string   `json:"inviteCode" gorm:"size:16;uniqueIndex"`
	Paused           bool      `json:"paused" gorm:"not null;default:false"`
	RatioOverrideBPS *int64    `json:"ratioOverrideBps"`
	Version          int64     `json:"version" gorm:"not null;default:0"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Invitation struct {
	InviteeID string    `json:"-" gorm:"primaryKey;size:36"`
	InviterID string    `json:"-" gorm:"size:36;index"`
	CreatedAt time.Time `json:"createdAt" gorm:"index"`
}

// PaymentPromotionSnapshot is internal and immutable, including excluded orders.
// A nil snapshot identifies an older order, which must never be backfilled.
type PaymentPromotionSnapshot struct {
	Version            int    `json:"version"`
	PolicyVersion      int64  `json:"policyVersion"`
	ProfileVersion     int64  `json:"profileVersion"`
	InviterID          string `json:"inviterId"`
	Eligible           bool   `json:"eligible"`
	ExclusionReason    string `json:"exclusionReason"`
	RatioBPS           int64  `json:"ratioBps"`
	FreezeDays         int    `json:"freezeDays"`
	BaseMicrocredits   int64  `json:"baseMicrocredits"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
}

type CommissionRecord struct {
	ID                      string    `json:"id" gorm:"primaryKey;size:36"`
	PaymentOrderID          string    `json:"paymentOrderId" gorm:"size:36;uniqueIndex"`
	InviterID               string    `json:"inviterId" gorm:"size:36;index:idx_commission_owner_available,priority:1"`
	InviteeID               string    `json:"-" gorm:"size:36;index"`
	BaseMicrocredits        int64     `json:"baseMicrocredits,string"`
	AmountMicrocredits      int64     `json:"amountMicrocredits,string"`
	TransferredMicrocredits int64     `json:"transferredMicrocredits,string" gorm:"not null;default:0"`
	VoidedMicrocredits      int64     `json:"voidedMicrocredits,string" gorm:"not null;default:0"`
	RatioBPS                int64     `json:"ratioBps"`
	PolicyVersion           int64     `json:"policyVersion"`
	ProfileVersion          int64     `json:"profileVersion"`
	FreezeDays              int       `json:"freezeDays"`
	AvailableAt             time.Time `json:"availableAt" gorm:"index:idx_commission_owner_available,priority:2"`
	VoidReason              string    `json:"voidReason,omitempty" gorm:"size:500"`
	VoidedBy                string    `json:"voidedBy,omitempty" gorm:"size:36"`
	CreatedAt               time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt               time.Time `json:"updatedAt"`
}

type PromotionTransfer struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	UserID             string    `json:"-" gorm:"size:36;uniqueIndex:idx_promotion_transfer_request,priority:1;index"`
	RequestID          string    `json:"requestId" gorm:"size:80;uniqueIndex:idx_promotion_transfer_request,priority:2"`
	AmountMicrocredits int64     `json:"amountMicrocredits,string"`
	CreatedAt          time.Time `json:"createdAt" gorm:"index"`
}

type CommissionAllocation struct {
	ID                 string    `json:"-" gorm:"primaryKey;size:36"`
	TransferID         string    `json:"transferId" gorm:"size:36;uniqueIndex:idx_commission_allocation,priority:1"`
	CommissionID       string    `json:"commissionId" gorm:"size:36;uniqueIndex:idx_commission_allocation,priority:2;index"`
	AmountMicrocredits int64     `json:"amountMicrocredits,string"`
	CreatedAt          time.Time `json:"createdAt"`
}
