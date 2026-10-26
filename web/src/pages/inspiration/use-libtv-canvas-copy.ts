import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { createLatestRequestGuard, ensureRemoteLibTVCanvasDraft } from "@/lib/libtv-gallery";
import { createCanvasProjectWithRemoteSync, formatLocalSavedRemotePending, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { openLoginModal } from "@/stores/use-login-modal-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 「复制并打开画布」：作品详情页与首页精选画布弹窗共用。
 * 先在自己账号下建好已同步的空画布，再带 importTemplate 进入画布，由导入弹窗预览并确认后才写入节点。
 */
export function useLibTVCanvasCopy({ templateUuid, title, canImport, messageApi, onClose }: { templateUuid?: string; title?: string; canImport: boolean; messageApi: MessageInstance; onClose: () => void }) {
    const navigate = useNavigate();
    const [copying, setCopying] = useState(false);
    const draftProjectIdRef = useRef<string | undefined>(undefined);
    // 异步创建草稿期间作品可能已关闭或切到别的作品：回来先确认这次请求仍是最新且仍是同一条作品。
    const guardRef = useRef(createLatestRequestGuard());

    // 关闭弹窗或切换作品时作废在途的创建请求，并清掉上一条作品留下的待同步草稿。
    useEffect(() => {
        draftProjectIdRef.current = undefined;
        setCopying(false);
        guardRef.current.invalidate();
        return () => guardRef.current.invalidate();
    }, [templateUuid]);

    const copy = async () => {
        if (!templateUuid || !canImport || copying) return;
        // 游客可以浏览作品，复制需要先登录：画布要存进自己的账号里。
        if (!useUserStore.getState().user) {
            // 先关掉作品弹窗，登录弹窗才不会被压在下面。
            onClose();
            openLoginModal({ description: "登录后即可把这个画布复制到你的空间继续编辑" });
            return;
        }
        const guard = guardRef.current.begin();
        setCopying(true);
        try {
            const result = await ensureRemoteLibTVCanvasDraft(draftProjectIdRef.current, title?.trim() || "未命名画布", {
                create: (value) => createCanvasProjectWithRemoteSync(value),
                retry: (projectId) => saveRemoteUserDataNow(projectId),
                exists: (projectId) => useCanvasStore.getState().projects.some((project) => project.id === projectId),
            });
            // 作品已被关闭/切换：不写回草稿、不导航，也不弹已经过时的提示。
            if (!guardRef.current.isCurrent(guard)) return;
            draftProjectIdRef.current = result.projectId;
            if (!result.ok) {
                // 只保留本地草稿，不进入需要归属校验的模板导入；创建失败时同步层已排队重试，手动重试失败时在此补排。
                const warning = result.phase === "create" ? formatLocalSavedRemotePending("已创建本地草稿画布", result.error) : localSavedRemotePendingMessage("本地草稿画布已保留", result.error);
                messageApi.warning(`${warning} 云端同步成功前不会导入模板，可再次点击「复制并打开画布」立即重试。`);
                setCopying(false);
                return;
            }
            onClose();
            navigate(`/canvas/${result.projectId}?importTemplate=${encodeURIComponent(templateUuid)}`);
        } catch (err) {
            if (!guardRef.current.isCurrent(guard)) return;
            messageApi.error(err instanceof Error ? err.message : "创建画布失败");
            setCopying(false);
        }
    };

    return { copy, copying };
}
