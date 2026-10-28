/**
 * 常驻通知条的时间与关闭记录规则（纯函数）。
 *
 * - 时钟：以服务端时间为准（serverTime 与本机收到响应时刻的差值），本机时钟不准也不会让倒计时或下线提前、延后。
 * - 生效：后端只返回当前生效的条目；到期条目由前台按 endsAt 立即隐藏，预约条目在 nextChangeAt 重新拉取后出现。
 * - 关闭：按「条目 ID + 更新时间」逐条记录。后台新增或重新编辑的通知会再次出现；
 *   其他通知到期或上线也不会让已关闭的通知重新出现。
 */

export type BannerTiming = {
    id: string;
    updatedAt: string;
    startsAt?: string;
    endsAt?: string;
    showCountdown?: boolean;
};

/** setTimeout 的安全上限之内只调度一天内的刷新，更远的变化交给常规轮询。 */
export const BANNER_TIMER_MAX_DELAY_MS = 24 * 60 * 60 * 1000;

function timeOf(value?: string) {
    if (!value) return undefined;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
}

/** 服务端时间减去本机收到响应的时间；缺少或无法解析时按 0 处理（沿用本机时间）。 */
export function bannerClockOffset(serverTime: string | undefined, receivedAt: number) {
    const server = timeOf(serverTime);
    if (server === undefined || !receivedAt) return 0;
    return server - receivedAt;
}

export function bannerVersion(banner: Pick<BannerTiming, "id" | "updatedAt">) {
    return `${banner.id}:${banner.updatedAt}`;
}

/** 关闭记录以 `|` 分隔的条目版本保存；旧版整条快照（同样是 `id:updatedAt` 以 `|` 拼接）可直接沿用。 */
export function parseBannerDismissals(raw: string | null | undefined) {
    return new Set(
        (raw || "")
            .split("|")
            .map((item) => item.trim())
            .filter(Boolean),
    );
}

/** 记下本次关闭的条目，并丢掉已经不在列表里的旧记录，避免存储无限增长。 */
export function mergeBannerDismissals(previous: Set<string>, feed: BannerTiming[], dismissed: BannerTiming[]) {
    const current = new Set(feed.map(bannerVersion));
    const next = new Set([...previous].filter((version) => current.has(version)));
    for (const banner of dismissed) next.add(bannerVersion(banner));
    return next;
}

export function serializeBannerDismissals(versions: Iterable<string>) {
    return Array.from(new Set(versions)).sort().join("|");
}

export function bannerIsLive(banner: BannerTiming, now: number) {
    const start = timeOf(banner.startsAt);
    const end = timeOf(banner.endsAt);
    return (start === undefined || start <= now) && (end === undefined || now < end);
}

export function visibleBanners<T extends BannerTiming>(banners: T[], now: number, dismissed: Set<string>) {
    return banners.filter((banner) => bannerIsLive(banner, now) && !dismissed.has(bannerVersion(banner)));
}

/** 列表里全部有效的开始 / 结束时间点（升序），用于到点重新计算可见条目。 */
export function bannerBoundaries(banners: BannerTiming[]) {
    const times: number[] = [];
    for (const banner of banners) {
        for (const time of [timeOf(banner.startsAt), timeOf(banner.endsAt)]) {
            if (time !== undefined) times.push(time);
        }
    }
    return times.sort((left, right) => left - right);
}

/** 晚于 now 的最近一个时间点；没有时返回 null。 */
export function nextBoundaryAfter(boundaries: number[], now: number) {
    return boundaries.find((time) => time > now) ?? null;
}

export function nextBannerBoundary(banners: BannerTiming[], now: number) {
    return nextBoundaryAfter(bannerBoundaries(banners), now);
}

/** 开启倒计时且尚未到期时返回截止时间。 */
export function bannerCountdownTarget(banner: BannerTiming, now: number) {
    if (!banner.showCountdown) return null;
    const end = timeOf(banner.endsAt);
    return end !== undefined && end > now ? end : null;
}

export function bannerCountdownParts(remainingMs: number) {
    const total = Math.max(0, Math.floor(remainingMs / 1000));
    return {
        days: Math.floor(total / 86_400),
        hours: Math.floor((total % 86_400) / 3_600),
        minutes: Math.floor((total % 3_600) / 60),
        seconds: total % 60,
    };
}

/** 距离下一次生效列表变化还有多久；没有或超过一天时返回 null，由常规轮询兜底。 */
export function bannerRefreshDelay(nextChangeAt: string | undefined, now: number) {
    const at = timeOf(nextChangeAt);
    if (at === undefined) return null;
    const delay = at - now;
    return delay > 0 && delay <= BANNER_TIMER_MAX_DELAY_MS ? delay : null;
}
