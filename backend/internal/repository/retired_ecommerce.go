package repository

import (
	"strings"

	"yingce/backend/internal/model"
)

// Keep references and storage accounting for records written before withdrawal.
// No creation, orchestration or model dispatch operations remain here.
func (r *Repository) EcommerceStorageUsage(userID string) (int64, int64, error) {
	var count, total int64
	if !r.db.Migrator().HasTable(&model.EcommerceProduct{}) {
		return 0, 0, nil
	}
	if err := r.db.Model(&model.EcommerceProduct{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return 0, 0, err
	}
	for _, table := range []struct{ Name, Fields string }{
		{"ecommerce_products", "name, selling_points, config_json"}, {"ecommerce_runs", "config_json, product_snapshot_json, titles_json"},
		{"ecommerce_branches", "plan_json, accepted_plan_json, plan_history_json, config_json"}, {"ecommerce_slots", "title, copy, refinement_json, draft_json"},
		{"ecommerce_steps", "request_json, raw_response, result_json, error"}, {"ecommerce_image_versions", "prompt, copy"},
		{"ecommerce_quotes", "scope_json, prices_json"}, {"ecommerce_authorizations", "scope_json, prices_json"}, {"ecommerce_operations", "response_json"}, {"ecommerce_presets", "config_json"},
	} {
		parts := []string{}
		for _, field := range strings.Split(table.Fields, ", ") {
			if r.db.Dialector.Name() == "postgres" {
				parts = append(parts, "COALESCE(OCTET_LENGTH("+field+"),0)")
			} else {
				parts = append(parts, "COALESCE(LENGTH(CAST("+field+" AS BLOB)),0)")
			}
		}
		var bytes int64
		if err := r.db.Table(table.Name).Select("COALESCE(SUM("+strings.Join(parts, "+")+"),0)").Where("user_id = ?", userID).Scan(&bytes).Error; err != nil {
			return 0, 0, err
		}
		total += bytes
	}
	return count, total, nil
}

func (r *Repository) EcommerceResourceReferences(userID string, ids []string) ([]ResourceDirectReference, error) {
	refs := []ResourceDirectReference{}
	if !r.db.Migrator().HasTable(&model.EcommerceProduct{}) {
		return refs, nil
	}
	products := []model.EcommerceProduct{}
	if err := r.db.Where("user_id = ? AND source_resource_id IN ?", userID, ids).Find(&products).Error; err != nil {
		return nil, err
	}
	for _, p := range products {
		refs = append(refs, ResourceDirectReference{Kind: "商品原图", ID: p.ID, Title: p.Name, ResourceID: p.SourceResourceID})
	}
	versions := []model.EcommerceImageVersion{}
	if err := r.db.Where("user_id = ? AND resource_id IN ?", userID, ids).Find(&versions).Error; err != nil {
		return nil, err
	}
	for _, v := range versions {
		refs = append(refs, ResourceDirectReference{Kind: "商品套图版本", ID: v.ID, Title: "商品图片", ResourceID: v.ResourceID})
	}
	return refs, nil
}
