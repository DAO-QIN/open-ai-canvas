import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

export function useCreationConversationRoute(ready: boolean, userId: string | undefined, open: (id: string, signal: AbortSignal) => Promise<void>, deletedIds?: ReadonlySet<string>) {
    const { conversationId } = useParams<{ conversationId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const openRef = useRef(open);
    openRef.current = open;
    const localNavigation = useRef<string | undefined>(undefined);
    const [resolution, setResolution] = useState({ key: "", error: "" });
    const key = `${userId || ""}:${location.key}`;
    const unavailable = Boolean(conversationId && deletedIds?.has(conversationId));
    // 本页自己换的地址（恢复后补上会话链接、在历史里点开会话）：这段对话已经显示着，不算加载中。
    // 否则地址变化后到副作用确认之前会有一帧"正在打开会话"，整段对话被卸掉再重新挂载一遍。
    const localTarget = Boolean(conversationId && localNavigation.current === conversationId);

    useEffect(() => {
        if (!ready || !conversationId || unavailable) return;
        if (localNavigation.current === conversationId) {
            localNavigation.current = undefined;
            setResolution({ key, error: "" });
            return;
        }
        const controller = new AbortController();
        void openRef
            .current(conversationId, controller.signal)
            .then(() => {
                if (!controller.signal.aborted) setResolution({ key, error: "" });
            })
            .catch((error) => {
                if (!controller.signal.aborted) setResolution({ key, error: error instanceof Error ? error.message : "会话无法打开" });
            });
        return () => controller.abort();
    }, [ready, conversationId, key, unavailable]);

    const show = useCallback(
        (id: string, replace = false) => {
            const path = `/c/${encodeURIComponent(id)}`;
            if (location.pathname === path) return;
            localNavigation.current = id;
            // 对话已经显示着，换地址只是补记。路由不走过渡（RouterProvider useTransitions={false}），这里单独放进过渡：
            // 恢复会话后补链接发生在首帧之前，整页连同全部消息跟着地址重渲染一遍，放进过渡后可以分片，排到首帧之后。
            startTransition(() => void navigate(path, { replace }));
        },
        [location.pathname, navigate],
    );

    return {
        conversationId,
        loading: Boolean(conversationId && !unavailable && !localTarget && (!ready || resolution.key !== key)),
        error: unavailable ? "会话已删除或已超过保留期限" : conversationId && resolution.key === key ? resolution.error : "",
        show,
    };
}
