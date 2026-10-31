import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import { cumulativeUsage, formatUsageCreditsExact, formatUsageDay, usageLevelScale, type UsageDay, type UsageMonthLabel, type UsageWeek } from "@/lib/credit-usage";

export type UsageView = "daily" | "weekly" | "cumulative";

type TooltipPosition = { left: number; top: number; align: "start" | "center" | "end" };

type UsageActivityChartProps = {
    view: UsageView;
    days: UsageDay[];
    weeks: UsageWeek[];
    monthLabels: UsageMonthLabel[];
    /** 消耗构成正在展示的单日（每日视图）或单周（每周视图）下标；累计视图不选中。 */
    selected?: number | null;
    /** 点击、轻点或用方向键移到某一天 / 某一周时调用；累计视图不调用。 */
    onSelect?: (index: number) => void;
};

// 面积图纵向留白（viewBox 百分比），让曲线不贴顶也不压住底边。
const AREA_TOP = 6;
const AREA_BOTTOM = 96;

/** 累计面积图：x 与热力图同列对齐（每天占 1/7 列），y 按累计最大值归一。 */
function buildArea(days: UsageDay[], leading: number) {
    const cumulative = cumulativeUsage(days);
    const max = cumulative.at(-1) ?? 0;
    const x = (index: number) => leading + index + 0.5;
    const y = (index: number) => (max > 0 ? AREA_BOTTOM - (cumulative[index] / max) * (AREA_BOTTOM - AREA_TOP) : AREA_BOTTOM);
    if (days.length === 0) return { cumulative, x, y, linePath: "", areaPath: "" };
    const points = days.map((_, index) => `${x(index).toFixed(2)} ${y(index).toFixed(2)}`).join(" L ");
    const first = x(0).toFixed(2);
    const last = x(days.length - 1).toFixed(2);
    return { cumulative, x, y, linePath: `M ${points}`, areaPath: `M ${first} ${AREA_BOTTOM} L ${points} L ${last} ${AREA_BOTTOM} Z` };
}

/**
 * 积分活动图：每日热力图、每周柱状图与累计面积图共用同一套 53 列网格，
 * 切换视图时高度和月份刻度保持不变。悬停，或聚焦后用方向键，查看单日/单周数值；
 * 每日、每周视图里点击或方向键同时选中该项，消耗构成随之切换。
 */
