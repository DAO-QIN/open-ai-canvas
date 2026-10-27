package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaEditingUpgradePreservesSchema75DataAndHistory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:drama-editing-upgrade?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	episode := model.DramaEpisode{ID: "existing-episode", ProjectID: "existing-project", Number: 1, Title: "Keep this episode"}
	segment := model.DramaSegment{ID: "existing-segment", ProjectID: episode.ProjectID, EpisodeID: episode.ID}
	invitation := model.Invitation{InviteeID: "existing-invitee", InviterID: "existing-inviter"}
	for _, row := range []any{&episode, &segment, &invitation} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, column := range []struct {
		entity any
		name   string
	}{{&model.DramaEpisode{}, "SourceFormat"}, {&model.DramaSegment{}, "ReferenceCastIDsJSON"}} {
		if err := db.Migrator().DropColumn(column.entity, column.name); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version > ?", 75).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	var history []schemaMigration
	if err := db.Order("version").Find(&history).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	for _, previous := range history {
		var current schemaMigration
		if err := db.First(&current, "version = ?", previous.Version).Error; err != nil {
			t.Fatal(err)
		}
		if current != previous {
			t.Fatalf("existing migration changed: before=%#v after=%#v", previous, current)
		}
	}
	var storedEpisode model.DramaEpisode
	var storedSegment model.DramaSegment
	var storedInvitation model.Invitation
	if err := db.First(&storedEpisode, "id = ?", episode.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&storedSegment, "id = ?", segment.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&storedInvitation, "invitee_id = ?", invitation.InviteeID).Error; err != nil {
		t.Fatal(err)
	}
	if storedEpisode.Title != episode.Title || storedEpisode.SourceFormat != "" || storedSegment.ReferenceCastIDsJSON != "" || storedInvitation.InviterID != invitation.InviterID {
		t.Fatal("upgrade changed existing episode, segment or invitation data")
	}
}
