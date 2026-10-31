import type { ComponentProps } from "react";
import { createLucideIcon } from "lucide-react";

export { requestCreditCost } from "@/lib/model-pricing";

/**
 * 积分的统一图标：余额、价格、计费和积分入口都从这里取，换图标只改这一处。
 * 自绘实心斜闪电，只填充不描边，沿用 lucide 组件接口，尺寸和颜色由宿主决定。路径由 24 栅格多边形
 * (17,1.8) (15,9.6) (21,9.6) 及其绕 (12,12) 的对称点倒圆得到：尖角半径 1.4，横档两端 1.1，内折角 0.5。
 * 顶栏积分入口与积分中心页头（WorkspaceCreditMark）也直接用这只闪电，不加圆底，和余额数字同色。
 */
export const CreditIcon = createLucideIcon("credit-bolt", [
    ["path", { d: "M15.96 2.74Q17 1.8 16.65 3.16L15.12 9.12Q15 9.6 15.5 9.6L19.9 9.6Q21 9.6 20.18 10.34L8.04 21.26Q7 22.2 7.35 20.84L8.88 14.88Q9 14.4 8.5 14.4L4.1 14.4Q3 14.4 3.82 13.66Z", fill: "currentColor", stroke: "none", key: "bolt" }],
]);

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <CreditIcon className="size-[1em]" />
        </span>
    );
}

export function formatCredits(value: number, maximumFractionDigits = 6) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits });
}
