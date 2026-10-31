import { CreditIcon } from "@/constant/credits";
import { cn } from "@/lib/utils";

/**
 * 顶栏、画布顶栏与积分中心页头的积分标识：与 LibTV 一样的单色实心闪电，不加圆底。
 * 颜色由宿主样式决定，和旁边的余额数字同色（暗色主题为白色），见 globals.css 的 .app-workspace-credit-mark；
 * is-compact 用于画布顶栏较矮的按钮。
 */
export function WorkspaceCreditMark({ className }: { className?: string }) {
    return (
        <span className={cn("app-workspace-credit-mark", className)} aria-hidden="true">
            <CreditIcon />
        </span>
    );
}
