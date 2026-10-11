import { ShieldCheck } from "lucide-react";
import { versionQualityCheck, type ProductSlot } from "@/lib/ecommerce/contracts";

export function ProductQualityResult({ slot, versionId, detailed = false }: { slot: ProductSlot; versionId?: string; detailed?: boolean }) {
    const check = versionQualityCheck(slot, versionId);
    if (!check) return null;
    const report = check.report;
    const label = report
        ? { pass: "未发现明显问题", attention: "需检查", undetermined: "无法判断" }[report.verdict]
        : (({ pending: "等待检查", submitted: "检查中", uncertain: "检查结果待核对", failed: "检查未完成" } as Record<string, string>)[check.status] ?? "检查未完成");
    return (
        <div className="space-y-2 text-xs leading-5 text-foreground/80" role="status">
            <p className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 shrink-0" />
                智能质检：{label}
            </p>
            {detailed && report && (
                <>
                    <p>{report.summary}</p>
                    {report.issues.length > 0 && (
                        <ul className="list-disc space-y-2 pl-4">
                            {report.issues.map((issue, index) => (
                                <li key={index}>
                                    <p>{issue.evidence}</p>
                                    <p className="text-foreground/60">建议：{issue.suggestion}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-foreground/60">AI 检查仅供参考，使用前请核对商品细节与文案。</p>
                </>
            )}
            {detailed && !report && <p className="text-foreground/60">成图已保留。检查未完成时，可在待处理步骤核对状态或重新确认费用。</p>}
        </div>
    );
}
