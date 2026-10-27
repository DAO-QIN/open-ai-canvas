package auth

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func curatedItem(uuid string, likes int, tags ...string) LibTVGalleryItem {
	item := LibTVGalleryItem{TemplateUUID: uuid, Title: "作品 " + uuid, CoverURL: "https://libtv-res.liblib.art/" + uuid + ".png", MediaURL: "https://libtv-res.liblib.art/" + uuid + ".mp4", MediaType: "video", LikeCount: likes}
	for index, tag := range tags {
		item.Tags = append(item.Tags, LibTVGalleryTag{ID: index + 1, Label: tag})
	}
	return item
}

func TestCurateLibTVCanvasesKeepsNodeRichImportableCleanWorks(t *testing.T) {
	noCover := curatedItem("nocover", 900)
	noCover.CoverURL = ""
	noVideo := curatedItem("novideo", 900)
	noVideo.MediaType, noVideo.MediaURL = "image", ""
	libtvTitle := curatedItem("collab", 900)
	libtvTitle.Title = "【LibTV x 品牌】合作短片"
	items := []LibTVGalleryItem{
		curatedItem("small", 1000),                           // 节点太少
		curatedItem("rich-b", 300, "短片剧集"),                   // 保留，点赞第二
		curatedItem("broken", 950),                           // 详情读不到 → 失效
		curatedItem("rich-a", 500, "精选画布"),                   // 保留，点赞第一
		curatedItem("ad", 999, "产品展示"),                       // 品牌广告赛道（常带水印）
		curatedItem("hack", 998, "LibTV·「X小时之后」AI短片黑客松"),     // 官方活动
		curatedItem("9b73b351334c4281adbc36ca6510efad", 997), // 人工复核水印
		curatedItem("empty", 996),                            // 节点够但没有可导入节点
		noCover, noVideo, libtvTitle,
		curatedItem("rich-a", 500), // 重复
	}
	var asked []string
	var mu sync.Mutex
	result := curateLibTVCanvases(context.Background(), items, func(_ context.Context, uuid string) (libTVCanvasStats, error) {
		mu.Lock()
		asked = append(asked, uuid)
		mu.Unlock()
		switch uuid {
		case "small":
			return libTVCanvasStats{Nodes: 12, Connections: 3, Importable: 12}, nil
		case "broken":
			return libTVCanvasStats{}, errors.New("upstream")
		case "empty":
			return libTVCanvasStats{Nodes: 200, Importable: 0}, nil
		}
		return libTVCanvasStats{Nodes: 150, Connections: 40, Importable: 140}, nil
	})
	got := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		got = append(got, item.TemplateUUID)
	}
	if strings.Join(got, ",") != "rich-a,rich-b" {
		t.Fatalf("curated = %v", got)
	}
	if result.Items[0].NodeCount != 150 || result.Items[0].ConnectionCount != 40 {
		t.Fatalf("counts = %#v", result.Items[0])
	}
	// 只按列表字段就能排除的作品不读详情。
	for _, uuid := range asked {
		for _, skipped := range []string{"ad", "hack", "9b73b351334c4281adbc36ca6510efad", "nocover", "novideo", "collab"} {
			if uuid == skipped {
				t.Fatalf("read detail for excluded %s", uuid)
			}
		}
	}
}

func TestCurateLibTVCanvasesStopsAtLimit(t *testing.T) {
	var items []LibTVGalleryItem
	for index := range libTVCuratedLimit + 15 {
		items = append(items, curatedItem(strings.Repeat("a", 3)+string(rune('A'+index)), 1000-index))
	}
	var calls atomic.Int32
	result := curateLibTVCanvases(context.Background(), items, func(context.Context, string) (libTVCanvasStats, error) {
		calls.Add(1)
		return libTVCanvasStats{Nodes: 120, Importable: 100}, nil
	})
	if len(result.Items) != libTVCuratedLimit {
		t.Fatalf("items = %d", len(result.Items))
	}
	if int(calls.Load()) > libTVCuratedLimit+libTVCuratedDetailLimit {
		t.Fatalf("read too many details: %d", calls.Load())
	}
	for index := 1; index < len(result.Items); index++ {
		if result.Items[index-1].LikeCount < result.Items[index].LikeCount {
			t.Fatal("not sorted by likes")
		}
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
	cache := &libTVFeaturedCache{now: clock, fetch: func(context.Context) (*LibTVFeaturedResult, error) {
		calls.Add(1)
		if fail.Load() {
			return nil, errors.New("upstream down")
		}
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: int(version.Add(1))}}}, nil
	}}
	for range 3 {
		result, err := cache.get(context.Background())
		if err != nil || len(result.Items) != 1 || result.Items[0].NodeCount != 1 {
			t.Fatalf("get = %#v, %v", result, err)
		}
		result.Items[0].NodeCount = 99 // 调用方改动不能污染缓存
	}
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
	cache.fetch = func(context.Context) (*LibTVFeaturedResult, error) { return &LibTVFeaturedResult{}, nil }
	advance(libTVFeaturedRetryAfter + time.Second)
	cache.get(context.Background())
	cache.refreshes.Wait()
	if result, _ := cache.get(context.Background()); len(result.Items) != 1 || result.Items[0].NodeCount != 2 {
		t.Fatalf("empty refresh replaced cache: %#v", result)
	}
	empty := &libTVFeaturedCache{now: time.Now, fetch: func(context.Context) (*LibTVFeaturedResult, error) { return nil, errors.New("down") }}
	if _, err := empty.get(context.Background()); err == nil {
		t.Fatal("empty cache must surface upstream error")
	}
}

func TestLibTVFeaturedCacheRefreshIgnoresCallerCancellation(t *testing.T) {
	cache := &libTVFeaturedCache{now: time.Now, fetch: func(ctx context.Context) (*LibTVFeaturedResult, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: 1}}}, nil
	}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := cache.get(ctx); err != nil {
		t.Fatalf("refresh followed caller cancellation: %v", err)
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
	cache := &libTVFeaturedCache{now: time.Now, fetch: func(context.Context) (*LibTVFeaturedResult, error) {
		calls.Add(1)
		<-release
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{NodeCount: 7}}}, nil
	}}
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
	slow := &libTVFeaturedCache{now: time.Now, fetch: func(ctx context.Context) (*LibTVFeaturedResult, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	slow.prewarm()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := slow.get(ctx); err == nil {
		t.Fatal("cancelled visitor should not block on prewarm")
	}
}
