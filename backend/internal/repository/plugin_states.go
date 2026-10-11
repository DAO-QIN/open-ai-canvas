package repository

import (
	"errors"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) PluginPlatformState(pluginID string) (*model.PluginPlatformState, error) {
	var state model.PluginPlatformState
	if err := r.db.First(&state, "plugin_id = ?", pluginID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &state, nil
}

func (r *Repository) PluginPlatformStates() ([]model.PluginPlatformState, error) {
	var states []model.PluginPlatformState
	err := r.db.Order("plugin_id asc").Find(&states).Error
	return states, err
}

func (r *Repository) SavePluginPlatformState(state *model.PluginPlatformState) error {
	if state.PluginID == model.EcommercePluginID {
		return r.db.Transaction(func(tx *gorm.DB) error {
			if e := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "plugin_id"}}, DoUpdates: clause.AssignmentColumns([]string{"available", "updated_by", "updated_at"})}).Create(state).Error; e != nil {
				return e
			}
			if !state.Available && tx.Migrator().HasTable(&model.EcommerceRun{}) {
				return New(tx).PauseEcommerce("", "商品套图已关闭；重新开放后请手动继续")
			}
			return nil
		})
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "plugin_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"available", "updated_by", "updated_at"}),
	}).Create(state).Error
}

func (r *Repository) DeletePluginPlatformState(pluginID string) error {
	return r.db.Delete(&model.PluginPlatformState{}, "plugin_id = ?", pluginID).Error
}

func (r *Repository) UserPluginState(userID string, pluginID string) (*model.UserPluginState, error) {
	var state model.UserPluginState
	if err := r.db.First(&state, "user_id = ? AND plugin_id = ?", userID, pluginID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &state, nil
}

func (r *Repository) UserPluginStates(userID string) ([]model.UserPluginState, error) {
	var states []model.UserPluginState
	err := r.db.Where("user_id = ?", userID).Order("plugin_id asc").Find(&states).Error
	return states, err
}

func (r *Repository) SaveUserPluginState(state *model.UserPluginState) error {
	if state.PluginID == model.EcommercePluginID {
		return r.MutateEcommerce(state.UserID, "", func(_ *model.EcommerceProduct, repo *Repository) error {
			if e := repo.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "plugin_id"}}, DoUpdates: clause.AssignmentColumns([]string{"enabled", "updated_at"})}).Create(state).Error; e != nil {
				return e
			}
			if !state.Enabled && repo.db.Migrator().HasTable(&model.EcommerceRun{}) {
				return repo.PauseEcommerce(state.UserID, "你已停用商品套图；启用后请手动继续")
			}
			return nil
		})
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "plugin_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"enabled", "updated_at"}),
	}).Create(state).Error
}

func (r *Repository) DeleteUserPluginStates(pluginID string) error {
	return r.db.Delete(&model.UserPluginState{}, "plugin_id = ?", pluginID).Error
}

func (r *Repository) EnabledPluginUserCounts() (map[string]int64, error) {
	type countRow struct {
		PluginID string
		Count    int64
	}
	var rows []countRow
	if err := r.db.Model(&model.UserPluginState{}).
		Select("plugin_id, COUNT(*) AS count").
		Where("enabled = ?", true).
		Group("plugin_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.PluginID] = row.Count
	}
	return result, nil
}
