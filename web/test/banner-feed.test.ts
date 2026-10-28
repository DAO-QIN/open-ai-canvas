import { describe, expect, test } from "bun:test";

import {
    bannerBoundaries,
    bannerClockOffset,
    bannerCountdownParts,
    bannerCountdownTarget,
    bannerRefreshDelay,
    bannerVersion,
    mergeBannerDismissals,
    nextBannerBoundary,
    parseBannerDismissals,
    serializeBannerDismissals,
    visibleBanners,
    type BannerTiming,
} from "@/lib/announcements/banner-feed";

const NOW = Date.parse("2026-10-28T08:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function banner(id: string, extra: Partial<BannerTiming> = {}): BannerTiming {
    return { id, updatedAt: "2026-10-01T00:00:00Z", ...extra };
}

describe("服务端时钟", () => {
    test("按服务端时间与本机收到响应的差值校准，缺失或无法解析时不偏移", () => {
        expect(bannerClockOffset(at(90_000), NOW)).toBe(90_000);
        expect(bannerClockOffset(undefined, NOW)).toBe(0);
        expect(bannerClockOffset("not-a-time", NOW)).toBe(0);
        expect(bannerClockOffset(at(0), 0)).toBe(0);
    });
});

describe("生效与切换", () => {
    test("到结束时间立即隐藏，未到开始时间不显示", () => {
        const list = [banner("live"), banner("ending", { endsAt: at(1_000) }), banner("later", { startsAt: at(60_000) })];
        expect(visibleBanners(list, NOW, new Set()).map((item) => item.id)).toEqual(["live", "ending"]);
        expect(visibleBanners(list, NOW + 1_000, new Set()).map((item) => item.id)).toEqual(["live"]);
        expect(visibleBanners(list, NOW + 60_000, new Set()).map((item) => item.id)).toEqual(["live", "later"]);
    });

    test("下一个切换时间点取最近的未来开始或结束时间", () => {
        const list = [banner("a", { endsAt: at(5_000) }), banner("b", { startsAt: at(-5_000), endsAt: at(9_000) }), banner("c", { startsAt: at(2_000) })];
        expect(bannerBoundaries(list)).toEqual([NOW - 5_000, NOW + 2_000, NOW + 5_000, NOW + 9_000]);
        expect(nextBannerBoundary(list, NOW)).toBe(NOW + 2_000);
        expect(nextBannerBoundary(list, NOW + 9_000)).toBeNull();
    });

    test("只在一天以内调度精确刷新，过去或无效时间交给常规轮询", () => {
        expect(bannerRefreshDelay(at(30_000), NOW)).toBe(30_000);
        expect(bannerRefreshDelay(at(-1), NOW)).toBeNull();
        expect(bannerRefreshDelay(at(2 * 24 * 60 * 60 * 1000), NOW)).toBeNull();
        expect(bannerRefreshDelay(undefined, NOW)).toBeNull();
    });
});

describe("倒计时", () => {
    test("开启且未到期时才返回截止时间", () => {
        expect(bannerCountdownTarget(banner("a", { showCountdown: true, endsAt: at(10_000) }), NOW)).toBe(NOW + 10_000);
        expect(bannerCountdownTarget(banner("b", { showCountdown: false, endsAt: at(10_000) }), NOW)).toBeNull();
        expect(bannerCountdownTarget(banner("c", { showCountdown: true }), NOW)).toBeNull();
        expect(bannerCountdownTarget(banner("d", { showCountdown: true, endsAt: at(-1) }), NOW)).toBeNull();
    });

    test("剩余时间拆成天时分秒，到期后不出现负数", () => {
        expect(bannerCountdownParts(((2 * 24 + 7) * 3600 + 53 * 60 + 5) * 1000 + 999)).toEqual({ days: 2, hours: 7, minutes: 53, seconds: 5 });
        expect(bannerCountdownParts(-5_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    });
});

describe("关闭记录", () => {
    test("兼容旧版整条快照，并按条目版本隐藏", () => {
        const first = banner("a");
        const second = banner("b");
        const legacy = [bannerVersion(first), bannerVersion(second)].sort().join("|");
        const dismissed = parseBannerDismissals(legacy);
        expect(visibleBanners([first, second], NOW, dismissed)).toEqual([]);
        expect(parseBannerDismissals(null).size).toBe(0);
    });

    test("其他通知到期不会让已关闭的通知重新出现；重新编辑后会再次出现", () => {
        const kept = banner("kept");
        const expiring = banner("expiring", { endsAt: at(1_000) });
        const dismissed = mergeBannerDismissals(new Set(), [kept, expiring], [kept, expiring]);
        // expiring 到期后列表只剩 kept，kept 仍保持关闭。
        expect(visibleBanners([kept], NOW + 2_000, dismissed)).toEqual([]);
        const edited = { ...kept, updatedAt: "2026-10-28T09:00:00Z" };
        expect(visibleBanners([edited], NOW + 2_000, dismissed).map((item) => item.id)).toEqual(["kept"]);
    });

    test("合并时清理已不在列表中的旧记录", () => {
        const current = banner("current");
        const previous = new Set(["gone:2026-01-01T00:00:00Z", bannerVersion(current)]);
        const next = mergeBannerDismissals(previous, [current, banner("new")], [banner("new")]);
        expect(serializeBannerDismissals(next)).toBe([bannerVersion(current), bannerVersion(banner("new"))].sort().join("|"));
    });
});
