package ecommerce

import (
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestEcommercePlanningContractsAndBoundedLocalRepair(t *testing.T) {
	config := DefaultSettings().Defaults
	slot := model.EcommerceSlot{ID: "slot", Kind: "detail", Index: 1}
	plan := planFixture([]model.EcommerceSlot{slot}, config, "detail")
	original := refineFixture(plan, slot)
	row := map[string]any{}
	if err := json.Unmarshal([]byte(encode(original)), &row); err != nil {
		t.Fatal(err)
	}
	visual := row["visualPlan"].(map[string]any)
	visual["variariation"] = visual["variation"]
	delete(visual, "variation")
	visual["colorEvidence"] = visual["visualEvidence"]
	delete(visual, "visualEvidence")
	delete(visual, "colorRhythm")
	visual["generationPrompt"] = row["generationPrompt"]
	delete(row, "generationPrompt")
	raw := encode(row)
	for _, candidate := range []string{raw, raw + "}", raw[:len(raw)-1]} {
		out, err := CompileRefinement(candidate, plan, slot, config)
		if err != nil {
			t.Fatal(err)
		}
		if out.Copy != original.Copy || !strings.Contains(out.Prompt, plan.VisualSystem.Palette) || len(out.Repairs) < 4 {
			t.Fatal("bounded repair did not preserve accepted contract")
		}
	}
	for _, candidate := range []string{raw + " trailing", raw + " {}", raw + "}}", strings.TrimSuffix(raw, "}")[:len(raw)-15], "{\"generationPrompt\":\"unterminated"} {
		if _, _, err := ParseRefinementJSON(candidate); err == nil {
			t.Fatalf("unsafe repair accepted %q", candidate)
		}
	}
	changed := original
	changed.Copy = "虚构卖点"
	if _, err := CompileRefinement(encode(changed), plan, slot, config); err == nil {
		t.Fatal("refinement changed accepted copy")
	}
	changed = original
	changed.SlotID = "different"
	if _, err := CompileRefinement(encode(changed), plan, slot, config); err == nil {
		t.Fatal("wrong slot accepted")
	}
	pure := config
	pure.Detail.CopyMode = "none"
	if err := ValidatePlan(&plan, []model.EcommerceSlot{slot}, pure, "detail"); err == nil {
		t.Fatal("pure image plan contained typeset copy")
	}
	plan = planFixture([]model.EcommerceSlot{slot}, config, "detail")
	plan.Screens = append(plan.Screens, plan.Screens[0])
	if err := ValidatePlan(&plan, []model.EcommerceSlot{slot}, config, "detail"); err == nil {
		t.Fatal("duplicate slot accepted")
	}
	config.TitleMaxLength = 10
	if _, err := CompileTitles(encode(map[string]any{"titles": []string{"中文标题", "手柄设计", "清晰细节"}}), config); err != nil {
		t.Fatal(err)
	}
	for _, titles := range [][]string{{"相同", "相同", "另一个"}, {"超出十个Unicode字符的中文标题", "短标题", "另一个"}, {"少一个", "短标题"}} {
		if _, err := CompileTitles(encode(map[string]any{"titles": titles}), config); err == nil {
			t.Fatal("invalid title contract accepted")
		}
	}
}
