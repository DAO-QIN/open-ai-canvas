// 拖进创作输入框的内容：本机图片，或对话里的生成结果图。生成结果放下后和结果图上的「作为参考」走同一条路径。
import type { CreationResultImageRef } from "./creation-workspace-messages";

/** 生成结果图拖动时写进 dataTransfer 的类型，只在本页内部使用。 */
export const CREATION_RESULT_IMAGE_DRAG_TYPE = "application/x-yingce-creation-result-image";

// 生成结果只在本页内拖动：dataTransfer 里只放一次性口令，图片本身留在这里。
// 别的网页能伪造同一个类型，但拿不到口令，放下时当作没有拖入生成结果。
let activeResultImageDrag: { token: string; image: CreationResultImageRef } | null = null;

export function startCreationResultImageDrag(dataTransfer: DataTransfer, image: CreationResultImageRef) {
    const token = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join("");
    activeResultImageDrag = { token, image };
    dataTransfer.effectAllowed = "copy";
    dataTransfer.setData(CREATION_RESULT_IMAGE_DRAG_TYPE, token);
    // dragend 在 drop 之后派发：放下时还能读到，拖动一结束就作废。
    document.addEventListener(
        "dragend",
        () => {
            if (activeResultImageDrag?.token === token) activeResultImageDrag = null;
        },
        { capture: true, once: true },
    );
}

/** 拖动经过时只能读到类型、读不到内容：用来决定要不要展开参考素材、显示可以放下。 */
export function hasCreationReferenceDrag(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types);
    return types.includes("Files") || types.includes(CREATION_RESULT_IMAGE_DRAG_TYPE);
}

/** 放下时读取：生成结果优先，否则取本机图片（只收图片）。 */
export function readCreationReferenceDrop(dataTransfer: DataTransfer): { resultImage?: CreationResultImageRef; files: File[] } {
    const token = dataTransfer.getData(CREATION_RESULT_IMAGE_DRAG_TYPE);
    if (token && activeResultImageDrag?.token === token) return { resultImage: activeResultImageDrag.image, files: [] };
    return { files: Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/")) };
}
