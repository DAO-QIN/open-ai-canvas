import { expect, test } from "bun:test";
import { productCanvasNodes } from "@/lib/ecommerce/canvas-layout";
import { ensureMediaNodeMinimumSize, fitNodeSize } from "@/lib/canvas/canvas-node-size";
import type { Product } from "@/lib/ecommerce/contracts";

test("mixed product images retain selected resources and proportions without overlapping after canvas normalization", () => {
    const naturalSizes = [
        { width: 4096, height: 4096 },
        { width: 3584, height: 4800 },
        { width: 8000, height: 2000 },
        { width: 50, height: 200 },
        { width: 4096, height: 4096 },
        { width: 3584, height: 4800 },
    ];
    const product = {
        id: "product",
        name: "商品",
        run: {
            id: "run",
            slots: naturalSizes.map((_, index) => ({
                id: "slot-" + index,
                kind: index < 3 ? "hero" : "detail",
                index: index + 1,
                selectedVersionId: "selected-" + index,
                versions: [
                    { id: "newer-" + index, resourceId: "newer-resource-" + index },
                    { id: "selected-" + index, resourceId: "selected-resource-" + index, prompt: "已确认的提示词" },
                ],
            })),
        },
    } as Product;
    const nodes = productCanvasNodes(product, naturalSizes);
    for (const [index, node] of nodes.entries()) {
        expect(ensureMediaNodeMinimumSize(node)).toEqual(node);
        expect({ width: node.width, height: node.height }).toEqual(fitNodeSize(naturalSizes[index].width, naturalSizes[index].height));
        expect(node.width / node.height).toBeCloseTo(naturalSizes[index].width / naturalSizes[index].height);
        expect(node.metadata?.storageKey).toBe("resource:selected-resource-" + index);
        expect(node.metadata?.naturalWidth).toBe(naturalSizes[index].width);
        expect(node.metadata?.pluginData).toMatchObject({ productId: "product", runId: "run", slotId: "slot-" + index, versionId: "selected-" + index });
        for (const other of nodes.slice(index + 1)) {
            const separated = node.position.x + node.width <= other.position.x || other.position.x + other.width <= node.position.x || node.position.y + node.height + 24 <= other.position.y || other.position.y + other.height + 24 <= node.position.y;
            expect(separated).toBe(true);
        }
    }
    expect(product.run?.slots[0].versions).toHaveLength(2);
    expect(() => productCanvasNodes(product, [])).toThrow("尺寸");
    expect(() =>
        productCanvasNodes(
            product,
            naturalSizes.map(() => ({ width: Number.NaN, height: 1 })),
        ),
    ).toThrow("尺寸");
});
