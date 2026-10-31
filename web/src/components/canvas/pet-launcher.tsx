import { type CSSProperties, useEffect, useState } from "react";
import { motion } from "motion/react";
import { LoaderCircle, Maximize2, Minus } from "lucide-react";
import { useLocation } from "react-router";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { agentAvatarClipForState, agentAvatarStateForRunStatus, assistantAppearance, DEFAULT_CANVAS_APPEARANCE, isAgentAvatarBundleManifest, type AgentAvatarBundleManifest } from "@/lib/canvas/agent-appearance";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { Live2DAvatar } from "./live2d-avatar";
import { agentAvatarBundleFileURL, live2DModelURL } from "@/services/api/appearance";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { AgentMoon } from "./agent-moon";
import { useAgentLauncherPosition } from "./use-agent-launcher-position";
import { layoutViewport } from "@/lib/ui-scale";
import { hasWorkspaceShellChrome, isCanvasEditorPath } from "@/lib/workspace-routes";

export function AgentLauncher({
    theme,
    statusColor,
    approvalPending,
    reducedMotion,
    status,
    hidden = false,
    onOpen,
}: {
    theme: CanvasTheme;
    statusColor: string;
    approvalPending: boolean;
    reducedMotion: boolean;
    status: string;
    hidden?: boolean;
    onOpen: () => void;
}) {
    const appearance = assistantAppearance(useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE);
    const appearanceResolved = useAppearanceStore((state) => state.resolved);
    const appearanceRevision = useAppearanceStore((state) => state.appearance.revision);
    const live = appearance.avatarType === "live2d" && Boolean(appearance.live2dResourceId && appearance.live2dEntry);
    const moon = appearance.avatarType === "moon";
    const avatarState = agentAvatarStateForRunStatus(status);
    const compact = useMediaQuery("(max-width: 720px)");
    // 满月没有底座，本身就是图标：桌面 84px，窄屏 68px。
    const moonSize = compact ? 68 : 84;
    const bundleManifestURL = appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, "avatar.json", false, appearanceRevision) : "/doll/avatar.json";
    const [bundleManifestState, setBundleManifestState] = useState<{ url: string; manifest: AgentAvatarBundleManifest | null } | null>(null);
    useEffect(() => {
        if (appearance.avatarType !== "bundle") {
            setBundleManifestState(null);
            return;
        }
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch(bundleManifestURL, { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`无法读取 Agent 动画包（HTTP ${response.status}）`);
                const manifest: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(manifest)) throw new Error("avatar.json 格式无效");
                setBundleManifestState({ url: bundleManifestURL, manifest });
            } catch {
                if (!controller.signal.aborted) setBundleManifestState({ url: bundleManifestURL, manifest: null });
            }
        })();
        return () => controller.abort();
    }, [appearance.avatarType, bundleManifestURL]);
    const currentBundleManifestState = bundleManifestState?.url === bundleManifestURL ? bundleManifestState : null;
    const bundleManifest = currentBundleManifestState?.manifest ?? null;
    const bundleManifestLoading = appearance.avatarType === "bundle" && currentBundleManifestState === null;
    const clip = bundleManifest ? agentAvatarClipForState(appearance, avatarState, bundleManifest) : "";
    const clipFile = bundleManifest?.clips[clip] || "";
    const mediaURL = appearance.avatarType === "bundle" && clipFile ? (appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, clipFile, false, appearanceRevision) : `/doll/${encodeURIComponent(clipFile)}`) : "";
    const [mediaError, setMediaError] = useState(false);
    useEffect(() => setMediaError(false), [mediaURL]);
    const [live2DError, setLive2DError] = useState("");
    // 工作台跟随桌面端整体缩放，视口按样式像素算。
    const [viewport, setViewport] = useState(layoutViewport);
    useEffect(() => {
        const resize = () => setViewport(layoutViewport());
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    const [collapsed, setCollapsed] = useState(readAgentLauncherCollapsed);
    const toggleCollapsed = () => {
        const next = !collapsed;
        setCollapsed(next);
        try {
            if (next) localStorage.setItem(AGENT_LAUNCHER_COLLAPSED_KEY, "1");
            else localStorage.removeItem(AGENT_LAUNCHER_COLLAPSED_KEY);
        } catch (error) {
            console.warn("Agent 形象收起状态无法保存", error);
        }
    };
    const media = Boolean(mediaURL && !mediaError);
    const aspectRatio = live ? 0.75 : bundleManifest ? bundleManifest.width / bundleManifest.height : appearance.avatarType === "bundle" ? 480 / 432 : 1;
    const largeAvatar = live || media || bundleManifestLoading;
    // 收起后只留小圆球入口：不加载 Live2D / 动画，也不挡画布。位置以右下角为锚点，收起展开不跳位。
    const keepsAvatarSize = largeAvatar && !collapsed;
    const idleSize = moon ? moonSize : 76;
    const height = collapsed ? AGENT_LAUNCHER_COLLAPSED_SIZE : keepsAvatarSize ? Math.max(40, Math.min(compact ? Math.min(appearance.avatarHeight, 96) : appearance.avatarHeight, viewport.height - 60, (viewport.width - 40) / aspectRatio)) : idleSize;
    const width = collapsed ? AGENT_LAUNCHER_COLLAPSED_SIZE : keepsAvatarSize ? Math.round(height * aspectRatio) : idleSize;
    // 手机上把入口（连同下方的名称标签）抬到底部导航（工作台页面）或画布底部工具条（画布编辑器，
    // 58px 高、离底 12px）上方，并加上 iPhone 底部安全区；后台没有底部栏，入口贴底。
    const { pathname } = useLocation();
    const bottomInset = compact && (hasWorkspaceShellChrome(pathname) || isCanvasEditorPath(pathname)) ? 72 : 0;
    const { position, dragging, handlers } = useAgentLauncherPosition(onOpen, width, height + bottomInset);
    const bottomOffset = (extra: number) => (bottomInset ? `calc(${position.bottom + bottomInset + extra}px + env(safe-area-inset-bottom, 0px))` : position.bottom + extra);
    const showToggle = !hidden && (largeAvatar || collapsed);
    return (
        <>
            <motion.button
                type="button"
                aria-label={`打开${appearance.agentName}`}
                title={live && live2DError ? live2DError : `${approvalPending ? "Agent 等待你的审批" : "打开 Agent 助手"} · 拖动可调整位置，聚焦后可用方向键移动`}
                className={cn(
                    "canvas-agent-launcher fixed z-[calc(var(--z-toast)+1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35",
                    dragging && "is-dragging",
                    collapsed && "is-collapsed",
                    keepsAvatarSize && live && "canvas-agent-launcher-live2d",
                    keepsAvatarSize && media && "canvas-agent-launcher-media",
                    moon && "canvas-agent-launcher-moon",
                )}
                style={{ ...position, bottom: bottomOffset(0), width, height, color: theme.node.text, "--canvas-agent-launcher-shadow": theme.spatial.shadow, ...(hidden ? { display: "none" } : null) } as CSSProperties}
                aria-hidden={hidden || undefined}
                tabIndex={hidden ? -1 : undefined}
                data-canvas-no-zoom
                onDragStart={(event) => event.preventDefault()}
                {...handlers}
                whileHover={reducedMotion || dragging ? undefined : { scale: 1.035 }}
                whileTap={reducedMotion || dragging ? undefined : { scale: 0.96 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
            >
                {collapsed ? (
                    moon ? (
                        <AgentMoon size={40} state={avatarState} reducedMotion={reducedMotion} paused={hidden} />
                    ) : (
                        <FluidOrb size={30} color="#7164f6" />
                    )
                ) : live ? (
                    <Live2DAvatar
                        url={live2DModelURL(appearance.live2dResourceId, appearance.live2dEntry)}
                        width={width}
                        height={height}
                        reducedMotion={reducedMotion}
                        fallback={<FluidOrb size={60} color="#7164f6" />}
                        onReady={() => setLive2DError("")}
                        onError={setLive2DError}
                    />
                ) : mediaURL && !mediaError ? (
                    <AgentAvatarVideo src={mediaURL} paused={hidden} reducedMotion={reducedMotion} loop={!["completed", "failed", "cancelled", "rejected"].includes(avatarState)} onError={() => setMediaError(true)} />
                ) : bundleManifestLoading || !appearanceResolved ? (
                    <span role="status" aria-busy="true">
                        <LoaderCircle className={reducedMotion ? "size-6" : "size-6 motion-safe:animate-spin"} aria-hidden="true" />
                        <span className="sr-only">正在加载助手形象</span>
                    </span>
                ) : moon ? (
                    <AgentMoon size={moonSize} state={avatarState} reducedMotion={reducedMotion} paused={hidden} />
                ) : (
                    <FluidOrb size={60} color="#7164f6" />
                )}
                {appearance.launcherLabel && !collapsed ? <span className="canvas-agent-launcher-label">{appearance.launcherLabel}</span> : null}
                {live && live2DError ? (
                    <span className="sr-only" role="status">
                        {live2DError}
                    </span>
                ) : null}
                <span className={cn("canvas-agent-launcher-status", approvalPending && "is-pending")} style={{ "--canvas-agent-status-color": statusColor } as CSSProperties} />
                {approvalPending ? <span className="canvas-agent-launcher-badge">待审批</span> : null}
            </motion.button>
            {showToggle ? (
                <button
                    type="button"
                    className="canvas-agent-launcher-toggle fixed z-[calc(var(--z-toast)+2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35"
                    style={{ right: position.right + width - 14, bottom: bottomOffset(height - 14), color: theme.node.text } as CSSProperties}
                    aria-label={collapsed ? `展开${appearance.agentName}形象` : `收起${appearance.agentName}形象`}
                    aria-pressed={collapsed}
                    title={collapsed ? "展开形象" : "收起形象，只保留小入口"}
                    data-canvas-no-zoom
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapsed();
                    }}
                >
                    {collapsed ? <Maximize2 className="size-3" aria-hidden="true" /> : <Minus className="size-3" aria-hidden="true" />}
                </button>
            ) : null}
        </>
    );
}

const AGENT_LAUNCHER_COLLAPSED_KEY = "canvas:agent-launcher-collapsed:v1";
const AGENT_LAUNCHER_COLLAPSED_SIZE = 48;

function readAgentLauncherCollapsed() {
    try {
        return localStorage.getItem(AGENT_LAUNCHER_COLLAPSED_KEY) === "1";
    } catch {
        return false;
    }
}

