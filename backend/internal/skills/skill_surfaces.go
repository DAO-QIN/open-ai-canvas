package skills

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"yingce/backend/internal/kernel"
)

// 首页电商种子包早于入口元数据发布。只认这一份原始内置包（ID、来源和两个哈希都对上），
// 编辑过的包或同名技能不享受同样的例外，也不改写它的版本。
const (
	legacyCreationSeedSkillID         = "电商创作"
	legacyCreationSeedContentHash     = "c0bd4e3bbd549a84f3b684ac4b57c82ab65326b6794e08a4d135db2d95d60b37"
	legacyCreationSeedInstructionHash = "cff3ef37363b078f8db045c399d6d4cc8c3780974cd42e509a67960428b94915"
)

// AgentSurfaces 返回技能在 SKILL.md frontmatter 里声明的 Agent 入口（creation 首页创作、canvas 画布助手），
// 没声明时返回 nil。声明不合法时报错，调用方不得把它当作可用。
// 首页 Agent 只会自己找来用声明了 creation 的技能；没声明的技能要用户主动选择，见 SelectableAgentSurfaces。
func AgentSurfaces(skillID, sourceType, contentHash, instruction string) ([]string, error) {
	if skillID == legacyCreationSeedSkillID && sourceType == "builtin" && contentHash == legacyCreationSeedContentHash {
		sum := sha256.Sum256([]byte(instruction))
		if hex.EncodeToString(sum[:]) == legacyCreationSeedInstructionHash {
			return []string{"creation"}, nil
		}
	}
	return declaredAgentSurfaces(instruction)
}

// SelectableAgentSurfaces 是用户主动选择（固定、点名）技能时能用的入口。没声明入口的技能早于首页入口，
// 和画布助手一样由用户决定在哪用，两个入口都能选；声明了入口的只能在声明的入口用。
func SelectableAgentSurfaces(declared []string) []string {
	if declared == nil {
		return []string{"creation", "canvas"}
	}
	return declared
}

func declaredAgentSurfaces(instruction string) ([]string, error) {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(instruction), "\r\n", "\n"), "\n")
	if len(lines) == 0 || lines[0] != "---" {
		return nil, nil
	}
	var surfaces []string
	declared, closed := false, false
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			closed = true
			break
		}
		if line != strings.TrimLeft(line, " \t") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(key) != "agentSurfaces" {
			continue
		}
		if declared || json.Unmarshal([]byte(strings.TrimSpace(value)), &surfaces) != nil {
			return nil, kernel.BadAuthRequest("技能 agentSurfaces 必须是入口名称的 JSON 数组")
		}
		declared = true
	}
	if !declared {
		return nil, nil
	}
	if !closed || len(surfaces) == 0 {
		return nil, kernel.BadAuthRequest("技能 agentSurfaces 必须在完整元数据中声明至少一个入口")
	}
	seen := map[string]bool{}
	for _, surface := range surfaces {
		if (surface != "creation" && surface != "canvas") || seen[surface] {
			return nil, kernel.BadAuthRequest("技能 agentSurfaces 只允许不重复的 creation、canvas")
		}
		seen[surface] = true
	}
	return surfaces, nil
}
