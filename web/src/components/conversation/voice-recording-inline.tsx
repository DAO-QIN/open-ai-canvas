import { App } from "antd";
import { Check, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Tooltip } from "@/components/ui/base/tooltip";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { cn } from "@/lib/utils";
import { AudioWaveform } from "./audio-waveform";
import "./voice-recording.css";

type VoiceRecordingInlineProps = {
    /** 转写完成回调，返回转写文本 */
    onTranscribed: (text: string) => void;
    /** 取消或失败后收起胶囊 */
    onCancel: () => void;
    className?: string;
};

type Phase = "recording" | "transcribing";
type Notice = { text: string; level: "error" | "warning" };

const MAX_DURATION_SECONDS = 60;
/** 录音和识别可能先后报同一个问题，共用一个 key 只留一条提示 */
const NOTICE_KEY = "voice-recording-notice";

function formatDuration(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 内联语音录制胶囊：在麦克风按钮原位展开，高度与输入行控件一致，不另起一行。
 * 挂载后自动开始录音，用浏览器 Web Speech API 转写（无需后端与 API Key）。
 * 点「完成」转成文字，点「取消」或按 Esc 放弃；出错时用轻提示说明原因并收回麦克风按钮，再点一次即可重试。
 */
export function VoiceRecordingInline({ onTranscribed, onCancel, className }: VoiceRecordingInlineProps) {
    const { message } = App.useApp();
    const {
        state,
        waveform,
        duration,
        error: recorderError,
        start: startRecording,
        stop: stopRecording,
        cancel: cancelRecording,
    } = useVoiceRecording({
        maxDuration: MAX_DURATION_SECONDS,
    });
    const {
        supported: speechSupported,
        error: speechError,
        start: startSpeech,
        stop: stopSpeech,
        cancel: cancelSpeech,
    } = useSpeechRecognition();
    const [phase, setPhase] = useState<Phase>("recording");
    // 转写要等识别收尾，回调时用最新的父组件回调，避免拿到旧的输入框内容
    const callbacksRef = useRef({ onTranscribed, onCancel });
    const mountedRef = useRef(false);
    const finishingRef = useRef(false);
    const wasRecordingRef = useRef(false);
    const doneButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        callbacksRef.current = { onTranscribed, onCancel };
    });

    const dismiss = useCallback(
        (notice?: Notice) => {
            cancelRecording();
            cancelSpeech();
            if (notice) message[notice.level]({ content: notice.text, key: NOTICE_KEY });
            callbacksRef.current.onCancel();
        },
        [cancelRecording, cancelSpeech, message],
    );

    const finish = useCallback(async () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        setPhase("transcribing");
        const text = (await stopSpeech()).trim();
        void stopRecording();
        if (!mountedRef.current) return;
        if (!text) {
            dismiss({ text: "没有识别到语音内容，请再试一次", level: "warning" });
            return;
        }
        callbacksRef.current.onTranscribed(text);
    }, [dismiss, stopRecording, stopSpeech]);

    // 挂载即开始录音与识别；完成、取消或离开页面卸载时一并释放麦克风
    useEffect(() => {
        mountedRef.current = true;
        if (!speechSupported) {
            dismiss({ text: "当前浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器", level: "error" });
            return () => {
                mountedRef.current = false;
            };
        }
        void startRecording();
        startSpeech();
        return () => {
            mountedRef.current = false;
            cancelRecording();
            cancelSpeech();
        };
    }, [cancelRecording, cancelSpeech, dismiss, speechSupported, startRecording, startSpeech]);

    const failure = speechError?.message || recorderError || "";
    useEffect(() => {
        if (failure) dismiss({ text: failure, level: "error" });
    }, [dismiss, failure]);

    // 录满最长时长时录音会自动停下，接着转写，效果等同点「完成」
    useEffect(() => {
        if (state === "recording") wasRecordingRef.current = true;
        else if (wasRecordingRef.current && !finishingRef.current) void finish();
    }, [finish, state]);

    // 胶囊替换了麦克风按钮，焦点交给「完成」：回车完成，Esc 取消
    useEffect(() => {
        doneButtonRef.current?.focus({ preventScroll: true });
    }, []);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || phase !== "recording") return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
    };

    const recording = phase === "recording";

    return (
        <div role="group" aria-label="语音输入" data-phase={phase} className={cn("voice-recording-inline", className)} onKeyDown={handleKeyDown}>
            {recording ? (
                <>
                    <Tooltip title="取消（Esc）">
                        <button type="button" className="voice-recording-action" data-voice-action="cancel" aria-label="取消语音输入" onClick={() => dismiss()}>
                            <X aria-hidden="true" />
                        </button>
                    </Tooltip>
                    <AudioWaveform waveform={waveform} active={state === "recording"} />
                    <span className="voice-recording-time">{formatDuration(Math.min(duration, MAX_DURATION_SECONDS))}</span>
                    <Tooltip title="说完了，转成文字">
                        <button ref={doneButtonRef} type="button" className="voice-recording-action is-primary" data-voice-action="done" aria-label="完成语音输入" onClick={() => void finish()}>
                            <Check aria-hidden="true" />
                        </button>
                    </Tooltip>
                </>
            ) : (
                <span className="voice-recording-status">
                    <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
                    识别中
                </span>
            )}
            <span className="sr-only" aria-live="polite">
                {recording ? "" : "正在识别语音"}
            </span>
        </div>
    );
}
