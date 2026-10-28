import { expect, test } from "bun:test";
import { promotionDisplay } from "../src/lib/promotion-display";
import type { PromotionOverview } from "../src/services/api/promotion";

const empty: PromotionOverview = {
    policy: { enabled: false, ratioBps: 500, freezeDays: 3, version: 7 },
    profile: { userId: "promoter", inviteCode: "EXISTING123", paused: false, ratioOverrideBps: null, version: 0 },
    effectiveRatioBps: 500,
    canPromote: false,
    inviteCount: 0,
    totalMicrocredits: "0",
    frozenMicrocredits: "0",
    availableMicrocredits: "0",
    transferredMicrocredits: "0",
    voidedMicrocredits: "0",
    serverTime: "2026-10-11T00:00:00Z",
};
const active = { ...empty, policy: { ...empty.policy, enabled: true }, canPromote: true };

test("invitation content requires confirmed activity and personal eligibility; zero ratio still allows invitations", () => {
    expect(promotionDisplay(active)).toEqual({ canInvite: true, title: "邀请有礼", showEntry: true });
    expect(promotionDisplay({ ...active, effectiveRatioBps: 0 }).canInvite).toBe(true);
    for (const overview of [empty, { ...active, policy: empty.policy }, { ...active, canPromote: false }, { ...active, profile: { ...active.profile, paused: true } }]) {
        expect(promotionDisplay(overview).canInvite).toBe(false);
        expect(promotionDisplay(overview).title).toBe("我的奖励");
    }
});

test("an unused invite code alone does not keep the consumer menu visible after closure", () => {
    expect(promotionDisplay(empty).showEntry).toBe(false);
    expect(promotionDisplay({ ...empty, profile: { ...empty.profile, inviteCode: null } }).showEntry).toBe(false);
});

test("closed and paused users keep historical access even if everything was transferred or ended", () => {
    for (const history of [
        { ...empty, inviteCount: 1 },
        { ...empty, totalMicrocredits: "1", availableMicrocredits: "1" },
        { ...empty, totalMicrocredits: "1", frozenMicrocredits: "1" },
        { ...empty, totalMicrocredits: "60000000", transferredMicrocredits: "60000000" },
        { ...empty, totalMicrocredits: "60000000", voidedMicrocredits: "60000000" },
        { ...empty, totalMicrocredits: "11000000000000000000", transferredMicrocredits: "11000000000000000000" },
    ]) {
        for (const paused of [false, true]) {
            expect(promotionDisplay({ ...history, profile: { ...history.profile, paused } })).toEqual({ canInvite: false, title: "我的奖励", showEntry: true });
        }
    }
});

test("unknown reads and unfinished transfers preserve a neutral recovery entry without advertising invitations", () => {
    for (const state of [promotionDisplay(), promotionDisplay(active, true), promotionDisplay(empty, true), promotionDisplay(empty, false, true)]) {
        expect(state).toEqual({ canInvite: false, title: "我的奖励", showEntry: true });
    }
    // A later successful empty read belongs to its own account and may hide the entry.
    expect(promotionDisplay(empty)).toEqual({ canInvite: false, title: "我的奖励", showEntry: false });
});
