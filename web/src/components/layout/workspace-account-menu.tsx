import { Popover } from "antd";
import { CircleUserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { WorkspaceAccountCard } from "./workspace-account-card";
import { UserAvatar } from "./user-avatar";
import { UserGroupAvatarRing } from "./user-group-badge";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { useUserStore } from "@/stores/use-user-store";
import { interceptLoginLinkClick } from "@/stores/use-login-modal-store";

/** 顶部与侧栏复用同一账户卡片（含版本公告与外观偏好），两个入口内容一致。 */
export function WorkspaceAccountMenu() {
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const [menuOpen, setMenuOpen] = useState(false);

    if (!hydrated) {
        return (
            <span className="grid size-9 place-items-center" aria-hidden>
                <span className="size-6 animate-pulse rounded-full bg-foreground/[.06]" />
            </span>
        );
    }

    return user ? (
        <>
            <Popover
                trigger="click"
                placement="bottomRight"
                arrow={false}
                rootClassName="workspace-account-popover"
                open={menuOpen}
                onOpenChange={setMenuOpen}
                content={
                    <div className="workspace-topbar-account-menu">
                        <WorkspaceAccountCard
                            active={menuOpen}
                            onNavigate={() => setMenuOpen(false)}
                            onWallet={() => {
                                setMenuOpen(false);
                                openWorkspaceWallet();
                            }}
                        />
                    </div>
                }
            >
                <button type="button" className="app-workspace-topbar-icon-button app-workspace-account-trigger" aria-label="账户菜单" title={user.displayName || user.username}>
                    <UserGroupAvatarRing><UserAvatar user={user} className="size-6" /></UserGroupAvatarRing>
                </button>
            </Popover>
        </>
    ) : (
        <Link to="/login" onClick={(event) => interceptLoginLinkClick(event)} className="app-workspace-topbar-auth-pill" aria-label="注册或登录" title="注册 / 登录">
            <CircleUserRound aria-hidden="true" />
            <span className="app-workspace-topbar-auth-label">注册 / 登录</span>
            <span className="app-workspace-topbar-auth-short">登录</span>
        </Link>
    );
}
