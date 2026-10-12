package database

import (
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ecommerceTaskV51 struct {
	EcommerceStepID *string `gorm:"size:36;uniqueIndex"`
}

func (ecommerceTaskV51) TableName() string { return "tasks" }

func migrateEcommerce(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.PluginPlatformState{}, &EcommerceBatch{}, &EcommerceProduct{}, &EcommerceRun{}, &EcommerceBranch{}, &EcommerceSlot{}, &EcommerceImageVersion{}, &EcommerceStep{}, &EcommerceQuote{}, &EcommerceAuthorization{}, &EcommercePreset{}, &EcommerceOperation{}); err != nil {
		return err
	}
	if !tx.Migrator().HasColumn(&ecommerceTaskV51{}, "EcommerceStepID") {
		if err := tx.Migrator().AddColumn(&ecommerceTaskV51{}, "EcommerceStepID"); err != nil {
			return err
		}
	}
	if !tx.Migrator().HasIndex(&ecommerceTaskV51{}, "EcommerceStepID") {
		if err := tx.Migrator().CreateIndex(&ecommerceTaskV51{}, "EcommerceStepID"); err != nil {
			return err
		}
	}
	// No missing-record default can accidentally publish an unconfigured module.
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.PluginPlatformState{PluginID: ecommercePluginID, Available: false, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error
}
