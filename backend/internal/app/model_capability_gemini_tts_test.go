package app

import (
	"encoding/json"
	"reflect"
	"testing"
	"yingce/backend/internal/model"
)

func TestKacangGeminiTTSAdminSaveReadbackAndRejection(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "tts", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "TTS", BaseURL: "https://example.com/v1", APIKey: "test", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	disabled := false
	profile := DefaultModelCapabilityConfigForModel("kacang-gemini-tts", "gemini-3.8-flash-tts")
	req := ChannelModelRequest{ModelKey: "gemini-3.8-flash-tts", ProviderModelKey: "gemini-3.8-flash-tts", Capability: "audio", Protocol: "kacang-gemini-tts", CapabilityConfig: profile, Enabled: &disabled, PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: false, Enabled: &disabled}}}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeModelCapabilityConfig(stored.CapabilityConfigJSON)
	if err != nil || decoded == nil || !reflect.DeepEqual(decoded.Audio, profile.Audio) || stored.Enabled || stored.PriceConfigured {
		t.Fatalf("capabilities or pricing changed: %#v %v", stored, err)
	}
	if decoded.Audio.Speech.DefaultVoice != "Kore" || decoded.Audio.Speech.OutputFormat != "wav" || len(decoded.Audio.Speech.Voices) != 30 {
		t.Fatal("defaults incomplete")
	}
	readback, err := svc.AdminChannelModels(admin, channel.ID)
	if err != nil || len(readback) != 1 {
		t.Fatal("admin readback lost model", err)
	}
	readbackJSON, _ := json.Marshal(readback[0].CapabilityConfig)
	readbackConfig, err := DecodeModelCapabilityConfig(string(readbackJSON))
	if err != nil || readbackConfig == nil || !reflect.DeepEqual(readbackConfig.Audio, profile.Audio) {
		t.Fatal("admin readback lost defaults", err)
	}
	req.CapabilityConfig = decoded
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err != nil {
		t.Fatal("saved contract cannot be resaved", err)
	}
	beforeRejected, _ := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	decoded.Audio.Speech.SampleRate = 16000
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err == nil {
		t.Fatal("unsupported PCM specification accepted")
	}
	afterRejected, _ := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if !reflect.DeepEqual(beforeRejected, afterRejected) {
		t.Fatal("rejected save changed stored record")
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "audio")
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"image", "video", "audio"} {
		if spec.Inputs[kind].Max != 0 {
			t.Fatal("TTS references allowed")
		}
	}
}
