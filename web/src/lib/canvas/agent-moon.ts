import type { AgentAvatarState } from "./agent-appearance";

/** 渐变满月的视觉状态：8 种运行状态归并成 7 种动效。 */
export type AgentMoonMode = "idle" | "working" | "waiting" | "approval" | "done" | "failed" | "sleep";

export function agentMoonMode(state: AgentAvatarState): AgentMoonMode {
    switch (state) {
        case "running":
            return "working";
        case "queued":
            return "waiting";
        case "waiting_approval":
            return "approval";
        case "completed":
            return "done";
        case "failed":
            return "failed";
        case "cancelled":
        case "rejected":
            return "sleep";
        default:
            return "idle";
    }
}

/** 圆半径与条纹数量：12 道条纹从圆顶流向圆底，越往下越细。 */
export const AGENT_MOON_RADIUS = 44;
export const AGENT_MOON_STRIPES = 12;
export const AGENT_MOON_TOP = 50 - AGENT_MOON_RADIUS;
export const AGENT_MOON_SPAN = AGENT_MOON_RADIUS * 2;
/** 圆顶处条纹最粗的厚度（viewBox 单位）。 */
export const AGENT_MOON_BAR = 7.75;
/** 圆底处条纹最细的厚度：84px 时约 1px，复杂背景上也不会细到消失。 */
export const AGENT_MOON_MIN_BAR = 1.1;

/** 条纹在流动进度 progress（0 = 圆顶，1 = 圆底）处的厚度；CSS 关键帧按此取样。 */
export function agentMoonStripeThickness(progress: number) {
    const clamped = Math.min(1, Math.max(0, progress));
    return AGENT_MOON_MIN_BAR + (AGENT_MOON_BAR - AGENT_MOON_MIN_BAR) * Math.pow(1 - clamped, 1.3);
}
