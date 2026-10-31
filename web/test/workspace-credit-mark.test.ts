import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8");
const rule = (css: string, selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

describe("workspace credit mark", () => {
    test("top-bar credit entries use the unified credit bolt as a bare glyph in the balance color, not a tinted disc", () => {
        const topBar = source("../src/components/layout/workspace-top-bar.tsx");
        const canvas = source("../src/pages/canvas/canvas-project-top-bar.tsx");
        const mark = source("../src/components/layout/workspace-credit-mark.tsx");
        const css = source("../src/styles/globals.css");

        expect(topBar).toContain("<WorkspaceCreditMark />");
        expect(topBar).not.toContain("Coins");
        expect(canvas).toContain('<WorkspaceCreditMark className="is-compact" />');
        expect(canvas).not.toContain("Coins");
        // 标识复用统一的积分闪电，颜色只来自宿主样式，不在组件里写死色值或渐变。
        expect(mark).toContain("<CreditIcon />");
        expect(mark).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(mark).not.toContain("linearGradient");
        // 与 LibTV 一样的单色闪电：和余额数字同色（暗色主题为白色），没有圆底、描边或强调色。
        const base = rule(css, ".app-user-workspace .app-workspace-credit-mark");
        expect(base).toContain("color: var(--button-secondary-fg);");
        expect(base).not.toContain("background");
        expect(base).not.toContain("box-shadow");
        expect(base).not.toContain("--palette-wallet-ice");
        expect(css).not.toContain(".dark .app-user-workspace .app-workspace-credit-mark");
        // 画布顶栏按钮的文字色来自画布主题，闪电跟随它。
        expect(rule(css, ".app-user-workspace .canvas-topbar-credits .app-workspace-credit-mark")).toContain("color: inherit;");
        expect(css).not.toContain("app-workspace-credit-gift");
    });

    test("the credits-center balance pill uses the same bare bolt in the balance number color", () => {
        const modal = source("../src/components/layout/workspace-wallet-modal.tsx");
        const css = source("../src/components/layout/workspace-wallet-topup.css");

        expect(modal).toContain('<WorkspaceCreditMark className="workspace-wallet-balance-mark" />');
        const mark = rule(css, ".workspace-wallet-balance-mark");
        expect(mark).toContain("color: var(--user-ink);");
        expect(mark).not.toContain("background");
        expect(mark).not.toContain("box-shadow");
    });
});
