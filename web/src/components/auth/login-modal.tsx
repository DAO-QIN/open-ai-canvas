import { useCallback, useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { useReducedMotion } from "motion/react";
import { FileText, Play, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import { splitAgreementParagraph } from "@/lib/agreement-text";
import { curatedInspirations } from "@/lib/inspirations/catalog";
import { getAuthSettings } from "@/services/api/auth";
import { brandStudioLabel, useAppearanceStore } from "@/stores/use-appearance-store";
import { safeNextPath, useLoginModalStore, type AuthModalView } from "@/stores/use-login-modal-store";
import { AuthLoginView } from "./auth-modal-login";
import { AuthRegisterView } from "./auth-modal-register";
import { AuthForgotView } from "./auth-modal-forgot";
import "./login-modal.css";

export type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

/** 三个视图共用的上下文：后台登录配置、切换视图、成功收尾和协议弹窗。 */
export type AuthViewContext = {
    settings: AuthSettings | null;
    settingsFailed: boolean;
    reloadSettings: () => void;
    brandName: string;
    agreementTitle: string;
    openAgreement: () => void;
    switchView: (view: AuthModalView, prefill?: { account?: string }) => void;
    finish: (afterClose?: () => void) => void;
    nextPath: string;
    prefillAccount: string;
    inviteCode: string;
};

const SLIDE_INTERVAL_MS = 5200;
// 影片不可用时的兜底展示：只用打包在前端的原创作品封面，不依赖网络。
const SHOWCASE = curatedInspirations.filter((item) => item.image.startsWith("/")).slice(0, 8);

/** 全站唯一的登录 / 注册 / 找回密码弹窗，由 openLoginModal() 打开；挂在用户工作台布局里。 */
export function LoginModal() {
    const open = useLoginModalStore((state) => state.open);
    const close = useLoginModalStore((state) => state.close);
    return (
        <AppModal open={open} onCancel={close} footer={null} centered flush closable={false} width="min(1000px, calc(100vw - 24px))" rootClassName="login-modal-root" className="login-modal" aria-label="登录或注册">
            {open ? <LoginModalContent onClose={close} /> : null}
        </AppModal>
    );
}

function LoginModalContent({ onClose }: { onClose: () => void }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const request = useLoginModalStore((state) => state.request);
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "平台";
    const [view, setView] = useState<AuthModalView>(request.view ?? "login");
    const [prefillAccount, setPrefillAccount] = useState("");
    const [settings, setSettings] = useState<AuthSettings | null>(null);
    const [settingsFailed, setSettingsFailed] = useState(false);
    const [settingsReloadKey, setSettingsReloadKey] = useState(0);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const shownError = useRef(false);
    const currentPath = location.pathname + location.search;
    const nextPath = request.next ? safeNextPath(request.next) : currentPath;

    useEffect(() => {
        let cancelled = false;
        setSettingsFailed(false);
        void getAuthSettings()
            .then((value) => {
                if (!cancelled) setSettings(value);
            })
            .catch((error) => {
                // 读取失败时只保留账号密码登录，不展示任何未确认开启的入口；
                // 注册需要协议标题和验证方式，留下失败态让用户重试。
                if (cancelled) return;
                console.warn("读取登录与注册配置失败", error);
                setSettingsFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [settingsReloadKey]);

    useEffect(() => {
        if (request.error && !shownError.current) {
            shownError.current = true;
            message.error(request.error);
        }
    }, [message, request.error]);

    const finish = useCallback(
        (afterClose?: () => void) => {
            const onSuccess = request.onSuccess;
            onClose();
            if (request.next && safeNextPath(request.next) !== currentPath) navigate(safeNextPath(request.next), { replace: true });
            afterClose?.();
            onSuccess?.();
        },
        [currentPath, navigate, onClose, request.next, request.onSuccess],
    );

    // 协议标题只来自后台配置；只有确认拿到配置后才回退到品牌名，书名号统一由页面补齐。
    const agreementTitle = settings ? ((settings.agreementTitle || "").trim() || `${brandName}服务协议`).replace(/^《|》$/g, "") : "";
    const agreementParagraphs = (settings?.agreementContent || "").trim().split(/\n\s*\n/).filter(Boolean);

    const context: AuthViewContext = {
        settings,
        settingsFailed,
        reloadSettings: () => setSettingsReloadKey((value) => value + 1),
        brandName,
        agreementTitle,
        openAgreement: () => setAgreementOpen(true),
        switchView: (next, prefill) => {
            setPrefillAccount(prefill?.account ?? "");
            setView(next);
        },
        finish,
        nextPath,
        prefillAccount,
        inviteCode: (request.inviteCode ?? "").trim().toUpperCase(),
    };

    return (
        <div className="login-modal-shell">
            <AuthShowcase />
            <section className="login-modal-pane" data-view={view}>
                <button type="button" className="login-modal-close" aria-label="关闭" onClick={onClose}>
                    <X className="size-4" />
                </button>
                <div className="login-modal-brand">
                    <BrandLogo className="size-7" alt="" fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />} />
                    <BrandWordmark name={brandName} />
                </div>
                {view === "login" ? <AuthLoginView key="login" context={context} title={request.title} description={request.description} /> : null}
                {view === "register" ? <AuthRegisterView key="register" context={context} /> : null}
                {view === "forgot" ? <AuthForgotView key="forgot" context={context} /> : null}
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

/**
 * 左侧展示：优先播放后台「外观设置」里配置的登录影片和标题（原登录页的同一套配置）；
 * 关闭自动播放或系统要求减少动态效果时显示封面和播放按钮；影片和封面都不可用时轮播内置作品。
 */
function AuthShowcase() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const reducedMotion = useReducedMotion();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [manualPlay, setManualPlay] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [videoFailed, setVideoFailed] = useState(false);
    const [posterFailed, setPosterFailed] = useState(false);
    const videoURL = videoFailed ? "" : appearance.authVideoUrl;
    const posterURL = posterFailed ? "" : appearance.authVideoPosterUrl;
    const videoActive = Boolean(videoURL && ((appearance.authVideoAutoplay && !reducedMotion) || manualPlay));
    const useCarousel = !videoActive && !posterURL;

    useEffect(() => {
        setManualPlay(false);
        setPlaying(false);
        setVideoFailed(false);
        setPosterFailed(false);
    }, [appearance.authVideoUrl, appearance.authVideoPosterUrl, appearance.authVideoAutoplay]);

    const play = () => {
        setManualPlay(true);
        requestAnimationFrame(() => {
            void videoRef.current?.play().catch(() => setPlaying(false));
        });
    };

    return (
        <aside className="login-modal-showcase" aria-label={`${appearance.brandName}品牌影片`}>
            {videoActive ? (
                <video ref={videoRef} className="login-modal-media" src={videoURL} poster={posterURL || undefined} autoPlay muted loop playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setVideoFailed(true)} />
            ) : posterURL ? (
                <img className="login-modal-media" src={posterURL} alt="" decoding="async" onError={() => setPosterFailed(true)} />
            ) : null}
            {useCarousel ? <ShowcaseCarousel /> : null}
            <div aria-hidden className="login-modal-showcase-shade" />
            {!useCarousel && videoURL && !playing ? (
                <button type="button" className="login-modal-play" onClick={play}>
                    <Play className="size-3 fill-current" />
                    播放品牌影片
                </button>
            ) : null}
            <div className="login-modal-showcase-copy">
                <p className="login-modal-eyebrow">{brandStudioLabel(appearance)}</p>
                <h3>{appearance.authHeroTitle}</h3>
                {appearance.authHeroDescription ? <p className="login-modal-hero-desc">{appearance.authHeroDescription}</p> : null}
            </div>
        </aside>
    );
}

function ShowcaseCarousel() {
    const reducedMotion = useReducedMotion();
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (reducedMotion || SHOWCASE.length < 2) return;
        const timer = window.setTimeout(() => setIndex((value) => (value + 1) % SHOWCASE.length), SLIDE_INTERVAL_MS);
        return () => window.clearTimeout(timer);
    }, [index, reducedMotion]);

    return (
        <>
            {SHOWCASE.map((item, itemIndex) => (
                <img key={item.image} src={item.image} alt="" decoding="async" loading={itemIndex === 0 ? "eager" : "lazy"} className="login-modal-slide" data-active={itemIndex === index ? "true" : "false"} data-motion={reducedMotion ? "off" : "on"} />
            ))}
        </>
    );
}
