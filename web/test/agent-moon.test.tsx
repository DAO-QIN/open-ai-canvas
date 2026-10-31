import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMoon } from "../src/components/canvas/agent-moon";
import { PetAvatar } from "../src/components/canvas/pet-avatar";
import { AGENT_AVATAR_STATES, DEFAULT_CANVAS_APPEARANCE, assistantAppearance } from "../src/lib/canvas/agent-appearance";
import { AGENT_MOON_BAR, AGENT_MOON_LOOP, AGENT_MOON_MAX_BAR_SCALE, AGENT_MOON_MIN_BAR, AGENT_MOON_PITCHES, AGENT_MOON_SPAN, AGENT_MOON_STRIPES, AGENT_MOON_TOP, agentMoonMode, agentMoonStripeThickness } from "../src/lib/canvas/agent-moon";
import { petAvatarSize } from "../src/lib/canvas/pet-menu";

const moonCSS = () => readFileSync(new URL("../src/components/canvas/agent-moon.css", import.meta.url), "utf8");

/** [百分比, 条纹中心 y, scaleY]，按 CSS 关键帧原样解析。 */
function flowFrames() {
    const css = moonCSS();
    const block = css.slice(css.indexOf("@keyframes agent-moon-flow"), css.indexOf("@keyframes agent-moon-breathe"));
    return [...block.matchAll(/([\d.]+)%\s*\{\s*transform:\s*translateY\(([\d.]+)(?:px)?\)\s*scaleY\(([\d.]+)\)/g)].map((match) => match.slice(1).map(Number));
}

/** 按浏览器的线性插值求某个流动进度上的条纹上下沿。 */
function stripeAt(frames: number[][], progress: number, barScale: number) {
    const percent = progress * 100;
    const after = frames.findIndex(([at]) => at >= percent);
    const next = Math.max(1, after);
    const [p0, y0, s0] = frames[next - 1];
    const [p1, y1, s1] = frames[next];
    const k = (percent - p0) / (p1 - p0);
    const center = y0 + (y1 - y0) * k;
    const half = (AGENT_MOON_BAR * (s0 + (s1 - s0) * k) * barScale) / 2;
    return [center - half, center + half] as const;
}

test("every run state maps to a moon motion", () => {
    expect(AGENT_AVATAR_STATES.map((state) => agentMoonMode(state.id))).toEqual(["idle", "waiting", "working", "approval", "done", "failed", "sleep", "sleep"]);
});

test("stripes thin out from the top of the moon to the bottom", () => {
    expect(agentMoonStripeThickness(0)).toBeCloseTo(AGENT_MOON_BAR, 5);
    for (let step = 1; step <= 8; step++) expect(agentMoonStripeThickness(step / 8)).toBeLessThan(agentMoonStripeThickness((step - 1) / 8));
    expect(agentMoonStripeThickness(1)).toBeCloseTo(AGENT_MOON_MIN_BAR, 5);
    // 84px 显示时最细的条纹也约有 1px。
    expect((agentMoonStripeThickness(1) * 84) / 100).toBeGreaterThan(0.9);
});

test("flow keyframes follow the thickness curve and wrap outside the moon", () => {
    const css = moonCSS();
    const frames = flowFrames();
    expect(frames[0]).toEqual([0, 0, 1]);
    expect(frames.at(-1)?.[0]).toBe(100);
    expect(frames.at(-1)?.[1]).toBeCloseTo(AGENT_MOON_LOOP, 2);
    for (const [percent, offset, scale] of frames) {
        expect(percent).toBeCloseTo((offset / AGENT_MOON_LOOP) * 100, 2);
        expect(scale).toBeCloseTo(agentMoonStripeThickness((offset - AGENT_MOON_TOP) / AGENT_MOON_SPAN) / AGENT_MOON_BAR, 2);
    }
    // 圆内每 1/8 取样一次粗细曲线。
    const inside = frames.map(([, offset]) => offset).filter((offset) => offset >= AGENT_MOON_TOP && offset <= AGENT_MOON_TOP + AGENT_MOON_SPAN);
    expect(inside).toEqual(Array.from({ length: 9 }, (_, step) => AGENT_MOON_TOP + (AGENT_MOON_SPAN * step) / 8));
    // 起点和终点的条纹按最大倍数放大后也完全在圆外，回到起点这一下看不见。
    expect((AGENT_MOON_BAR * AGENT_MOON_MAX_BAR_SCALE) / 2).toBeLessThanOrEqual(AGENT_MOON_TOP);
    expect(AGENT_MOON_LOOP - (AGENT_MOON_MIN_BAR * AGENT_MOON_MAX_BAR_SCALE) / 2).toBeGreaterThanOrEqual(AGENT_MOON_TOP + AGENT_MOON_SPAN);
    expect(css).toContain(`scaleY(${AGENT_MOON_MAX_BAR_SCALE})`);
    // 一圈 13 个间距，相邻条纹错开 1 个间距；--agent-moon-duration 仍是过圆（12 个间距）的时间。
    expect(css).toContain(`* ${AGENT_MOON_STRIPES} / ${AGENT_MOON_PITCHES})`);
    expect(css).toContain(`/ -${AGENT_MOON_PITCHES})`);
});

test("the top of the moon stays covered at every moment of the flow", () => {
    const frames = flowFrames();
    const steps = 400 * AGENT_MOON_STRIPES;
    let worst = Infinity;
    // 待命、悬停变粗、排队和审批呼吸的条纹倍数。
    for (const barScale of [1, 1.15, 1.2, AGENT_MOON_MAX_BAR_SCALE]) {
        for (let step = 0; step < steps; step++) {
            const bars = Array.from({ length: AGENT_MOON_STRIPES }, (_, index) => stripeAt(frames, (step / steps + index / AGENT_MOON_STRIPES) % 1, barScale)).sort((a, b) => a[0] - b[0]);
            // 把从圆顶之上开始、首尾相接的条纹并成一段，看它能盖到圆顶以下多深。
            let reach = -Infinity;
            for (const [start, end] of bars) {
                if (start > Math.max(reach, AGENT_MOON_TOP)) break;
                reach = Math.max(reach, end);
            }
            worst = Math.min(worst, reach - AGENT_MOON_TOP);
        }
    }
    expect(worst).toBeGreaterThanOrEqual(1);
});

test("no state fades the moon out: stopped stays clearly visible on dark canvases", () => {
    const css = moonCSS();
    expect(css).not.toContain("agent-moon-halo");
    expect(css).not.toContain("drop-shadow");
    const rest = css.slice(css.indexOf("@keyframes agent-moon-rest"), css.indexOf("@keyframes agent-moon-glitch"));
    const levels = [...rest.matchAll(/opacity:\s*([\d.]+)/g)].map((match) => Number(match[1]));
    expect(levels.length).toBeGreaterThan(0);
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(0.75);
    const sleepBar = css.match(/data-mode="sleep"\] \.agent-moon-bar \{\s*transform: scaleY\(([\d.]+)\)/);
    expect(Number(sleepBar?.[1])).toBeGreaterThanOrEqual(0.8);
    for (const match of css.matchAll(/\.agent-moon-body \{[^}]*?opacity:\s*([\d.]+)/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(0.75);
});

test("moon follows the theme colour, glows faint white and keeps ids unique per instance", () => {
    const html = renderToStaticMarkup(
        <>
            <AgentMoon size={84} state="running" />
            <AgentMoon size={40} state="waiting_approval" reducedMotion paused />
        </>,
    );
    expect(html).toContain('data-mode="working"');
    expect(html).toContain('data-mode="approval"');
    expect(html).toContain('stop-color="currentColor"');
    expect(html).toContain('stop-color="#fff"');
    expect(html.match(/class="agent-moon-stripe"/g)).toHaveLength(AGENT_MOON_STRIPES * 2);
    expect(html).toContain("data-reduced-motion");
    expect(html).toContain("data-paused");
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html).toContain(`url(#${id})`);
});

test("shared assistant keeps the moon type and renders it for run states", () => {
    const appearance = assistantAppearance({ ...DEFAULT_CANVAS_APPEARANCE, avatarType: "moon" });
    expect(appearance.avatarType).toBe("moon");
    expect(petAvatarSize(appearance, 100)).toEqual({ width: 72, height: 72 });
    const html = renderToStaticMarkup(<PetAvatar appearance={appearance} height={100} paused={false} reducedMotion state={{ status: "completed" }} />);
    expect(html).toContain('class="agent-moon"');
    expect(html).toContain('data-mode="done"');
    expect(html).not.toContain("fluid-orb");
});
