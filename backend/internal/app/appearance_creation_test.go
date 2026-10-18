package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestAppearanceCreationCopyPersistenceAndDefaults(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	legacy := model.SystemSetting{Key: appearanceSettingKey, ValueJSON: `{"schemaVersion":10,"brandName":"影绘"}`}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	before, err := svc.Appearance()
	if err != nil || before.CreationTitle != defaultCreationTitle || before.CreationDescription != defaultCreationDescription {
		t.Fatalf("existing settings defaults: %#v, %v", before, err)
	}
	current, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	value := current.AppearanceSetting
	value.CreationTitle = "  用{brandName}开启创作\r\n把想法变成画面  "
	value.CreationDescription = "  第一行\r\n第二行  "
	updated, err := svc.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	read, err := svc.Appearance()
	if err != nil || read.CreationTitle != "用{brandName}开启创作\n把想法变成画面" || read.CreationDescription != "第一行\n第二行" || updated.Public.CreationTitle != read.CreationTitle {
		t.Fatalf("public roundtrip: %#v, %v", read, err)
	}
	if read.BrandName != before.BrandName || read.Revision == before.Revision {
		t.Fatal("copy save must preserve brand and invalidate public revision")
	}
	value.CreationTitle = " "
	value.CreationDescription = ""
	if _, err = svc.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	read, err = svc.Appearance()
	if err != nil || read.CreationTitle != defaultCreationTitle || read.CreationDescription != "" {
		t.Fatalf("empty title fallback and hidden subtitle: %#v, %v", read, err)
	}
	if _, err = svc.UpdateAppearance(&model.User{Role: model.UserRoleUser, Status: model.UserStatusActive}, value); err == nil {
		t.Fatal("non-admin was allowed to edit creation copy")
	}
}

func TestAppearanceCreationCopyRejectsInvalidValues(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	for _, input := range []struct{ title, description string }{
		{strings.Repeat("字", 81), ""},
		{"标题", strings.Repeat("字", 161)},
		{"坏\x00标题", ""},
		{"标题", "坏\x07副标题"},
	} {
		value := defaultAppearanceSetting()
		value.CreationTitle, value.CreationDescription = input.title, input.description
		if _, err := svc.UpdateAppearance(admin, value); err == nil {
			t.Errorf("invalid creation copy accepted: %#v", input)
		}
	}
}
