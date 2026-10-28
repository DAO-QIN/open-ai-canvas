import "./usage-dashboard.css";

/** 用量看板加载占位：与真实布局同尺寸，避免代码分块和数据加载时页面跳动。 */
export function UsageDashboardSkeleton() {
    return (
        <div className="usage-dashboard" aria-busy="true" aria-label="正在加载用量看板">
            <div className="usage-skeleton-header">
                <span className="usage-skeleton usage-skeleton-line is-title" />
                <span className="usage-skeleton usage-skeleton-line is-subtitle" />
            </div>
            <div className="usage-skeleton usage-skeleton-scope" />
            <div className="usage-stats" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                    <span key={index} className="usage-skeleton usage-skeleton-stat" />
                ))}
            </div>
            <div className="usage-skeleton usage-skeleton-panel" aria-hidden="true" />
        </div>
    );
}
