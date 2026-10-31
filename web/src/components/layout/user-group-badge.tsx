import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { UserGroupBadgeStyle } from "@/services/api/user-groups";
import { useUserStore } from "@/stores/use-user-store";
import "./user-group-badge.css";

type BadgeGroup = { name?: string; badgeLabel?: string; badgeStyle?: UserGroupBadgeStyle | string } | null | undefined;

function visibleBadgeStyle(group: BadgeGroup): "vip" | "svip" | null {
    return group?.badgeStyle === "vip" || group?.badgeStyle === "svip" ? group.badgeStyle : null;
}

/** 未传 group 时取当前会话分组；传 null 表示明确不展示。 */
function useBadgeGroup(group: BadgeGroup) {
    const sessionGroup = useUserStore((state) => state.userGroup);
    return group === undefined ? sessionGroup : group;
}

/** 皇冠（vip）：三颗宝石尖 + 底座，实心单色跟随文字色；12px 下描边图标会糊成一团，所以用填充。 */
function CrownGlyph() {
    return (
        <svg className="user-group-badge-glyph" viewBox="0 0 16 12" aria-hidden>
            <path d="M2.2 4.2 5.4 6.6 8 2.2l2.6 4.4 3.2-2.4-1.1 5H3.3z" />
            <circle cx="2" cy="3.4" r="1.4" />
            <circle cx="8" cy="1.5" r="1.5" />
            <circle cx="14" cy="3.4" r="1.4" />
            <rect x="3.3" y="10.4" width="9.4" height="1.5" rx="0.75" />
        </svg>
    );
}

/** 钻石（svip）：冠部浅紫、亭部浅粉，中轴两块刻面提亮，小尺寸下也能读出切面。 */
function GemGlyph() {
    return (
        <svg className="user-group-badge-glyph" viewBox="0 0 16 12" aria-hidden>
            <path className="is-crown" d="M4.4 1h7.2L15 4.6H1z" />
            <path className="is-pavilion" d="M1 4.6h14L8 11.4z" />
            <path className="is-facet" d="M5.9 4.6 8 1l2.1 3.6zm0 0h4.2L8 11.4z" />
        </svg>
    );
}

/** 分组徽章（铭牌）：vip 香槟金箔，svip 黑曜石 + 紫粉极光与流光；none 或未分组时不渲染，compact 只留图标。 */
export function UserGroupBadge({ group, compact = false, className }: { group?: BadgeGroup; compact?: boolean; className?: string }) {
    const resolved = useBadgeGroup(group);
    const style = visibleBadgeStyle(resolved);
    if (!style || !resolved) return null;
    const label = resolved.badgeLabel?.trim() || style.toUpperCase();
    return (
        // 外层 <b>、文字放内层 <b>：所在容器常有 span / em 后代样式（侧栏副标题、账户卡角色标签），避免被改色改字号。
        <b className={cn("user-group-badge", `is-${style}`, compact && "is-compact", className)} title={resolved.name || label} role={compact ? "img" : undefined} aria-label={compact ? label : undefined}>
            {style === "svip" ? <GemGlyph /> : <CrownGlyph />}
            {compact ? null : <b className="user-group-badge-label">{label}</b>}
        </b>
    );
}

/** 头像框：vip 金属环、svip 缓慢流转的极光环；未传 group 时按当前会话分组。 */
export function UserGroupAvatarRing({ group, children, className }: { group?: BadgeGroup; children: ReactNode; className?: string }) {
    const style = visibleBadgeStyle(useBadgeGroup(group));
    return <span className={cn("user-group-avatar-ring", style && `is-${style}`, className)}>{children}</span>;
}
