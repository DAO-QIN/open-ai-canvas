import { ChevronRight, Coins, Gift, LogOut, Moon, RefreshCw, Settings, ShieldCheck, Sun } from "lucide-react";
import { Link } from "react-router";
import { useEffect, useState } from "react";
import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { usePromotionOverview } from "@/hooks/use-promotion-overview";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { readPendingPromotionTransfer } from "@/lib/promotion-credits";
import { promotionDisplay } from "@/lib/promotion-display";
import { cn } from "@/lib/utils";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import { UserGroupAvatarRing, UserGroupBadge } from "./user-group-badge";
import "./workspace-account-card.css";

// 打开菜单时，超过该时长的余额会在后台静默刷新；不做常驻轮询。
const WALLET_REFRESH_ON_OPEN_MS = 60_000;

const themeOptions: { value: ThemeName; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
];

function formatCredits(microcredits: number) {
    return (microcredits / 1_000_000).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** 同一账户卡片用于顶部和侧栏；余额、偏好与退出均复用真实服务，两个入口内容保持一致。 */
export function WorkspaceAccountCard({ onWallet, onNavigate, active }: { onWallet: () => void; onNavigate: () => void; active: boolean }) {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const { availableMicrocredits, refreshing, refresh, updatedAt, failed } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const overview = usePromotionOverview(user?.id, active);
    const [pendingScope, setPendingScope] = useState<{ userId: string; unresolved: boolean }>();
    useEffect(() => {
        if (!active || !user) return;
        let unresolved = true;
        try {
            unresolved = Boolean(readPendingPromotionTransfer(user.id));
        } catch {
            // Keep the recovery route reachable when local transfer state cannot be read.
        }
        setPendingScope({ userId: user.id, unresolved });
    }, [active, user?.id]);
    useEffect(() => {
        if (!active || !creditsEnabled || refreshing) return;
        if (updatedAt && Date.now() - updatedAt < WALLET_REFRESH_ON_OPEN_MS) return;
        void refresh();
        // 只在菜单打开时判断一次，避免刷新状态变化后重复请求。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, creditsEnabled]);
    const promotion = promotionDisplay(overview.data, Boolean(overview.error), pendingScope?.userId === user?.id && pendingScope?.unresolved);
    if (!user) return null;
    const displayName = user.displayName || user.username;
    const balanceKnown = availableMicrocredits !== null;
    return (
        <section className="workspace-account-card" aria-label="我的账户">
            <Link to="/settings?section=profile" onClick={onNavigate} className="workspace-account-card-identity" title="查看个人信息">
                <UserGroupAvatarRing><UserAvatar user={user} className="workspace-account-card-avatar" /></UserGroupAvatarRing>
                <span className="workspace-account-card-identity-copy">
                    <strong className="workspace-account-card-name">{displayName}<UserGroupBadge /></strong>
                    <span>@{user.username}</span>
                </span>
                <em data-role={user.role}>{user.role === "admin" ? "管理员" : "创作者"}</em>
            </Link>
            {creditsEnabled ? (
                <div className="workspace-account-card-wallet">
                    <div className="workspace-account-card-wallet-head">
                        <span>
                            <Coins aria-hidden />
                            可用积分
                        </span>
                        <button type="button" className={cn("workspace-account-card-refresh", refreshing && "is-spinning")} onClick={() => void refresh()} disabled={refreshing} aria-label="刷新积分余额" title="刷新余额">
                            <RefreshCw aria-hidden />
                        </button>
                    </div>
                    <strong className="workspace-account-card-balance" aria-live="polite" aria-busy={refreshing && !balanceKnown}>
                        {balanceKnown ? formatCredits(availableMicrocredits) : refreshing ? <span className="workspace-account-card-balance-skeleton" aria-label="正在读取余额" /> : "—"}
                    </strong>
                    {!balanceKnown && failed && !refreshing ? <p className="workspace-account-card-wallet-error">余额读取失败，点右上角重试</p> : null}
                    <button type="button" className="workspace-account-card-topup" onClick={onWallet}>
                        充值 / 兑换
                        <ChevronRight aria-hidden />
                    </button>
                </div>
            ) : null}
            <nav className="workspace-account-card-actions" aria-label="账户操作">
                {promotion.showEntry ? (
                    <Link to="/promotion" onClick={onNavigate}>
                        <Gift aria-hidden />
                        <span>{promotion.title}</span>
                        <ChevronRight aria-hidden />
                    </Link>
                ) : null}
                <Link to="/settings?section=profile" onClick={onNavigate}>
                    <Settings aria-hidden />
                    <span>账户与设置</span>
                    <ChevronRight aria-hidden />
                </Link>
                {user.role === "admin" ? (
                    <Link to="/admin" onClick={onNavigate}>
                        <ShieldCheck aria-hidden />
                        <span>管理员后台</span>
                        <ChevronRight aria-hidden />
                    </Link>
                ) : null}
            </nav>
            <div className="workspace-account-card-prefs">
                <AppChangelogButton className="workspace-account-card-changelog" showLabel showVersion versionClassName="workspace-account-card-version" />
                <div className="workspace-account-card-theme">
                    <span>外观</span>
                    <div className="workspace-account-card-segmented" role="radiogroup" aria-label="界面外观">
                        {themeOptions.map(({ value, label, icon: Icon }) => (
                            <button key={value} type="button" role="radio" aria-checked={theme === value} className={cn(theme === value && "is-active")} onClick={() => setTheme(value)}>
                                <Icon aria-hidden />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="workspace-account-card-footer">
                <button type="button" className="workspace-account-card-logout" disabled={loggingOut} onClick={() => void handleLogout()}>
                    {loggingOut ? <RefreshCw className="is-spinning" aria-hidden /> : <LogOut aria-hidden />}
                    {loggingOut ? "正在退出…" : "退出登录"}
                </button>
            </div>
        </section>
    );
}
