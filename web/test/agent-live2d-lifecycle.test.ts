import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const launcherSource = readFileSync(new URL("../src/components/canvas/pet-launcher.tsx", import.meta.url), "utf8");

// 同一路径一旦被 text 加载器注册，bun 1.3.9 的模块缓存会让其它测试的具名导入失效，这里直接读源码文本。
const panelSource = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url), "utf8");
const avatarSource = readFileSync(new URL("../src/components/canvas/live2d-avatar.tsx", import.meta.url), "utf8");

test("Live2D launcher remains mounted while the Agent panel is open", () => {
    expect(panelSource).toContain("<AgentLauncher");
    expect(panelSource).toContain("hidden={open}");
    expect(panelSource).not.toContain("{!open ? <AgentLauncher");
    expect(launcherSource).toContain("hidden = false");
    expect(launcherSource).toContain('display: "none"');
});

test("launcher waits for appearance configuration before displaying the default orb", () => {
    expect(launcherSource).toContain("bundleManifestLoading || !appearanceResolved");
    expect(launcherSource).toContain("正在加载助手形象");
});

test("assistant launcher uses shared animation states and a compact toggle without a pet picker", () => {
    expect(launcherSource).toContain("agentAvatarStateForRunStatus(status)");
    expect(launcherSource).toContain("AGENT_LAUNCHER_COLLAPSED_SIZE = 48");
    expect(launcherSource).not.toContain("PetRadialMenu");
    expect(launcherSource).not.toContain("usePetPreference");
});

test("Live2D fallback is reserved for load or render failures and yielded render slots, not initial loading", () => {
    // 让出渲染权（另一个 Live2D 实例占用着 Cubism 着色器单例）时也显示回退形象。
    expect(avatarSource).toContain("{suspended || failed ? (");
    expect(avatarSource).toContain(") : !ready ? (");
    expect(avatarSource).not.toContain("{failed || !ready ? <span");
    expect(avatarSource).toContain("setFailed(true)");
    expect(avatarSource).toContain("callbacks.current.onError?.");
});
