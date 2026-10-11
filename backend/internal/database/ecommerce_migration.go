package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
	"yingce/backend/internal/model"
)

func migrateEcommerce(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.PluginPlatformState{}, &model.EcommerceBatch{}, &model.EcommerceProduct{}, &model.EcommerceRun{}, &model.EcommerceBranch{}, &model.EcommerceSlot{}, &model.EcommerceImageVersion{}, &model.EcommerceStep{}, &model.EcommerceQuote{}, &model.EcommerceAuthorization{}, &model.EcommercePreset{}, &model.EcommerceOperation{}); err != nil {
		return err
	}
	if !tx.Migrator().HasColumn(&model.Task{}, "EcommerceStepID") {
		if err := tx.Migrator().AddColumn(&model.Task{}, "EcommerceStepID"); err != nil {
			return err
		}
	}
	if !tx.Migrator().HasIndex(&model.Task{}, "EcommerceStepID") {
		if err := tx.Migrator().CreateIndex(&model.Task{}, "EcommerceStepID"); err != nil {
			return err
		}
	}
	// No missing-record default can accidentally publish an unconfigured module.
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.PluginPlatformState{PluginID: model.EcommercePluginID, Available: false, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error
}
