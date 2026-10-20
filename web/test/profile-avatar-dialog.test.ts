import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("头像弹窗实际组件的选择、取消、保存失败重试与旧头像保持", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/profile-avatar-dialog.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("0 fail");
    expect(result.exitCode, output).toBe(0);
}, 40000);
