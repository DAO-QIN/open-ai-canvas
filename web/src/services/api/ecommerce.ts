import { http, apiBaseURL } from "./request";
import type { ModelCatalogResponse } from "./logical-models";
import type { PluginState } from "./plugins";
import type { EcommerceSettings, Product, ProductBatch, ProductBatchResult, ProductCommand, ProductConfig, ProductPage, ProductPreset, ProductQuote, ProductRun, QuoteScope } from "@/lib/ecommerce/contracts";

export type EcommerceOptions = { defaults: ProductConfig; batchLimit: number; state: PluginState; catalog: ModelCatalogResponse; presets: ProductPreset[] };
export const fetchEcommerceOptions = (signal?: AbortSignal) => http.get<EcommerceOptions>("/ecommerce/options", { signal });
export const fetchProducts = (page = 1, archived = false, signal?: AbortSignal) => http.get<ProductPage>("/ecommerce/products", { params: { page, pageSize: 20, archived: String(archived) }, signal });
export const fetchProduct = (id: string, signal?: AbortSignal) => http.get<Product>(`/ecommerce/products/${encodeURIComponent(id)}`, { signal });
export const fetchProductRun = (id: string, runId: string, signal?: AbortSignal) => http.get<ProductRun>(`/ecommerce/products/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`, { signal });
export const importProducts = (request: { operationId: string; name?: string; items: { resourceId: string; name: string; sellingPoints: string }[]; config: ProductConfig }) => http.post<ProductBatch>("/ecommerce/batches", request);
export const updateProduct = (id: string, request: { operationId: string; revision: number; name?: string; sellingPoints?: string; config?: ProductConfig; archived?: boolean }) =>
    http.put<Product>(`/ecommerce/products/${encodeURIComponent(id)}`, request);
export const deleteProductDraft = (id: string, request: { operationId: string; revision: number }) => http.delete<{ deleted: boolean }>("/ecommerce/products/" + encodeURIComponent(id), { params: request });
export const quoteProduct = (id: string, revision: number, scope: QuoteScope) => http.post<ProductQuote>(`/ecommerce/products/${encodeURIComponent(id)}/quote`, { revision, ...scope });
export const commandProduct = (id: string, command: ProductCommand) => http.post<Product>(`/ecommerce/products/${encodeURIComponent(id)}/commands`, command);
export const batchCommandProducts = (items: { productId: string; command: ProductCommand }[]) => http.post<ProductBatchResult[]>("/ecommerce/batch-commands", { items });
export const saveProductPreset = (name: string, config: ProductConfig, revision = 0) =>
    name === "default" ? saveProductPreferences(config, revision) : http.put<ProductPreset>("/ecommerce/presets", { name, config, revision, operationId: crypto.randomUUID() });
export const fetchProductPreferences = (signal?: AbortSignal) => http.get<ProductPreset>("/ecommerce/preferences", { signal });
export const saveProductPreferences = (config: ProductConfig, revision = 0) => http.put<ProductPreset>("/ecommerce/preferences", { config, revision, operationId: crypto.randomUUID() });
export const deleteProductPreset = (id: string, revision: number, operationId = crypto.randomUUID()) => http.delete<{ deleted: boolean }>(`/ecommerce/presets/${encodeURIComponent(id)}`, { params: { revision, operationId } });
export const getEcommerceSettings = (signal?: AbortSignal) => http.get<EcommerceSettings>("/admin/ecommerce/settings", { signal });
export const updateEcommerceSettings = (settings: EcommerceSettings) => http.put<EcommerceSettings>("/admin/ecommerce/settings", settings);
export async function exportProducts(ids: string[], signal?: AbortSignal) {
    return downloadArchive("/ecommerce/export", { productIds: ids }, signal);
}
export const exportProductRun = (id: string, runId: string, signal?: AbortSignal) => downloadArchive("/ecommerce/products/" + encodeURIComponent(id) + "/runs/" + encodeURIComponent(runId) + "/export", {}, signal);
export const recoverProductStep = (id: string, stepId: string) => http.post<{ providerStatus: string; recovered: boolean }>("/ecommerce/products/" + encodeURIComponent(id) + "/steps/" + encodeURIComponent(stepId) + "/recover", {});
async function downloadArchive(path: string, data: unknown, signal?: AbortSignal) {
    const response = await http.raw<Blob>({ method: "POST", url: apiBaseURL + path, data, responseType: "blob", signal });
    // A binary endpoint can return a JSON error envelope; never save it as a ZIP.
    if (!String(response.headers["content-type"] ?? "").includes("zip")) {
        const body = await response.data.text();
        let message = "下载失败，请稍后重试";
        try {
            const value = JSON.parse(body) as { msg?: string };
            message = value.msg || message;
        } catch {
            /* non-JSON transport error */
        }
        throw new Error(message);
    }
    return response.data;
}
