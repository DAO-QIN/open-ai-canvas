import type { AgentAvatarState } from "./agent-appearance";

/** 光圈形象的视觉状态：8 种运行状态归并成 7 种动效。 */
export type AgentApertureMode = "idle" | "working" | "waiting" | "approval" | "done" | "failed" | "sleep";

export function agentApertureMode(state: AgentAvatarState): AgentApertureMode {
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

const RADIUS = 44;
const HOLE = 12;
const BLADES = 6;
const round = (value: number) => Number(value.toFixed(2));

/**
 * 六片叶片拼满整圆：每片由相邻两条与中心孔相切的射线夹出，外缘贴合圆周，内侧汇于圆心，
 * 中心孔由遮罩控制开合，因此光孔可以完全闭合。
 */
export function agentApertureGeometry() {
    const reach = Math.sqrt(RADIUS * RADIUS - HOLE * HOLE);
    const tangent = [] as [number, number][];
    const edge = [] as [number, number][];
    for (let index = 0; index < BLADES; index++) {
        const angle = (index * 2 * Math.PI) / BLADES;
        const point: [number, number] = [50 + HOLE * Math.cos(angle), 50 + HOLE * Math.sin(angle)];
        tangent.push(point);
        edge.push([point[0] - reach * Math.sin(angle), point[1] + reach * Math.cos(angle)]);
    }
    const blades = tangent.map((point, index) => {
        const next = (index + 1) % BLADES;
        return `M${round(point[0])} ${round(point[1])}L${round(edge[index][0])} ${round(edge[index][1])}A${RADIUS} ${RADIUS} 0 0 1 ${round(edge[next][0])} ${round(edge[next][1])}L${round(tangent[next][0])} ${round(tangent[next][1])}L50 50Z`;
    });
    // 缝隙线略微越过圆周，保证叶片之间的切口一直通到边缘。
    const seams = tangent
        .map((point, index) => {
            const end = [point[0] + (edge[index][0] - point[0]) * 1.05, point[1] + (edge[index][1] - point[1]) * 1.05];
            return `M${round(point[0])} ${round(point[1])}L${round(end[0])} ${round(end[1])}`;
        })
        .join("");
    return { radius: RADIUS, hole: HOLE, blades, seams };
}

export const AGENT_APERTURE_GEOMETRY = agentApertureGeometry();
/** 叶片明暗交错，转动时能看出层次。 */
export const AGENT_APERTURE_BLADE_OPACITY = [1, 0.8, 0.93, 0.72, 0.9, 0.78] as const;
