import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { currentVersion, type Product } from "./contracts";
import type { CanvasNodeData } from "@/types/canvas";

export function productCanvasNodes(product: Product, naturalSizes: { width: number; height: number }[]): CanvasNodeData[] {
    const slots = product.run?.slots.filter((slot) => currentVersion(slot)) ?? [];
    if (naturalSizes.length !== slots.length || naturalSizes.some(({ width, height }) => !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)) throw new Error("无法读取商品图片尺寸，请重新打开作品");
    const sizes = naturalSizes.map(({ width, height }) => fitNodeSize(width, height));
    const columnWidth = Math.max(0, ...sizes.map((size) => size.width)) + 80;
    let rowY = 0;
    return slots.map((slot, index) => {
        if (index && index % 4 === 0) rowY += Math.max(...sizes.slice(index - 4, index).map((size) => size.height)) + 96;
        const version = currentVersion(slot)!;
        return {
            id: crypto.randomUUID(),
            type: "image",
            title: product.name + " · " + (slot.kind === "hero" ? "主图" : "详情") + slot.index,
            position: { x: (index % 4) * columnWidth, y: rowY },
            ...sizes[index],
            metadata: {
                status: "success",
                storageKey: "resource:" + version.resourceId,
                prompt: version.prompt,
                naturalWidth: naturalSizes[index].width,
                naturalHeight: naturalSizes[index].height,
                pluginId: "ecommerce-studio",
                pluginData: { productId: product.id, runId: product.run!.id, slotId: slot.id, versionId: version.id },
            },
        };
    });
}
