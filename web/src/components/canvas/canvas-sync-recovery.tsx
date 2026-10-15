import { useEffect, useState } from "react";
import { App, Button } from "antd";
import { useNavigate } from "react-router";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { readAllCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { adoptCloudCanvas, restoreCanvasDraftAsCopy, retryCanvasSync } from "@/services/user-data-sync";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";

export function CanvasSyncRecovery({ projectId }: { projectId?: string }) {
    const [open, setOpen] = useState(false);
    const [drafts, setDrafts] = useState<CanvasSyncDraft[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [loadedScope, setLoadedScope] = useState("");
    const userId = useUserStore((state) => state.user?.id);
    const navigate = useNavigate();
    const { message } = App.useApp();
    useEffect(() => {
        if (!open) return;
        let active = true;
        const scope = getActiveUserScope();
        setDrafts([]);
        setError("");
        setLoadedScope("");
        void readAllCanvasSyncDrafts(scope)
            .then((items) => {
                if (active && scope === getActiveUserScope()) {
                    setDrafts(items.filter((item) => !projectId || item.project.id === projectId).reverse());
                    setLoadedScope(scope);
                }
            })
            .catch(() => {
                if (active) setError("草稿读取失败，请关闭后重试");
            });
        return () => {
            active = false;
        };
    }, [open, projectId, userId]);
    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        setError("");
        try {
            if (loadedScope !== getActiveUserScope()) throw new Error("账号已切换，请重新读取草稿");
            await action();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "恢复失败，请重试");
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <Button size="small" onClick={() => setOpen(true)}>
                同步恢复
            </Button>
            <AppDrawer title="同步恢复" open={open} onClose={() => setOpen(false)}>
                <p className="mb-4 text-sm text-muted-foreground">草稿保留了本机未确认的内容。恢复副本会新建画布；采用云端版本会保留草稿并更新原画布。</p>
                {error ? (
                    <p role="alert" className="mb-4 text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
                {drafts.length ? (
                    drafts.map((draft) => (
                        <article key={`${draft.project.id}:${draft.id}`} className="mb-4 rounded-lg border border-border p-4">
                            <p className="font-medium">{draft.project.title}</p>
                            <p className="my-2 text-xs text-muted-foreground">
                                {draft.reason} · {new Date(draft.savedAt).toLocaleString()}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void run(async () => {
                                            const id = await restoreCanvasDraftAsCopy(draft);
                                            setOpen(false);
                                            navigate(`/canvas/${id}`);
                                        })
                                    }
                                >
                                    恢复为新画布
                                </Button>
                                <Button disabled={busy} onClick={() => void run(() => exportCanvasProjects([draft.project], "画布恢复草稿"))}>
                                    导出草稿
                                </Button>
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void run(async () => {
                                            await retryCanvasSync(draft.project.id);
                                            message.success("同步已恢复");
                                        })
                                    }
                                >
                                    重试安全合并
                                </Button>
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void run(async () => {
                                            await adoptCloudCanvas(draft.project.id);
                                            message.success("已采用云端版本，草稿仍保留");
                                        })
                                    }
                                >
                                    采用云端版本
                                </Button>
                            </div>
                        </article>
                    ))
                ) : (
                    <p className="text-sm text-muted-foreground">暂无需要恢复的草稿</p>
                )}
            </AppDrawer>
        </>
    );
}
