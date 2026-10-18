export const DEFAULT_CREATION_TITLE = "和{brandName}聊聊创作想法";
export const DEFAULT_CREATION_DESCRIPTION = "从一个画面、一个角色或一句话开始。";

export function resolveCreationCopy(brandName: string, title?: string, description?: string) {
    const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim();
    return {
        title: (normalize(title ?? "") || DEFAULT_CREATION_TITLE).replaceAll("{brandName}", () => brandName),
        description: normalize(description ?? DEFAULT_CREATION_DESCRIPTION).replaceAll("{brandName}", () => brandName),
    };
}
