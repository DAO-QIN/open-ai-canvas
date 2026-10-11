package ecommerce

import "testing"

func TestEcommercePersonalPreferencesAndDraftDeletionAreScopedAndIdempotent(t *testing.T) {
	f := newWorkflow(t)
	p := f.productView(t)
	before, err := f.svc.Preferences("other")
	if err != nil {
		t.Fatal(err)
	}
	if before.Revision != 0 {
		t.Fatal("new user's preferences inherited another account")
	}
	config := f.config
	config.Style = "我的默认风格"
	req := PresetRequest{Guard: Guard{Revision: 0, OperationID: "my-preferences"}, Name: "ignored", Config: config}
	saved, err := f.svc.SavePreferences("owner", req)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := f.svc.SavePreferences("owner", req)
	if err != nil || replayed.ID != saved.ID || replayed.Revision != 1 {
		t.Fatalf("preference replay: %+v %v", replayed, err)
	}
	if f.productView(t).Config.Style == config.Style {
		t.Fatal("new preference rewrote an existing product")
	}
	other, err := f.svc.Preferences("other")
	if err != nil || other.Revision != 0 {
		t.Fatal("preference leaked to another account")
	}
	guard := Guard{Revision: saved.Revision, OperationID: "delete-preference"}
	if err = f.svc.DeletePreset("other", saved.ID, guard); err == nil {
		t.Fatal("cross-account preset deletion accepted")
	}
	for i := 0; i < 2; i++ {
		if err = f.svc.DeletePreset("owner", saved.ID, guard); err != nil {
			t.Fatal(err)
		}
	}
	guard = Guard{Revision: p.Revision, OperationID: "delete-product-draft"}
	if err = f.svc.DeleteDraft("other", p.ID, guard); err == nil {
		t.Fatal("cross-account draft deletion accepted")
	}
	for i := 0; i < 2; i++ {
		if err = f.svc.DeleteDraft("owner", p.ID, guard); err != nil {
			t.Fatal(err)
		}
	}
}
