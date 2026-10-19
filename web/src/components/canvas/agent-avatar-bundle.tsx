import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { agentAvatarClipForState, agentAvatarStateForRunStatus, isAgentAvatarBundleManifest, type AgentAvatarBundleManifest, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL } from "@/services/api/appearance";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { FluidOrb } from "@/components/ui/fluid-orb";

export function AgentAvatarBundle({
    appearance,
    height,
    status = "idle",
    preview = false,
    paused = false,
    reducedMotion = false,
    onReady,
    onError,
}: {
    appearance: CanvasAppearance;
    height: number;
    status?: string;
    preview?: boolean;
    paused?: boolean;
    reducedMotion?: boolean;
    onReady?: () => void;
    onError?: (error: string) => void;
}) {
    const revision = useAppearanceStore((s) => s.appearance.revision);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    const url = appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, "avatar.json", preview, revision) : "/doll/avatar.json";
    const [loaded, setLoaded] = useState<{ url: string; manifest: AgentAvatarBundleManifest | null } | null>(null);
    const [failedURL, setFailedURL] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch(url, { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`无法读取动画包（HTTP ${response.status}）`);
                const manifest: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(manifest)) throw new Error("动画包格式无效");
                if (!controller.signal.aborted) setLoaded({ url, manifest });
            } catch (cause) {
                if (!controller.signal.aborted) {
                    setLoaded({ url, manifest: null });
                    callbacks.current.onError?.(cause instanceof Error ? cause.message : "动画加载失败");
                }
            }
        })();
        return () => controller.abort();
    }, [url]);
    const manifest = loaded?.url === url ? loaded.manifest : null;
    const state = agentAvatarStateForRunStatus(status);
    const clip = manifest ? agentAvatarClipForState(appearance, state, manifest) : "";
    const file = manifest?.clips[clip];
    const src = file ? (appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, file, preview, revision) : `/doll/${encodeURIComponent(file)}`) : "";
    const loading = loaded?.url !== url;
    return (
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative", width: height, height }}>
            {loading ? (
                <span role="status" aria-busy="true">
                    <LoaderCircle className={reducedMotion ? "size-6" : "size-6 motion-safe:animate-spin"} />
                    <span className="sr-only">正在加载助手形象</span>
                </span>
            ) : src && failedURL !== src ? (
                <AgentAvatarVideo
                    src={src}
                    paused={paused}
                    reducedMotion={reducedMotion}
                    loop={!["completed", "failed", "cancelled", "rejected"].includes(state)}
                    onReady={() => callbacks.current.onReady?.()}
                    onError={() => {
                        setFailedURL(src);
                        callbacks.current.onError?.("动画播放失败");
                    }}
                />
            ) : (
                <FluidOrb size={Math.min(60, height)} />
            )}
        </span>
    );
}
