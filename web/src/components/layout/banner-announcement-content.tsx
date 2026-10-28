import { ArrowRight } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { BANNER_TIMER_MAX_DELAY_MS, bannerCountdownParts, nextBoundaryAfter } from "@/lib/announcements/banner-feed";
import { bannerNoticeSurfaceCSS, normalizeBannerNoticeType } from "@/lib/announcements/banner-notice";
import { bannerTitlePlainText, bannerTitleRunStyle, type BannerTitleRun } from "@/lib/announcements/banner-title";
import { cn } from "@/lib/utils";

import "./banner-announcement.css";

/**
 * 通知条的展示单元：配色光效外壳、倒计时、富文本标题与行动按钮。
 *
 * 首页通知条与后台「前台效果预览」共用这里的每一个部件——后台 DIY 出来的结果之所以能原样回显，
 * 靠的就是两处不各写一份渲染，而不是靠两边样式对齐。
 * 图标素材（emoji）是标题文本的一部分，随 BannerAnnouncementTitle 一起渲染，这里不单独处理。
 */

const NO_BOUNDARIES: number[] = [];

/** 通知类型的实色，用于后台列表的类型标签；通知条本身的深色底与光晕由外壳的 data-notice-type 选择。 */
export function bannerAnnouncementBarStyle(noticeType?: string | null) {
    return { backgroundColor: bannerNoticeSurfaceCSS(noticeType) };
}

/**
 * 以服务端时间为准的「现在」：有倒计时时逐秒刷新，否则只在下一个开始 / 结束时间点刷新一次。
 * offset 是服务端时间减本机时间的差值；boundaries 是升序的开始 / 结束时间点。
 */
export function useBannerNow(offset: number, ticking: boolean, boundaries: number[] = NO_BOUNDARIES) {
    const [now, setNow] = useState(() => Date.now() + offset);
    const boundary = nextBoundaryAfter(boundaries, now);

    useEffect(() => {
        const read = () => Date.now() + offset;
        setNow(read());
        if (ticking) {
            let timer = 0;
            const tick = () => {
                const current = read();
                setNow(current);
                // 对齐到整秒，数字翻动与系统时钟同步。
                timer = window.setTimeout(tick, 1000 - (current % 1000) + 8);
            };
            timer = window.setTimeout(tick, 1000 - (read() % 1000) + 8);
            return () => window.clearTimeout(timer);
        }
        if (boundary === null) return;
        const delay = boundary - read();
        if (delay > BANNER_TIMER_MAX_DELAY_MS) return;
        const timer = window.setTimeout(() => setNow(read()), Math.max(0, delay) + 50);
        return () => window.clearTimeout(timer);
    }, [offset, ticking, boundary]);

    return now;
}

