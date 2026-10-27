import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMoon } from "../src/components/canvas/agent-moon";
import { PetAvatar } from "../src/components/canvas/pet-avatar";
import { AGENT_AVATAR_STATES, DEFAULT_CANVAS_APPEARANCE, assistantAppearance } from "../src/lib/canvas/agent-appearance";
import { AGENT_MOON_BAR, AGENT_MOON_MIN_BAR, AGENT_MOON_SPAN, AGENT_MOON_STRIPES, agentMoonMode, agentMoonStripeThickness } from "../src/lib/canvas/agent-moon";
import { petAvatarSize } from "../src/lib/canvas/pet-menu";

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

test("flow keyframes follow the thickness curve across the whole moon", () => {
    const css = readFileSync(new URL("../src/components/canvas/agent-moon.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf("@keyframes agent-moon-flow"), css.indexOf("@keyframes agent-moon-breathe"));
    const frames = [...block.matchAll(/([\d.]+)%\s*\{\s*transform:\s*translateY\(([\d.]+)(?:px)?\)\s*scaleY\(([\d.]+)\)/g)].map((match) => match.slice(1).map(Number));
    expect(frames).toHaveLength(9);
    for (const [percent, offset, scale] of frames) {
        expect(offset).toBeCloseTo((AGENT_MOON_SPAN * percent) / 100, 5);
        expect(scale).toBeCloseTo(agentMoonStripeThickness(percent / 100) / AGENT_MOON_BAR, 2);
    }
    expect(css).toContain(`/ -${AGENT_MOON_STRIPES})`);
});

test("no state fades the moon out: stopped stays clearly visible on dark canvases", () => {
    const css = readFileSync(new URL("../src/components/canvas/agent-moon.css", import.meta.url), "utf8");
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
