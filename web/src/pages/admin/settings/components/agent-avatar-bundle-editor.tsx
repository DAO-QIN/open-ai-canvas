import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Radio, Select } from "antd";
import { Upload } from "lucide-react";
import {
    AGENT_AVATAR_STATES,
    DEFAULT_AGENT_AVATAR_CLIP_STATES,
    agentAvatarClipForState,
    isAgentAvatarBundleManifest,
    suggestedAgentAvatarClipStates,
    type AgentAvatarBundleManifest,
    type AgentAvatarState,
    type CanvasAppearance,
} from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL, uploadAgentAvatarBundle } from "@/services/api/appearance";
import { AgentAvatarBundle } from "@/components/canvas/agent-avatar-bundle";

export function AgentAvatarBundleEditor({ value, onChange, disabled, onUploading }: { value: CanvasAppearance; onChange: (patch: Partial<CanvasAppearance>) => void; disabled: boolean; onUploading: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [manifest, setManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [state, setState] = useState<AgentAvatarState>("idle");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const url = value.avatarBundleResourceId ? agentAvatarBundleFileURL(value.avatarBundleResourceId, "avatar.json", true) : "/doll/avatar.json";
    useEffect(() => {
        const controller = new AbortController();
        setManifest(null);
        setError("");
        void (async () => {
            try {
                const response = await fetch(url, { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`无法读取动画包（HTTP ${response.status}）`);
                const data: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(data)) throw new Error("动画包格式无效");
                if (!controller.signal.aborted) setManifest(data);
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "动画加载失败");
            }
        })();
        return () => controller.abort();
    }, [url, attempt]);
    async function upload(file?: File) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".zip") || file.size > 128 * 1024 * 1024) {
            message.error("请选择不超过 128 MiB 的动画 ZIP");
            return;
        }
        setBusy(true);
        onUploading(true);
        try {
            const bundle = await uploadAgentAvatarBundle(file);
            onChange({ avatarType: "bundle", avatarBundleResourceId: bundle.resourceId, avatarClipStates: suggestedAgentAvatarClipStates(bundle.manifest) });
            setState("idle");
            message.success("动画包已导入，保存后生效");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "动画包导入失败");
        } finally {
            setBusy(false);
            onUploading(false);
        }
    }
    const clip = manifest ? agentAvatarClipForState(value, state, manifest) : "";
    return (
        <div className="grid gap-3">
            <input
                ref={input}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />
            <div className="flex flex-wrap gap-2">
                <Button icon={<Upload size={16} />} disabled={disabled || busy} loading={busy} onClick={() => input.current?.click()}>
                    导入动画包 ZIP
                </Button>
                <Button disabled={disabled || busy} onClick={() => onChange({ avatarBundleResourceId: "", avatarClipStates: DEFAULT_AGENT_AVATAR_CLIP_STATES })}>
                    使用内置形象
                </Button>
            </div>
            <Radio.Group value={state} disabled={disabled || busy} options={AGENT_AVATAR_STATES.map((item) => ({ label: item.label, value: item.id }))} onChange={(event) => setState(event.target.value)} />
            <Select
                aria-label="当前状态动画"
                value={clip || undefined}
                disabled={disabled || busy || !manifest}
                options={Object.entries(manifest?.clips ?? {}).map(([id, file]) => ({ label: `${id} · ${file}`, value: id }))}
                onChange={(id) => onChange({ avatarClipStates: { ...value.avatarClipStates, [state]: id } })}
            />
            {error ? (
                <Alert type="warning" title="动画预览失败" description={error} action={<Button onClick={() => setAttempt(attempt + 1)}>重试</Button>} />
            ) : (
                <AgentAvatarBundle key={`${url}:${attempt}`} appearance={value} height={200} status={state} preview />
            )}
        </div>
    );
}
