// 输入框左下角的"创作类型"菜单（参考即梦）：按钮显示当前类型，菜单每项只有图标和名称，选中项打勾。
// 菜单只放生成类型，不放去其他页面的入口。

import { useState } from "react";
import { Dropdown, type MenuProps } from "antd";

import { CreationTypeIcon, type CreationTypeIconName } from "@/components/creation/creation-type-icon";
import { CreationIcon } from "./creation-icons";
import type { CreationComposerModeKey, CreationComposerModeOption } from "./creation-types";

export const creationModeIconNames: Record<CreationComposerModeKey, CreationTypeIconName> = { agent: "agent", image: "image", video: "video", music: "music", audio: "audio" };

export function CreationModePicker({
    value,
    options,
    variant,
    onSelect,
}: {
    value: CreationComposerModeKey;
    /** 菜单里列出的类型：调用方去掉没有可用模型的类型，当前类型始终保留。 */
    options: readonly CreationComposerModeOption[];
    variant: "empty" | "thread";
    onSelect: (option: CreationComposerModeOption) => void;
}) {
    const [open, setOpen] = useState(false);
    const active = options.find((option) => option.key === value) || options[0];
    const select = (key: string) => {
        setOpen(false);
        const option = options.find((item) => item.key === key);
        if (option && option.key !== value) onSelect(option);
    };
    const items: MenuProps["items"] = options.map((option) => ({
        key: option.key,
        icon: <CreationTypeIcon name={creationModeIconNames[option.key]} size={20} />,
        label: (
            <span className="creation-mode-menu-item">
                <span className="creation-mode-menu-name">{option.label}</span>
                {option.key === value ? (
                    <>
                        <CreationIcon name="check" className="creation-mode-menu-check" />
                        <span className="sr-only">（当前）</span>
                    </>
                ) : null}
            </span>
        ),
    }));
    return (
        <div className="creation-mode-dropdown" data-active-mode={value}>
            <Dropdown
                open={open}
                onOpenChange={setOpen}
                trigger={["click"]}
                menu={{ items, selectedKeys: [value], onClick: ({ key }) => select(String(key)), "aria-label": "创作类型" }}
                placement={variant === "thread" ? "topLeft" : "bottomLeft"}
                autoAdjustOverflow
                arrow={false}
                classNames={{ root: "creation-mode-menu" }}
                getPopupContainer={() => document.body}
            >
                <button type="button" className="creation-mode-select" aria-haspopup="menu" aria-expanded={open} aria-label={`创作类型：${active.label}`}>
                    <CreationTypeIcon name={creationModeIconNames[active.key]} />
                    <span>{active.label}</span>
                    <CreationIcon name="chevronDown" className="creation-mode-select-chevron" />
                </button>
            </Dropdown>
        </div>
    );
}
