import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeModelCapabilityConfig, normalizeVideoValue } from "../src/lib/model-capabilities";
import type { ModelProtocolWorkflow } from "../src/lib/model-protocols";
import { resolveWorkflowVideoScreenSpec, updateWorkflowVideoScreenSpec } from "../src/lib/video-screen-specs";

const workflow: ModelProtocolWorkflow = {
    id: "minimax_h3_zm_u24", label: "H3 ZM U24", providerId: "autodl-comfyui", capability: "video",
    parameters: [{ name: "resolution", mapping: "resolution", type: "string", values: ["480p竖", "768p竖", "480p横", "768p横", "480p(1:1)", "768p(1:1)"] }],
    defaults: { resolution: "768p竖" },
};
const legacy = () => defaultModelCapabilityConfig("autodl-comfyui", workflow.id).video!;

test("fixed mode ignores legacy and forged custom values while preserving other capabilities", () => {
    const original = legacy();
    original.resolutions = ["720p"];
    original.customScreenSpec = { ratios: ["2:3"], defaultRatio: "2:3", resolutions: ["invalid"], defaultResolution: "missing" };
    const resolved = resolveWorkflowVideoScreenSpec(original, workflow);
    expect(resolved.resolutions).toEqual(workflow.parameters[0]!.values!);
    expect(resolved.defaultResolution).toBe("768p竖");
    expect(resolved.ratios).toEqual([]);
    expect(resolved.duration).toEqual(original.duration);
    expect(resolved.references).toEqual(original.references);
    expect(resolved.operations).toEqual(original.operations);
    expect(original.resolutions).toEqual(["720p"]);
});

test("multiple complete enums and default survive saving, disabling and re-enabling", () => {
    let profile = updateWorkflowVideoScreenSpec(legacy(), workflow, { customSizeEnabled: true });
    profile = updateWorkflowVideoScreenSpec(profile, workflow, { resolutions: [" 480p横 ", "768p(1:1)", "480P横", ""], defaultResolution: " 768P(1:1) " });
    profile = updateWorkflowVideoScreenSpec(profile, workflow, { customSizeEnabled: false });
    const reloaded = normalizeModelCapabilityConfig(JSON.parse(JSON.stringify({ version: 1, video: profile }))).video!;
    expect(reloaded.defaultResolution).toBe("768p竖");
    const enabled = updateWorkflowVideoScreenSpec(reloaded, workflow, { customSizeEnabled: true });
    expect(enabled.resolutions).toEqual(["480p横", "768p(1:1)"]);
    expect(enabled.defaultResolution).toBe("768p(1:1)");
    expect(normalizeVideoValue(enabled, { seconds: "6", ratio: "16:9", resolution: "768p(1:1)" })).toEqual({ seconds: "6", ratio: "", resolution: "768p(1:1)" });
});

test("creation and canvas use the effective fixed profile after a stale cached selection", () => {
    const profile = updateWorkflowVideoScreenSpec(legacy(), workflow, { customSizeEnabled: false });
    const config = { channels: [{ id: "autodl", models: [workflow.id], modelCosts: [{ model: workflow.id, protocol: "autodl-comfyui", capabilityConfig: { version: 1, video: profile } }] }] };
    const selected = modelCapabilityConfigFor(config, `autodl::${workflow.id}`).video!;
    expect(normalizeVideoValue(selected, { seconds: "6", ratio: "16:9", resolution: "720p" })).toEqual({ seconds: "6", ratio: "", resolution: "768p竖" });
    expect(normalizeVideoValue(selected, { resolution: "480p横" }).resolution).toBe("480p横");
});

test("switching workflows refreshes fixed values but retains the custom draft", () => {
    const previous = updateWorkflowVideoScreenSpec(legacy(), workflow, { customSizeEnabled: true, resolutions: ["480p横"], defaultResolution: "480p横" });
    const next = resolveWorkflowVideoScreenSpec({ ...previous, customSizeEnabled: false }, { ...workflow, id: "z0901", parameters: [{ name: "resolution", type: "string", values: ["768p竖(768*1344)"] }], defaults: { resolution: "768p竖(768*1344)" } });
    expect(next.defaultResolution).toBe("768p竖(768*1344)");
    expect(next.customScreenSpec!.defaultResolution).toBe("480p横");
});

test("real editor renders the switch and complete labels, without independent ratio controls", () => {
    for (const enabled of [false, true]) {
        const profile = updateWorkflowVideoScreenSpec(legacy(), workflow, { customSizeEnabled: enabled });
        const html = renderToStaticMarkup(<ModelCapabilityEditor capability="video" protocol="autodl-comfyui" model={workflow.id} workflows={[workflow]} section="protocol" value={{ version: 1, video: profile }} />);
        expect(html).toContain('role="switch"');
        expect(html).toContain('aria-label="自定义比例分辨率"');
        expect(html).toContain(`aria-checked="${enabled}"`);
        expect(html).toContain("768p(1:1)");
        expect(html).not.toContain("支持比例");
        expect(html).not.toContain("默认比例");
        expect(html).toContain(enabled ? "填写工作流实际支持的完整值" : "使用当前工作流的插件预设");
    }
});

test("other video protocols keep their existing settings and controls", () => {
    const profile = legacy();
    expect(resolveWorkflowVideoScreenSpec(profile)).toBe(profile);
    const html = renderToStaticMarkup(<ModelCapabilityEditor capability="video" protocol="minimax-video" section="protocol" />);
    expect(html).not.toContain("自定义比例分辨率");
    expect(html).toContain("支持比例");
});
