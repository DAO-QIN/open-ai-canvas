import { Button } from "antd";
import { Check, Crop, ImagePlus } from "lucide-react";
import { UserAvatar } from "@/components/layout/user-avatar";
import { DEFAULT_USER_AVATARS } from "@/lib/default-user-avatars";
import type { LocalUser } from "@/services/api/auth";

type Props = {
    user: LocalUser;
    source: "preset" | "upload";
    preset: string;
    uploadPreview?: string;
    disabled: boolean;
    onSelect: (preset: string) => void;
    onUpload: () => void;
    onCrop: () => void;
    onPreviewError: () => void;
};

export function ProfileAvatarPicker({ user, source, preset, uploadPreview, disabled, onSelect, onUpload, onCrop, onPreviewError }: Props) {
    const previewUser = source === "preset" ? { ...user, avatarMode: "default" as const, avatarPreset: preset, avatarUrl: undefined } : user;
    return (
        <>
            <div className="profile-avatar-picker-header">
                {source === "upload" && uploadPreview ? <img className="profile-avatar-dialog-preview" src={uploadPreview} alt="待保存的头像预览" onError={onPreviewError} /> : <UserAvatar user={previewUser} className="profile-avatar-dialog-preview" />}
                <div className="profile-avatar-upload-controls">
                    <div className="profile-actions">
                        <Button icon={<ImagePlus className="size-4" />} disabled={disabled} onClick={onUpload}>
                            上传头像
                        </Button>
                        {source === "upload" && uploadPreview ? (
                            <Button icon={<Crop className="size-4" />} disabled={disabled} onClick={onCrop}>
                                重新裁剪
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div>
            <div className="profile-default-avatar-grid" role="group" aria-label="默认头像">
                {DEFAULT_USER_AVATARS.map((avatar, index) => (
                    <button key={avatar.id} type="button" className="profile-default-avatar-choice" aria-label={avatar.label} aria-pressed={source === "preset" && preset === avatar.id} disabled={disabled} onClick={() => onSelect(avatar.id)}>
                        <UserAvatar user={{ ...user, avatarMode: "default", avatarPreset: avatar.id }} className="profile-default-avatar-image" loading={index < 24 ? "eager" : "lazy"} />
                        {source === "preset" && preset === avatar.id ? (
                            <span className="profile-default-avatar-check">
                                <Check aria-hidden />
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>
        </>
    );
}
