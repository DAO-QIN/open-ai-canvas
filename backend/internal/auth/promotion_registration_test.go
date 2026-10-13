package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/promotion"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const registrationInviteCode = "ABCDEFGHJK"

type promotionRegistrationHost struct{ nopHost }

func (promotionRegistrationHost) SettingsEncryptionKey() ([]byte, error) {
	return []byte("registration-test-key-32-bytes!!!"), nil
}

func (promotionRegistrationHost) BindInvitation(repo *repository.Repository, user *model.User, code string) error {
	return promotion.New(repo).BindInvitation(user, code)
}

type registrationSMS struct{ code string }

func (*registrationSMS) Available(string) (bool, error) { return true, nil }
func (s *registrationSMS) SendCode(_ context.Context, _, _, code string) error {
	s.code = code
	return nil
}

func newPromotionRegistrationService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	svc, db := newRegistrationTestService(t)
	svc.host = promotionRegistrationHost{}
	if err := db.AutoMigrate(&model.PromotionProfile{}, &model.Invitation{}, &model.AuthVerification{}, &model.NotificationQuota{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create([]model.User{
		{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		{ID: "promoter", Username: "promoter", Role: model.UserRoleUser, Status: model.UserStatusActive},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PromotionProfile{UserID: "promoter", InviteCode: stringPointer(registrationInviteCode)}).Error; err != nil {
		t.Fatal(err)
	}
	for _, setting := range []model.SystemSetting{
		{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`},
		{Key: model.PromotionPolicySettingKey, ValueJSON: `{"enabled":true,"ratioBps":500,"version":1}`},
	} {
		if err := db.Create(&setting).Error; err != nil {
			t.Fatal(err)
		}
	}
	return svc, db
}

func stringPointer(value string) *string { return &value }

func assertRegistrationCount(t *testing.T, svc *Service, want int64) {
	t.Helper()
	if count, err := svc.repo.UserCount(); err != nil || count != want {
		t.Fatalf("users=%d want=%d err=%v", count, want, err)
	}
}

func TestInvitationRegistrationConsumesVerificationAtomically(t *testing.T) {
	for _, method := range []string{"legacy_email", "email", "sms", "sms_email"} {
		t.Run(method, func(t *testing.T) {
			svc, db := newPromotionRegistrationService(t)
			policy := VerificationPolicy{EmailRegistration: method == "email" || method == "legacy_email", SMSRegistration: method == "sms", SMSAndEmailRegistration: method == "sms_email"}
			encoded, _ := json.Marshal(policy)
			if err := db.Create(&model.SystemSetting{Key: authPolicyKey, ValueJSON: string(encoded)}).Error; err != nil {
				t.Fatal(err)
			}
			req := RegisterRequest{Username: "invited-user", Password: "strong-password", AcceptedTerms: true, InviteCode: "INVALID", LoginContext: LoginContext{IP: "192.0.2.10", UserAgent: "invitation-test"}}
			if method != "sms" {
				req.Email = "invited@example.com"
			}
			if method == "sms" || method == "sms_email" {
				req.Phone = "+8613800138000"
			}
			sms := &registrationSMS{}
			svc.SetSMSDelivery(sms)
			svc.SetMailSender(func(_ EmailSettingValue, _, _ string, body string) error {
				req.EmailCode = regexp.MustCompile(`[0-9]{6}`).FindString(body)
				return nil
			})
			if method == "legacy_email" {
				if err := svc.SendRegistrationEmailCode(req.Email); err != nil {
					t.Fatal(err)
				}
			} else {
				ticket, err := svc.StartVerification(context.Background(), nil, VerificationRequest{Purpose: "register", Method: method, Email: req.Email, Phone: req.Phone})
				if err != nil {
					t.Fatal(err)
				}
				req.Ticket, req.SMSCode = ticket.Ticket, sms.code
			}
			assertUnused := func(wantUsed bool) {
				t.Helper()
				var used bool
				if method == "legacy_email" {
					var stored model.EmailVerificationCode
					if err := db.First(&stored, "email = ?", req.Email).Error; err != nil {
						t.Fatal(err)
					}
					used = stored.UsedAt != nil
				} else {
					var stored model.AuthVerification
					if err := db.First(&stored, "id = ?", strings.Split(req.Ticket, ".")[0]).Error; err != nil {
						t.Fatal(err)
					}
					used = stored.UsedAt != nil
				}
				if used != wantUsed {
					t.Fatalf("verification used=%v want=%v", used, wantUsed)
				}
			}
			_, err := svc.Register(req)
			var appErr *kernel.AppError
			if !errors.As(err, &appErr) || appErr.Reason != "invalid_invite_code" {
				t.Fatalf("invalid invite error=%v", err)
			}
			assertRegistrationCount(t, svc, 2)
			assertUnused(false)
			req.InviteCode = strings.ToLower(registrationInviteCode)
			result, err := svc.Register(req)
			if err != nil {
				t.Fatal(err)
			}
			assertRegistrationCount(t, svc, 3)
			assertUnused(true)
			invitation, err := svc.repo.InvitationForUser(result.User.ID)
			if err != nil || invitation.InviterID != "promoter" {
				t.Fatalf("invitation=%+v err=%v", invitation, err)
			}
			var event model.LoginLog
			if err := db.First(&event, "user_id = ? AND source = ?", result.User.ID, "registration").Error; err != nil || event.Result != "success" || event.IP != req.LoginContext.IP {
				t.Fatalf("invitation registration lost login context: %+v %v", event, err)
			}
			if (req.Email != "" && result.User.EmailVerifiedAt == nil) || (req.Phone != "" && result.User.PhoneVerifiedAt == nil) {
				t.Fatalf("verified contacts missing: %+v", result.User)
			}
			if _, err := svc.Register(req); err == nil {
				t.Fatal("verification was reused")
			}
			assertRegistrationCount(t, svc, 3)
		})
	}
}

func TestInvitationDoesNotBindFirstAdministrator(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	svc.host = promotionRegistrationHost{}
	if err := db.AutoMigrate(&model.Invitation{}); err != nil {
		t.Fatal(err)
	}
	result, err := svc.Register(RegisterRequest{Username: "first-admin", Password: "strong-password", AcceptedTerms: true, InviteCode: "INVALID"})
	if err != nil || result.User.Role != model.UserRoleAdmin {
		t.Fatalf("first admin=%+v err=%v", result, err)
	}
	var count int64
	if err := db.Model(&model.Invitation{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("invitations=%d err=%v", count, err)
	}
}

func TestLinuxDOInvitationStateAndExistingAccount(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			_, _ = w.Write([]byte(`{"access_token":"test-token"}`))
		} else {
			_, _ = w.Write([]byte(`{"id":"42","username":"linux-user","name":"Linux User"}`))
		}
	}))
	defer provider.Close()
	for _, tc := range []struct {
		name, code               string
		existing, dual, accepted bool
		reason                   string
	}{
		{name: "new account", code: registrationInviteCode, accepted: true},
		{name: "invalid invitation rolls back account", code: "INVALID", accepted: true, reason: "invalid_invite_code"},
		{name: "existing account ignores invitation and agreement", code: "INVALID", existing: true},
		{name: "invitation cannot bypass dual verification", code: registrationInviteCode, accepted: true, dual: true, reason: "forbidden"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newPromotionRegistrationService(t)
			setting, _ := json.Marshal(linuxDOSettingValue{Enabled: true, ClientID: "client", AuthorizationURL: provider.URL + "/authorize", TokenURL: provider.URL + "/token", UserInfoURL: provider.URL + "/profile", RedirectURL: "https://example.com/callback"})
			if err := db.Create(&model.SystemSetting{Key: linuxDOSettingKey, ValueJSON: string(setting)}).Error; err != nil {
				t.Fatal(err)
			}
			if tc.dual {
				if err := db.Create(&model.SystemSetting{Key: authPolicyKey, ValueJSON: `{"smsAndEmailRegistration":true}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.existing {
				user := &model.User{ID: "old-oauth", Username: "old-oauth", Role: model.UserRoleUser, Status: model.UserStatusActive}
				if err := svc.repo.CreateOAuthUser(user, &model.UserIdentity{ID: "old-identity", UserID: user.ID, Provider: "linuxdo", Subject: "42"}, func(repo *repository.Repository) error {
					return promotion.New(repo).BindInvitation(user, registrationInviteCode)
				}); err != nil {
					t.Fatal(err)
				}
			}
			target, err := svc.BeginLinuxDOLogin("/promotion", tc.accepted, tc.code)
			if err != nil {
				t.Fatal(err)
			}
			parsed, _ := url.Parse(target)
			if parsed.Query().Has("inviteCode") {
				t.Fatal("invite code leaked to provider")
			}
			state := parsed.Query().Get("state")
			var stored model.OAuthState
			if err := db.First(&stored, "state_hash = ?", HashToken(state)).Error; err != nil || stored.InviteCode != tc.code {
				t.Fatalf("state=%+v err=%v", stored, err)
			}
			result, err := svc.CompleteLinuxDOLogin(state, "test-code", "", LoginContext{IP: "192.0.2.11", UserAgent: "oauth-invitation-test"})
			if tc.reason != "" {
				var appErr *kernel.AppError
				if !errors.As(err, &appErr) || string(appErr.Reason) != tc.reason {
					t.Fatalf("callback error=%v", err)
				}
				assertRegistrationCount(t, svc, 2)
				var count int64
				if err := db.Model(&model.UserIdentity{}).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("identities=%d err=%v", count, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			assertRegistrationCount(t, svc, 3)
			invitation, err := svc.repo.InvitationForUser(result.Session.User.ID)
			if err != nil || invitation.InviterID != "promoter" {
				t.Fatalf("invitation=%+v err=%v", invitation, err)
			}
			if tc.existing && result.Session.User.ID != "old-oauth" {
				t.Fatal("existing account replaced")
			}
			var event model.LoginLog
			if err := db.First(&event, "user_id = ?", result.Session.User.ID).Error; err != nil || event.Result != "success" || event.Method != "linuxdo" || event.IP != "192.0.2.11" {
				t.Fatalf("OAuth invitation lost login context: %+v %v", event, err)
			}
			wantSource := "registration"
			if tc.existing {
				wantSource = "login"
			}
			if event.Source != wantSource {
				t.Fatalf("OAuth source=%q want=%q", event.Source, wantSource)
			}
		})
	}
}
