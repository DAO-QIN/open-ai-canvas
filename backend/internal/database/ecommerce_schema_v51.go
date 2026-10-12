package database

import "time"

// Frozen schema definitions used only by migration 51. Runtime models must not
// register these tables; migration 53 removes them after test-task cleanup.
const ecommercePluginID = "ecommerce-studio"

// Parent records organize work; only Task/BillingOrder carry model charges.
type EcommerceBatch struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	UserID      string    `json:"-" gorm:"size:36;index;uniqueIndex:idx_ecommerce_batch_operation,priority:1"`
	OperationID string    `json:"-" gorm:"size:120;uniqueIndex:idx_ecommerce_batch_operation,priority:2"`
	RequestHash string    `json:"-" gorm:"size:64"`
	Name        string    `json:"name" gorm:"size:200"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type EcommerceProduct struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	UserID           string    `json:"-" gorm:"size:36;index:idx_ecommerce_product_owner,priority:1"`
	BatchID          string    `json:"batchId" gorm:"size:36;index"`
	SourceResourceID string    `json:"sourceResourceId" gorm:"size:36;index"`
	Name             string    `json:"name" gorm:"size:200"`
	SellingPoints    string    `json:"sellingPoints" gorm:"type:text"`
	ConfigJSON       string    `json:"-" gorm:"type:text"`
	CurrentRunID     string    `json:"currentRunId,omitempty" gorm:"size:36"`
	Revision         int64     `json:"revision"`
	Archived         bool      `json:"archived" gorm:"index:idx_ecommerce_product_owner,priority:2"`
	CreatedAt        time.Time `json:"createdAt" gorm:"index:idx_ecommerce_product_owner,priority:3"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type EcommerceRun struct {
	ID                  string     `json:"id" gorm:"primaryKey;size:36"`
	UserID              string     `json:"-" gorm:"size:36;index"`
	ProductID           string     `json:"productId" gorm:"size:36;index"`
	Number              int        `json:"number"`
	Revision            int64      `json:"revision"`
	Status              string     `json:"status" gorm:"size:40;index"`
	PauseReason         string     `json:"pauseReason,omitempty" gorm:"size:500"`
	Mode                string     `json:"mode" gorm:"size:16"`
	ConfigJSON          string     `json:"-" gorm:"type:text"`
	ProductSnapshotJSON string     `json:"-" gorm:"type:text"`
	TitlesJSON          string     `json:"-" gorm:"type:text"`
	TitleRevision       int64      `json:"titleRevision"`
	LeaseOwner          string     `json:"-" gorm:"size:120"`
	LeaseEpoch          int64      `json:"-"`
	LeaseExpiresAt      *time.Time `json:"-" gorm:"index"`
	NextCheckAt         time.Time  `json:"-" gorm:"index"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

type EcommerceBranch struct {
	ID               string     `json:"id" gorm:"primaryKey;size:36"`
	UserID           string     `json:"-" gorm:"size:36;index"`
	RunID            string     `json:"runId" gorm:"size:36;uniqueIndex:idx_ecommerce_branch,priority:1"`
	Kind             string     `json:"kind" gorm:"size:16;uniqueIndex:idx_ecommerce_branch,priority:2"`
	Revision         int64      `json:"revision"`
	Status           string     `json:"status" gorm:"size:32"`
	PlanJSON         string     `json:"-" gorm:"type:text"`
	AcceptedPlanJSON string     `json:"-" gorm:"type:text"`
	ConfigJSON       string     `json:"-" gorm:"type:text"`
	AcceptedRevision int64      `json:"acceptedRevision"`
	PlanHistoryJSON  string     `json:"-" gorm:"type:text"`
	ApprovedAt       *time.Time `json:"approvedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type EcommerceSlot struct {
	ID                string    `json:"id" gorm:"primaryKey;size:36"`
	UserID            string    `json:"-" gorm:"size:36;index"`
	RunID             string    `json:"runId" gorm:"size:36;uniqueIndex:idx_ecommerce_slot,priority:1"`
	Kind              string    `json:"kind" gorm:"size:16;uniqueIndex:idx_ecommerce_slot,priority:2"`
	Index             int       `json:"index" gorm:"uniqueIndex:idx_ecommerce_slot,priority:3"`
	Revision          int64     `json:"revision"`
	Status            string    `json:"status" gorm:"size:32"`
	Title             string    `json:"title" gorm:"size:200"`
	Copy              string    `json:"copy" gorm:"type:text"`
	RefinementJSON    string    `json:"-" gorm:"type:text"`
	DraftJSON         string    `json:"-" gorm:"type:text"`
	SelectedVersionID string    `json:"selectedVersionId,omitempty" gorm:"size:36"`
	Generation        int       `json:"generation"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type EcommerceImageVersion struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	UserID     string    `json:"-" gorm:"size:36;index"`
	RunID      string    `json:"runId" gorm:"size:36;index"`
	SlotID     string    `json:"slotId" gorm:"size:36;uniqueIndex:idx_ecommerce_image_version,priority:1"`
	Number     int       `json:"number" gorm:"uniqueIndex:idx_ecommerce_image_version,priority:2"`
	TaskID     string    `json:"taskId" gorm:"size:36;uniqueIndex"`
	ResourceID string    `json:"resourceId" gorm:"size:36;index"`
	Prompt     string    `json:"prompt" gorm:"type:text"`
	Copy       string    `json:"copy" gorm:"type:text"`
	CreatedAt  time.Time `json:"createdAt"`
}

type EcommerceStep struct {
	ID                   string    `json:"id" gorm:"primaryKey;size:36"`
	UserID               string    `json:"-" gorm:"size:36;index"`
	ProductID            string    `json:"productId" gorm:"size:36;index"`
	RunID                string    `json:"runId" gorm:"size:36;uniqueIndex:idx_ecommerce_step_stage,priority:1"`
	StageKey             string    `json:"stageKey" gorm:"size:120;uniqueIndex:idx_ecommerce_step_stage,priority:2"`
	Kind                 string    `json:"kind" gorm:"size:24"`
	BranchKind           string    `json:"branchKind,omitempty" gorm:"size:16"`
	SlotID               string    `json:"slotId,omitempty" gorm:"size:36"`
	Generation           int       `json:"generation"`
	Status               string    `json:"status" gorm:"size:32;index"`
	TaskID               *string   `json:"taskId,omitempty" gorm:"size:36;uniqueIndex"`
	AuthorizationID      string    `json:"authorizationId,omitempty" gorm:"size:36"`
	RequestJSON          string    `json:"-" gorm:"type:text"`
	RawResponse          string    `json:"-" gorm:"type:text"`
	ResultJSON           string    `json:"-" gorm:"type:text"`
	ErrorCode            string    `json:"errorCode,omitempty" gorm:"size:80"`
	Error                string    `json:"error,omitempty" gorm:"size:500"`
	PriceSignature       string    `json:"-" gorm:"type:text"`
	ReservedMicrocredits int64     `json:"reservedMicrocredits"`
	ActualMicrocredits   int64     `json:"actualMicrocredits"`
	BillingStatus        string    `json:"billingStatus,omitempty" gorm:"size:32"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type EcommerceQuote struct {
	ID                    string     `json:"id" gorm:"primaryKey;size:36"`
	UserID                string     `json:"-" gorm:"size:36;index"`
	ProductID             string     `json:"productId" gorm:"size:36;index"`
	RunID                 string     `json:"runId,omitempty" gorm:"size:36"`
	ProductRevision       int64      `json:"productRevision"`
	RunRevision           int64      `json:"runRevision"`
	ScopeJSON             string     `json:"-" gorm:"type:text"`
	PricesJSON            string     `json:"-" gorm:"type:text"`
	Hash                  string     `json:"hash" gorm:"size:64"`
	EstimatedMicrocredits int64      `json:"estimatedMicrocredits"`
	BudgetMicrocredits    int64      `json:"budgetMicrocredits"`
	TextCalls             int        `json:"textCalls"`
	ImageCalls            int        `json:"imageCalls"`
	ConsumedAt            *time.Time `json:"-"`
	ExpiresAt             time.Time  `json:"expiresAt"`
	CreatedAt             time.Time  `json:"createdAt"`
}

type EcommerceAuthorization struct {
	ID                   string     `json:"id" gorm:"primaryKey;size:36"`
	UserID               string     `json:"-" gorm:"size:36;index"`
	RunID                string     `json:"runId" gorm:"size:36;index"`
	QuoteID              string     `json:"quoteId" gorm:"size:36;uniqueIndex"`
	ScopeJSON            string     `json:"-" gorm:"type:text"`
	PricesJSON           string     `json:"-" gorm:"type:text"`
	BudgetMicrocredits   int64      `json:"budgetMicrocredits"`
	OccupiedMicrocredits int64      `json:"occupiedMicrocredits"`
	RevokedAt            *time.Time `json:"revokedAt,omitempty"`
	ExpiresAt            time.Time  `json:"expiresAt"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type EcommercePreset struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	UserID     string    `json:"-" gorm:"size:36;uniqueIndex:idx_ecommerce_preset,priority:1"`
	Name       string    `json:"name" gorm:"size:120;uniqueIndex:idx_ecommerce_preset,priority:2"`
	Revision   int64     `json:"revision"`
	ConfigJSON string    `json:"-" gorm:"type:text"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type EcommerceOperation struct {
	ID           string    `json:"-" gorm:"primaryKey;size:36"`
	UserID       string    `json:"-" gorm:"size:36;uniqueIndex:idx_ecommerce_operation,priority:1"`
	OperationID  string    `json:"-" gorm:"size:120;uniqueIndex:idx_ecommerce_operation,priority:2"`
	ProductID    string    `json:"-" gorm:"size:36;index"`
	RequestHash  string    `json:"-" gorm:"size:64"`
	ResponseJSON string    `json:"-" gorm:"type:text"`
	CreatedAt    time.Time `json:"-"`
}
