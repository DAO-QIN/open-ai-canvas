import { describe, expect, test } from "bun:test";
import { createOfficialApplicationHostServices, officialApplicationRoute } from "@/services/plugin-applications";
import { modelChoices, selectedModelKey } from "@/lib/ecommerce/models";
import { currentVersion, versionQualityCheck, type ProductSlot } from "@/lib/ecommerce/contracts";
import type { PluginManifest } from "@/lib/plugins/plugin-types";
import type { ModelCatalogResponse } from "@/services/api/logical-models";

const manifest: PluginManifest = { apiVersion: "yingce.plugin/v1", id: "ecommerce-studio", name: "商品套图", version: "1", author: "影策", description: "test", surfaces: ["fullscreen"], permissions: [], trusted: true, contributes: {} };
describe("official ecommerce host boundary", () => {
    test("uploaded manifests cannot claim a privileged host binding", () => {
        for (const source of ["uploaded", "system", undefined]) expect(createOfficialApplicationHostServices({ manifest, source, permissions: new Set() })).toBeUndefined();
        expect(createOfficialApplicationHostServices({ manifest: { ...manifest, trusted: false }, source: "bundled", permissions: new Set() })).toBeUndefined();
    });
    test("unknown command ids cannot open arbitrary routes", () => {
        expect(officialApplicationRoute("ecommerce-studio", "open-product-images")).toBe("/create/product-images");
        expect(() => officialApplicationRoute("ecommerce-studio", "/admin/plugins")).toThrow();
        expect(() => officialApplicationRoute("another-app", "open-product-images")).toThrow();
    });
    test("generation and export are independently permission checked", () => {
        const host = createOfficialApplicationHostServices({ manifest, source: "bundled", permissions: new Set() })!;
        expect(() => host.quote("product", 1, { action: "auto" })).toThrow("生成权限");
        expect(() => host.generate("product", { action: "auto", revision: 1, operationId: "test" })).toThrow("生成权限");
        expect(() => host.export(["product"])).toThrow("导出权限");
    });
});
describe("product model and version choices", () => {
    test("only available models with original-image capability can be selected", () => {
        const catalog = {
            source: "system",
            channels: [
                {
                    id: "a",
                    name: "平台",
                    models: [
                        { modelKey: "vision", displayName: "理解", capability: "text", available: true, capabilityConfig: { text: { references: { maxImages: 1 } } } },
                        { modelKey: "text-only", capability: "text", available: true, capabilityConfig: { text: { references: { maxImages: 0 } } } },
                        { modelKey: "disabled", capability: "text", available: false, capabilityConfig: { text: { references: { maxImages: 2 } } } },
                        { modelKey: "ref-image", capability: "image", available: true, capabilityConfig: { image: { references: { maxImages: 1 } } } },
                    ],
                },
            ],
        } as ModelCatalogResponse;
        const choices = modelChoices(catalog, "text");
        expect(choices.map((choice) => choice.value)).toEqual(["a:vision"]);
        expect(choices[0].selection).toEqual({ channelId: "a", channelModelKey: "vision" });
        expect(selectedModelKey(choices[0].selection)).toBe("a:vision");
        expect(modelChoices(catalog, "image").map((choice) => choice.value)).toEqual(["a:ref-image"]);
    });
    test("selecting an old image version affects the deliverable without dropping newer versions", () => {
        const slot = {
            selectedVersionId: "old",
            versions: [
                { id: "new", resourceId: "new-resource" },
                { id: "old", resourceId: "old-resource" },
            ],
        } as ProductSlot;
        expect(currentVersion(slot)?.resourceId).toBe("old-resource");
        expect(slot.versions).toHaveLength(2);
        expect(currentVersion({ ...slot, selectedVersionId: "missing" })).toBeUndefined();
    });
    test("quality verdict follows the selected version and ignores superseded checks", () => {
        const slot = {
            selectedVersionId: "old",
            qualityChecks: [
                { stepId: "old-failed", versionId: "old", status: "superseded" },
                { stepId: "new-check", versionId: "new", status: "succeeded", report: { verdict: "pass", summary: "正常", issues: [] } },
                { stepId: "old-check", versionId: "old", status: "succeeded", report: { verdict: "attention", summary: "文字错误", issues: [] } },
            ],
        } as unknown as ProductSlot;
        expect(versionQualityCheck(slot, slot.selectedVersionId)?.report?.verdict).toBe("attention");
        expect(versionQualityCheck(slot, "new")?.report?.verdict).toBe("pass");
        expect(versionQualityCheck(slot, "missing")).toBeUndefined();
    });
});
