package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func curatedItem(uuid string, likes int, tags ...string) LibTVGalleryItem {
	item := LibTVGalleryItem{TemplateUUID: uuid, Title: "作品 " + uuid, CoverURL: "https://libtv-res.liblib.art/" + uuid + ".png", MediaURL: "https://libtv-res.liblib.art/" + uuid + ".mp4", MediaType: "video", LikeCount: likes, snapshotID: 1}
	for index, tag := range tags {
		item.Tags = append(item.Tags, LibTVGalleryTag{ID: index + 1, Label: tag})
	}
	return item
}

// goodCheck 是满足全部收录条件的复核结论。
func goodCheck() libTVCanvasCheck {
	return libTVCanvasCheck{Nodes: 150, Connections: 40, Lossless: true, CopyBytes: 1 << 20, CoverWidth: 1920, CoverHeight: 1080}
}

func featuredUUIDs(result *LibTVFeaturedResult) string {
	got := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		got = append(got, item.TemplateUUID)
	}
	return strings.Join(got, ",")
}

func TestLibTVCanvasCheckQualifiesOnlyLosslessNodeRichLandscapeCanvases(t *testing.T) {
	if !goodCheck().qualifies() {
		t.Fatal("good check rejected")
	}
	for name, mutate := range map[string]func(*libTVCanvasCheck){
		"too few nodes":    func(c *libTVCanvasCheck) { c.Nodes = libTVCuratedMinNodes - 1 },
		"lossy import":     func(c *libTVCanvasCheck) { c.Lossless = false },
		"too large":        func(c *libTVCanvasCheck) { c.CopyBytes = libTVFeaturedMaxCopyBytes + 1 },
		"portrait cover":   func(c *libTVCanvasCheck) { c.CoverWidth, c.CoverHeight = 1080, 1440 },
		"square cover":     func(c *libTVCanvasCheck) { c.CoverWidth, c.CoverHeight = 1000, 1000 },
		"unknown cover":    func(c *libTVCanvasCheck) { c.CoverWidth, c.CoverHeight = 0, 0 },
		"just below ratio": func(c *libTVCanvasCheck) { c.CoverWidth, c.CoverHeight = 1199, 1000 },
	} {
		check := goodCheck()
		mutate(&check)
		if check.qualifies() {
			t.Errorf("%s accepted: %#v", name, check)
		}
	}
	edge := goodCheck()
	edge.Nodes, edge.CopyBytes, edge.CoverWidth, edge.CoverHeight = libTVCuratedMinNodes, libTVFeaturedMaxCopyBytes, 1200, 1000
	if !edge.qualifies() {
		t.Fatalf("boundary values rejected: %#v", edge)
	}
	fourThree := goodCheck()
	fourThree.CoverWidth, fourThree.CoverHeight = 2048, 1536
	if !fourThree.qualifies() {
		t.Fatal("4:3 cover rejected")
	}
}

