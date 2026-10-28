import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { getActiveBanners, type BannerAnnouncement } from "@/services/api/announcements";
import { BannerAnnouncementBody, BannerAnnouncementShell, useBannerNow } from "@/components/layout/banner-announcement-content";
import { bannerBoundaries, bannerClockOffset, bannerCountdownTarget, bannerRefreshDelay, bannerVersion, mergeBannerDismissals, parseBannerDismissals, serializeBannerDismissals, visibleBanners } from "@/lib/announcements/banner-feed";
import { bannerCtaLabel } from "@/lib/announcements/banner-notice";
import { useUserStore } from "@/stores/use-user-store";

const BANNER_ROTATE_MS = 6000;
const BANNER_POLL_MS = 3 * 60_000;
const BANNER_DISMISS_STORAGE_PREFIX = "yingce.banner-announcements.dismissed";
const EMPTY_BANNERS: BannerAnnouncement[] = [];

export function BannerAnnouncementsSlider() {
    const reducedMotion = Boolean(useReducedMotion());
    const userId = useUserStore((state) => state.user?.id);
    const { data, dataUpdatedAt, refetch } = useQuery({
        queryKey: ["active-banner-announcements"],
        queryFn: getActiveBanners,
        staleTime: 60_000,
        refetchInterval: BANNER_POLL_MS,
    });

    const feed = data?.banners ?? EMPTY_BANNERS;
    // 倒计时、到点下线都按服务端时钟计算，本机时间不准也不会提前或延后。
    const offset = useMemo(() => bannerClockOffset(data?.serverTime, dataUpdatedAt), [data?.serverTime, dataUpdatedAt]);

    // 关闭记录按「用户 + 条目版本」保存：后台新增或重新编辑的通知会再次出现，其他通知到期不会让已关闭的复现。
    const [dismissed, setDismissed] = useState(() => readDismissals(userId));
    useEffect(() => {
        setDismissed(readDismissals(userId));
    }, [userId]);

    const candidates = useMemo(() => feed.filter((banner) => !dismissed.has(bannerVersion(banner))), [feed, dismissed]);
    const boundaries = useMemo(() => bannerBoundaries(candidates), [candidates]);
    const ticking = candidates.some((banner) => banner.showCountdown && banner.endsAt);
    const now = useBannerNow(offset, ticking, boundaries);
    const visible = useMemo(() => visibleBanners(feed, now, dismissed), [feed, now, dismissed]);

    // 预约通知开始或当前通知到期时立即重新拉取，不等常规轮询。
    useEffect(() => {
        const delay = bannerRefreshDelay(data?.nextChangeAt, Date.now() + offset);
        if (delay === null) return;
        const timer = window.setTimeout(() => void refetch(), delay + 600);
        return () => window.clearTimeout(timer);
    }, [data?.nextChangeAt, offset, refetch]);

    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const pageHidden = usePageHidden();
    const paused = hovered || focused || pageHidden;

    // 轮播按条目 ID 跟踪当前项：列表刷新、排序变化或某条到期时不会跳到别的通知上。
    const [activeId, setActiveId] = useState<string>();
    const current = visible.find((banner) => banner.id === activeId) ?? visible[0];
    const currentId = current?.id;
    const ids = visible.map((banner) => banner.id);
    const idsKey = ids.join("|");
    const remainingRef = useRef(BANNER_ROTATE_MS);

    useEffect(() => {
        remainingRef.current = BANNER_ROTATE_MS;
    }, [currentId]);

    useEffect(() => {
        if (!currentId || ids.length <= 1 || paused) return;
        const startedAt = performance.now();
        const timer = window.setTimeout(() => {
            const index = ids.indexOf(currentId);
            setActiveId(ids[(index + 1) % ids.length]);
        }, remainingRef.current);
        // 暂停时记下剩余时间，恢复后接着走，与圆点进度条保持一致。
        return () => {
            window.clearTimeout(timer);
            remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAt));
        };
        // ids 的内容由 idsKey 表达。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId, idsKey, paused]);

    if (!current) return null;

    const handleDismiss = () => {
        const next = mergeBannerDismissals(dismissed, feed, visible);
        writeDismissals(userId, next);
        setDismissed(next);
    };

    const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    };

    const link = current.link?.trim();
    const body = (
        <BannerAnnouncementBody
            titleRuns={current.titleRuns}
            title={current.title}
            ctaLabel={link ? bannerCtaLabel(current.ctaText, current.noticeType) : undefined}
            countdownTarget={bannerCountdownTarget(current, now)}
            now={now}
            motion={!reducedMotion}
        />
    );
    const content = !link ? (
        <div className="notice-banner-content">{body}</div>
    ) : /^https?:\/\//i.test(link) ? (
        <a className="notice-banner-content" href={link} target="_blank" rel="noopener noreferrer">
            {body}
        </a>
    ) : (
        <Link className="notice-banner-content" to={link}>
            {body}
        </Link>
    );

    return (
        <BannerAnnouncementShell
            noticeType={current.noticeType}
            theme={current}
            paused={paused}
            role="region"
            aria-label="站点通知"
            style={{ "--nb-rotate-ms": `${BANNER_ROTATE_MS}ms` } as CSSProperties}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            trailing={
                <>
                    {visible.length > 1 ? (
                        <div className="notice-banner-dots" role="group" aria-label="切换通知">
                            {visible.map((banner, index) => {
                                const active = banner.id === current.id;
                                return (
                                    <button key={banner.id} type="button" className="notice-banner-dot" aria-label={`第 ${index + 1} 条通知`} aria-current={active ? "true" : undefined} onClick={() => setActiveId(banner.id)}>
                                        <span className="notice-banner-dot-mark">{active ? <span key={banner.id} className="notice-banner-dot-progress" /> : null}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                    <button type="button" className="notice-banner-close" onClick={handleDismiss} aria-label="关闭通知" title="关闭">
                        <X aria-hidden="true" />
                    </button>
                </>
            }
        >
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={current.id}
                    className="notice-banner-slide"
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -14 }}
                    transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    {content}
                </motion.div>
            </AnimatePresence>
        </BannerAnnouncementShell>
    );
}

function usePageHidden() {
    const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
    useEffect(() => {
        const update = () => setHidden(document.visibilityState === "hidden");
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    return hidden;
}

function dismissalKey(userId?: string) {
    return `${BANNER_DISMISS_STORAGE_PREFIX}.${userId || "anonymous"}`;
}

function readDismissals(userId?: string) {
    try {
        return parseBannerDismissals(localStorage.getItem(dismissalKey(userId)));
    } catch {
        return new Set<string>();
    }
}

function writeDismissals(userId: string | undefined, versions: Set<string>) {
    try {
        localStorage.setItem(dismissalKey(userId), serializeBannerDismissals(versions));
    } catch {
        // 浏览器禁用存储时仍允许关闭，本次组件生命周期内不会重复出现。
    }
}