/** 配色光效外壳：深色底 + 缓慢流动的光晕，内容与尾部操作由调用方放入。 */
export function BannerAnnouncementShell({ noticeType, paused, trailing, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { noticeType?: string | null; paused?: boolean; trailing?: ReactNode }) {
    return (
        <div {...rest} className={cn("notice-banner", paused && "is-paused", className)} data-notice-type={normalizeBannerNoticeType(noticeType)}>
            <span className="notice-banner-backdrop" aria-hidden="true">
                <span className="notice-banner-aurora" />
            </span>
            {children}
            {trailing ? <div className="notice-banner-trailing">{trailing}</div> : null}
        </div>
    );
}

/** 倒计时数字块：天（大于 0 时）/ 时 / 分 / 秒，数字变化时自上而下翻入。 */
export function BannerAnnouncementCountdown({ target, now }: { target: number; now: number }) {
    const { days, hours, minutes, seconds } = bannerCountdownParts(target - now);
    const pad = (value: number) => String(value).padStart(2, "0");
    const groups = days > 0 ? [pad(days), pad(hours), pad(minutes), pad(seconds)] : [pad(hours), pad(minutes), pad(seconds)];
    const label = `距结束还有${days > 0 ? ` ${days} 天` : ""} ${hours} 小时 ${minutes} 分 ${seconds} 秒`;

    return (
        <span className="notice-banner-countdown" role="timer" aria-label={label}>
            {groups.map((group, groupIndex) => (
                <Fragment key={groupIndex}>
                    {groupIndex > 0 ? (
                        <span className="notice-banner-countdown-colon" aria-hidden="true">
                            :
                        </span>
                    ) : null}
                    {Array.from(group).map((digit, digitIndex) => (
                        <span key={`${groupIndex}-${digitIndex}`} className="notice-banner-digit" aria-hidden="true">
                            {/* 以数字为 key：变化时重新挂载，播放翻入动画。 */}
                            <span key={digit} className="notice-banner-digit-value">
                                {digit}
                            </span>
                        </span>
                    ))}
                </Fragment>
            ))}
        </span>
    );
}

/** 行动按钮：白底深字的实心按钮，是通知条的视觉落点；只在通知可点击时渲染。 */
export function BannerAnnouncementCta({ label }: { label: string }) {
    return (
        <span className="notice-banner-cta">
            <span className="notice-banner-cta-label">{label}</span>
            <ArrowRight className="notice-banner-cta-icon" aria-hidden="true" />
        </span>
    );
}

/**
 * 通知标题：按样式分段输出行内 span，未设置样式的维度沿用外层类名（通知条为白色 16px 中等字重）。
 * 分段为空时回落到纯文本标题，避免旧数据不显示。
 */
export function BannerAnnouncementTitle({ runs, fallbackText }: { runs?: BannerTitleRun[] | null; fallbackText?: string }) {
    if (!runs || !runs.length) {
        return <>{fallbackText || ""}</>;
    }
    return (
        <>
            {runs.map((run, index) => {
                const style = bannerTitleRunStyle(run);
                return (
                    <span key={`${index}:${run.text}`} style={style}>
                        {run.text}
                    </span>
                );
            })}
        </>
    );
}

/** 标题放不下时左右往返滚动，完整展示长通知；减少动态效果时改为省略号截断。 */
function BannerAnnouncementMarquee({ children, motion, contentKey }: { children: ReactNode; motion: boolean; contentKey: string }) {
    const viewportRef = useRef<HTMLSpanElement | null>(null);
    const trackRef = useRef<HTMLSpanElement | null>(null);
    const [overflow, setOverflow] = useState(0);

    // 只在标题内容变化时重新挂观察器；宽度变化（窗口缩放、倒计时出现）由 ResizeObserver 跟进。
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const track = trackRef.current;
        if (!viewport || !track) return;
        const measure = () => setOverflow(Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth)));
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        observer.observe(track);
        return () => observer.disconnect();
    }, [contentKey]);

    const scrolling = motion && overflow > 8;
    // 约 32px/秒匀速移动，两端各停留一段时间方便阅读。
    const style = scrolling ? ({ "--nb-marquee-distance": `${-overflow}px`, "--nb-marquee-duration": `${Math.max(6, overflow / 32 / 0.76).toFixed(2)}s` } as CSSProperties) : undefined;

    return (
        <span ref={viewportRef} className={cn("notice-banner-title", scrolling && "is-scrolling")} style={style}>
            <span ref={trackRef} className="notice-banner-title-track">
                {children}
            </span>
        </span>
    );
}

/** 通知条内容：倒计时（可选）+ 标题 + 行动按钮（可选），前台与预览共用。 */
export function BannerAnnouncementBody({
    titleRuns,
    title,
    ctaLabel,
    countdownTarget,
    now,
    motion = true,
}: {
    titleRuns?: BannerTitleRun[] | null;
    title?: string;
    /** 为空表示通知不可点击，不显示按钮。 */
    ctaLabel?: string;
    countdownTarget?: number | null;
    now: number;
    motion?: boolean;
}) {
    return (
        <>
            {countdownTarget ? <BannerAnnouncementCountdown target={countdownTarget} now={now} /> : null}
            <BannerAnnouncementMarquee motion={motion} contentKey={bannerTitlePlainText(titleRuns) || title || ""}>
                <BannerAnnouncementTitle runs={titleRuns} fallbackText={title} />
            </BannerAnnouncementMarquee>
            {ctaLabel ? <BannerAnnouncementCta label={ctaLabel} /> : null}
        </>
    );
}
