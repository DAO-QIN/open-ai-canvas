import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { App, Button, Input, Modal } from "antd";
import { useReducedMotion } from "motion/react";
import { ArrowRight, FileText, KeyRound, LockKeyhole, Mail, MessageSquareText, UserPlus, UserRound, X } from "lucide-react";
import { Link, useLocation } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { BrandLogo } from "@/components/brand/brand-logo";
import { LinuxDOIcon } from "@/components/auth/linuxdo-icon";
import { VerificationFields } from "@/components/auth/verification-fields";
import { splitAgreementParagraph } from "@/lib/agreement-text";
import { curatedInspirations, type CreationInspiration } from "@/lib/inspirations/catalog";
import { getAuthSession, getAuthSettings, linuxDOLoginURL, login } from "@/services/api/auth";
import { emptyVerification, loginVerification, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useLoginModalStore } from "@/stores/use-login-modal-store";
import "./login-modal.css";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;
type LoginMethod = "password" | VerificationMethod;

const SLIDE_INTERVAL_MS = 5200;
const MODE_LABELS: Record<CreationInspiration["mode"], string> = { video: "视频", image: "图片", text: "文本" };
const METHOD_META: Record<LoginMethod, { label: string; icon: ReactNode }> = {
    password: { label: "密码登录", icon: <KeyRound className="size-[18px]" /> },
    sms: { label: "手机号登录", icon: <MessageSquareText className="size-[18px]" /> },
    email: { label: "邮箱验证码", icon: <Mail className="size-[18px]" /> },
    sms_email: { label: "双重验证", icon: <LockKeyhole className="size-[18px]" /> },
};

// 左侧展示只用打包在前端的原创作品封面：不依赖网络，弹窗打开即有画面。
const SHOWCASE = curatedInspirations.filter((item) => item.image.startsWith("/")).slice(0, 8);

/** 全站唯一的登录弹窗，由 openLoginModal() 打开；挂在用户工作台布局里。 */
export function LoginModal() {
    const open = useLoginModalStore((state) => state.open);
    const close = useLoginModalStore((state) => state.close);
    return (
        <AppModal
            open={open}
            onCancel={close}
            footer={null}
            centered
            flush
            closable={false}
            width="min(1000px, calc(100vw - 24px))"
            rootClassName="login-modal-root"
            className="login-modal"
            aria-label="登录"
        >
            {open ? <LoginModalContent onClose={close} /> : null}
        </AppModal>
    );
}

