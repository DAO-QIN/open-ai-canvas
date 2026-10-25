import { useEffect, useState, type FormEvent } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";

import { resetPassword, sendPasswordResetEmailCode } from "@/services/api/auth";
import { Notice } from "./auth-modal-register";
import type { AuthViewContext } from "./login-modal";

type RecoveryStage = "request" | "reset";

export function AuthForgotView({ context }: { context: AuthViewContext }) {
    const { message } = App.useApp();
    const emailEnabled = context.settings ? context.settings.emailEnabled : null;
    const [stage, setStage] = useState<RecoveryStage>("request");
    const [email, setEmail] = useState(context.prefillAccount.includes("@") ? context.prefillAccount : "");
    const [emailCode, setEmailCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [countdown, setCountdown] = useState(0);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    const sendCode = async (advance: boolean) => {
        const normalizedEmail = email.trim();
        if (!normalizedEmail) {
            message.warning("请先输入邮箱");
            return;
        }
        setSendingCode(true);
        try {
            await sendPasswordResetEmailCode(normalizedEmail);
            setEmail(normalizedEmail);
            setCountdown(60);
            if (advance) setStage("reset");
            message.success("如果该邮箱已绑定可找回的账号，验证码将发送到邮箱");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发送验证码失败");
        } finally {
            setSendingCode(false);
        }
    };

    const requestCode = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void sendCode(true);
    };

    const submitReset = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (password !== confirmPassword) {
            message.error("两次输入的密码不一致");
            return;
        }
        setSubmitting(true);
        try {
            await resetPassword({ email: email.trim(), emailCode, password });
            message.success("密码已重置，请使用新密码登录");
            context.switchView("login", { account: email.trim() });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码重置失败");
        } finally {
            setSubmitting(false);
        }
    };

    const editEmail = () => {
        setStage("request");
        setEmailCode("");
        setPassword("");
        setConfirmPassword("");
        setCountdown(0);
    };

    return (
        <div className="login-modal-main">
            <h2 className="login-modal-title">找回密码</h2>
            <p className="login-modal-subtitle">{stage === "request" ? "验证账号邮箱后，设置一个新的登录密码" : `验证码已发送至 ${email}`}</p>

            {stage === "request" ? (
                <form className="login-modal-form" onSubmit={requestCode}>
                    {emailEnabled === false ? <Notice icon={<TriangleAlert className="size-3.5" />}>管理员尚未启用密码找回，请联系管理员处理。</Notice> : null}
                    <Input size="large" aria-label="账号邮箱" prefix={<Mail className="auth-scene-icon size-4" />} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入绑定邮箱" autoComplete="email" inputMode="email" autoFocus required disabled={emailEnabled === false} />
                    <Button type="primary" htmlType="submit" size="large" block loading={sendingCode} disabled={emailEnabled === false} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="login-modal-submit">
                        发送验证码
                    </Button>
                </form>
            ) : (
                <form className="login-modal-form" onSubmit={(event) => void submitReset(event)}>
                    <div className="login-modal-inline">
                        <Input size="large" aria-label="账号邮箱" prefix={<Mail className="auth-scene-icon size-4" />} value={email} readOnly autoComplete="email" />
                        <Button htmlType="button" size="large" onClick={editEmail}>
                            修改
                        </Button>
                    </div>
                    <div className="login-modal-inline">
                        <Input size="large" aria-label="邮箱验证码" prefix={<ShieldCheck className="auth-scene-icon size-4" />} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位验证码" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
                        <Button htmlType="button" size="large" loading={sendingCode} disabled={countdown > 0} onClick={() => void sendCode(false)}>
                            {countdown > 0 ? `${countdown}s` : "重新发送"}
                        </Button>
                    </div>
                    <div className="login-modal-pair">
                        <Input.Password size="large" aria-label="新密码" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="新密码（≥8 位）" autoComplete="new-password" minLength={8} required />
                        <Input.Password size="large" aria-label="确认密码" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="确认密码" autoComplete="new-password" minLength={8} required />
                    </div>
                    <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="login-modal-submit">
                        重置密码
                    </Button>
                </form>
            )}

            <p className="login-modal-switch">
                想起密码了？
                <button type="button" onClick={() => context.switchView("login", { account: email.trim() })}>
                    返回登录
                </button>
            </p>
        </div>
    );
}
