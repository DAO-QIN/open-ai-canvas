package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"

	"yingce/backend/internal/model"
)

const spiritAvatarCount = 48

func validProfileAvatarPreset(preset string) bool {
	switch preset {
	case "person", "director", "camera", "cat", "rabbit", "robot", "rocket", "sparkles":
		return true
	}
	if len(preset) != len("spirit-v1-01") || preset[:10] != "spirit-v1-" {
		return false
	}
	index, err := strconv.Atoi(preset[10:])
	return err == nil && index >= 1 && index <= spiritAvatarCount && preset == fmt.Sprintf("spirit-v1-%02d", index)
}

// AssignNewUserAvatar assigns a preset before account creation. Never call it on login or profile reads.
func AssignNewUserAvatar(user *model.User) error {
	index, err := rand.Int(rand.Reader, big.NewInt(spiritAvatarCount))
	if err != nil {
		return fmt.Errorf("assign default avatar: %w", err)
	}
	user.AvatarMode = "default"
	user.AvatarPreset = fmt.Sprintf("spirit-v1-%02d", index.Int64()+1)
	return nil
}
