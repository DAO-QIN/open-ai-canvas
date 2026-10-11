// Package ecommerce is the official product-image application. It owns plans
// and orchestration, while the host owns identities, tasks, routes and billing.
package ecommerce

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const PluginID = model.EcommercePluginID
const SettingsKey = "ecommerce_studio"
const PlanningVersion = "master-refine-v1"

type Selection struct {
	LogicalModelID  string `json:"logicalModelId,omitempty"`
	ChannelID       string `json:"channelId,omitempty"`
	ChannelModelKey string `json:"channelModelKey,omitempty"`
}
type Output struct {
	Count    int    `json:"count"`
	Size     string `json:"size"`
	Quality  string `json:"quality,omitempty"`
	CopyMode string `json:"copyMode"`
}
type Config struct {
	Planner                Selection  `json:"planner"`
	ImageModel             Selection  `json:"imageModel"`
	ReviewModel            *Selection `json:"reviewModel,omitempty"`
	QualityCheck           bool       `json:"qualityCheck"`
	Hero                   Output     `json:"hero"`
	Detail                 Output     `json:"detail"`
	TitleCount             int        `json:"titleCount"`
	TitleMaxLength         int        `json:"titleMaxLength"`
	Style                  string     `json:"style"`
	Platform               string     `json:"platform"`
	Market                 string     `json:"market"`
	Language               string     `json:"language"`
	PlanningInstructions   string     `json:"planningInstructions,omitempty"`
	RefinementInstructions string     `json:"refinementInstructions,omitempty"`
	GenerationInstructions string     `json:"generationInstructions,omitempty"`
}
type Settings struct {
	ReviewAvailable         bool      `json:"reviewAvailable"`
	ReviewModel             Selection `json:"reviewModel"`
	Revision                int64     `json:"revision"`
	Defaults                Config    `json:"defaults"`
	BatchLimit              int       `json:"batchLimit"`
	ProductConcurrency      int       `json:"productConcurrency"`
	TextConcurrency         int       `json:"textConcurrency"`
	ImageConcurrency        int       `json:"imageConcurrency"`
	ProductImageConcurrency int       `json:"productImageConcurrency"`
}

func DefaultSettings() Settings {
	return Settings{Revision: 1, BatchLimit: 20, ProductConcurrency: 3, TextConcurrency: 2, ImageConcurrency: 4, ProductImageConcurrency: 2, Defaults: Config{Hero: Output{Count: 3, Size: "1024x1024", CopyMode: "none"}, Detail: Output{Count: 5, Size: "1024x1536", CopyMode: "typeset"}, TitleCount: 3, TitleMaxLength: 80, Style: "简洁、真实、统一的商业摄影", Platform: "自定义电商平台", Market: "中国", Language: "简体中文"}}
}

