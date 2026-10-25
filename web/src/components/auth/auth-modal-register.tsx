import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { App, Button, Checkbox, Input, Segmented } from "antd";
import { ArrowRight, Info, LockKeyhole, Mail, Ticket, TriangleAlert, UserRound } from "lucide-react";

import { LinuxDOIcon } from "@/components/auth/linuxdo-icon";
import { VerificationFields } from "@/components/auth/verification-fields";
import { getAuthSession, linuxDOLoginURL, register } from "@/services/api/auth";
import { validateInviteCode } from "@/services/api/promotion";
import { ApiError } from "@/services/api/request";
import { emptyVerification, methodLabels, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import type { AuthViewContext } from "./login-modal";

export function AuthRegisterView({ context }: { context: AuthViewContext }) {
    const { message } = App.useApp();
    const { settings, settingsFailed } = context;
    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [inviteCode, setInviteCode] = useState(context.inviteCode);
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [method, setMethod] = useState<VerificationMethod>("email");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const registering = useRef(false);

    const methods = settings ? verificationMethods(settings, "register") : [];
    const firstUser = Boolean(settings?.firstUser);
    const registrationClosed = settings?.registrationEnabled === false;
    const verificationUnavailable = Boolean(settings && !firstUser && methods.length === 0);
    const disabled = !settings || registrationClosed || verificationUnavailable;

    useEffect(() => {
        if (settings) setMethod(verificationMethods(settings, "register")[0] ?? "email");
    }, [settings]);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (registering.current || countdown > 0) return;
        if (!agreementAccepted) {
            message.warning(`请先阅读并同意《${context.agreementTitle}》`);
            return;
        }
        if (password !== confirmPassword) {
            message.error("两次输入的密码不一致");
            return;
        }
        registering.current = true;
        setSubmitting(true);
        try {
            if (!firstUser && !verification.ticket) throw new Error("请先获取本次注册验证码");
            const code = firstUser ? "" : inviteCode.trim().toUpperCase();
            if (code && !(await validateInviteCode(code)).valid) throw new Error("邀请码无效或推广已暂停，请清除或更换邀请码后重试");
            await register({ username, ...(firstUser ? { email } : verification), displayName, password, acceptedTerms: agreementAccepted, inviteCode: code || undefined });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            if (!firstUser) window.sessionStorage.setItem("yingce:model-setup-guide", "1");
            message.success(firstUser ? "管理员账号已创建" : "注册成功，欢迎加入");
            context.finish();
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : "注册失败");
        } finally {
            registering.current = false;
            setSubmitting(false);
        }
    };

    return (
        <div className="login-modal-main" data-dense="true">
            <h2 className="login-modal-title">{firstUser ? "创建管理员账号" : "注册账号"}</h2>
            <p className="login-modal-subtitle">{firstUser ? "首个账号自动成为管理员" : `加入${context.brandName}，开始你的创作`}</p>

            <form className="login-modal-form" onSubmit={(event) => void submit(event)}>
                {firstUser ? <Notice icon={<Info className="size-3.5" />} tone="blue">首个账号自动成为管理员，邮箱验证码暂不要求。</Notice> : null}
                {registrationClosed ? <Notice icon={<TriangleAlert className="size-3.5" />}>当前已关闭普通注册，请联系管理员创建账号。</Notice> : null}
                {verificationUnavailable ? <Notice icon={<TriangleAlert className="size-3.5" />}>当前没有可用的注册验证方式，请联系管理员检查短信及邮件配置。</Notice> : null}
                {settingsFailed ? (
                    <Notice icon={<TriangleAlert className="size-3.5" />}>
                        <span>
                            读取注册设置失败，暂时无法确认服务协议名称与条款。
                            <button type="button" className="auth-scene-link ml-1" onClick={context.reloadSettings}>
                                重新读取
                            </button>
                        </span>
                    </Notice>
                ) : null}

                <div className="login-modal-pair">
                    <Input size="large" aria-label="用户名" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名（3-32 位）" autoComplete="username" autoFocus required disabled={disabled} />
                    <Input size="large" aria-label="显示名称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称（选填）" disabled={disabled} />
                </div>

                {firstUser ? (
                    <Input size="large" aria-label="邮箱（可选）" prefix={<Mail className="auth-scene-icon size-4" />} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱（选填，用于登录与安全验证）" autoComplete="email" disabled={disabled} />
                ) : (
                    <>
                        {methods.length > 1 ? (
                            <Segmented
                                block
                                aria-label="注册验证方式"
                                options={methods.map((value) => ({ value, label: methodLabels[value] }))}
                                value={method}
                                disabled={submitting}
                                onChange={(value) => {
                                    setMethod(value as VerificationMethod);
                                    setVerification({ ...emptyVerification });
                                }}
                            />
                        ) : null}
                        {methods.length > 0 ? <VerificationFields key={method} purpose="register" method={method} value={verification} onChange={setVerification} disabled={disabled || submitting} /> : null}
                    </>
                )}

                <div className="login-modal-pair">
                    <Input.Password size="large" aria-label="密码" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码（≥8 位）" autoComplete="new-password" required disabled={disabled} />
                    <Input.Password size="large" aria-label="确认密码" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="确认密码" autoComplete="new-password" required disabled={disabled} />
                </div>

                {!firstUser ? (
                    <Input size="large" aria-label="邀请码（选填）" prefix={<Ticket className="auth-scene-icon size-4" />} value={inviteCode} maxLength={16} disabled={submitting} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="邀请码（选填，绑定后不可更换）" allowClear />
                ) : null}

                {settings ? (
                    <div className="auth-agreement-row" data-accepted={agreementAccepted ? "true" : "false"}>
                        <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                            <span className="auth-agreement-label">我已阅读并同意</span>
                        </Checkbox>
                        <button type="button" className="auth-agreement-link" onClick={context.openAgreement}>
                            《{context.agreementTitle}》
                        </button>
                    </div>
                ) : null}

                <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled || countdown > 0 || !agreementAccepted} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="login-modal-submit">
                    {countdown > 0 ? `${countdown} 秒后可重试` : firstUser ? "创建管理员账号" : "注册并开始创作"}
                </Button>
                {settings?.linuxdoEnabled && !settings.smsAndEmailRegistration ? (
                    <Button size="large" block disabled={!agreementAccepted} icon={<LinuxDOIcon />} href={agreementAccepted ? linuxDOLoginURL(context.nextPath, true, inviteCode) : undefined}>
                        使用 Linux.do 注册 / 登录
                    </Button>
                ) : null}
            </form>

            <p className="login-modal-switch">
                已有账号？
                <button type="button" onClick={() => context.switchView("login")}>
                    去登录
                </button>
            </p>
        </div>
    );
}

export function Notice({ icon, tone = "amber", children }: { icon: ReactNode; tone?: "blue" | "amber"; children: ReactNode }) {
    return (
        <div data-tone={tone} className="auth-scene-notice flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}
