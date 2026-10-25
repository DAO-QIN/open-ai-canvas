import { useState, type FormEvent, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, KeyRound, LockKeyhole, Mail, MessageSquareText, UserPlus, UserRound } from "lucide-react";

import { LinuxDOIcon } from "@/components/auth/linuxdo-icon";
import { VerificationFields } from "@/components/auth/verification-fields";
import { getAuthSession, linuxDOLoginURL, login } from "@/services/api/auth";
import { emptyVerification, loginVerification, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import type { AuthViewContext } from "./login-modal";

type LoginMethod = "password" | VerificationMethod;

const METHOD_META: Record<LoginMethod, { label: string; title: string; icon: ReactNode }> = {
    password: { label: "密码登录", title: "登录开启创作", icon: <KeyRound className="size-[18px]" /> },
    sms: { label: "手机号登录", title: "手机号登录", icon: <MessageSquareText className="size-[18px]" /> },
    email: { label: "邮箱验证码", title: "邮箱验证码登录", icon: <Mail className="size-[18px]" /> },
    sms_email: { label: "双重验证", title: "双重验证登录", icon: <LockKeyhole className="size-[18px]" /> },
};

export function AuthLoginView({ context, title, description }: { context: AuthViewContext; title?: string; description?: string }) {
    const { message } = App.useApp();
    const { settings } = context;
    const [method, setMethod] = useState<LoginMethod>("password");
    const [username, setUsername] = useState(context.prefillAccount);
    const [password, setPassword] = useState("");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [submitting, setSubmitting] = useState(false);

    const methods: LoginMethod[] = ["password", ...(settings ? verificationMethods(settings, "login") : [])];

    const switchMethod = (value: LoginMethod) => {
        setMethod(value);
        setVerification({ ...emptyVerification });
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            if (method === "password") await login({ username: username.trim(), password });
            else {
                if (!verification.ticket) throw new Error("请先获取本次登录验证码");
                await loginVerification(verification);
            }
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success("登录成功，欢迎回来");
            context.finish();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    // 底部入口只放后台真实开启的方式；没有其他登录方式时放注册与找回密码。
    const alternatives = methods.filter((value) => value !== method);
    const footerItems: ReactNode[] = [
        ...alternatives.map((value) => (
            <button key={value} type="button" className="login-modal-alt" onClick={() => switchMethod(value)} disabled={submitting}>
                <span className="login-modal-alt-icon">{METHOD_META[value].icon}</span>
                {METHOD_META[value].label}
            </button>
        )),
        ...(settings?.linuxdoEnabled
            ? [
                  <a key="linuxdo" className="login-modal-alt" href={linuxDOLoginURL(context.nextPath)}>
                      <span className="login-modal-alt-icon">
                          <LinuxDOIcon />
                      </span>
                      Linux.do
                  </a>,
              ]
            : []),
        ...(settings?.registrationEnabled !== false
            ? [
                  <button key="register" type="button" className="login-modal-alt" onClick={() => context.switchView("register")} disabled={submitting}>
                      <span className="login-modal-alt-icon">
                          <UserPlus className="size-[18px]" />
                      </span>
                      注册账号
                  </button>,
              ]
            : []),
    ];
    if (alternatives.length === 0 && !settings?.linuxdoEnabled) {
        footerItems.push(
            <button key="forgot" type="button" className="login-modal-alt" onClick={() => context.switchView("forgot")} disabled={submitting}>
                <span className="login-modal-alt-icon">
                    <LockKeyhole className="size-[18px]" />
                </span>
                找回密码
            </button>,
        );
    }
    const visibleFooter = footerItems.slice(0, 4);

    return (
        <>
            <div className="login-modal-main">
                <h2 className="login-modal-title">{title && method === "password" ? title : METHOD_META[method].title}</h2>
                <p className="login-modal-subtitle">{description || "画布、素材与生成记录都会保存在你的账号里"}</p>

                <form className="login-modal-form" onSubmit={(event) => void submit(event)}>
                    {method === "password" ? (
                        <>
                            <Input size="large" aria-label="用户名或邮箱" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" autoFocus={!username} required />
                            <Input.Password size="large" aria-label="密码" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" autoFocus={Boolean(username)} required />
                            <div className="login-modal-row">
                                <button type="button" className="login-modal-link" onClick={() => context.switchView("forgot")}>
                                    忘记密码？
                                </button>
                            </div>
                        </>
                    ) : (
                        <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} />
                    )}
                    <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="login-modal-submit">
                        登录
                    </Button>
                </form>

                {settings ? (
                    <p className="login-modal-terms">
                        继续即表示你同意
                        <button type="button" onClick={context.openAgreement}>
                            《{context.agreementTitle}》
                        </button>
                    </p>
                ) : null}
            </div>

            {visibleFooter.length > 0 ? (
                <nav className="login-modal-alts" aria-label="其他方式" style={{ gridTemplateColumns: `repeat(${visibleFooter.length}, minmax(0, 1fr))` }}>
                    {visibleFooter}
                </nav>
            ) : null}
        </>
    );
}
