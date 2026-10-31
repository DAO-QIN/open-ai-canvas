import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * useVoiceRecording 的频段每段约 750Hz，人声能量集中在最前面几段。
 * 最强的低频段放中间、较弱的放两侧，说话时音量条呈山形起伏。
 */
const BAND_ORDER = [3, 1, 0, 2, 4];
/** 安静环境的底噪大约落在 0.15 以下，扣掉后音量条才有起伏 */
const NOISE_FLOOR = 0.15;
const GAIN = 1.6;

type AudioWaveformProps = {
    /** useVoiceRecording 输出的 0-1 频段能量 */
    waveform: number[];
    /** 是否跟随音量起伏；未开始录音时保持最低高度 */
    active?: boolean;
    className?: string;
};

/**
 * 紧凑音量条：5 根竖条跟随麦克风实时音量起伏，用在输入行内的语音录制胶囊里。
 * 尺寸和颜色由 voice-recording.css 决定；减少动态效果时保持静止。
 */
export function AudioWaveform({ waveform, active = true, className }: AudioWaveformProps) {
    return (
        <span className={cn("voice-level-bars", className)} aria-hidden="true">
            {BAND_ORDER.map((band) => {
                const level = active ? Math.min(1, Math.max(0, ((waveform[band] ?? 0) - NOISE_FLOOR) * GAIN)) : 0;
                return <span key={band} style={{ "--voice-level": level.toFixed(3) } as CSSProperties} />;
            })}
        </span>
    );
}
