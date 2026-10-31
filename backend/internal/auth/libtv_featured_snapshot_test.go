package auth

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func featuredResult(uuids ...string) *LibTVFeaturedResult {
	result := &LibTVFeaturedResult{RefreshedAt: time.Now().UTC()}
	for index, uuid := range uuids {
		result.Items = append(result.Items, LibTVFeaturedItem{LibTVGalleryItem: curatedItem(uuid, 100-index), NodeCount: 150, ConnectionCount: 40})
	}
	return result
}

func writeFeaturedSnapshot(t *testing.T, path string, snapshot libTVFeaturedSnapshot) {
	t.Helper()
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

// 线上现象：后端重启后首个访客等了 102 秒（另一次 15 秒后 500）才看到精选，
// 因为精选与作品复核结论只在进程内存里。重启后应先展示上一份精选，后台刷新。
func TestLibTVFeaturedSnapshotServesTheLastResultAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "libtv-featured.json")
	firstChecks := &libTVCanvasChecks{items: map[string]libTVCanvasCheck{"tpl-a": goodCheck()}}
	first := &libTVFeaturedCache{now: time.Now, snapshotPath: path, checks: firstChecks, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
		return featuredResult("tpl-a", "tpl-b"), nil
	})}
	first.prewarm()
	first.refreshes.Wait()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("snapshot not written: %v", err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temporary snapshot file left behind")
	}

	// 新进程：上游读取被卡住，访客仍应立即拿到上一份精选。
	release := make(chan struct{})
	var calls atomic.Int32
	restartedChecks := &libTVCanvasChecks{items: map[string]libTVCanvasCheck{}}
	restarted := &libTVFeaturedCache{now: time.Now, snapshotPath: path, checks: restartedChecks, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
		calls.Add(1)
		<-release
		return featuredResult("tpl-c"), nil
	})}
	restarted.prewarm()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := restarted.get(ctx)
	if err != nil || featuredUUIDs(result) != "tpl-a,tpl-b" {
		t.Fatalf("restart served %v, %v; want the saved featured list immediately", result, err)
	}
	if _, ok := restartedChecks.items["tpl-a"]; !ok {
		t.Fatal("saved canvas checks were not restored, the refresh would re-read every detail")
	}
	close(release)
	restarted.refreshes.Wait()
	if result, err := restarted.get(context.Background()); err != nil || featuredUUIDs(result) != "tpl-c" {
		t.Fatalf("background refresh not applied: %v, %v", result, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("upstream builds after restart = %d", calls.Load())
	}
	var saved libTVFeaturedSnapshot
	raw, _ := os.ReadFile(path)
	if err := json.Unmarshal(raw, &saved); err != nil || featuredUUIDs(saved.Result) != "tpl-c" {
		t.Fatalf("snapshot not updated after refresh: %v", err)
	}
}

func TestLibTVFeaturedSnapshotIgnoresUnusableFiles(t *testing.T) {
	watermarked := "9b73b351334c4281adbc36ca6510efad"
	if !libTVWatermarkedTemplates[watermarked] {
		t.Fatal("fixture must be a watermarked template")
	}
	cases := map[string]func(path string){
		"corrupt": func(path string) { _ = os.WriteFile(path, []byte("{"), 0o600) },
		"old": func(path string) {
			writeFeaturedSnapshot(t, path, libTVFeaturedSnapshot{Version: libTVFeaturedSnapshotVersion, SavedAt: time.Now().Add(-libTVFeaturedSnapshotMaxAge - time.Hour), Result: featuredResult("tpl-old")})
		},
		"version": func(path string) {
			writeFeaturedSnapshot(t, path, libTVFeaturedSnapshot{Version: libTVFeaturedSnapshotVersion + 1, SavedAt: time.Now(), Result: featuredResult("tpl-old")})
		},
		"only-excluded": func(path string) {
			writeFeaturedSnapshot(t, path, libTVFeaturedSnapshot{Version: libTVFeaturedSnapshotVersion, SavedAt: time.Now(), Result: featuredResult(watermarked)})
		},
		"missing": func(string) {},
	}
	for name, prepare := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "libtv-featured.json")
			prepare(path)
			cache := &libTVFeaturedCache{now: time.Now, snapshotPath: path, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
				return featuredResult("tpl-fresh"), nil
			})}
			cache.prewarm()
			result, err := cache.get(context.Background())
			if err != nil || featuredUUIDs(result) != "tpl-fresh" {
				t.Fatalf("unusable snapshot served: %v, %v", result, err)
			}
			cache.refreshes.Wait()
		})
	}
}

func TestLibTVFeaturedSnapshotDropsNewlyExcludedWorks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "libtv-featured.json")
	watermarked := "9b73b351334c4281adbc36ca6510efad"
	writeFeaturedSnapshot(t, path, libTVFeaturedSnapshot{Version: libTVFeaturedSnapshotVersion, SavedAt: time.Now(), Result: featuredResult("tpl-a", watermarked, "tpl-b")})
	release := make(chan struct{})
	cache := &libTVFeaturedCache{now: time.Now, snapshotPath: path, fetch: staticFeaturedFetch(func(context.Context) (*LibTVFeaturedResult, error) {
		<-release
		return featuredResult("tpl-fresh"), nil
	})}
	cache.prewarm()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := cache.get(ctx)
	close(release)
	cache.refreshes.Wait()
	if err != nil || featuredUUIDs(result) != "tpl-a,tpl-b" {
		t.Fatalf("snapshot must drop works excluded by current rules: %v, %v", result, err)
	}
}
