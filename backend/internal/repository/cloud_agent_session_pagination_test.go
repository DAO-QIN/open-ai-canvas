package repository

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestCreationSessionDirectoryReadsBeyondOneHundredAndScopesCursor(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.AgentSession{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	repo := New(db)
	stamp := time.Now().UTC()
	for i := 0; i < 107; i++ {
		row := model.AgentSession{ID: fmt.Sprintf("session-%03d", i), UserID: "owner", Surface: "creation", Status: "active", UpdatedAt: stamp, CreatedAt: stamp}
		if err = db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	foreign := model.AgentSession{ID: "foreign", UserID: "other", Surface: "creation", Status: "active", UpdatedAt: stamp}
	if err = db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	first, err := repo.AgentSessions("owner", "creation", "", 100)
	if err != nil || len(first) != 100 {
		t.Fatalf("first page %d: %v", len(first), err)
	}
	second, err := repo.AgentSessions("owner", "creation", "", 100, first[len(first)-1].ID)
	if err != nil || len(second) != 7 {
		t.Fatalf("remaining page %d: %v", len(second), err)
	}
	seen := map[string]bool{}
	for _, row := range append(first, second...) {
		if seen[row.ID] {
			t.Fatalf("duplicate session %s", row.ID)
		}
		seen[row.ID] = true
	}
	if _, err = repo.AgentSessions("owner", "creation", "", 100, "foreign"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign cursor accepted: %v", err)
	}
}
