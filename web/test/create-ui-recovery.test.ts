import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8").replace(/\s+/g, " ");
const workspace = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-workspace.tsx"), "utf8").replace(/\s+/g, " ");
const styles = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-product.css"), "utf8");

test("首页复用原模型选择器，Agent 主栏是对话模型，图片视频模型进入偏好", () => {
    expect(workspace).toContain("<ModelPicker config={props.config}");
    expect(workspace).toContain("capability={creationModelCapability(props.mode)}");
    expect(workspace).toContain('value={props.agentImageModel} onChange={props.onAgentImageModelChange} capability="image"');
    expect(workspace).toContain('value={props.agentVideoModel} onChange={props.onAgentVideoModelChange} capability="video"');
    expect(workspace).not.toContain("CreationAgentModelPicker");
    expect(styles).not.toContain("creation-agent-model-panel");
    expect(page).toContain("model: selectedModel");
    expect(page).toContain('onModelChange: (value: string) => updateConfig(mode === "text" || mode === "agent" ? "textModel" : mode === "image" ? "imageModel" : "videoModel", value)');
});

test("首页 Agent 权限与自动参数接入实际服务端执行流程", () => {
    expect(workspace).toContain("<GenerationSettingsMenu {...props} />");
    expect(workspace).toContain("<DurationMenu profile={props.videoProfile}");
    expect(workspace).toContain("<AgentPermissionControl mode={props.agentPermissionMode}");
    expect(workspace).toContain("<AgentExecutionSettings {...props} />");
    expect(page).toContain('surface: "creation"');
    expect(page).toContain("buildCreationAgentRunInput");
    expect(workspace).not.toContain("creation-chat-control-agent-auto");
    expect(page).not.toContain("<CreationAgentEntry");
});

test("创作类型菜单脱离 Composer 裁切容器、自动避让；固定宽度，每项名字加一句说明，选中项打勾", () => {
    expect(workspace).toContain('placement={variant === "thread" ? "topLeft" : "bottomLeft"} autoAdjustOverflow');
    expect(workspace).toContain('getPopupContainer={() => document.body}');
    expect(workspace).toContain('<span className="creation-mode-menu-name">{item.label}</span>');
    expect(workspace).toContain('<span className="creation-mode-menu-description">{item.description}</span>');
    expect(workspace).toContain('<CreationIcon name="check" className="creation-mode-menu-check" />');
    // 菜单不再跟随按钮宽度：按钮只有"自动"两个字，跟随会把说明挤掉。
    expect(workspace).not.toContain("setPopupStyle({ width, minWidth: width");
    expect(styles).not.toContain(".creation-mode-dropdown .creation-mode-menu");
    expect(styles).toContain(".creation-mode-menu .ant-dropdown-menu { width: 300px;");
    expect(styles).toContain(".creation-mode-menu .ant-dropdown-menu-item { display: flex; align-items: center; min-height: 50px;");
});

test("首页移除虚构上下文进度，发送继续走实际提交入口", () => {
    expect(page).not.toContain("contextEstimate");
    expect(workspace).not.toContain("ContextEstimateRing");
    expect(styles).not.toContain("creation-context-estimate");
    expect(page).not.toContain("本地估算");
    expect(page).not.toContain("未测量");
    expect(page).toContain("onSubmit: () => void submit()");
});