func TestCurateLibTVCanvasesKeepsEveryQualifyingWorkCuratedFirst(t *testing.T) {
	noCover := curatedItem("nocover", 900)
	noCover.CoverURL = ""
	noVideo := curatedItem("novideo", 900)
	noVideo.MediaType, noVideo.MediaURL = "image", ""
	libtvTitle := curatedItem("collab", 900)
	libtvTitle.Title = "【LibTV x 品牌】合作短片"
	candidates := []libTVFeaturedCandidate{
		{item: curatedItem("small", 1000), curated: true},                           // 节点太少
		{item: curatedItem("rich-b", 300, "短片剧集"), curated: true},                   // 精选，点赞第二
		{item: curatedItem("broken", 950), curated: true},                           // 详情读不到
		{item: curatedItem("rich-a", 500, "精选画布"), curated: true},                   // 精选，点赞第一
		{item: curatedItem("lossy", 990), curated: true},                            // 复制会丢节点
		{item: curatedItem("huge", 980), curated: true},                             // 复制后画布过大
		{item: curatedItem("portrait", 970), curated: true},                         // 竖版封面
		{item: curatedItem("ad", 999, "产品展示"), curated: true},                       // 品牌广告赛道
		{item: curatedItem("hack", 998, "LibTV·「X小时之后」AI短片黑客松"), curated: true},     // 官方活动
		{item: curatedItem("9b73b351334c4281adbc36ca6510efad", 997), curated: true}, // 人工复核水印
		{item: noCover, curated: true}, {item: noVideo, curated: true}, {item: libtvTitle, curated: true},
		{item: curatedItem("public-top", 5000)},           // 公开流：点赞再高也排在精选后面
		{item: curatedItem("public-low", 10)},             // 公开流
		{item: curatedItem("rich-a", 500)},                // 两边都有：按精选算，只出现一次
		{item: curatedItem("rich-b", 300), curated: true}, // 精选里重复
	}
	var asked []string
	var mu sync.Mutex
	result := curateLibTVCanvases(context.Background(), candidates, func(_ context.Context, item LibTVGalleryItem) (libTVCanvasCheck, error) {
		mu.Lock()
		asked = append(asked, item.TemplateUUID)
		mu.Unlock()
		check := goodCheck()
		switch item.TemplateUUID {
		case "small":
			check.Nodes = 12
		case "broken":
			return libTVCanvasCheck{}, errors.New("upstream")
		case "lossy":
			check.Lossless = false
		case "huge":
			check.CopyBytes = libTVFeaturedMaxCopyBytes + 1
		case "portrait":
			check.CoverWidth, check.CoverHeight = 1080, 1920
		}
		return check, nil
	}, nil)
	if got := featuredUUIDs(result); got != "rich-a,rich-b,public-top,public-low" {
		t.Fatalf("featured = %s", got)
	}
	if result.Items[0].NodeCount != 150 || result.Items[0].ConnectionCount != 40 {
		t.Fatalf("counts = %#v", result.Items[0])
	}
	// 只按列表字段就能排除的作品不读详情，重复作品只读一次。
	seen := map[string]int{}
	for _, uuid := range asked {
		seen[uuid]++
		for _, skipped := range []string{"ad", "hack", "9b73b351334c4281adbc36ca6510efad", "nocover", "novideo", "collab"} {
			if uuid == skipped {
				t.Fatalf("read detail for excluded %s", uuid)
			}
		}
	}
	if seen["rich-a"] != 1 || seen["rich-b"] != 1 {
		t.Fatalf("duplicates read more than once: %v", seen)
	}
}

func TestCurateLibTVCanvasesHasNoCountLimit(t *testing.T) {
	var candidates []libTVFeaturedCandidate
	for index := range 150 {
		candidates = append(candidates, libTVFeaturedCandidate{item: curatedItem(fmt.Sprintf("work-%03d", index), 1000-index), curated: index%2 == 0})
	}
	result := curateLibTVCanvases(context.Background(), candidates, func(context.Context, LibTVGalleryItem) (libTVCanvasCheck, error) {
		return goodCheck(), nil
	}, nil)
	// 点赞随下标递减：精选（偶数下标）按下标排在前面，公开流（奇数下标）随后。
	var want []string
	for _, parity := range []int{0, 1} {
		for index := range 150 {
			if index%2 == parity {
				want = append(want, fmt.Sprintf("work-%03d", index))
			}
		}
	}
	if got := featuredUUIDs(result); got != strings.Join(want, ",") {
		t.Fatalf("featured order = %s", got)
	}
}

func TestCurateLibTVCanvasesPublishesAnOrderedPrefixFirst(t *testing.T) {
	var candidates []libTVFeaturedCandidate
	for index := range 60 {
		candidates = append(candidates, libTVFeaturedCandidate{item: curatedItem(fmt.Sprintf("work-%03d", index), 1000-index), curated: true})
	}
	release := make(chan struct{})
	var partial *LibTVFeaturedResult
	var publishes atomic.Int32
	result := curateLibTVCanvases(context.Background(), candidates, func(_ context.Context, item LibTVGalleryItem) (libTVCanvasCheck, error) {
		var index int
		fmt.Sscanf(item.TemplateUUID, "work-%d", &index)
		if index >= 40 {
			// 后面的作品要等前面先交出一批才读完，模拟首次构建里慢的部分。
			select {
			case <-release:
			case <-time.After(5 * time.Second):
				return libTVCanvasCheck{}, errors.New("prefix was never published")
			}
		}
		check := goodCheck()
		if index%3 == 0 {
			check.Lossless = false
		}
		return check, nil
	}, func(early *LibTVFeaturedResult) {
		publishes.Add(1)
		partial = early
		close(release)
	})
	if publishes.Load() != 1 || partial == nil || len(partial.Items) < libTVFeaturedEarlyCount {
		t.Fatalf("publishes = %d partial = %#v", publishes.Load(), partial)
	}
	if len(result.Items) != 40 {
		t.Fatalf("final items = %d", len(result.Items))
	}
	if !strings.HasPrefix(featuredUUIDs(result), featuredUUIDs(partial)) {
		t.Fatalf("partial is not a prefix of the final order:\n%s\n%s", featuredUUIDs(partial), featuredUUIDs(result))
	}
}

