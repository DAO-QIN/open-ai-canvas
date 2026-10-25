import { expect, test } from "bun:test";

test("password recovery lives in the auth modal and keeps the legacy route", async () => {
    const [loginSource, recoverySource, routerSource, authAPISource, emailSettingsSource] = await Promise.all([
        Bun.file(new URL("../src/components/auth/auth-modal-login.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/auth/auth-modal-forgot.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/router.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/auth.ts", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/email-settings-panel.tsx", import.meta.url)).text(),
    ]);

    expect(loginSource).toContain('aria-label="密码"');
    expect(loginSource).toContain("忘记密码？");
    expect(loginSource).toContain('context.switchView("forgot")');
    expect(routerSource).toContain('{ path: "/forgot-password", element: <AuthRouteRedirect view="forgot" />');
    expect(recoverySource).toContain("如果该邮箱已绑定可找回的账号，验证码将发送到邮箱");
    expect(recoverySource).toContain('autoComplete="one-time-code"');
    expect(recoverySource).toContain('autoComplete="new-password"');
    expect(recoverySource).toContain('context.switchView("login", { account: email.trim() })');
    expect(authAPISource).toContain('http.post<{ sent: boolean }>("/auth/password-reset-code"');
    expect(authAPISource).toContain('http.post<{ reset: boolean }>("/auth/password-reset"');
    expect(emailSettingsSource).toContain("发送注册与密码找回验证码");
});

test("legacy auth routes open the modal and keep next, invite and OAuth error parameters", async () => {
    const [routerSource, redirectSource] = await Promise.all([
        Bun.file(new URL("../src/router.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/auth/auth-route-redirect.tsx", import.meta.url)).text(),
    ]);
    expect(routerSource).toContain('{ path: "/login", element: <AuthRouteRedirect view="login" />');
    expect(routerSource).toContain('{ path: "/register", element: <AuthRouteRedirect view="register" />');
    expect(routerSource).not.toContain("pages/auth/");
    expect(redirectSource).toContain('safeNextPath(params.get("next"))');
    expect(redirectSource).toContain('params.get("inviteCode")');
    expect(redirectSource).toContain('params.get("oauth_error")');
});
