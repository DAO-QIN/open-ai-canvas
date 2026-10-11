import { ECOMMERCE_PLUGIN_ID } from "@/lib/ecommerce/contracts";
import { registerPlugin } from "../plugin-registry";
import { PLUGIN_API_VERSION, type RegisteredPlugin } from "../plugin-types";

export const ecommerceStudioPlugin: RegisteredPlugin = {
    source: "bundled",
    manifest: {
        apiVersion: PLUGIN_API_VERSION,
        id: ECOMMERCE_PLUGIN_ID,
        name: "商品套图",
        version: "1.0.0",
        author: "影策团队",
        description: "从商品原图生成主图、详情图和标题，支持方案确认、单图调整与成套导出。",
        documentation: "# 商品套图\n\n从创作首页直接打开。每张原图对应一个商品，默认先生成方案与标题，再确认套图费用。平台开放后默认可用；你可以在插件中心个人停用。关闭后历史作品仍可查看和下载。",
        surfaces: ["fullscreen"],
        permissions: ["asset.read", "asset.upload", "generation.run", "ai.text", "media.read", "canvas.write"],
        trusted: true,
        runtime: { web: "declarative", backend: "trusted-backend" },
        contributes: { commands: [{ id: "open-product-images", label: "商品套图" }], importExport: ["product-images-zip"] },
    },
};
registerPlugin(ecommerceStudioPlugin);