func TestLibTVCanvasChecksReuseSnapshotAndFallBackOnErrors(t *testing.T) {
	checks := &libTVCanvasChecks{items: map[string]libTVCanvasCheck{}}
	item := curatedItem("work", 10)
	item.snapshotID = 7
	var calls int
	fail := false
	inspect := func(_ context.Context, item LibTVGalleryItem) (libTVCanvasCheck, error) {
		calls++
		if fail {
			return libTVCanvasCheck{}, errors.New("upstream")
		}
		check := goodCheck()
		check.SnapshotID, check.CoverURL, check.Nodes = item.snapshotID, item.CoverURL, 100+calls
		return check, nil
	}
	first, err := checks.check(context.Background(), item, inspect)
	if err != nil || calls != 1 || first.Nodes != 101 {
		t.Fatalf("first = %#v, %v, calls=%d", first, err, calls)
	}
	if again, _ := checks.check(context.Background(), item, inspect); calls != 1 || again.Nodes != 101 {
		t.Fatalf("same snapshot re-read: calls=%d %#v", calls, again)
	}
	item.CoverURL = "https://libtv-res.liblib.art/new-cover.png"
	if changed, _ := checks.check(context.Background(), item, inspect); calls != 2 || changed.Nodes != 102 {
		t.Fatalf("changed cover not re-read: calls=%d %#v", calls, changed)
	}
	item.snapshotID = 8
	fail = true
	if fallback, err := checks.check(context.Background(), item, inspect); err != nil || calls != 3 || fallback.Nodes != 102 {
		t.Fatalf("fallback = %#v, %v, calls=%d", fallback, err, calls)
	}
	if _, err := checks.check(context.Background(), curatedItem("fresh", 1), inspect); err == nil {
		t.Fatal("error without a previous conclusion must surface")
	}
	unversioned := curatedItem("unversioned", 1)
	unversioned.snapshotID = 0
	fail = false
	checks.check(context.Background(), unversioned, inspect)
	checks.check(context.Background(), unversioned, inspect)
	if calls != 6 {
		t.Fatalf("unversioned work should always be re-read, calls=%d", calls)
	}
	checks.retain(map[string]bool{"work": true})
	if _, ok := checks.items["unversioned"]; ok || len(checks.items) != 1 {
		t.Fatalf("retain kept %v", checks.items)
	}
}

func losslessTestSnapshot(t *testing.T, drop ...string) (*libTVPublishedTemplate, *libTVTemplateSnapshot) {
	t.Helper()
	work, snapshot := testLibTVPublishedSnapshot(t)
	removed := map[string]bool{}
	for _, id := range drop {
		removed[id] = true
	}
	nodes := snapshot.Nodes[:0]
	for _, node := range snapshot.Nodes {
		if !removed[node.ID] {
			nodes = append(nodes, node)
		}
	}
	edges := snapshot.Edges[:0]
	for _, edge := range snapshot.Edges {
		if !removed[edge.ID] {
			edges = append(edges, edge)
		}
	}
	snapshot.Nodes, snapshot.Edges = nodes, edges
	return work, snapshot
}

func TestLibTVImportLosslessRequiresEveryNodeEdgeAndMediaResult(t *testing.T) {
	work, snapshot := losslessTestSnapshot(t)
	if libTVImportLossless(snapshot, adaptLibTVTemplate(work, snapshot)) {
		t.Fatal("unsupported node and dangling edge accepted")
	}
	work, snapshot = losslessTestSnapshot(t, "unsupported", "broken")
	if libTVImportLossless(snapshot, adaptLibTVTemplate(work, snapshot)) {
		t.Fatal("media on an untrusted host accepted")
	}
	work, snapshot = losslessTestSnapshot(t, "unsupported", "broken", "untrusted")
	if !libTVImportLossless(snapshot, adaptLibTVTemplate(work, snapshot)) {
		t.Fatal("clean snapshot rejected")
	}
	for index := range snapshot.Nodes {
		if snapshot.Nodes[index].ID == "video" {
			snapshot.Nodes[index].Data = json.RawMessage(`{"type":"video","url":["https://libtv-res.liblib.art/video.mp4","https://other.invalid/other.mp4",""]}`)
		}
	}
	if libTVImportLossless(snapshot, adaptLibTVTemplate(work, snapshot)) {
		t.Fatal("partially dropped results accepted")
	}
}

