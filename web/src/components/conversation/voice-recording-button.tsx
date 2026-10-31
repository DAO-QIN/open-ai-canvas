import { Button } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useRef, useState } from "react";

import { Mic } from "lucide-react";

import { cn } from "@/lib/utils";
import { VoiceRecordingInline } from "./voice-recording-inline";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

type VoiceRecordingButtonProps = {
    /** 转写完成回调，返回转写文本 */
    onTranscribed: (text: string) => void;
    /** 是否禁用（如发送中或未连接） */
    disabled?: boolean;
    className?: string;
};

/**
 * 语音输入按钮：点击后按钮原位变成录音胶囊，录制完成自动 STT 转写，再变回按钮
 * 使用局部状态，多个输入行可独立使用
 */
export function VoiceRecordingButton({ onTranscribed, disabled, className }: VoiceRecordingButtonProps) {
    const theme = canvasThemes[useActiveTheme()];
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const returnFocusRef = useRef(false);

    // 胶囊卸载时焦点随之丢失；没有别的控件接住焦点时还给麦克风按钮
    useEffect(() => {
        if (open || !returnFocusRef.current) return;
        returnFocusRef.current = false;
        const active = document.activeElement;
        if (!active || active === document.body) triggerRef.current?.focus({ preventScroll: true });
    }, [open]);

    const close = () => {
        returnFocusRef.current = true;
        setOpen(false);
    };

    if (open) {
        return (
            <VoiceRecordingInline
                onTranscribed={(text) => {
                    close();
                    onTranscribed(text);
                }}
                onCancel={close}
            />
        );
    }

    return (
        <Tooltip title="语音输入">
            <Button
                ref={triggerRef}
                type="text"
                shape="circle"
                className={cn(!className && "!h-8 !w-8 !min-w-8", className)}
                disabled={disabled}
                style={className ? undefined : { color: theme.node.muted }}
                icon={<Mic className="size-4" />}
                onClick={() => setOpen(true)}
                aria-label="语音输入"
            />
        </Tooltip>
    );
}
