import { expect, test } from "bun:test";
import { buildCreativeAgentSystemPrompt, CREATIVE_AGENT_SYSTEM_PROMPT } from "../src/lib/creation/creative-agent-tools";
import { buildAiEditingSystemPrompt } from "../src/lib/timeline/ai-command-schema";

test("both assistants use the supplied current brand while preserving their execution contracts", () => {
    for (const brand of ["影绘", "North Studio", "新品牌 $&"]) {
        const creative = buildCreativeAgentSystemPrompt(` ${brand} `);
        expect(creative.startsWith(`你是${brand}的通用创作助手，`)).toBe(true);
        expect(creative.endsWith(CREATIVE_AGENT_SYSTEM_PROMPT)).toBe(true);
        const editing = buildAiEditingSystemPrompt("时间线：clip-a", brand);
        expect(editing).toContain(`你是${brand}视频剪辑工作台`);
        expect(editing).toContain("时间线：clip-a");
        expect(editing).toContain("非法命令会被整批拒绝");
        expect(creative + editing).not.toContain("影策");
    }
});

test("missing brand uses neutral identity without restoring the upstream brand", () => {
    expect(buildCreativeAgentSystemPrompt("  ")).toStartWith("你是本站的通用创作助手");
    expect(buildAiEditingSystemPrompt("空", "  ")).toContain("你是本站视频剪辑工作台");
});
