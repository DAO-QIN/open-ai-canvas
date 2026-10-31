export const DEFAULT_CREATION_TITLE = "和{brandName}聊聊创作想法";
export const DEFAULT_CREATION_DESCRIPTION = "从一个画面、一个角色或一句话开始。";
// 「画布」面（/create?mode=canvas）的文案和「生成」面分开，在后台「外观设置 → 创作首页」各自配置。
export const DEFAULT_CREATION_CANVAS_TITLE = "从一张画布，展开你的灵感";
export const DEFAULT_CREATION_CANVAS_DESCRIPTION = "新建空白画布，或复制一张精选画布。";

export type CreationCopySurface = "generate" | "canvas";

const DEFAULT_CREATION_COPY: Record<CreationCopySurface, { title: string; description: string }> = {
    generate: { title: DEFAULT_CREATION_TITLE, description: DEFAULT_CREATION_DESCRIPTION },
    canvas: { title: DEFAULT_CREATION_CANVAS_TITLE, description: DEFAULT_CREATION_CANVAS_DESCRIPTION },
};

/** 标题留空用这一面的默认标题；副标题只在缺省时取默认，空串表示隐藏。两段里的 {brandName} 换成当前品牌名。 */
export function resolveCreationCopy(brandName: string, title?: string, description?: string, surface: CreationCopySurface = "generate") {
    const defaults = DEFAULT_CREATION_COPY[surface];
    const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim();
    return {
        title: (normalize(title ?? "") || defaults.title).replaceAll("{brandName}", () => brandName),
        description: normalize(description ?? defaults.description).replaceAll("{brandName}", () => brandName),
    };
}
