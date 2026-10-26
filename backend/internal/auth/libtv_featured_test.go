package auth

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestBuildLibTVFeaturedPicksCoveredItemsAndKeepsFailedCounts(t *testing.T) {
	items := []LibTVGalleryItem{
		{TemplateUUID: "a", CoverURL: "https://libtv-res.liblib.art/a.png"},
		{TemplateUUID: "no-cover"},
		{TemplateUUID: "b", CoverURL: "https://libtv-res.liblib.art/b.png"},
		{TemplateUUID: "broken", CoverURL: "https://libtv-res.liblib.art/c.png"},
		{TemplateUUID: "d", CoverURL: "x"}, {TemplateUUID: "e", CoverURL: "x"}, {TemplateUUID: "f", CoverURL: "x"},
	}
	result := buildLibTVFeatured(context.Background(), items, func(_ context.Context, uuid string) (int, int, error) {
		if uuid == "broken" {
			return 0, 0, errors.New("upstream")
		}
		return 10, 4, nil
	})
	if len(result.Items) != libTVFeaturedLimit {
		t.Fatalf("items = %d", len(result.Items))
	}
	want := []string{"a", "b", "broken", "d", "e"}
	for index, item := range result.Items {
		if item.TemplateUUID != want[index] {
			t.Fatalf("order = %#v", result.Items)
		}
	}
	if result.Items[0].NodeCount != 10 || result.Items[0].ConnectionCount != 4 || result.Items[2].NodeCount != 0 {
		t.Fatalf("counts = %#v", result.Items)
	}
}

func TestLibTVFeaturedCacheSharesOneFetchAndServesStaleOnFailure(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	var calls atomic.Int32
	fail := false
	cache := &libTVFeaturedCache{now: func() time.Time { return now }, fetch: func(context.Context) (*LibTVFeaturedResult, error) {
		calls.Add(1)
		if fail {
			return nil, errors.New("upstream down")
		}
		return &LibTVFeaturedResult{Items: []LibTVFeaturedItem{{LibTVGalleryItem: LibTVGalleryItem{TemplateUUID: "a"}, NodeCount: 3}}}, nil
	}}
	for range 3 {
		result, err := cache.get(context.Background())
		if err != nil || len(result.Items) != 1 {
			t.Fatalf("get = %#v, %v", result, err)
		}
		result.Items[0].NodeCount = 99 // 调用方改动不能污染缓存
	}
	if calls.Load() != 1 {
		t.Fatalf("fetches within TTL = %d", calls.Load())
	}
	now = now.Add(libTVFeaturedTTL + time.Second)
	fail = true
	result, err := cache.get(context.Background())
	if err != nil || result.Items[0].NodeCount != 3 || calls.Load() != 2 {
		t.Fatalf("stale fallback = %#v, %v, calls=%d", result, err, calls.Load())
	}
	// 失败后一分钟内不重复打上游。
	if _, err := cache.get(context.Background()); err != nil || calls.Load() != 2 {
		t.Fatalf("retry window calls = %d, %v", calls.Load(), err)
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
		return &LibTVFeaturedResult{}, nil
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
