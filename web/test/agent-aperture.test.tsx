import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentAperture } from "../src/components/canvas/agent-aperture";
import { PetAvatar } from "../src/components/canvas/pet-avatar";
import { AGENT_AVATAR_STATES, DEFAULT_CANVAS_APPEARANCE, assistantAppearance } from "../src/lib/canvas/agent-appearance";
import { AGENT_APERTURE_GEOMETRY, agentApertureMode } from "../src/lib/canvas/agent-aperture";
import { petAvatarSize } from "../src/lib/canvas/pet-menu";

test("every run state maps to an aperture motion", () => {
    expect(AGENT_AVATAR_STATES.map((state) => agentApertureMode(state.id))).toEqual(["idle", "waiting", "working", "approval", "done", "failed", "sleep", "sleep"]);
});

test("six blades fill the whole circle and meet at the centre so the hole can close", () => {
    const { blades, seams, radius, hole } = AGENT_APERTURE_GEOMETRY;
    expect(blades).toHaveLength(6);
    expect(radius).toBe(44);
    expect(hole).toBe(12);
    for (const blade of blades) {
        expect(blade).toContain(`A${radius} ${radius} 0 0 1`);
        expect(blade.endsWith("L50 50Z")).toBe(true);
    }
    expect(seams.match(/M/g)).toHaveLength(6);
    // Every blade edge ends on the circle: no outer ring, no base disc.
    for (const match of blades.join("").matchAll(/A44 44 0 0 1 ([\d.]+) ([\d.]+)/g)) {
        expect(Math.hypot(Number(match[1]) - 50, Number(match[2]) - 50)).toBeCloseTo(radius, 1);
    }
});

test("aperture follows the theme colour and keeps ids unique per instance", () => {
    const html = renderToStaticMarkup(
        <>
            <AgentAperture size={84} state="running" />
            <AgentAperture size={40} state="waiting_approval" reducedMotion paused />
        </>,
    );
    expect(html).toContain('data-mode="working"');
    expect(html).toContain('data-mode="approval"');
    expect(html).toContain('stop-color="currentColor"');
    expect(html).toContain("data-reduced-motion");
    expect(html).toContain("data-paused");
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html).toContain(`url(#${id})`);
    expect(html).not.toContain("<image");
});

test("shared assistant keeps the aperture type and renders it for run states", () => {
    const appearance = assistantAppearance({ ...DEFAULT_CANVAS_APPEARANCE, avatarType: "aperture" });
    expect(appearance.avatarType).toBe("aperture");
    expect(petAvatarSize(appearance, 100)).toEqual({ width: 72, height: 72 });
    const html = renderToStaticMarkup(<PetAvatar appearance={appearance} height={100} paused={false} reducedMotion state={{ status: "failed" }} />);
    expect(html).toContain('class="agent-aperture"');
    expect(html).toContain('data-mode="failed"');
    expect(html).not.toContain("fluid-orb");
});
