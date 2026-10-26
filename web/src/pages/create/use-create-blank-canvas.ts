import { useState } from "react";
import { App } from "antd";
import { useNavigate } from "react-router";

import { getActiveUserScope } from "@/lib/user-scope";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { blankCanvasPath, type CanvasStartNode } from "@/lib/canvas/canvas-start-node";

export type { CanvasStartNode };

// 首页多个入口（最近画布、工具入口）共用一把锁，避免连点两个入口时建出两个空画布。
let creatingLock = false;

/**
 * 首页「创建画布」与工具入口共用：游客先登录；同一时间只创建一个画布；
 * 切换账号后不再跳转到上一位用户的画布。
 */
export function useCreateBlankCanvas(onRequireLogin: () => void) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const [creating, setCreating] = useState<CanvasStartNode | "blank" | null>(null);

    const createCanvas = async (start?: CanvasStartNode, title = "未命名画布") => {
        if (!userId) {
            onRequireLogin();
            return;
        }
        if (!canvasHydrated || creatingLock) return;
        const scope = getActiveUserScope();
        creatingLock = true;
        setCreating(start ?? "blank");
        try {
            const { id, syncError } = await createCanvasProjectWithRemoteSync(title);
            await flushCanvasStorePersistence();
            if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) return;
            if (syncError) message.warning("画布已保存在本机，云端同步尚未完成，将自动重试。");
            navigate(blankCanvasPath(id, start));
        } catch (error) {
            if (getActiveUserScope() === scope) message.error(error instanceof Error ? error.message : "创建画布失败，请重试");
        } finally {
            creatingLock = false;
            setCreating(null);
        }
    };

    return { createCanvas, creating, ready: sessionHydrated && canvasHydrated, signedIn: Boolean(userId) };
}