export function UsageActivityChart({ view, days, weeks, monthLabels, selected = null, onSelect }: UsageActivityChartProps) {
    const chartRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const areaRef = useRef<HTMLDivElement>(null);
    const baseId = `usage-chart-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const [active, setActive] = useState<number | null>(null);
    const [tooltip, setTooltip] = useState<TooltipPosition | null>(null);
    // 键盘移动选中项时把它滚进可视区；指针选中的项本来就在视口内，不需要滚动。
    const followActiveRef = useRef(false);
    const columns = weeks.length;
    const cellCount = columns * 7;
    const leading = days.length > 0 ? days[0].weekday : 0;
    const area = useMemo(() => buildArea(days, leading), [days, leading]);
    const weekMax = useMemo(() => weeks.reduce((max, week) => Math.max(max, week.value), 0), [weeks]);
    const weekLevel = useMemo(() => usageLevelScale(weeks.map((week) => week.value)), [weeks]);
    const months = useMemo(() => monthlyTotals(days), [days]);
    const lastIndex = view === "weekly" ? columns - 1 : days.length - 1;
    // 累计曲线只看数值，不选中。
    const select = view === "cumulative" ? undefined : onSelect;
    const selectedIndex = select && selected !== null && selected >= 0 && selected <= lastIndex ? selected : null;

    useEffect(() => {
        setActive(null);
    }, [view, days]);

    // 窄屏横向滚动时默认停在最近一周。
    useLayoutEffect(() => {
        const scroller = scrollRef.current;
        if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    }, [columns]);

    // 桌面端根元素有缩放，提示框坐标统一换算回图表自身的 CSS 像素。
    useLayoutEffect(() => {
        const chart = chartRef.current;
        const anchor = active === null ? null : chart?.querySelector<HTMLElement>("[data-usage-anchor='true']");
        if (!chart || !anchor) {
            setTooltip(null);
            return;
        }
        if (followActiveRef.current) {
            followActiveRef.current = false;
            anchor.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        }
        const chartRect = chart.getBoundingClientRect();
        const rect = anchor.getBoundingClientRect();
        const scale = chart.offsetWidth > 0 ? chartRect.width / chart.offsetWidth : 1;
        const left = (rect.left + rect.width / 2 - chartRect.left) / scale;
        const top = (rect.top - chartRect.top) / scale;
        const width = chart.offsetWidth;
        setTooltip({ left, top, align: left < 96 ? "start" : left > width - 96 ? "end" : "center" });
    }, [active, view]);

    const activeDay = active !== null && view !== "weekly" ? days[active] : undefined;
    const activeWeek = active !== null && view === "weekly" ? weeks[active] : undefined;
    const description = describeActive(view, activeDay, activeWeek, activeDay ? area.cumulative[active!] : 0);

    const pickDay = (event: PointerEvent<HTMLElement>) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-day]");
        setActive(target ? Number(target.dataset.day) : null);
    };
    const pickWeek = (event: PointerEvent<HTMLElement>) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-week]");
        setActive(target ? Number(target.dataset.week) : null);
    };
    const pickArea = (event: PointerEvent<HTMLElement>) => {
        const element = areaRef.current;
        if (!element || days.length === 0) return;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0) return;
        const slot = Math.floor(((event.clientX - rect.left) / rect.width) * cellCount);
        setActive(Math.min(days.length - 1, Math.max(0, slot - leading)));
    };

    const onClick = (event: MouseEvent<HTMLDivElement>) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(view === "daily" ? "[data-day]" : "[data-week]");
        if (target) select?.(Number(view === "daily" ? target.dataset.day : target.dataset.week));
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (lastIndex < 0) return;
        const current = active ?? selectedIndex ?? lastIndex;
        const steps: Record<string, number> =
            view === "daily"
                ? { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
                : view === "weekly"
                  ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }
                  : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -30, PageDown: 30 };
        let next: number;
        if (event.key in steps) next = current + steps[event.key];
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = lastIndex;
        else if (event.key === "Escape") {
            setActive(null);
            return;
        } else return;
        event.preventDefault();
        followActiveRef.current = true;
        const target = Math.min(lastIndex, Math.max(0, next));
        setActive(target);
        // 选中跟随方向键，键盘用户不必再按确认键，消耗构成直接切到这一项。
        select?.(target);
    };

    // 触屏没有悬停：按下即显示所点格子/柱子的提示框，抬起后的 click 再把它选为构成；鼠标仍由移动决定提示框。
    const pick = view === "daily" ? pickDay : view === "weekly" ? pickWeek : pickArea;
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "mouse") pick(event);
    };
    const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
        // 触屏抬起后也会触发 pointerleave，保留刚点中的提示框。
        if (event.pointerType === "mouse") setActive(null);
    };

    // 聚焦时若没有悬停项，从消耗构成正在展示的一项（默认最近一项）开始，方向键由此移动；鼠标点击时悬停项已由指针决定。
    const onFocus = (event: FocusEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        setActive((current) => current ?? selectedIndex ?? (lastIndex >= 0 ? lastIndex : null));
    };

    return (
        <div ref={chartRef} className="usage-chart" data-view={view} data-selectable={select ? "true" : undefined}>
            <div
                ref={scrollRef}
                className="usage-chart-scroll"
                role="group"
                tabIndex={0}
                aria-label={`${viewLabel(view)}，聚焦后可用方向键逐项查看${select ? "，消耗构成随之切换" : ""}`}
                aria-describedby={`${baseId}-live`}
                onKeyDown={onKeyDown}
                onFocus={onFocus}
                onBlur={() => setActive(null)}
                onClick={select ? onClick : undefined}
                onPointerDown={onPointerDown}
                onPointerLeave={onPointerLeave}
            >
                <div className="usage-chart-body" style={{ "--usage-columns": columns } as CSSProperties}>
                    <div className="usage-chart-plot">
                        <div className="usage-heatmap" aria-hidden="true" onPointerMove={view === "daily" ? pickDay : undefined}>
                            {weeks.map((week, column) =>
                                week.cells.map((cell, row) =>
                                    cell.index < 0 ? (
                                        <span key={`${column}-${row}`} className="usage-cell is-padding" />
                                    ) : (
                                        <span
                                            key={`${column}-${row}`}
                                            className="usage-cell"
                                            data-level={cell.level}
                                            data-day={cell.index}
                                            data-selected={view === "daily" && selectedIndex === cell.index ? "true" : undefined}
                                            data-active={view === "daily" && active === cell.index ? "true" : undefined}
                                            data-usage-anchor={view === "daily" && active === cell.index ? "true" : undefined}
                                        />
                                    ),
                                ),
                            )}
                        </div>
                        {view === "weekly" ? (
                            <div className="usage-bars" aria-hidden="true" onPointerMove={pickWeek}>
                                {weeks.map((week, index) => (
                                    <span key={index} className="usage-bar-slot" data-week={index} data-selected={selectedIndex === index ? "true" : undefined} data-active={active === index ? "true" : undefined}>
                                        <span
                                            className="usage-bar"
                                            data-level={weekLevel(week.value)}
                                            data-usage-anchor={active === index ? "true" : undefined}
                                            style={week.value > 0 && weekMax > 0 ? { height: `max(3px, ${((week.value / weekMax) * 100).toFixed(2)}%)` } : undefined}
                                        />
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {view === "cumulative" ? (
                            <div ref={areaRef} className="usage-area" aria-hidden="true" onPointerMove={pickArea}>
                                <svg viewBox={`0 0 ${cellCount} 100`} preserveAspectRatio="none" focusable="false">
                                    <defs>
                                        <linearGradient id={`${baseId}-fill`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                                            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    <line className="usage-area-baseline" x1="0" x2={cellCount} y1={AREA_BOTTOM} y2={AREA_BOTTOM} vectorEffect="non-scaling-stroke" />
                                    {area.areaPath ? <path d={area.areaPath} fill={`url(#${baseId}-fill)`} /> : null}
                                    {area.linePath ? <path className="usage-area-line" d={area.linePath} vectorEffect="non-scaling-stroke" /> : null}
                                </svg>
                                {activeDay ? (
                                    <>
                                        <span className="usage-area-guide" style={{ left: `${(area.x(active!) / cellCount) * 100}%` }} />
                                        <span className="usage-area-dot" data-usage-anchor="true" style={{ left: `${(area.x(active!) / cellCount) * 100}%`, top: `${area.y(active!)}%` }} />
                                    </>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <div className="usage-months" aria-hidden="true">
                        {monthLabels.map((label) => (
                            // 跨度收在 53 列内，末尾月份不能撑出隐式列，否则刻度会与周列错位。
                            <span key={label.column} style={{ gridColumn: `${label.column + 1} / span ${Math.max(1, Math.min(4, columns - label.column))}` }}>
                                {label.label}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            {tooltip && description ? (
                <div className="usage-tooltip" data-align={tooltip.align} style={{ left: tooltip.left, top: tooltip.top }} aria-hidden="true">
                    <strong>{description.title}</strong>
                    <span>{description.body}</span>
                    {description.note ? <em>{description.note}</em> : null}
                </div>
            ) : null}
            <p id={`${baseId}-live`} className="sr-only" aria-live="polite">
                {description ? [description.title, description.body, description.note].filter(Boolean).join("，") : ""}
            </p>
            {/* 读屏浏览模式不会把方向键交给图表，这里给出可逐行阅读的按月汇总。 */}
            <table className="sr-only">
                <caption>每月积分消耗</caption>
                <thead>
                    <tr>
                        <th scope="col">月份</th>
                        <th scope="col">消耗积分</th>
                        <th scope="col">笔数</th>
                        <th scope="col">活跃天数</th>
                    </tr>
                </thead>
                <tbody>
                    {months.map((month) => (
                        <tr key={month.key}>
                            <th scope="row">{month.label}</th>
                            <td>{formatUsageCreditsExact(month.value)}</td>
                            <td>{month.count.toLocaleString("zh-CN")}</td>
                            <td>{month.activeDays}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function monthlyTotals(days: UsageDay[]) {
    const months: Array<{ key: string; label: string; value: number; count: number; activeDays: number }> = [];
    for (const day of days) {
        const key = day.date.slice(0, 7);
        let month = months.at(-1);
        if (!month || month.key !== key) {
            month = { key, label: `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月`, value: 0, count: 0, activeDays: 0 };
            months.push(month);
        }
        month.value += day.value;
        month.count += day.count;
        if (day.value > 0) month.activeDays += 1;
    }
    return months;
}

function viewLabel(view: UsageView) {
    return view === "daily" ? "每日积分消耗热力图" : view === "weekly" ? "每周积分消耗柱状图" : "累计积分消耗曲线";
}

function describeActive(view: UsageView, day: UsageDay | undefined, week: UsageWeek | undefined, cumulative: number) {
    if (view === "weekly") {
        if (!week) return null;
        return {
            title: week.start === week.end ? formatUsageDay(week.start, false) : `${formatUsageDay(week.start, false)} – ${formatUsageDay(week.end, false)}`,
            body: week.value > 0 ? `${formatUsageCreditsExact(week.value)} 积分 · ${week.count.toLocaleString("zh-CN")} 笔` : "本周无消耗",
            note: "",
        };
    }
    if (!day) return null;
    if (view === "cumulative") {
        return {
            title: formatUsageDay(day.date),
            body: `累计 ${formatUsageCreditsExact(cumulative)} 积分`,
            note: day.value > 0 ? `当日 ${formatUsageCreditsExact(day.value)} 积分` : "当日无消耗",
        };
    }
    return {
        title: formatUsageDay(day.date),
        body: day.value > 0 ? `${formatUsageCreditsExact(day.value)} 积分 · ${day.count.toLocaleString("zh-CN")} 笔` : "无消耗",
        note: "",
    };
}
