// 结果图工具目录：图上操作条的常用项、「更多」菜单的分组，以及由后端提示词工具驱动的预设。
// 画布图片节点上能单张出图的工具在这里都有入口；全景、图层拆分、预演台、表情和质感依赖画布节点，不放进来。

import { Camera, Clapperboard, Contrast, Crop, FastForward, Grid2x2, Grid3x3, LayoutGrid, Package, PersonStanding, Rewind, Scaling, ScanFace, ScanText, Scissors, SquareDashed, Sun, Type, type LucideIcon } from "lucide-react";

import type { CreationIconName } from "./creation-icons";

export type CreationImageToolId =
    | "variant"
    | "upscale"
    | "inpaint"
    | "expand"
    | "erase"
    | "region"
    | "textEdit"
    | "removeBackground"
    | "lighting"
    | "angle"
    | "lightCorrection"
    | "projectionBefore"
    | "projectionAfter"
    | "multiCamera"
    | "storyFourGrid"
    | "storyboard25"
    | "characterThreeView"
    | "faceThreeView"
    | "productThreeView"
    | "crop"
    | "resize"
    | "split"
    | "reversePrompt";

/** 转视频、作为参考只改输入框，不打开弹窗；其余都是弹窗工具。 */
export type CreationResultImageIntent = CreationImageToolId | "video" | "reference";

/** 弹窗标题与说明；菜单里的说明用同一份文案。 */
export const creationImageTools: Record<CreationImageToolId, { title: string; description: string }> = {
    variant: { title: "变体", description: "保持主体，按选的方向再出几版" },
    upscale: { title: "高清", description: "按原图比例用模型重绘成更清晰的版本" },
    inpaint: { title: "局部重绘", description: "涂抹要改的地方，写下改成什么" },
    expand: { title: "扩图", description: "选画幅和倍数，向四周补全画面" },
    erase: { title: "消除", description: "涂抹不想要的物体，用背景自然补上" },
    region: { title: "区域标注", description: "框选多处，用 @区域N 分别描述修改" },
    textEdit: { title: "文字编辑", description: "识别图中文字并逐行改写" },
    removeBackground: { title: "去除背景", description: "保留主体，输出透明或纯色背景" },
    lighting: { title: "打光", description: "调整光线方向、亮度与光效" },
    angle: { title: "多角度", description: "调整摄影机角度，生成新视角" },
    lightCorrection: { title: "电影级光影校正", description: "修正光影层次，让画面更有电影感" },
    projectionBefore: { title: "画面推演 · 5 秒前", description: "推演这一镜 5 秒前的画面" },
    projectionAfter: { title: "画面推演 · 3 秒后", description: "推演这一镜 3 秒后的画面" },
    multiCamera: { title: "多机位九宫格", description: "同一时刻的 3×3 多机位联系表" },
    storyFourGrid: { title: "剧情推演四宫格", description: "顺着剧情推演的 2×2 连续画面" },
    storyboard25: { title: "25 宫格连贯分镜", description: "围绕同一事件的 5×5 连贯分镜" },
    characterThreeView: { title: "角色三视图", description: "同一角色的正面、侧面和背面" },
    faceThreeView: { title: "角色脸部三视图", description: "同一张脸的正面、四分之三侧和侧面" },
    productThreeView: { title: "产品三视图", description: "同一产品的正面、侧面和背面" },
    crop: { title: "裁剪", description: "裁出一部分，放进输入框作为参考" },
    resize: { title: "调整尺寸", description: "插值放大后下载，不调用模型" },
    split: { title: "宫格切分", description: "按行列切开，下载或作为参考" },
    reversePrompt: { title: "反推提示词", description: "让模型看图写出生图提示词" },
};

export type CreationImagePrimaryAction = { intent: CreationResultImageIntent; icon: CreationIconName; label: string; title: string };

