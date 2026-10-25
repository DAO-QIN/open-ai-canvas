import { useEffect, useRef } from "react";
import { Navigate, useSearchParams } from "react-router";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { isGuestWorkspacePath } from "@/lib/guest-workspace";
import { openLoginModal, safeNextPath, type AuthModalView } from "@/stores/use-login-modal-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 旧的独立登录、注册、找回密码地址不再有单独页面：回到工作台并打开对应的弹窗视图。
 * 保留这些地址是因为邀请链接、第三方登录回跳（oauth_error）、受保护页面的登录跳转
 * 和用户收藏仍然指向它们；next、inviteCode 参数原样交给弹窗。
 */
export function AuthRouteRedirect({ view }: { view: AuthModalView }) {
    const [params] = useSearchParams();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const opened = useRef(false);
    const next = safeNextPath(params.get("next"));
    // 受保护页面在登录前进不去，先停在首页，登录成功后再前往 next。
    const landing = isGuestWorkspacePath(next.split("?")[0]) ? next : "/";

    useEffect(() => {
        if (!hydrated || user || opened.current) return;
        opened.current = true;
        openLoginModal({
            view,
            next: next === landing ? undefined : next,
            inviteCode: params.get("inviteCode") ?? undefined,
            error: params.get("oauth_error") ?? undefined,
        });
    }, [hydrated, landing, next, params, user, view]);

    if (!hydrated) return <FullScreenLoader />;
    return <Navigate to={user ? next : landing} replace />;
}
