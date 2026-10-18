import type { SpritePet } from "./sprite-pet";

export type CanvasAppearance = {
    defaultPetId?: string;
    agentName: string;
    launcherLabel: string;
    panelTitle: string;
    welcomeTitle: string;
    welcomeDescription: string;
    inputPlaceholder: string;
    avatarType: "orb" | "live2d" | "sprite";
    live2dResourceId: string;
    live2dEntry: string;
    avatarHeight: number;
    spriteResourceId?: string;
    sprite?: SpritePet;
};

export const DEFAULT_CANVAS_APPEARANCE: CanvasAppearance = {
    agentName: "影策",
    launcherLabel: "Agent",
    panelTitle: "画布助手",
    welcomeTitle: "在这里，和{agentName}让灵感，慢慢成形",
    welcomeDescription: "从一个想法开始，和{agentName}一起创作。",
    inputPlaceholder: "输入操作指导；用 @ 引用画布节点，用 / 或 、 引用 Skills",
    avatarType: "orb",
    live2dResourceId: "",
    live2dEntry: "",
    avatarHeight: 220,
};

export function agentCopy(template: string, name: string) {
    return template.replaceAll("{agentName}", () => name);
}