/** 图上操作条：最常用的几项平铺，其余在「更多」里。 */
export const creationImagePrimaryActions: CreationImagePrimaryAction[] = [
    { intent: "variant", icon: "variant", label: "用这张图做变体", title: "变体" },
    { intent: "upscale", icon: "hd", label: "把这张图重绘成高清版", title: "高清" },
    { intent: "inpaint", icon: "inpaint", label: "涂抹这张图的局部来重绘", title: "局部重绘" },
    { intent: "expand", icon: "expand", label: "把这张图向四周扩展", title: "扩图" },
    { intent: "erase", icon: "erase", label: "涂抹并消除这张图里的物体", title: "消除" },
    { intent: "video", icon: "toVideo", label: "用这张图做视频", title: "转视频" },
    { intent: "reference", icon: "reference", label: "把这张图作为参考", title: "作为参考" },
];

/** 输入框是 Agent 时用：结果图多半要交回给 Agent 接着改，「作为参考」排第一，其余顺序不变。 */
export const creationImagePrimaryActionsReferenceFirst: CreationImagePrimaryAction[] = [
    ...creationImagePrimaryActions.filter((action) => action.intent === "reference"),
    ...creationImagePrimaryActions.filter((action) => action.intent !== "reference"),
];

export type CreationImageMenuItem = { intent: CreationImageToolId; icon: LucideIcon };

export const creationImageMoreGroups: Array<{ title: string; items: CreationImageMenuItem[] }> = [
    {
        title: "局部编辑",
        items: [
            { intent: "region", icon: SquareDashed },
            { intent: "textEdit", icon: Type },
            { intent: "removeBackground", icon: Scissors },
        ],
    },
    {
        title: "光影与镜头",
        items: [
            { intent: "lighting", icon: Sun },
            { intent: "angle", icon: Camera },
            { intent: "lightCorrection", icon: Contrast },
            { intent: "projectionBefore", icon: Rewind },
            { intent: "projectionAfter", icon: FastForward },
        ],
    },
    {
        title: "宫格与设定",
        items: [
            { intent: "multiCamera", icon: Grid3x3 },
            { intent: "storyFourGrid", icon: Grid2x2 },
            { intent: "storyboard25", icon: Clapperboard },
            { intent: "characterThreeView", icon: PersonStanding },
            { intent: "faceThreeView", icon: ScanFace },
            { intent: "productThreeView", icon: Package },
        ],
    },
    {
        title: "图片工具",
        items: [
            { intent: "crop", icon: Crop },
            { intent: "resize", icon: Scaling },
            { intent: "split", icon: LayoutGrid },
            { intent: "reversePrompt", icon: ScanText },
        ],
    },
];

/**
 * 后端 nine_grid 提示词工具（与画布图片工具条同一批 ID）：提示词由后端按 ID 展开并校验，前端只放工具标签。
 * ratio 是该工具约定的输出画幅，original 表示沿用原图比例。iconName 只用于标签展示。
 */
export type CreationImagePresetTool = { toolId: number; label: string; iconName: string; ratio: string };

export const creationImagePresetTools: Partial<Record<CreationImageToolId, CreationImagePresetTool>> = {
    lightCorrection: { toolId: 84, label: "电影级光影校正", iconName: "Contrast", ratio: "original" },
    projectionBefore: { toolId: 87, label: "画面推演-5秒前", iconName: "Rewind", ratio: "original" },
    projectionAfter: { toolId: 86, label: "画面推演-3秒后", iconName: "FastForward", ratio: "original" },
    multiCamera: { toolId: 79, label: "多机位九宫格", iconName: "Grid3x3", ratio: "original" },
    storyFourGrid: { toolId: 80, label: "剧情推演四宫格", iconName: "Grid2x2", ratio: "original" },
    storyboard25: { toolId: 83, label: "25宫格连贯分镜", iconName: "Clapperboard", ratio: "original" },
    characterThreeView: { toolId: 85, label: "角色三视图", iconName: "PersonStanding", ratio: "16:9" },
    faceThreeView: { toolId: 81, label: "角色脸部三视图", iconName: "ScanFace", ratio: "3:2" },
    productThreeView: { toolId: 82, label: "产品三视图", iconName: "Package", ratio: "3:2" },
};

export function isCreationImageToolIntent(intent: CreationResultImageIntent): intent is CreationImageToolId {
    return intent !== "video" && intent !== "reference";
}