type Guard struct {
	Revision    int64  `json:"revision"`
	OperationID string `json:"operationId"`
}
type ImportItem struct {
	ResourceID    string `json:"resourceId"`
	Name          string `json:"name"`
	SellingPoints string `json:"sellingPoints"`
}
type ImportRequest struct {
	OperationID string       `json:"operationId"`
	Name        string       `json:"name"`
	Items       []ImportItem `json:"items"`
	Config      *Config      `json:"config,omitempty"`
}
type ProductRequest struct {
	Guard
	Name          string  `json:"name"`
	SellingPoints string  `json:"sellingPoints"`
	Config        *Config `json:"config,omitempty"`
	Archived      *bool   `json:"archived,omitempty"`
}
type Scope struct {
	Action           string   `json:"action"`
	Branches         []string `json:"branches,omitempty"`
	SlotID           string   `json:"slotId,omitempty"`
	StepID           string   `json:"stepId,omitempty"`
	AdditionalHero   int      `json:"additionalHero,omitempty"`
	AdditionalDetail int      `json:"additionalDetail,omitempty"`
	Config           *Config  `json:"config,omitempty"`
	StepIDs          []string `json:"-"`
}
type QuoteRequest struct {
	Revision int64 `json:"revision"`
	Scope
}
type Command struct {
	Guard
	Action             string      `json:"action"`
	QuoteID            string      `json:"quoteId,omitempty"`
	BudgetMicrocredits int64       `json:"budgetMicrocredits,omitempty"`
	Branch             string      `json:"branch,omitempty"`
	BranchRevision     int64       `json:"branchRevision,omitempty"`
	Plan               *Plan       `json:"plan,omitempty"`
	SlotID             string      `json:"slotId,omitempty"`
	SlotRevision       int64       `json:"slotRevision,omitempty"`
	Draft              *Refinement `json:"draft,omitempty"`
	VersionID          string      `json:"versionId,omitempty"`
}
type Price struct {
	ReviewModel           *Selection `json:"reviewModel,omitempty"`
	Key                   string     `json:"key"`
	Signature             string     `json:"signature"`
	EstimatedMicrocredits int64      `json:"estimatedMicrocredits"`
	CapMicrocredits       int64      `json:"capMicrocredits"`
	Calls                 int        `json:"calls"`
	Estimated             bool       `json:"estimated"`
}
type QuoteView struct {
	model.EcommerceQuote
	Scope  Scope   `json:"scope"`
	Prices []Price `json:"prices"`
}
type SlotView struct {
	model.EcommerceSlot
	QualityChecks []QualityCheckView            `json:"qualityChecks"`
	Refinement    *Refinement                   `json:"refinement,omitempty"`
	Draft         *Refinement                   `json:"draft,omitempty"`
	Versions      []model.EcommerceImageVersion `json:"versions"`
}
type BranchView struct {
	model.EcommerceBranch
	Plan         *Plan   `json:"plan,omitempty"`
	AcceptedPlan *Plan   `json:"acceptedPlan,omitempty"`
	History      []Plan  `json:"history"`
	Config       *Config `json:"config,omitempty"`
}
type RunView struct {
	model.EcommerceRun
	Config               Config                `json:"config"`
	Titles               []string              `json:"titles"`
	TitleHistory         [][]string            `json:"titleHistory"`
	Branches             []BranchView          `json:"branches"`
	Slots                []SlotView            `json:"slots"`
	Steps                []model.EcommerceStep `json:"steps"`
	BudgetMicrocredits   int64                 `json:"budgetMicrocredits"`
	OccupiedMicrocredits int64                 `json:"occupiedMicrocredits"`
	ActualMicrocredits   int64                 `json:"actualMicrocredits"`
}
type ProductView struct {
	model.EcommerceProduct
	Config Config               `json:"config"`
	Run    *RunView             `json:"run,omitempty"`
	Runs   []model.EcommerceRun `json:"runs"`
}
type ProductPage struct {
	Items    []ProductView `json:"items"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
}
type BatchView struct {
	model.EcommerceBatch
	Products []ProductView `json:"products"`
}
type BatchCommandItem struct {
	ProductID string  `json:"productId"`
	Command   Command `json:"command"`
}
type BatchResult struct {
	ProductID string       `json:"productId"`
	Status    string       `json:"status"`
	Reason    string       `json:"reason,omitempty"`
	Product   *ProductView `json:"product,omitempty"`
}
type PresetView struct {
	model.EcommercePreset
	Config Config `json:"config"`
}
type PresetRequest struct {
	Guard
	Name   string `json:"name"`
	Config Config `json:"config"`
}
type Intent struct {
	ReviewModel      Selection
	ResultResourceID string
	VersionID        string
	Kind             string
	Config           Config
	ResourceID       string
	Prompt           string
	StageID          string
	Copy             string
}
type Prepared struct {
	Task      *model.Task
	Order     *model.BillingOrder
	Signature string
	Amount    int64
	Estimated bool
}
type Completion struct {
	Text       string
	ResourceID string
}

// All host methods operate on server-built inputs. Public commands cannot
// provide task IDs, provider credentials, billing identities or raw routes.
type Host interface {
	WithStorageLock(func() error) error
	Require(*repository.Repository, string) error
	ValidateConfig(string, Config) error
	ValidateReviewModel(string, Selection) error
	Prepare(string, Intent, *int64) (*Prepared, error)
	Admit(*repository.Repository, *Prepared) error
	StorageQuota(*repository.Repository, string, int64) error
	Completion(*model.Task) (Completion, error)
	OpenResource(string, string) (*model.Resource, io.ReadCloser, error)
	Wake()
}
type Service struct {
	repo  *repository.Repository
	host  Host
	owner string
}

func New(repo *repository.Repository, host Host, owner string) *Service {
	return &Service{repo: repo, host: host, owner: owner}
}
func Hash(value any) string {
	b, _ := json.Marshal(value)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func encode(value any) string { b, _ := json.Marshal(value); return string(b) }
func conflict(msg string) error {
	return &kernel.AppError{Status: 409, Code: 409, Reason: "ecommerce_conflict", Message: msg}
}
func invalid(msg string) error {
	return &kernel.AppError{Status: 400, Code: 400, Reason: "ecommerce_invalid", Message: msg}
}
func blocked(code, msg string) error {
	return &kernel.AppError{Status: 409, Code: 409, Reason: kernel.ErrorReason(code), Message: msg}
}
func expires() time.Time { return time.Now().Add(15 * time.Minute) }
