import type { TopupProduct } from "@/services/api/payments";

/**
 * 充值报价：与后端 quoteTopupProduct（internal/app/payment_products.go）同一算法。
 * 固定套餐只能买 1 份；自定义充值按份计价，金额与积分都是每份数值的整数倍，不做舍入。
 * 这里的结果只用于展示和下单时附带的期望报价，最终以服务端计算为准。
 */
export type TopupQuote = {
    quantity: number;
    /** 应付金额，货币最小单位（分 / 美分）。 */
    amountFen: number;
    /** 到账积分，微积分。 */
    creditsMicrocredits: number;
};

export function isCustomTopup(product?: Pick<TopupProduct, "pricingMode"> | null) {
    return product?.pricingMode === "custom";
}

/** 自定义充值的份数区间；配置不完整时返回 null，界面按不可购买处理。 */
export function customTopupBounds(product: TopupProduct): { min: number; max: number } | null {
    if (!isCustomTopup(product)) return null;
    const min = Math.floor(product.customMinQuantity ?? 0);
    const max = Math.floor(product.customMaxQuantity ?? 0);
    if (min < 1 || max < min || product.amountFen <= 0 || product.creditsMicrocredits <= 0) return null;
    return { min, max };
}

export function clampTopupQuantity(product: TopupProduct, quantity: number) {
    const bounds = customTopupBounds(product);
    if (!bounds) return 1;
    if (!Number.isFinite(quantity)) return bounds.min;
    return Math.min(bounds.max, Math.max(bounds.min, Math.round(quantity)));
}

export function quoteTopup(product: TopupProduct, quantity = 1): TopupQuote {
    const units = clampTopupQuantity(product, quantity);
    return { quantity: units, amountFen: units * product.amountFen, creditsMicrocredits: units * product.creditsMicrocredits };
}

/** 用户输入的积分数换算成最接近的整份，再夹到区间内。 */
export function topupQuantityForCredits(product: TopupProduct, credits: number) {
    const perUnit = product.creditsMicrocredits / 1_000_000;
    return clampTopupQuantity(product, perUnit > 0 ? credits / perUnit : Number.NaN);
}

/** 打开面板时的默认份数：约 100 个主单位（¥100 / $100），落在区间内。 */
export function defaultTopupQuantity(product: TopupProduct) {
    return clampTopupQuantity(product, product.amountFen > 0 ? Math.ceil(10_000 / product.amountFen) : 1);
}

function stopStep(value: number) {
    let step = 1;
    while (value >= step * 100) step *= 10;
    return step;
}

/**
 * 滑块档位：份数越大步长越大（1、10、100……），每个数量级约 90 档。
 * 区间跨度很大时线性滑块在低额段几乎无法拖准，按档位走能兼顾低额精度与高额范围。
 * 首尾固定为最少与最多份数；档位之间的任意份数用输入框填写。
 */
export function customTopupStops(min: number, max: number) {
    const stops: number[] = [];
    for (let value = min; value < max; ) {
        stops.push(value);
        const step = stopStep(value);
        value = (Math.floor(value / step) + 1) * step;
    }
    stops.push(max);
    return stops;
}

/** 份数在档位中的位置：不超过该份数的最后一档。 */
export function topupStopIndex(stops: number[], quantity: number) {
    let low = 0;
    let high = stops.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (stops[middle] <= quantity) low = middle;
        else high = middle - 1;
    }
    return low;
}

/**
 * 固定积分套餐比自定义充值买同样多积分省下的金额（最小货币单位，向下取整）。
 * 只比较同一货币；不足 1 个主单位时不展示，返回 0。
 */
export function topupSavingsFen(product: TopupProduct, custom?: TopupProduct) {
    if (!custom || product.kind !== "credits" || isCustomTopup(product) || custom.currency !== product.currency || !customTopupBounds(custom)) return 0;
    const baseline = (product.creditsMicrocredits / custom.creditsMicrocredits) * custom.amountFen;
    const savings = Math.floor(baseline - product.amountFen);
    return savings >= 100 ? savings : 0;
}

/**
 * 固定积分套餐比同样金额走自定义充值多到账的积分（微积分，向下取整到整积分）。
 * 与 topupSavingsFen 是同一份优惠的两种说法：同样的钱多得多少积分、同样的积分少花多少钱。
 * 只比较同一货币；不足 1 积分时返回 0。
 */
export function topupBonusMicrocredits(product: TopupProduct, custom?: TopupProduct) {
    if (!custom || product.kind !== "credits" || isCustomTopup(product) || custom.currency !== product.currency || !customTopupBounds(custom)) return 0;
    const baseline = (product.amountFen / custom.amountFen) * custom.creditsMicrocredits;
    const bonusCredits = Math.floor((product.creditsMicrocredits - baseline) / 1_000_000);
    return bonusCredits >= 1 ? bonusCredits * 1_000_000 : 0;
}

/** 同一货币的可购买固定积分套餐里，每单位金额到账积分最多的一个；不足两个或并列最优时不标注。 */
export function bestValueTopupId(products: TopupProduct[]) {
    const candidates = products.filter((item) => item.kind === "credits" && !isCustomTopup(item) && item.canPurchase && item.amountFen > 0);
    const currency = candidates[0]?.currency;
    const sameCurrency = candidates.filter((item) => item.currency === currency);
    if (sameCurrency.length < 2) return "";
    const ranked = [...sameCurrency].sort((left, right) => right.creditsMicrocredits / right.amountFen - left.creditsMicrocredits / left.amountFen);
    const [best, runnerUp] = ranked;
    return best.creditsMicrocredits / best.amountFen > runnerUp.creditsMicrocredits / runnerUp.amountFen ? best.id : "";
}

/** 卡片价格：整数金额不带小数（¥4,800），否则保留两位（¥9.90）。 */
export function topupPriceParts(amountMinor: number, currency?: string) {
    const whole = amountMinor % 100 === 0;
    const digits = whole ? 0 : 2;
    return {
        symbol: currency === "USD" ? "$" : "¥",
        value: (amountMinor / 100).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    };
}

export function formatTopupPrice(amountMinor: number, currency?: string) {
    const { symbol, value } = topupPriceParts(amountMinor, currency);
    return `${symbol}${value}`;
}

/** 输入框里的积分：不带千分位，便于直接编辑。 */
export function topupCreditsInputValue(creditsMicrocredits: number) {
    return String(Math.round(creditsMicrocredits) / 1_000_000);
}
