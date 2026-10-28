import type { PromotionOverview } from "@/services/api/promotion";

export function promotionDisplay(overview?: PromotionOverview, readFailed = false, unresolvedTransfer = false) {
    const canInvite = Boolean(overview && !readFailed && overview.canPromote && overview.policy.enabled && !overview.profile.paused);
    const hasHistory = Boolean(overview && (overview.inviteCount > 0 || BigInt(overview.totalMicrocredits) > BigInt(0)));
    return {
        canInvite,
        title: canInvite ? "邀请有礼" : "我的奖励",
        // Unknown results and unfinished transfers must not hide access to existing rewards.
        showEntry: canInvite || hasHistory || !overview || readFailed || unresolvedTransfer,
    };
}
