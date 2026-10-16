package database

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestForkV53UpgradePreservesDeployedLedgerAndBusinessData(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := ecommerceRemovalTestDB(t, driver)
			if err := db.AutoMigrate(&schemaMigration{}); err != nil {
				t.Fatal(err)
			}
			appliedAt := time.Date(2026, 10, 12, 1, 2, 3, 0, time.UTC)
			for _, item := range schemaMigrations {
				if item.version > 53 {
					break
				}
				if err := db.Transaction(item.apply); err != nil {
					t.Fatalf("prepare v%d: %v", item.version, err)
				}
				if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: appliedAt}).Error; err != nil {
					t.Fatal(err)
				}
			}
			code := "ABCDEFGHJK"
			entities := []any{
				&model.User{ID: "inviter", Username: "inviter", PasswordHash: "preserved-password", DisplayName: "Creator", Status: model.UserStatusActive},
				&model.User{ID: "invitee", Username: "invitee", PasswordHash: "preserved-second-password", Status: model.UserStatusActive},
				&model.AuthSession{ID: "session", UserID: "invitee", TokenHash: "preserved-token", ExpiresAt: appliedAt.AddDate(1, 0, 0)},
				&model.OAuthState{ID: "oauth", Provider: "linuxdo", StateHash: "preserved-state", CodeVerifier: "preserved-verifier", InviteCode: code, AcceptedTerms: true, NextPath: "/promotion", ExpiresAt: appliedAt.AddDate(1, 0, 0)},
				&model.PromotionProfile{UserID: "inviter", InviteCode: &code, Version: 4},
				&model.Invitation{InviteeID: "invitee", InviterID: "inviter", CreatedAt: appliedAt},
				&model.PaymentOrder{ID: "payment", UserID: "invitee", MerchantOrderNo: "preserved-order", IdempotencyKey: "preserved-payment", AmountFen: 1000, CreditsMicrocredits: 1000000, PromotionSnapshot: &model.PaymentPromotionSnapshot{Version: 1, PolicyVersion: 8, ProfileVersion: 4, InviterID: "inviter", Eligible: true, RatioBPS: 500, FreezeDays: 3, BaseMicrocredits: 1000000, AmountMicrocredits: 50000}},
				&model.CommissionRecord{ID: "commission", PaymentOrderID: "payment", InviterID: "inviter", InviteeID: "invitee", BaseMicrocredits: 1000000, AmountMicrocredits: 50000, TransferredMicrocredits: 10000, RatioBPS: 500, PolicyVersion: 8, ProfileVersion: 4, FreezeDays: 3, AvailableAt: appliedAt.AddDate(0, 0, 3)},
				&model.PromotionTransfer{ID: "transfer", UserID: "inviter", RequestID: "preserved-transfer", AmountMicrocredits: 10000},
				&model.CommissionAllocation{ID: "allocation", TransferID: "transfer", CommissionID: "commission", AmountMicrocredits: 10000},
				&model.CreditAccount{UserID: "inviter", AvailableMicrocredits: 10000, ReservedMicrocredits: 2000, Version: 7},
				&model.CreditLedgerEntry{ID: "ledger", UserID: "inviter", PaymentOrderID: "payment", AmountMicrocredits: 10000, AvailableAfterMicrocredits: 10000, Note: "preserved-ledger"},
				&model.BillingOrder{ID: "billing", UserID: "invitee", IdempotencyKey: "preserved-billing", TaskID: "task", AmountMicrocredits: 3000, PriceVersion: 9},
				&model.Task{ID: "task", UserID: "invitee", BillingOrderID: "billing", Operation: "text_to_image", InputJSON: `{"resourceId":"resource"}`, ResultJSON: `{"resourceId":"resource","nodeId":"node"}`},
				&model.CanvasMutationReceipt{ID: "receipt", UserID: "invitee", CanvasID: "canvas", MutationID: "mutation", PayloadDigest: "preserved-digest", ResultJSON: `{"nodeId":"node"}`, Revision: 11},
				&model.ModelChannel{ID: "channel", Name: "preserved-channel", Enabled: true, APIKey: "synthetic-encrypted-key", ModelsJSON: `["suno"]`},
				&model.ChannelModel{ID: "channel-model", ChannelID: "channel", ModelKey: "suno", Enabled: false, PriceConfigured: true, UnitPriceMicrocredits: 12345, PriceVersion: 9, CapabilityConfigJSON: `{"audio":{"voiceModes":["male","female"]}}`, CapabilityVersion: 3},
				&model.SystemSetting{Key: model.PromotionPolicySettingKey, ValueJSON: `{"enabled":true,"ratioBps":500,"freezeDays":3,"version":8}`},
			}
			for _, entity := range entities {
				if err := db.Create(entity).Error; err != nil {
					t.Fatalf("seed %T: %v", entity, err)
				}
			}
			// AutoMigrate in old migration functions sees current models; remove only
			// the new shape so this fixture actually tests adding the v54-v57 fields.
			for _, field := range []struct {
				entity any
				name   string
			}{
				{&model.User{}, "AvatarMode"}, {&model.User{}, "AvatarVersion"}, {&model.User{}, "AvatarPreset"},
				{&model.AuthSession{}, "ReauthenticatedAt"}, {&model.OAuthState{}, "ReauthUserID"}, {&model.OAuthState{}, "ReauthSessionID"},
				{&model.AuthVerification{}, "SessionID"}, {&model.AuthVerification{}, "CredentialHash"}, {&model.Task{}, "WorkbenchKind"},
			} {
				if driver == "sqlite" && db.Migrator().HasIndex(field.entity, field.name) {
					if err := db.Migrator().DropIndex(field.entity, field.name); err != nil {
						t.Fatal(err)
					}
				}
				if db.Migrator().HasColumn(field.entity, field.name) {
					if err := db.Migrator().DropColumn(field.entity, field.name); err != nil {
						t.Fatal(err)
					}
				}
			}
			for _, entity := range []any{&model.UserAvatar{}, &model.LoginLog{}, &model.WorkbenchTool{}, &model.WorkbenchPreset{}} {
				if err := db.Migrator().DropTable(entity); err != nil {
					t.Fatal(err)
				}
			}
			var ledgerBefore []schemaMigration
			if err := db.Order("version").Find(&ledgerBefore).Error; err != nil {
				t.Fatal(err)
			}
			if ledgerBefore[len(ledgerBefore)-3].Name != "official_ecommerce_studio" || ledgerBefore[len(ledgerBefore)-2].Name != "canvas_mutation_receipts" || ledgerBefore[len(ledgerBefore)-1].Name != "remove_ecommerce_studio" {
				t.Fatal("fixture lost the deployed fork migration identities")
			}
			columns := map[string][]string{}
			for _, entity := range entities {
				stmt := &gorm.Statement{DB: db}
				if err := stmt.Parse(entity); err != nil {
					t.Fatal(err)
				}
				types, err := db.Migrator().ColumnTypes(entity)
				if err != nil {
					t.Fatal(err)
				}
				if _, seen := columns[stmt.Schema.Table]; seen {
					continue
				}
				for _, column := range types {
					columns[stmt.Schema.Table] = append(columns[stmt.Schema.Table], column.Name())
				}
			}
			snapshot := func() map[string][]string {
				t.Helper()
				result := map[string][]string{}
				for table, projection := range columns {
					var rows []map[string]any
					if err := db.Table(table).Select(projection).Find(&rows).Error; err != nil {
						t.Fatal(err)
					}
					for _, row := range rows {
						data, err := json.Marshal(row)
						if err != nil {
							t.Fatal(err)
						}
						result[table] = append(result[table], string(data))
					}
					sort.Strings(result[table])
				}
				return result
			}
			before := snapshot()
			for range 2 {
				if err := MigrateSchema(db); err != nil {
					t.Fatal(err)
				}
				var ledgerAfter []schemaMigration
				if err := db.Where("version <= ?", 53).Order("version").Find(&ledgerAfter).Error; err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(ledgerBefore, ledgerAfter) {
					t.Fatal("deployed migration identity or applied_at changed")
				}
				if after := snapshot(); !reflect.DeepEqual(before, after) {
					for table := range before {
						if !reflect.DeepEqual(before[table], after[table]) {
							t.Errorf("old columns or records changed in %s", table)
						}
					}
				}
				assertEcommerceSchemaRemoved(t, db)
				for _, entity := range []any{&model.UserAvatar{}, &model.LoginLog{}, &model.WorkbenchTool{}, &model.WorkbenchPreset{}} {
					var count int64
					if err := db.Model(entity).Count(&count).Error; err != nil || count != 0 {
						t.Fatalf("migration unexpectedly seeded %T: %d %v", entity, count, err)
					}
				}
			}
			if status, err := ReadSchemaStatus(db); err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
				t.Fatalf("upgraded status: %+v %v", status, err)
			}
			if !db.Migrator().HasColumn(&model.Task{}, "WorkbenchKind") || !db.Migrator().HasColumn(&model.OAuthState{}, "ReauthUserID") || !db.Migrator().HasColumn(&model.User{}, "AvatarPreset") {
				t.Fatal("new schema fields absent")
			}
		})
	}
}
