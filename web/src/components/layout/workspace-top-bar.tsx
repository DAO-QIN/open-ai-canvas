import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLocation } from "react-router";
import type { Ref } from "react";
import { workspaceNavigationTool } from "@/constant/navigation-tools";

import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { WorkspaceTopBarExtensionSlot } from "@/components/layout/workspace-top-bar-extension";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { usePromotionOverview } from "@/hooks/use-promotion-overview";
import { promotionDisplay } from "@/lib/promotion-display";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar, sidebarToggleRef }: { sidebarOpen: boolean; onToggleSidebar: () => void; sidebarToggleRef?: Ref<HTMLButtonElement> }) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const { pathname } = useLocation();
    const slug = pathname.split("/").filter(Boolean)[0];
    const promotion = usePromotionOverview(user?.id, slug === "promotion");
    const pageTitle = slug === "promotion" && !promotionDisplay(promotion.data, Boolean(promotion.error)).canInvite ? "返利" : workspaceNavigationTool(pathname)?.label || brandName;
    const balance = availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

    return (
        <header className="app-workspace-topbar">
            <button ref={sidebarToggleRef} type="button" className="app-workspace-mobile-menu app-workspace-topbar-icon-button" aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"} aria-controls="workspace-sidebar" aria-expanded={sidebarOpen} onClick={onToggleSidebar}>
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <nav className="app-workspace-topbar-breadcrumb" aria-label="当前位置">
                <span className="truncate font-semibold text-foreground">{pageTitle}</span>
            </nav>
            <WorkspaceTopBarExtensionSlot />
            <div className="app-workspace-topbar-actions">
                {creditsEnabled ? <button type="button" className="app-workspace-topbar-credit-pill" aria-label={`打开积分中心，可用 ${balance} 积分`} onClick={() => openWorkspaceWallet()}>
                    <WorkspaceCreditGiftMark />
                    <span>积分</span>
                    <strong>{balance}</strong>
                </button> : null}
                {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" autoOpen /> : null}
                <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label="切换主题" />
                <WorkspaceAccountMenu />
            </div>
        </header>
    );
}
