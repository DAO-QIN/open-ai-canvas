import { describe, expect, test } from "bun:test";
import { CONTENT_MODERATION_MESSAGE, generationErrorMessage, generationFailureMetadata } from "../src/lib/generation-error";

describe("safe upstream error details", () => {
    const detail = "非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。请重试或修改提示语。";
    test("keeps the specific image rejection on the card", () => {
        const message = `模型服务拒绝了请求，请检查模型和参数；上游：${detail}`;
        expect(generationErrorMessage(new Error(message))).toBe(detail);
    });
    test("does not replace a safe upstream message with a generic HTTP hint", () => {
        const message = `模型服务暂时不可用（HTTP 500）；上游：${detail}`;
        expect(generationErrorMessage(message)).toBe(detail);
        expect(generationErrorMessage("模型服务暂时不可用（HTTP 500）")).toBe("网络异常。");
    });
    test("keeps details when moderation metadata is stored", () => {
        const message = `内容审核未通过；上游：${detail}`;
        const metadata = generationFailureMetadata(message, "test prompt");
        expect(metadata.errorDetails).toBe(`${CONTENT_MODERATION_MESSAGE} ${detail}`);
        expect(metadata.generationErrorCode).toBe("sensitive_words_detected");
    });
    test("upstream marker does not bypass URL hiding", () => {
        expect(generationErrorMessage("模型服务请求失败；上游：https://private.test")).toBe("网络异常。");
    });
});

describe("consumer generation errors", () => {
    const parameterMessage = "当前模型不支持这组参数或参考素材，请调整输入或切换模型后重试。";
    const serviceMessage = "模型服务处理失败，请稍后重试或换用其他模型。";
    test("hides protocol fields and task identifiers from reference failures", () => {
        for (const error of [
            "声明式协议任务失败（任务 private-task）：缺少必填参数：ref_image_0",
            "模型请求失败；上游：RequestParameterIsWrong: ref_image_0",
            { reason: "invalid_argument", message: "缺少必填参数 ref_audio_0" },
        ]) expect(generationErrorMessage(error)).toBe(parameterMessage);
    });
    test("keeps actionable plugin input validation", () => {
        const message = "当前模型至少需要 1 张参考图片，请添加后重试。";
        expect(generationErrorMessage(message)).toBe(message);
    });
    test("keeps route and authentication diagnostics out of the consumer UI", () => {
        expect(generationErrorMessage({ reason: "model_route_unavailable" })).toBe("当前模型暂时不可用，请稍后重试或换用其他模型。");
        for (const error of ["HTTP 401", "HTTP 403", "HTTP 404", "模型接口不存在，请检查渠道配置", "供应商 token 无效"]) {
            expect(generationErrorMessage(error)).toBe(serviceMessage);
        }
    });
    test("does not ask a consumer to configure infrastructure", () => {
        expect(generationErrorMessage("参考图片上传失败：腾讯云 COS UserDisable")).toBe("参考素材暂时无法上传，请稍后重试。");
    });
});
