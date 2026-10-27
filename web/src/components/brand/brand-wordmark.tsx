type BrandWordmarkProps = {
    name: string;
    className?: string;
};

export function BrandWordmark({ name, className }: BrandWordmarkProps) {
    if (name.trim().toLowerCase() !== "yinghui") {
        return <span className={className}>{name}</span>;
    }

    return (
        <span className={className}>
            <span className="sr-only">{name}</span>
            <svg className="app-workspace-brand-wordmark-art" viewBox="0 0 404 118" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M0 8h25l17 33L59 8h25L52 62v30H31V62Z" />
                <circle cx="95" cy="12" r="11" />
                <path d="M84 31h22v61H84ZM111 31h21v7c5-6 11-9 19-9 15 0 21 10 21 27v36h-21V59c0-8-3-12-9-12s-10 5-10 13v32h-21Z" />
                <path fillRule="evenodd" d="M224 31h21v57c0 21-14 30-35 30-14 0-25-4-32-9l8-16c6 4 14 7 23 7 10 0 15-4 15-12v-4c-5 5-11 8-20 8-17 0-30-13-30-31s13-32 30-32c9 0 15 3 20 9Zm-2 30c0-8-6-13-14-13s-14 5-14 13 6 13 14 13 14-5 14-13Z" clipRule="evenodd" />
                <path d="M249 5h22v33c5-6 11-9 20-9 16 0 24 10 24 27v36h-22V59c0-8-3-12-10-12s-12 5-12 13v32h-22ZM318 31h21v33c0 8 3 12 10 12s10-5 10-13V31h21v61h-20v-7c-5 6-11 9-19 9-15 0-23-10-23-27ZM382 31h22v61h-22Z" />
                <circle cx="393" cy="12" r="11" />
            </svg>
        </span>
    );
}
