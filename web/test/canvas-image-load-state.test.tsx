import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("画布图片加载、地址重签和重新加载使用独立的资源请求环境", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-image-load-state.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 25000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("6 pass");
    expect(output).toContain("0 fail");
}, 30000);
