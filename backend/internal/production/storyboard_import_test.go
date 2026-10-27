package production

import "testing"

func TestStoryboardImportPreservesDialogueAcrossFormats(t *testing.T) {
	line := "别回头，我们还有明天。"
	for _, sample := range []struct {
		name string
		text string
	}{
		{"json", `{"shots":[{"scene":"车站","speaker":"阿青","dialogue":"别回头，我们还有明天。","action":"抬头","durationSeconds":6}]}`},
		{"markdown", "| 场景 | 说话人 | 台词 | 动作 | 时长 |\n| --- | --- | --- | --- | --- |\n| 车站 | 阿青 | 别回头，我们还有明天。 | 抬头 | 6 |"},
		{"spreadsheet", "场景\t说话人\t台词\t动作\t时长\n车站\t阿青\t别回头，我们还有明天。\t抬头\t6"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			shots, ok := ParseStoryboardSource(sample.text)
			if !ok || len(shots) != 1 {
				t.Fatalf("import failed: %#v, %v", shots, ok)
			}
			if shots[0].Dialogue != line || shots[0].Speaker != "阿青" || shots[0].Scene != "车站" || shots[0].DurationSeconds != 6 {
				t.Fatalf("import rewrote the supplied storyboard: %#v", shots[0])
			}
		})
	}
}

func TestDialogueCheckAcceptsSplitLinesAndFindsMissingWords(t *testing.T) {
	source := SourceDialogueLines("场景：车站\n阿青：别回头，我们还有明天。\n阿林：下一班车快到了。", SourceScript)
	if len(source) != 2 {
		t.Fatalf("scene metadata was mistaken for dialogue: %#v", source)
	}
	missing := MissingDialogue(source, []string{"别回头", "我们还有明天"})
	if len(missing) != 1 || missing[0] != "下一班车快到了。" {
		t.Fatalf("unexpected missing dialogue: %#v", missing)
	}
	if missing := MissingDialogue(source, []string{"别回头", "我们还有明天", "下一班车快到了"}); len(missing) != 0 {
		t.Fatalf("punctuation or split shots caused a false positive: %#v", missing)
	}
}