function LoginModalContent({ onClose }: { onClose: () => void }) {
    const { message } = App.useApp();
    const location = useLocation();
    const request = useLoginModalStore((state) => state.request);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const [settings, setSettings] = useState<AuthSettings | null>(null);
    const [method, setMethod] = useState<LoginMethod>("password");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [submitting, setSubmitting] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const next = location.pathname.startsWith("/login") ? "/" : location.pathname + location.search;
    const nextQuery = `next=${encodeURIComponent(next)}`;

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((value) => {
                if (!cancelled) setSettings(value);
            })
            .catch((error) => {
                // 读取失败时只保留账号密码登录，不展示任何未确认开启的入口。
                console.warn("读取登录方式配置失败，仅保留账号密码登录", error);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const codeMethods = useMemo(() => (settings ? verificationMethods(settings, "login") : []), [settings]);
    const methods: LoginMethod[] = ["password", ...codeMethods];

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
            const onSuccess = request.onSuccess;
            onClose();
            onSuccess?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    const agreementTitle = settings ? ((settings.agreementTitle || "").trim() || `${brandName}服务协议`).replace(/^《|》$/g, "") : "";
    const agreementParagraphs = (settings?.agreementContent || "").trim().split(/\n\s*\n/).filter(Boolean);

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
                  <a key="linuxdo" className="login-modal-alt" href={linuxDOLoginURL(next)}>
                      <span className="login-modal-alt-icon"><LinuxDOIcon /></span>
                      Linux.do
                  </a>,
              ]
            : []),
        ...(settings?.registrationEnabled !== false
            ? [
                  <Link key="register" className="login-modal-alt" to={`/register?${nextQuery}`} onClick={onClose}>
                      <span className="login-modal-alt-icon"><UserPlus className="size-[18px]" /></span>
                      注册账号
                  </Link>,
              ]
            : []),
    ];
    if (alternatives.length === 0 && !settings?.linuxdoEnabled) {
        footerItems.push(
            <Link key="forgot" className="login-modal-alt" to={`/forgot-password?${nextQuery}`} onClick={onClose}>
                <span className="login-modal-alt-icon"><LockKeyhole className="size-[18px]" /></span>
                找回密码
            </Link>,
        );
    }

    return (
        <div className="login-modal-shell">
            <LoginShowcase brandName={brandName} />
            <section className="login-modal-pane">
                <button type="button" className="login-modal-close" aria-label="关闭" onClick={onClose}>
                    <X className="size-4" />
                </button>
                <div className="login-modal-main">
                    <div className="login-modal-brand">
                        <BrandLogo className="size-7" alt="" fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />} />
                        <span>{brandName}</span>
                    </div>
                    <h2 className="login-modal-title">{request.title || (method === "password" ? "登录开启创作" : METHOD_META[method].label)}</h2>
                    <p className="login-modal-subtitle">{request.description || "画布、素材与生成记录都会保存在你的账号里"}</p>

                    <form className="login-modal-form" onSubmit={(event) => void submit(event)}>
                        {method === "password" ? (
                            <>
                                <Input size="large" aria-label="用户名或邮箱" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" autoFocus required />
                                <Input.Password size="large" aria-label="密码" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" required />
                                <div className="login-modal-row">
                                    <Link to={`/forgot-password?${nextQuery}`} onClick={onClose} className="login-modal-link">
                                        忘记密码？
                                    </Link>
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
                            <button type="button" onClick={() => setAgreementOpen(true)}>
                                《{agreementTitle}》
                            </button>
                        </p>
                    ) : null}
                </div>

                {footerItems.length > 0 ? (
                    <nav className="login-modal-alts" aria-label="其他方式" style={{ gridTemplateColumns: `repeat(${Math.min(footerItems.length, 4)}, minmax(0, 1fr))` }}>
                        {footerItems.slice(0, 4)}
                    </nav>
                ) : null}
            </section>

            <Modal className="workspace-modal workspace-modal-compact auth-agreement-modal" title={agreementTitle} open={agreementOpen} onCancel={() => setAgreementOpen(false)} footer={null} destroyOnHidden>
                {agreementParagraphs.length === 0 ? (
                    <div className="auth-agreement-empty">
                        <FileText className="size-3.5 shrink-0" aria-hidden />
                        服务协议内容待补充，请联系管理员在后台「登录与注册」中完善。
                    </div>
                ) : (
                    <div className="auth-agreement-body">
                        {agreementParagraphs.flatMap((paragraph, index) =>
                            splitAgreementParagraph(paragraph).map((block, blockIndex) => (
                                <p key={`agreement-${index}-${blockIndex}`} data-role={block.heading ? "heading" : undefined}>
                                    {block.text}
                                </p>
                            )),
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}

function LoginShowcase({ brandName }: { brandName: string }) {
    const reducedMotion = useReducedMotion();
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        if (reducedMotion || paused || SHOWCASE.length < 2) return;
        const timer = window.setTimeout(() => setIndex((value) => (value + 1) % SHOWCASE.length), SLIDE_INTERVAL_MS);
        return () => window.clearTimeout(timer);
    }, [index, paused, reducedMotion]);

    const current = SHOWCASE[index];
    return (
        <aside className="login-modal-showcase" aria-label={`${brandName}热门作品`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            {SHOWCASE.map((item, itemIndex) => (
                <img key={item.image} src={item.image} alt="" decoding="async" loading={itemIndex === 0 ? "eager" : "lazy"} className="login-modal-slide" data-active={itemIndex === index ? "true" : "false"} data-motion={reducedMotion ? "off" : "on"} />
            ))}
            <div aria-hidden className="login-modal-showcase-shade" />
            {current ? (
                <div className="login-modal-showcase-copy">
                    <span className="login-modal-chip">{MODE_LABELS[current.mode] ?? "作品"}</span>
                    <h3 key={current.title}>{brandName} 热门作品</h3>
                    <p>
                        <span>{current.title}</span>
                        <span className="login-modal-divider" aria-hidden />
                        <span>登录开启你的创意大片</span>
                    </p>
                    {SHOWCASE.length > 1 ? (
                        <div className="login-modal-dots" role="tablist" aria-label="切换作品">
                            {SHOWCASE.map((item, itemIndex) => (
                                <button key={item.image} type="button" role="tab" aria-selected={itemIndex === index} aria-label={item.title} data-active={itemIndex === index ? "true" : "false"} onClick={() => setIndex(itemIndex)} />
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </aside>
    );
}
