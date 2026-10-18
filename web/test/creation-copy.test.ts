import { expect, test } from "bun:test";
import { resolveCreationCopy } from "../src/lib/creation-copy";
import { normalizePublicAppearance } from "../src/stores/use-appearance-store";

test("missing fields retain original copy and follow the current brand", () => {
    const old = normalizePublicAppearance({ brandName: "影绘" });
    expect(resolveCreationCopy(old.brandName, old.creationTitle, old.creationDescription)).toEqual({
        title: "和影绘聊聊创作想法",
        description: "从一个画面、一个角色或一句话开始。",
    });
});

test("preview and homepage share replacement, multiline normalization and explicit empty subtitle", () => {
    expect(resolveCreationCopy("影绘", "  {brandName}，开始吧\r\n{brandName}  ", "")).toEqual({
        title: "影绘，开始吧\n影绘",
        description: "",
    });
    expect(resolveCreationCopy("新品牌", " ", "在{brandName}创作").title).toBe("和新品牌聊聊创作想法");
    expect(normalizePublicAppearance({ creationDescription: "" }).creationDescription).toBe("");
});

test("brand text containing replacement symbols is rendered literally", () => {
    expect(resolveCreationCopy("$&{brandName}", "{brandName}", "").title).toBe("$&{brandName}");
});
