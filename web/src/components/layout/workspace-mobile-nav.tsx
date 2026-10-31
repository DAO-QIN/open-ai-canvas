import { CircleUserRound, House, PanelsTopLeft, WandSparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { interceptLoginLinkClick } from "@/stores/use-login-modal-store";
import { useUserStore } from "@/stores/use-user-store";

type WorkspaceMobileNavItem = {
    to: string;
    label: string;
    icon: LucideIcon;
    /** 游客点击时就地弹出登录框，登录后再前往，不经过 /login 重定向把人送回首页。 */
    loginHint?: string;
    /** 从该标签进入的二级页面仍高亮同一个标签，手机上始终知道自己在哪个分区。 */
    prefixes: string[];
};

export const workspaceMobileNavItems: WorkspaceMobileNavItem[] = [
    { to: "/", label: "首页", icon: House, prefixes: ["/inspiration", "/inspirations", "/projects", "/toolbox"] },
    { to: "/create", label: "创作", icon: WandSparkles, prefixes: ["/create", "/c"] },
    { to: "/canvas", label: "画布", icon: PanelsTopLeft, loginHint: "登录后查看和继续你的画布", prefixes: ["/canvas"] },
    // 「我的」进入设置页的手机中心页（不带 section），素材、历史、技能等资源页也归在这里。
    { to: "/settings", label: "我的", icon: CircleUserRound, loginHint: "登录后查看积分、作品与账户设置", prefixes: ["/settings", "/promotion", "/assets", "/tasks", "/skills", "/plugins", "/wallet"] },
];

const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function workspaceMobileNavActive(pathname: string) {
    if (pathname === "/") return "/";
    return workspaceMobileNavItems.find((item) => item.prefixes.some((prefix) => matchesPrefix(pathname, prefix)))?.to;
}

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

export function isTextEntryElement(element: Element | null) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable) return true;
    if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
    if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !NON_TEXT_INPUT_TYPES.has(element.type);
    return false;
}

/** 手机上正在输入时收起底部导航：软键盘弹起后把高度让给输入框和消息，失焦后恢复。 */
function useTextEntryFocused() {
    const [focused, setFocused] = useState(() => isTextEntryElement(document.activeElement));
    useEffect(() => {
        const update = () => setFocused(isTextEntryElement(document.activeElement));
        // focusout 触发时新焦点还没落定，下一帧再读 activeElement，避免在两个输入框之间切换时闪一下。
        let frame = 0;
        const deferUpdate = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(update);
        };
        document.addEventListener("focusin", update);
        document.addEventListener("focusout", deferUpdate);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener("focusin", update);
            document.removeEventListener("focusout", deferUpdate);
        };
    }, []);
    return focused;
}

export function WorkspaceMobileNav({ hidden }: { hidden: boolean }) {
    const { pathname } = useLocation();
    const signedIn = useUserStore((state) => Boolean(state.user));
    const typing = useTextEntryFocused();
    const active = workspaceMobileNavActive(pathname);
    return (
        <nav className="app-workspace-mobile-nav" aria-label="常用导航" hidden={hidden || typing}>
            {workspaceMobileNavItems.map(({ to, label, icon: Icon, loginHint }) => (
                <Link
                    key={to}
                    to={to}
                    aria-current={active === to ? "page" : undefined}
                    onClick={(event) => {
                        if (loginHint && !signedIn) interceptLoginLinkClick(event, { description: loginHint, next: to });
                    }}
                    onPointerDown={() => preloadWorkspaceRoute(to)}
                    onFocus={() => preloadWorkspaceRoute(to)}
                >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                </Link>
            ))}
        </nav>
    );
}
