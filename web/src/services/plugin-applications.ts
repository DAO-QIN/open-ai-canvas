import { ECOMMERCE_PLUGIN_ID, PRODUCT_IMAGES_ROUTE, type ProductCommand, type QuoteScope } from "@/lib/ecommerce/contracts";
import { commandProduct, exportProducts, quoteProduct } from "@/services/api/ecommerce";
import type { PluginHostContext, PluginHostServices } from "@/lib/plugins/plugin-types";

// Routes and operations are host-owned. Uploaded manifests cannot register
// privileged API prefixes or a durable orchestration worker.
export function officialApplicationRoute(pluginId: string, commandId: string) {
    if (pluginId === ECOMMERCE_PLUGIN_ID && commandId === "open-product-images") return PRODUCT_IMAGES_ROUTE;
    throw new Error("宿主未绑定这个官方应用入口");
}
export function createOfficialApplicationHostServices(context: Pick<PluginHostContext, "manifest" | "permissions"> & { source?: string }): PluginHostServices["applications"] {
    if (context.source !== "bundled" || context.manifest.id !== ECOMMERCE_PLUGIN_ID || !context.manifest.trusted) return undefined;
    return {
        openTool: (commandId) => officialApplicationRoute(context.manifest.id, commandId),
        quote: (productId, revision, scope) => {
            if (!context.permissions.has("generation.run")) throw new Error("插件没有生成权限");
            return quoteProduct(productId, revision, scope as QuoteScope);
        },
        generate: (productId, command) => {
            if (!context.permissions.has("generation.run")) throw new Error("插件没有生成权限");
            return commandProduct(productId, command as ProductCommand);
        },
        export: (productIds, signal) => {
            if (!context.permissions.has("media.read")) throw new Error("插件没有导出权限");
            return exportProducts(productIds, signal);
        },
    };
}
