package app

import (
	"yingce/backend/internal/model"
	"yingce/backend/internal/promotion"
	"yingce/backend/internal/repository"
)

type PromotionPolicy = model.PromotionPolicy
type PromotionTransferRequest = promotion.TransferRequest
type PromotionProfileRequest = promotion.ProfileRequest

func (s *Service) PromotionOverview(actor *model.User) (*promotion.Overview, error) {
	return promotion.New(s.repo).Overview(actor)
}
func (s *Service) CreatePromotionCode(actor *model.User) (*model.PromotionProfile, error) {
	return promotion.New(s.repo).CreateCode(actor)
}
func (s *Service) ValidatePromotionCode(code string) (bool, error) {
	return promotion.New(s.repo).ValidateCode(code)
}
func (s *Service) PromotionInvitations(actor *model.User, page, size int) (*promotion.Page[promotion.InviteView], error) {
	return promotion.New(s.repo).Invitations(actor, page, size)
}
func (s *Service) PromotionRecords(actor *model.User, page, size int) (*promotion.Page[model.CommissionRecord], error) {
	return promotion.New(s.repo).Records(actor, page, size)
}
func (s *Service) PromotionTransfers(actor *model.User, page, size int) (*promotion.Page[model.PromotionTransfer], error) {
	return promotion.New(s.repo).Transfers(actor, page, size)
}
func (s *Service) TransferPromotion(actor *model.User, request PromotionTransferRequest) (*model.PromotionTransfer, error) {
	return promotion.New(s.repo).Transfer(actor, request)
}
func (s *Service) PromotionTransferResult(actor *model.User, requestID string) (*model.PromotionTransfer, error) {
	return promotion.New(s.repo).TransferResult(actor, requestID)
}
func (s *Service) AdminPromotionPolicy(actor *model.User) (*PromotionPolicy, error) {
	return promotion.New(s.repo).AdminPolicy(actor)
}
func (s *Service) UpdatePromotionPolicy(actor *model.User, request PromotionPolicy) (*PromotionPolicy, error) {
	return promotion.New(s.repo).UpdatePolicy(actor, request)
}
func (s *Service) AdminPromotionProfiles(actor *model.User, keyword string, page, size int) (*promotion.Page[repository.AdminPromotionProfile], error) {
	return promotion.New(s.repo).Profiles(actor, keyword, page, size)
}
func (s *Service) UpdatePromotionProfile(actor *model.User, id string, request PromotionProfileRequest) (*model.PromotionProfile, error) {
	return promotion.New(s.repo).UpdateProfile(actor, id, request)
}
func (s *Service) AdminPromotionRecords(actor *model.User, id string, page, size int) (*promotion.Page[model.CommissionRecord], error) {
	return promotion.New(s.repo).AdminRecords(actor, id, page, size)
}
func (s *Service) VoidPromotionCommission(actor *model.User, id, reason string) error {
	return promotion.New(s.repo).Void(actor, id, reason)
}
