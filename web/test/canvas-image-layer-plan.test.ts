import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { imageLayerOutputSize, imageLayerPlannerError, imageLayerPlanTargets, parseImageLayerPlan } from "@/lib/canvas/canvas-image-layer-plan";
import { supportsExperimentalLayerExtraction } from "@/lib/canvas/canvas-image-layers";
import { defaultConfig, createModelChannel, selectableModelsByCapability } from "@/stores/use-config-store";

const vision = defaultModelCapabilityConfig();
vision.text!.references.maxImages = 2;
vision.text!.references.maxImageBytes = 30 * 1024 * 1024;
const blind = defaultModelCapabilityConfig();
const image = defaultModelCapabilityConfig("km-kemei-seedream", "doubao-seedream-5-0-pro-260628");
const channel = createModelChannel({
    id: "models",
    models: ["visual", "blind", "editor"],
    modelCosts: [
        { model: "visual", capability: "text", billingMode: "token", unitPriceMicrocredits: 1, capabilityConfig: vision },
        { model: "blind", capability: "text", billingMode: "token", unitPriceMicrocredits: 1, capabilityConfig: blind },
        { model: "editor", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1, capabilityConfig: image },
    ],
});
const config = { ...defaultConfig, channels: [channel] };
function response(names = ["背景", "人物", "花束", "标题文字"]) {
    return { canPlan: true, layers: names.map((name, index) => ({ name, description: `只保留${name}，排除其他层`, kind: index === 0 ? "background" : "object", ...(index ? { bbox: [100, 200, 800, 900] } : {}) })) };
}

describe("通用图层规划", () => {
    test("文本模型保持可选，只有选中的无识图能力模型报错，不猜模型名", () => {
        expect(selectableModelsByCapability(config, "text")).toContain("models::visual");
        expect(selectableModelsByCapability(config, "text")).toContain("models::blind");
        expect(imageLayerPlannerError(config, "models::visual")).toBe("");
        expect(imageLayerPlannerError(config, "models::blind")).toContain("未配置识图");
        expect(imageLayerPlannerError(config, "models::editor")).toContain("文本模型");
        expect(imageLayerPlannerError(config, "")).toContain("请选择");
    });
    test("普通拆层不局限 OpenAI 协议，必须是接受参考图的图片模型", () => {
        expect(supportsExperimentalLayerExtraction(config, "models::editor")).toBe(true);
        expect(supportsExperimentalLayerExtraction(config, "models::visual")).toBe(false);
        const noReferences = { ...image, image: { ...image.image!, references: { ...image.image!.references, maxImages: 0 } } };
        const altered = { ...config, channels: [{ ...channel, modelCosts: channel.modelCosts!.map((cost) => (cost.model === "editor" ? { ...cost, capabilityConfig: noReferences } : cost)) }] };
        expect(supportsExperimentalLayerExtraction(altered, "models::editor")).toBe(false);
    });
    test("规划层数和题材来自模型真实结果，允许二层和多层", () => {
        const plan = parseImageLayerPlan(JSON.stringify(response()));
        expect(plan.layers.map((layer) => layer.name)).toEqual(["背景", "人物", "花束", "标题文字"]);
        expect(imageLayerPlanTargets(plan)[1]).toContain("区域 <bbox>100 200 800 900</bbox>");
        expect(parseImageLayerPlan("```json\n" + JSON.stringify(response(["背景", "产品"])) + "\n```").layers).toHaveLength(2);
    });
    test("不能识图、空结果或非 JSON 不作为计划继续执行", () => {
        expect(() => parseImageLayerPlan('{"canPlan":false,"reason":"无法读取图片"}')).toThrow("无法读取图片");
        expect(() => parseImageLayerPlan("我建议分三层")).toThrow("JSON");
        expect(() => parseImageLayerPlan(JSON.stringify(response(["只有一层"])))).toThrow("2–8");
        expect(() => parseImageLayerPlan(JSON.stringify(response(Array.from({ length: 9 }, (_, index) => `层${index}`))))).toThrow("2–8");
    });
    test("拒绝重复、背景顺序、越界和反向 bbox，未知字段不进入计划", () => {
        expect(() => parseImageLayerPlan(JSON.stringify(response(["背景", "重复", "重复"])))).toThrow("重复");
        const wrong = response();
        wrong.layers[1].kind = "background";
        expect(() => parseImageLayerPlan(JSON.stringify(wrong))).toThrow("独立对象");
        for (const bbox of [
            [800, 200, 100, 900],
            [0, 0, 1001, 900],
            [0, 0, 1, 1],
        ]) {
            const bad = response();
            bad.layers[1].bbox = bbox;
            expect(() => parseImageLayerPlan(JSON.stringify(bad))).toThrow("坐标");
        }
        expect(parseImageLayerPlan(JSON.stringify({ ...response(), code: "ignored", model: "untrusted" }))).not.toHaveProperty("model");
    });
    test("输出比例优先匹配源图配置合同，不把任意原像素尺寸发送给模型", () => {
        const profile = { ...image, image: { ...image.image!, size: { parameter: "size" as const, values: ["1:1", "16:9", "auto"], default: "1:1", allowCustom: false } } };
        const outputConfig = { ...config, channels: [{ ...channel, modelCosts: channel.modelCosts!.map((cost) => (cost.model === "editor" ? { ...cost, capabilityConfig: profile } : cost)) }] };
        expect(imageLayerOutputSize(outputConfig, "models::editor", { width: 731, height: 412 })).toBe("16:9");
        expect(imageLayerOutputSize(outputConfig, "models::editor", { width: 997, height: 700 })).toBe("auto");
    });
});
