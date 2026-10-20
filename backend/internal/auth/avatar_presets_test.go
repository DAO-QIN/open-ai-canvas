package auth

import (
	"bytes"
	"fmt"
	"image"
	"testing"
)

func TestSpiritAvatarSelectionPersistsAndRejectsInvalidIDs(t *testing.T) {
	svc, _, actor := avatarTestService(t)
	for index := 1; index <= spiritAvatarCount; index++ {
		preset := fmt.Sprintf("spirit-v1-%02d", index)
		selected, err := svc.SelectDefaultProfileAvatar(actor, preset)
		if err != nil || selected.AvatarPreset != preset || selected.AvatarMode != "default" || selected.AvatarURL != "" {
			t.Fatalf("select %s: %#v, %v", preset, selected, err)
		}
		fresh, err := svc.repo.User(actor.ID)
		if err != nil || fresh.AvatarPreset != preset {
			t.Fatalf("reload %s: %#v, %v", preset, fresh, err)
		}
	}
	uploaded, err := svc.UpdateProfileAvatar(actor, avatarFileHeader(t, avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 8, 8)))))
	if err != nil {
		t.Fatal(err)
	}
	before, err := svc.ProfileAvatarContent(actor, actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"spirit-v1-00", "spirit-v1-49", "spirit-v1-1", "spirit-v1-001", "spirit-v1-+1", "spirit-v1-01/../02", " spirit-v1-01", "SPIRIT-v1-01"} {
		_, err := svc.SelectDefaultProfileAvatar(actor, invalid)
		avatarStatus(t, err, 400)
	}
	fresh, err := svc.repo.User(actor.ID)
	if err != nil || fresh.AvatarMode != "custom" || fresh.AvatarVersion != uploaded.AvatarVersion || fresh.AvatarPreset != "spirit-v1-48" {
		t.Fatalf("invalid ID changed uploaded avatar: %#v, %v", fresh, err)
	}
	after, err := svc.ProfileAvatarContent(actor, actor.ID)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("invalid ID changed avatar bytes: %v", err)
	}
}

func TestRegistrationStoresSpiritAvatarOnce(t *testing.T) {
	svc, _ := newRegistrationTestService(t)
	registered, err := svc.Register(RegisterRequest{Username: "spirit-user", Password: "password", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	preset := registered.User.AvatarPreset
	if registered.User.AvatarMode != "default" || !validProfileAvatarPreset(preset) || len(preset) != 12 {
		t.Fatalf("registration avatar = %#v", registered.User)
	}
	for attempt := 0; attempt < 3; attempt++ {
		fresh, err := svc.repo.User(registered.User.ID)
		if err != nil || fresh.AvatarPreset != preset {
			t.Fatalf("persisted avatar changed: %#v, %v", fresh, err)
		}
		public, err := svc.PublicAuthUser(fresh)
		if err != nil || public.AvatarPreset != preset {
			t.Fatalf("profile read rerolled avatar: %#v, %v", public, err)
		}
	}
}

func TestLinuxDONewAccountAvatarRespectsProviderImage(t *testing.T) {
	svc, _ := newRegistrationTestService(t)
	for _, source := range []string{"", "https://example.com/avatar.png"} {
		user, identity, err := svc.createLinuxDOUser("spirit-subject", "linux-spirit", "Creator", "", source)
		if err != nil {
			t.Fatal(err)
		}
		if identity.AvatarURL != source {
			t.Fatal("provider image changed")
		}
		if source == "" && (user.AvatarMode != "default" || !validProfileAvatarPreset(user.AvatarPreset)) {
			t.Fatalf("missing fallback: %#v", user)
		}
		if source != "" && (user.AvatarMode != "" || user.AvatarPreset != "") {
			t.Fatalf("provider image overridden: %#v", user)
		}
	}
}
