package database

import (
	"fmt"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

var ecommerceTablesV51 = []string{
	"ecommerce_operations", "ecommerce_presets", "ecommerce_authorizations",
	"ecommerce_quotes", "ecommerce_image_versions", "ecommerce_steps",
	"ecommerce_slots", "ecommerce_branches", "ecommerce_runs",
	"ecommerce_products", "ecommerce_batches",
}

func removeEcommerceStudio(tx *gorm.DB) error {
	// Removing the task link while retaining a failed image_to_image task would
	// make it eligible for generic retry and another charge. Require explicit
	// backed-up test-task cleanup before removing the retired runtime's schema.
	var namedTasks int64
	if err := tx.Model(&model.Task{}).Where("substr(operation, 1, 10) = ?", "ecommerce_").Count(&namedTasks).Error; err != nil {
		return err
	}
	if namedTasks != 0 {
		return fmt.Errorf("仍有 %d 条商品套图任务，请先备份、核对结算并清理测试任务及其日志/结果", namedTasks)
	}
	if tx.Migrator().HasColumn(&ecommerceTaskV51{}, "EcommerceStepID") {
		var count int64
		if err := tx.Model(&model.Task{}).Where("ecommerce_step_id IS NOT NULL").Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("仍有 %d 条商品套图关联任务，请先备份、核对结算并清理测试任务及其日志/结果；不得只清空关联字段", count)
		}
	}
	for _, table := range []string{"ecommerce_steps", "ecommerce_image_versions"} {
		if !tx.Migrator().HasTable(table) {
			continue
		}
		var count int64
		if err := tx.Table(table).Where("task_id IN (SELECT id FROM tasks)").Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("%s 仍关联 %d 条任务，请先备份、核对结算并清理测试任务及其日志/结果", table, count)
		}
	}
	for _, table := range ecommerceTablesV51 {
		if err := tx.Migrator().DropTable(table); err != nil {
			return err
		}
	}
	if err := tx.Exec("DROP INDEX IF EXISTS idx_tasks_ecommerce_step_id").Error; err != nil {
		return err
	}
	if tx.Migrator().HasColumn(&ecommerceTaskV51{}, "EcommerceStepID") {
		if err := tx.Migrator().DropColumn(&ecommerceTaskV51{}, "EcommerceStepID"); err != nil {
			return err
		}
	}
	for _, entity := range []any{&model.PluginPlatformState{}, &model.UserPluginState{}} {
		if !tx.Migrator().HasTable(entity) {
			continue
		}
		if err := tx.Where("plugin_id = ?", ecommercePluginID).Delete(entity).Error; err != nil {
			return err
		}
	}
	return nil
}
