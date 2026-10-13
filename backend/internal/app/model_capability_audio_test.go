package app

import (
	"context"
	"encoding/base64"
	"reflect"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestKacangSunoAdminSavePersistsCapabilitiesDisabledUnpriced(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "music", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Music", BaseURL: "https://example.com/v1", APIKey: "test", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	disabled := false
	profile := DefaultModelCapabilityConfigForModel("kacang-suno", "suno")
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{
		ModelKey: "suno", ProviderModelKey: "suno", Capability: "audio", Protocol: "kacang-suno", CapabilityConfig: profile, Enabled: &disabled,
		PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: false, Enabled: &disabled}},
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeModelCapabilityConfig(stored.CapabilityConfigJSON)
	if err != nil || decoded == nil || !reflect.DeepEqual(decoded.Audio, profile.Audio) || stored.CapabilityVersion == 0 {
		t.Fatalf("saved music capabilities lost: %#v, %v", stored, err)
	}
	if stored.Enabled || stored.PriceConfigured {
		t.Fatal("disabled/unpriced model changed")
	}
	for _, tier := range stored.PriceTiers {
		if tier.Enabled || tier.PriceConfigured {
			t.Fatal("price tier enabled or priced")
		}
	}
	published, err := svc.AdminChannelModels(admin, channel.ID)
	if err != nil || len(published) != 1 || published[0].CapabilityConfig == nil {
		t.Fatalf("music capabilities missing from admin readback: %#v, %v", published, err)
	}
	// Reopen the persisted capability contract and save a tag-only edit through
	// the real service write path; a pure form helper cannot prove API acceptance.
	tags := []model.ChannelModelTag{{Text: "音乐", Color: "green"}}
	req := ChannelModelRequest{
		ModelKey: "suno", ProviderModelKey: "suno", Capability: "audio", Protocol: "kacang-suno", CapabilityConfig: decoded, Enabled: &disabled, Tags: tags,
		PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: false, Enabled: &disabled}},
	}
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err != nil {
		t.Fatalf("legal audio contract cannot be resaved: %v", err)
	}
	resaved, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resaved.CapabilityConfigJSON != stored.CapabilityConfigJSON || !reflect.DeepEqual(resaved.Tags, tags) || resaved.Enabled || resaved.PriceConfigured || resaved.UnitPriceMicrocredits != stored.UnitPriceMicrocredits {
		t.Fatal("tag edit changed audio contract, availability or pricing")
	}
	invalid := *decoded.Audio
	invalid.TaskCount = 2
	req.CapabilityConfig = &ModelCapabilityConfig{Version: 1, Audio: &invalid}
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err == nil {
		t.Fatal("unsupported Suno settings were accepted by the save API")
	}
	afterRejectedSave, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resaved, afterRejectedSave) {
		t.Fatal("rejected audio contract modified the persisted model")
	}
}

func TestKacangSunoStoresTwoTracksWithoutDuplicatePrimary(t *testing.T) {
	s := newResourceTestService(t)
	items := []interface{}{map[string]interface{}{"dataUrl": "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString([]byte("ID3first"))}, map[string]interface{}{"dataUrl": "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString([]byte("ID3second"))}}
	stored, err := s.persistLegacyGeneratedMediaResult("user-1", map[string]interface{}{"mode": "audio", "audios": items})
	if err != nil {
		t.Fatal(err)
	}
	tracks := stored["audios"].([]interface{})
	first := tracks[0].(map[string]interface{})
	second := tracks[1].(map[string]interface{})
	if first["resourceId"] == second["resourceId"] || stored["audio"].(map[string]interface{})["resourceId"] != first["resourceId"] {
		t.Fatal("track identity lost")
	}
	rows, err := s.repo.Resources("user-1", 10)
	if err != nil || len(rows) != 2 {
		t.Fatalf("stored %d resources, want exactly two: %v", len(rows), err)
	}
}

func TestKacangSunoAudioCapabilities(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("kacang-suno", "suno")
	if profile.Audio == nil || profile.Audio.TaskCount != 1 || profile.Audio.OutputCount != 2 || profile.Audio.Streaming {
		t.Fatalf("default profile = %#v", profile)
	}
	normalized, err := NormalizeModelCapabilityConfigForModel("audio", "kacang-suno", "suno", nil)
	if err != nil || normalized.Audio == nil {
		t.Fatal("music defaults missing", err)
	}
	invalid := *profile.Audio
	invalid.TaskCount = 2
	if _, err := NormalizeModelCapabilityConfig("audio", "kacang-suno", &ModelCapabilityConfig{Audio: &invalid}); err == nil {
		t.Fatal("mutable music task count accepted")
	}
	for _, name := range []string{"openai-audio", "async-audio", "doubao-streaming-tts"} {
		value, err := NormalizeModelCapabilityConfig("audio", name, nil)
		if err != nil || value != nil {
			t.Fatal("existing speech behavior changed", name)
		}
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(normalized, "audio")
	if err != nil || len(spec.Inputs) != 3 || len(spec.Options) != 0 {
		t.Fatal("music reference/option constraints missing")
	}
	for _, kind := range []string{"image", "video", "audio"} {
		if spec.Inputs[kind].Max != 0 {
			t.Fatal("music references allowed")
		}
	}
}

func TestKacangSunoIncompleteOutputsFailBeforeDownload(t *testing.T) {
	_, err := finishProtocolResult(context.Background(), providerConfig{InterfaceType: "kacang-suno"}, "audio", "", &protocol.Result{Audios: []protocol.MediaReference{{URL: "https://media.example/one.mp3"}}}, defaultVideoPollPolicy())
	if err == nil {
		t.Fatal("one track incorrectly accepted as complete music result")
	}
}
