import { ChevronRight, History, Images, LibraryBig, PanelsTopLeft, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { WorkspaceAccountCard } from "@/components/layout/workspace-account-card";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { useUserStore } from "@/stores/use-user-store";
import "./settings-mobile-hub.css";

export type SettingsHubSection = { key: string; label: string; description: string; icon: ReactNode };

/** 从中心页点进设置项时带上这个标记，详情页的「返回」才能直接回退，而不是再压一层历史。 */
export const SETTINGS_HUB_STATE = { fromSettingsHub: true } as const;

/**
 * 手机底部导航「我的」：账户与积分、作品入口、常用设置。
 * 点设置项进入对应分区，分区顶部的「返回」回到这里；渠道、存储、诊断等桌面工作流分区不在列表里。
 */
export function SettingsMobileHub({ sections }: { sections: SettingsHubSection[] }) {
    const taskCenterEnabled = useUserStore((state) => state.features.taskCenterEnabled);
    const shortcuts: Array<{ to: string; label: string; icon: LucideIcon }> = [
        { to: "/canvas", label: "我的画布", icon: PanelsTopLeft },
        { to: "/assets", label: "素材", icon: Images },
        ...(taskCenterEnabled ? [{ to: "/tasks", label: "创作历史", icon: History }] : []),
        { to: "/skills", label: "技能库", icon: LibraryBig },
    ];
    return (
        <div className="settings-mobile-hub">
            <WorkspaceAccountCard variant="page" active onNavigate={() => undefined} onWallet={() => openWorkspaceWallet()}>
                <nav className="settings-mobile-hub-shortcuts" aria-label="我的作品">
                    {shortcuts.map(({ to, label, icon: Icon }) => (
                        <Link key={to} to={to}>
                            <span className="settings-mobile-hub-shortcut-icon" aria-hidden="true">
                                <Icon />
                            </span>
                            <span>{label}</span>
                        </Link>
                    ))}
                </nav>
                <nav className="settings-mobile-hub-list" aria-label="设置">
                    {sections.map((section) => (
                        <Link key={section.key} to={`/settings?section=${section.key}`} state={SETTINGS_HUB_STATE}>
                            <span className="settings-mobile-hub-list-icon" aria-hidden="true">
                                {section.icon}
                            </span>
                            <span className="settings-mobile-hub-list-copy">
                                <strong>{section.label}</strong>
                                <small>{section.description}</small>
                            </span>
                            <ChevronRight className="settings-mobile-hub-list-chevron" aria-hidden="true" />
                        </Link>
                    ))}
                </nav>
            </WorkspaceAccountCard>
        </div>
    );
}
