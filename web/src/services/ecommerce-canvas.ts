import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { getActiveUserScope } from "@/lib/user-scope";
import { currentVersion, type Product } from "@/lib/ecommerce/contracts";
import { productCanvasNodes } from "@/lib/ecommerce/canvas-layout";
import { getResourceAccess, resolveResourceAccessURL } from "@/services/api/resources";
import { prepareCanvasImage } from "@/services/canvas-image-loader";

export async function sendProductToCanvas(product: Product) {
    const scope = getActiveUserScope();
    const slots = product.run?.slots.filter((slot) => currentVersion(slot)) ?? [];
    if (!slots.length) throw new Error("还没有可放入画布的图片");
    const naturalSizes = await Promise.all(
        slots.map(async (slot) => {
            const access = await getResourceAccess("resource:" + currentVersion(slot)!.resourceId, "display");
            if (access.originalWidth && access.originalHeight) return { width: access.originalWidth, height: access.originalHeight };
            const image = await prepareCanvasImage(resolveResourceAccessURL(access.url), new AbortController().signal);
            return { width: image.naturalWidth, height: image.naturalHeight };
        }),
    );
    if (scope !== getActiveUserScope()) throw new DOMException("账号已切换，请重新打开作品", "AbortError");
    const nodes = productCanvasNodes(product, naturalSizes);
    const result = await createCanvasProjectWithRemoteSync(product.name + " · 商品套图", undefined, { nodes, connections: [] });
    if (scope !== getActiveUserScope()) throw new DOMException("账号已切换，请重新打开作品", "AbortError");
    if (result.syncError) throw new Error("画布已保存在本机，云端同步尚未完成，请从画布列表继续");
    return result.id;
}