func TestLibTVCopiedCanvasBytesCountsExpandedResultCards(t *testing.T) {
	node := func(kind string, results int) LibTVCanvasNode {
		item := LibTVCanvasNode{ID: kind, Type: kind, Prompt: strings.Repeat("提示词", 100)}
		for index := range results {
			item.Results = append(item.Results, LibTVMediaResult{SourceIndex: index, Content: "https://libtv-res.liblib.art/x"})
		}
		return item
	}
	size := func(item LibTVCanvasNode) int {
		encoded, _ := json.Marshal(item)
		return len(encoded)
	}
	image, video, text := node("image", 3), node("video", 2), node("text", 0)
	connections := []LibTVCanvasConnection{{ID: "edge", FromNodeID: "image", ToNodeID: "video"}}
	encodedConnections, _ := json.Marshal(connections)
	got := libTVCopiedCanvasBytes(&LibTVImportResult{Nodes: []LibTVCanvasNode{image, video, text}, Connections: connections})
	if want := size(image)*4 + size(video)*2 + size(text) + len(encodedConnections); got != want {
		t.Fatalf("bytes = %d, want %d", got, want)
	}
}

func TestDecodeLibTVImageInfo(t *testing.T) {
	width, height, err := decodeLibTVImageInfo([]byte(`{"FileSize":{"value":"1"},"ImageHeight":{"value":"1152"},"ImageWidth":{"value":"2048"}}`))
	if err != nil || width != 2048 || height != 1152 {
		t.Fatalf("size = %dx%d, %v", width, height, err)
	}
	for _, body := range []string{`{}`, `{"ImageHeight":{"value":"0"},"ImageWidth":{"value":"10"}}`, `{"ImageHeight":{"value":"x"},"ImageWidth":{"value":"10"}}`, `not json`} {
		if _, _, err := decodeLibTVImageInfo([]byte(body)); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
}

func staticFeaturedFetch(fetch func(context.Context) (*LibTVFeaturedResult, error)) func(context.Context, func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error) {
	return func(ctx context.Context, _ func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error) {
		return fetch(ctx)
	}
}

func TestLibTVFeaturedCacheServesStaleWhileRefreshing(t *testing.T) {
	var mu sync.Mutex
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	advance := func(d time.Duration) { mu.Lock(); now = now.Add(d); mu.Unlock() }
	var calls atomic.Int32
	var fail atomic.Bool
	version := atomic.Int32{}
	cache := &libTVFeaturedCache{now: clock, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
		calls.Add(1)
		if fail.Load() {
			return nil, errors.New("upstream down")
		}
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: int(version.Add(1))}}}, nil
	})}
	for range 3 {
		result, err := cache.get(context.Background())
		if err != nil || len(result.Items) != 1 || result.Items[0].NodeCount != 1 {
			t.Fatalf("get = %#v, %v", result, err)
		}
		result.Items[0].NodeCount = 99 // 调用方改动不能污染缓存
	}
	cache.refreshes.Wait()
	if calls.Load() != 1 {
		t.Fatalf("fetches within TTL = %d", calls.Load())
	}
	// 过期：立即返回旧结果，后台只刷新一次。
	advance(libTVFeaturedTTL + time.Second)
	for range 3 {
		if result, err := cache.get(context.Background()); err != nil || result.Items[0].NodeCount != 1 {
			t.Fatalf("stale = %#v, %v", result, err)
		}
	}
	cache.refreshes.Wait()
	if calls.Load() != 2 {
		t.Fatalf("background refreshes = %d", calls.Load())
	}
	if result, _ := cache.get(context.Background()); result.Items[0].NodeCount != 2 {
		t.Fatalf("refreshed = %#v", result)
	}
	// 刷新失败保留旧结果，一分钟内不再重试。
	advance(libTVFeaturedTTL + time.Second)
	fail.Store(true)
	if result, err := cache.get(context.Background()); err != nil || result.Items[0].NodeCount != 2 {
		t.Fatalf("stale on failure = %#v, %v", result, err)
	}
	cache.refreshes.Wait()
	cache.get(context.Background())
	cache.refreshes.Wait()
	if calls.Load() != 3 {
		t.Fatalf("retry window calls = %d", calls.Load())
	}
	// 上游返回空列表视同失败，不能覆盖已有精选。
	fail.Store(false)
	cache.fetch = staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) { return &LibTVFeaturedResult{}, nil })
	advance(libTVFeaturedRetryAfter + time.Second)
	cache.get(context.Background())
	cache.refreshes.Wait()
	if result, _ := cache.get(context.Background()); len(result.Items) != 1 || result.Items[0].NodeCount != 2 {
		t.Fatalf("empty refresh replaced cache: %#v", result)
	}
	var emptyCalls atomic.Int32
	empty := &libTVFeaturedCache{now: clock, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
		emptyCalls.Add(1)
		return nil, errors.New("down")
	})}
	if _, err := empty.get(context.Background()); err == nil {
		t.Fatal("empty cache must surface upstream error")
	}
	// 一份结果都没有时也等重试间隔，不让每个访客都触发一次整轮读取。
	if _, err := empty.get(context.Background()); err == nil || emptyCalls.Load() != 1 {
		t.Fatalf("rebuilt inside the retry window: calls=%d err=%v", emptyCalls.Load(), err)
	}
	advance(libTVFeaturedRetryAfter + time.Second)
	if _, err := empty.get(context.Background()); err == nil || emptyCalls.Load() != 2 {
		t.Fatalf("retry after the window: calls=%d err=%v", emptyCalls.Load(), err)
	}
}

