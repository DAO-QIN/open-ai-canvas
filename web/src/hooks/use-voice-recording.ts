import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecordingState = "idle" | "recording" | "paused";

type UseVoiceRecordingOptions = {
    /** 最大录音时长（秒），默认 60 秒 */
    maxDuration?: number;
};

export type UseVoiceRecordingReturn = {
    state: VoiceRecordingState;
    waveform: number[];
    duration: number;
    error: string | null;
    start: () => Promise<void>;
    stop: () => Promise<Blob | null>;
    cancel: () => void;
    reset: () => void;
};

/** getUserMedia 的失败原因转成中文；浏览器原始英文信息不直接展示给用户。 */
function microphoneErrorMessage(error: unknown): string {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "麦克风权限被拒绝，请在浏览器设置中允许访问麦克风";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "没有检测到麦克风，请连接后重试";
    if (name === "NotReadableError" || name === "AbortError") return "麦克风被其他应用占用，请关闭后重试";
    return "无法访问麦克风，请检查设备和浏览器权限";
}

/**
 * 语音录制 Hook
 * 使用 MediaRecorder API 录制音频，AnalyserNode 获取实时波形数据
 */
export function useVoiceRecording(options: UseVoiceRecordingOptions = {}): UseVoiceRecordingReturn {
    const { maxDuration = 60 } = options;
    const [state, setState] = useState<VoiceRecordingState>("idle");
    const [waveform, setWaveform] = useState<number[]>([]);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const animationFrameRef = useRef<number | null>(null);
    const timerRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    // 每次 start / 清理都换一代：授权弹窗还没点完就已取消或卸载时，迟到的麦克风流要立即释放。
    const sessionRef = useRef(0);

    // 清理资源
    const cleanup = useCallback(() => {
        sessionRef.current += 1;
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            void audioContextRef.current.close();
            audioContextRef.current = null;
        }
        analyserRef.current = null;
        mediaRecorderRef.current = null;
    }, []);

    // 更新波形数据
    const updateWaveform = useCallback(() => {
        const analyser = analyserRef.current;
        if (!analyser) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // 取 32 个频段的平均值，用于波形显示
        const step = Math.floor(bufferLength / 32);
        const values: number[] = [];
        for (let i = 0; i < 32; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) {
                sum += dataArray[i * step + j];
            }
            values.push(sum / step / 255);
        }
        setWaveform(values);

        animationFrameRef.current = requestAnimationFrame(updateWaveform);
    }, []);

    // 开始录制
    const start = useCallback(async () => {
        const session = ++sessionRef.current;
        setError(null);
        setWaveform([]);
        setDuration(0);
        chunksRef.current = [];

        // 非 HTTPS 页面（localhost 除外）浏览器不提供 mediaDevices
        if (!navigator.mediaDevices?.getUserMedia) {
            setError("当前页面无法使用麦克风，请通过 HTTPS 访问");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (session !== sessionRef.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            streamRef.current = stream;

            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.start(100);
            startTimeRef.current = Date.now();
            setState("recording");

            // 启动波形更新
            animationFrameRef.current = requestAnimationFrame(updateWaveform);

            // 启动计时器
            timerRef.current = window.setInterval(() => {
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                setDuration(elapsed);
                if (elapsed >= maxDuration && mediaRecorder.state !== "inactive") {
                    // 达到最大时长，自动停止并回到 idle，由调用方接着转写
                    mediaRecorder.onstop = () => {
                        cleanup();
                        setState("idle");
                    };
                    mediaRecorder.stop();
                }
            }, 100);
        } catch (err) {
            if (session !== sessionRef.current) return;
            setError(microphoneErrorMessage(err));
            setState("idle");
            cleanup();
        }

    }, [cleanup, maxDuration, updateWaveform]);

    // 停止录制
    const stop = useCallback((): Promise<Blob | null> => {
        return new Promise((resolve) => {
            const mediaRecorder = mediaRecorderRef.current;
            if (!mediaRecorder || mediaRecorder.state === "inactive") {
                cleanup();
                setState("idle");
                resolve(null);
                return;
            }

            mediaRecorder.onstop = () => {
                const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: "audio/webm" }) : null;
                cleanup();
                setState("idle");
                resolve(blob);
            };

            mediaRecorder.stop();
        });
    }, [cleanup]);

    // 取消录制
    const cancel = useCallback(() => {
        chunksRef.current = [];
        cleanup();
        setState("idle");
        setWaveform([]);
        setDuration(0);
    }, [cleanup]);

    // 重置
    const reset = useCallback(() => {
        cancel();
        setError(null);
    }, [cancel]);

    // 组件卸载时清理
    useEffect(() => {
        return () => cleanup();
    }, [cleanup]);

    return {
        state,
        waveform,
        duration,
        error,
        start,
        stop,
        cancel,
        reset,
    };
}