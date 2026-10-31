import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { creationModelKey } from "../src/pages/create/creation-types";

const page = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8").replace(/\s+/g, " ");
const workspace = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-workspace.tsx"), "utf8").replace(/\s+/g, " ");
const modePicker = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-mode-picker.tsx"), "utf8").replace(/\s+/g, " ");
const styles = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-product.css"), "utf8");

test("首页复用原模型选择器，Agent 主栏是对话模型，图片视频模型进入偏好", () => {
    expect(workspace).toContain("<ModelPicker config={props.config}");
    expect(workspace).toContain("capability={creationModelCapability(props.mode)}");
    expect(workspace).toContain('value={props.agentImageModel} onChange={props.onAgentImageModelChange} capability="image"');
    expect(workspace).toContain('value={props.agentVideoModel} onChange={props.onAgentVideoModelChange} capability="video"');
    expect(workspace).not.toContain("CreationAgentModelPicker");
    expect(styles).not.toContain("creation-agent-model-panel");
    expect(page).toContain("model: selectedModel");
    // 各类型（含音频）记到各自的默认模型键：自动和文本共用文本模型。
    expect(page).toContain("updateConfig(creationModelKey(mode), value);");
    expect((["agent", "text", "image", "video", "audio"] as const).map((mode) => creationModelKey(mode))).toEqual(["textModel", "textModel", "imageModel", "videoModel", "audioModel"]);
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

test("创作类型菜单脱离 Composer 裁切容器、自动避让；只放生成类型，每项只有图标和名称，选中项打勾，图标与首页共用", () => {
    expect(modePicker).toContain('placement={variant === "thread" ? "topLeft" : "bottomLeft"} autoAdjustOverflow');
    expect(modePicker).toContain('getPopupContainer={() => document.body}');
    expect(modePicker).toContain('<span className="creation-mode-menu-name">{option.label}</span>');
    expect(modePicker).not.toContain("creation-mode-menu-description");
    expect(modePicker).not.toContain('type: "group"');
    // 去短剧工作台的入口不放进类型菜单。
    expect(modePicker).not.toContain('type: "divider"');
    expect(modePicker).not.toContain("短剧");
    expect(workspace).not.toContain("onOpenShortDrama");
    expect(page).not.toContain("onOpenShortDrama");
    expect(modePicker).toContain('<CreationIcon name="check" className="creation-mode-menu-check" />');
    expect(modePicker).toContain('from "@/components/creation/creation-type-icon"');
    expect(workspace).toContain("<CreationModePicker value={activeModeKey} options={modeOptions}");
    // 菜单不跟随按钮宽度：按钮只有"Agent 模式"几个字。
    expect(modePicker).not.toContain("setPopupStyle({ width, minWidth: width");
    expect(styles).not.toContain(".creation-mode-dropdown .creation-mode-menu");
    expect(styles).not.toContain("creation-mode-menu-description");
    expect(styles).toContain(".creation-mode-menu .ant-dropdown-menu { min-width: 216px;");
    expect(styles).toContain(".creation-mode-menu .ant-dropdown-menu-item { display: flex; align-items: center; min-height: 44px;");
});

test("首页移除虚构上下文进度，发送继续走实际提交入口", () => {
    expect(page).not.toContain("contextEstimate");
    expect(workspace).not.toContain("ContextEstimateRing");
    expect(styles).not.toContain("creation-context-estimate");
    expect(page).not.toContain("本地估算");
    expect(page).not.toContain("未测量");
    expect(page).toContain("onSubmit: () => void submit(),");
});