func TestLibTVFeaturedCacheBuildOutlivesCancelledVisitors(t *testing.T) {
	release := make(chan struct{})
	cache := &libTVFeaturedCache{now: time.Now, fetch: staticFeaturedFetch(func(ctx context.Context) (*LibTVFeaturedResult, error) {
		<-release
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: 1}}}, nil
	})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := cache.get(ctx); err == nil {
		t.Fatal("cancelled visitor should return immediately")
	}
	close(release)
	cache.refreshes.Wait()
	if result, err := cache.get(context.Background()); err != nil || result.Items[0].NodeCount != 1 {
		t.Fatalf("build followed visitor cancellation: %#v, %v", result, err)
	}
}

func TestLibTVFeaturedRequiresActor(t *testing.T) {
	if _, err := New(nil, nil, nil).LibTVFeatured(context.Background(), nil); err == nil {
		t.Fatal("accepted nil actor")
	}
	if _, err := New(nil, nil, nil).LibTVFeatured(context.Background(), &model.User{}); err == nil {
		t.Fatal("accepted empty actor id")
	}
}

func TestLibTVFeaturedPrewarmSharesTheFirstBuild(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	cache := &libTVFeaturedCache{now: time.Now, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
		calls.Add(1)
		<-release
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: 7}}}, nil
	})}
	cache.prewarm()
	cache.prewarm() // 重复调用不会再起一次
	results := make(chan *LibTVFeaturedResult, 3)
	for range 3 {
		go func() {
			result, _ := cache.get(context.Background())
			results <- result
		}()
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	for range 3 {
		if result := <-results; result == nil || result.Items[0].NodeCount != 7 {
			t.Fatalf("waiting visitor got %#v", result)
		}
	}
	cache.refreshes.Wait()
	if calls.Load() != 1 {
		t.Fatalf("upstream builds = %d", calls.Load())
	}
	// 等待中的访客自己取消请求时立即返回，不拖住预热。
	slow := &libTVFeaturedCache{now: time.Now, fetch: staticFeaturedFetch(func(ctx context.Context) (*LibTVFeaturedResult, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})}
	slow.prewarm()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := slow.get(ctx); err == nil {
		t.Fatal("cancelled visitor should not block on prewarm")
	}
}

func TestLibTVFeaturedCacheServesTheFirstBatchEarly(t *testing.T) {
	release := make(chan struct{})
	var mu sync.Mutex
	now := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	builds := atomic.Int32{}
	cache := &libTVFeaturedCache{now: clock, fetch: func(_ context.Context, publish func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error) {
		build := int(builds.Add(1))
		publish(&LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: build * 10}}})
		<-release
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: build * 10}, {NodeCount: build*10 + 1}}}, nil
	}}
	cache.prewarm()
	first, err := cache.get(context.Background())
	if err != nil || len(first.Items) != 1 || first.Items[0].NodeCount != 10 {
		t.Fatalf("early batch = %#v, %v", first, err)
	}
	close(release)
	cache.refreshes.Wait()
	if full, _ := cache.get(context.Background()); len(full.Items) != 2 {
		t.Fatalf("full result = %#v", full)
	}
	// 已有完整结果时，后续刷新的部分结果不能替换它。
	mu.Lock()
	now = now.Add(libTVFeaturedTTL + time.Second)
	mu.Unlock()
	if stale, _ := cache.get(context.Background()); len(stale.Items) != 2 || stale.Items[0].NodeCount != 10 {
		t.Fatalf("stale = %#v", stale)
	}
	cache.refreshes.Wait()
	if refreshed, _ := cache.get(context.Background()); len(refreshed.Items) != 2 || refreshed.Items[0].NodeCount != 20 {
		t.Fatalf("refreshed = %#v", refreshed)
	}
}
