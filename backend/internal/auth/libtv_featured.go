package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

// 精选画布（首页前 5 个 +「全部画布」页）：收录所有节点多、复制后不丢东西、封面干净的公开画布，不设数量上限。
//
// 筛选规则：
//   - 来源是 LibTV「精选画布」标签（tagId 1000）和公开作品流（灵感广场同一个接口），两边都读到最后一页；
//   - 必须有成片和横版封面（宽高比不小于 libTVFeaturedMinCoverRatio：卡片和弹窗按 16:9 裁切，竖版封面会被切掉大半），
//     节点数不少于 libTVCuratedMinNodes；
//   - 复制后与原画布一致：每个节点、每条连线、每个媒体结果都能导入，且复制出的画布不超过 libTVFeaturedMaxCopyBytes
//     （服务端单张画布上限 4MB，留出继续编辑的余量）；
//   - 跳过 LibTV 活动赛道、品牌广告赛道和标题/标签带 LibTV 的合作作品——这些封面常直接带 LibTV 水印；
//   - 再跳过人工复核发现封面带水印或本身是广告的作品（libTVWatermarkedTemplates）；
//   - 「精选画布」标签里的作品排在前面，两组各自按点赞数排序。
//
// 判断节点要逐个读详情：每个作品的复核结论按快照版本缓存，作品没有重新发布就不再读；
// 列表结果在进程内缓存，所有访客共用一次上游读取。
const (
	libTVCuratedTagID          = 1000
	libTVCuratedMinNodes       = 100
	libTVFeaturedPageSize      = 40
	libTVFeaturedFeedPages     = 50 // 每个来源最多读的页数，只防上游分页异常时无限翻页
	libTVFeaturedWorkers       = 6
	libTVFeaturedEarlyCount    = 20 // 首次构建凑够这么多就先给访客，其余在后台补全
	libTVFeaturedMaxCopyBytes  = 3 << 20
	libTVFeaturedMinCoverRatio = 1.2
	libTVFeaturedTTL           = 30 * time.Minute
	libTVFeaturedRetryAfter    = time.Minute
	libTVFeaturedTimeout       = 5 * time.Minute
	// 重启后先用落盘的上一份精选：超过这个时间的快照不再展示，退回首次构建。
	libTVFeaturedSnapshotMaxAge  = 7 * 24 * time.Hour
	libTVFeaturedSnapshotVersion = 1
)

// 这些标签下的作品是 LibTV 官方活动或品牌广告，封面普遍带 LibTV / 合作方水印。
var libTVWatermarkTags = map[string]bool{
	"LibTV·「X小时之后」AI短片黑客松": true,
	"王者无界剧场计划":             true,
	"LibTV Skill 导演大师赛":    true,
	"产品展示":                 true,
	"创意TVC":                true,
	"1-创意TVC":              true,
	"广告导演请就位":              true,
	"功能卖点":                 true,
}

// 人工复核：封面画面带水印（LibTV、品牌、第三方账号）或本身是广告的作品。
// 2026-10-27 复核精选画布前 100 个与公开流前 200；2026-10-31 复核两个来源中其余规则都满足的全部 230 个。
var libTVWatermarkedTemplates = map[string]bool{
	"9b73b351334c4281adbc36ca6510efad": true, // AI教程｜4步完成TVC广告制作
	"1569f41b4f794942a0d2e51c1a2afec8": true, // 风雪山神庙（右下角 LibTV）
	"413f8e567bd548c988ce4757cd479ac5": true, // 云阙天宫（右下角 LibTV）
	"d3f34a5ebd584bbcb79b1e1ab146b28a": true, // iPhone air 产品展示
	"504f0f1c6e844e18b4ad82a54d8c298d": true, // 智能运动手表 TVC
	"59db0bf7162247248996844172485565": true, // 身在其中（黑客松）
	"587f124265454aa1ad2833d5bcca0928": true, // 暴走机关（王者无界）
	"67d0e9ab23b44506834fefbc50d1927e": true, // 小米空调 TVC
	"26aa7a460875463c8c7d9089f71255ea": true, // 长安异闻录 第二卷 无头（左下角 LibTV）
	"f1770f0682a94c49863e707d48a014d3": true, // 归途与光芒（左上角 LibTV）
	"4471c67ed0544b8e91b9fd283ffef2a1": true, // 艺术就是爆炸（底边残留第三方水印）
	"7f04fb819b944c93848bd4ad05d46147": true, // 雪王幻装记（左上角蜜雪冰城标志）
	"0b4acb2c9a384536a2848ce100e6bd75": true, // GAEA：echos of k（底部 LibTV 标志）
	"d5701097cbba4b92b33c90fbc16ce5d3": true, // 枫——未来版亡妻回忆录（标题下 LibTV 字样）
	"5d7f26feee9b4aaaaad579daf13df577": true, // 人间藏锋·我的爸爸是修罗 第3集（右上角 LibTV）
	"8179250d68da451ab9bbf8545da62345": true, // 人间藏锋·我的爸爸是修罗 第1集（右上角 LibTV）
	"af82cf2154144ce6ac47a192381bedcb": true, // 七两闻香录·黑羽迷局（左下角 LibTV）
	"1ca824fe53db47ee98b27b54ee340ed7": true, // 橙留香带菠萝头去航天认大哥（半透明账号水印）
	"c29bfddcd900494d82962bdafc86b3fe": true, // 山海经·牛来（封面是课程广告，标题带批发店名）
	"37b67cff31d24da6ac7cd3eeea7fc8f6": true, // 香港记者北上深圳…（猎艳 / 命案标题党封面）
	"7aeaf8be4dac44d1880430ff2075d251": true, // Hit The Road Jack 翻唱MV（封面是理财宣传语）
}

type LibTVFeaturedItem struct {
	LibTVGalleryItem
	NodeCount       int `json:"nodeCount"`
	ConnectionCount int `json:"connectionCount"`
}

type LibTVFeaturedResult struct {
	Items       []LibTVFeaturedItem `json:"items"`
	RefreshedAt time.Time           `json:"refreshedAt"`
}

type libTVFeaturedCache struct {
	mu         sync.Mutex
	result     *LibTVFeaturedResult
	err        error // 还没有任何结果时最近一次构建的失败原因
	expires    time.Time
	refreshing bool
	loading    chan struct{} // 正在进行的刷新；首次构建先放出部分结果或刷新结束时关闭
	refreshes  sync.WaitGroup
	now        func() time.Time
	fetch      func(ctx context.Context, publish func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error)
	// snapshotPath 非空时，每次完整刷新成功后把精选与作品复核结论落盘；
	// 进程重启后先展示这份快照并立即后台刷新，首个访客不必等待整轮读取。
	snapshotPath string
	checks       *libTVCanvasChecks
}

var (
	libTVFeaturedChecks = &libTVCanvasChecks{items: map[string]libTVCanvasCheck{}}
	libTVFeatured       = &libTVFeaturedCache{now: time.Now, checks: libTVFeaturedChecks, fetch: func(ctx context.Context, publish func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error) {
		return fetchLibTVFeaturedCanvases(ctx, libTVFeaturedChecks, publish)
	}}
)

// PrewarmLibTVFeatured 由服务启动流程调用一次；snapshotPath 是持久数据目录下的快照文件，可为空。
func (s *Service) PrewarmLibTVFeatured(snapshotPath string) {
	libTVFeatured.mu.Lock()
	if libTVFeatured.snapshotPath == "" {
		libTVFeatured.snapshotPath = snapshotPath
	}
	libTVFeatured.mu.Unlock()
	libTVFeatured.prewarm()
}

func (s *Service) LibTVFeatured(ctx context.Context, actor *model.User) (*LibTVFeaturedResult, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := s.allowLibTVGalleryRead(ctx, actor.ID); err != nil {
		return nil, err
	}
	return libTVFeatured.get(ctx)
}

// get：有缓存就立即返回（过期时在后台刷新一次，期间继续用旧结果）。
// 还没有任何结果时，所有访客等同一次后台构建；首次构建先凑出一批就放出来，不等全部读完。
// 上游失败或挑不出作品时保留旧结果，一分钟后再试，不让首页整块消失；
// 一份结果都没有时同样等一分钟再重建，不让每个访客都触发一次整轮读取。
func (c *libTVFeaturedCache) get(ctx context.Context) (*LibTVFeaturedResult, error) {
	c.mu.Lock()
	if c.result == nil {
		if !c.refreshing {
			if c.err != nil && c.now().Before(c.expires) {
				err := c.err
				c.mu.Unlock()
				return nil, err
			}
			c.startRefreshLocked()
		}
		loading := c.loading
		c.mu.Unlock()
		select {
		case <-loading:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		c.mu.Lock()
	}
	defer c.mu.Unlock()
	if c.result == nil {
		return nil, c.err
	}
	if !c.now().Before(c.expires) && !c.refreshing {
		c.startRefreshLocked()
	}
	return cloneLibTVFeatured(c.result), nil
}

// prewarm 在进程启动后立即后台准备精选，首个访客不必等待逐个读取详情。
// 有可用快照时先装入快照（视为已过期），访客立即拿到上一份精选，后台同时刷新。
func (c *libTVFeaturedCache) prewarm() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.result == nil && c.snapshotPath != "" {
		if snapshot := c.readSnapshot(c.snapshotPath); snapshot != nil {
			c.result = snapshot.Result
			c.expires = c.now()
			if c.checks != nil && len(snapshot.Checks) > 0 {
				c.checks.seed(snapshot.Checks)
			}
		}
	}
	if !c.refreshing && (c.result == nil || !c.now().Before(c.expires)) {
		c.startRefreshLocked()
	}
}

type libTVFeaturedSnapshot struct {
	Version int                         `json:"version"`
	SavedAt time.Time                   `json:"savedAt"`
	Result  *LibTVFeaturedResult        `json:"result"`
	Checks  map[string]libTVCanvasCheck `json:"checks,omitempty"`
}

// readSnapshot 读取并按当前规则校验快照；不存在、损坏、版本不符、过旧或筛完为空都返回 nil。
func (c *libTVFeaturedCache) readSnapshot(path string) *libTVFeaturedSnapshot {
	raw, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("[LibTV] featured snapshot unreadable: %v", err)
		}
		return nil
	}
	var snapshot libTVFeaturedSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil || snapshot.Version != libTVFeaturedSnapshotVersion || snapshot.Result == nil {
		log.Printf("[LibTV] featured snapshot ignored: invalid or outdated format")
		return nil
	}
	if age := c.now().Sub(snapshot.SavedAt); age < 0 || age > libTVFeaturedSnapshotMaxAge {
		log.Printf("[LibTV] featured snapshot ignored: saved %s ago", age.Round(time.Minute))
		return nil
	}
	// 快照之后新增的排除规则（水印名单、活动标签等）立即生效，不等后台刷新。
	kept := snapshot.Result.Items[:0]
	for _, item := range snapshot.Result.Items {
		if libTVCuratedCandidate(item.LibTVGalleryItem) {
			kept = append(kept, item)
		}
	}
	if len(kept) == 0 {
		return nil
	}
	snapshot.Result.Items = kept
	return &snapshot
}

// writeSnapshot 原子写入快照（先写临时文件再替换），失败只记日志，不影响精选服务。
func (c *libTVFeaturedCache) writeSnapshot(path string, result *LibTVFeaturedResult) {
	snapshot := libTVFeaturedSnapshot{Version: libTVFeaturedSnapshotVersion, SavedAt: c.now().UTC(), Result: result}
	if c.checks != nil {
		snapshot.Checks = c.checks.snapshot()
	}
	raw, err := json.Marshal(snapshot)
	if err == nil {
		err = os.MkdirAll(filepath.Dir(path), 0o755)
	}
	if err == nil {
		tmp := path + ".tmp"
		if err = os.WriteFile(tmp, raw, 0o600); err == nil {
			err = os.Rename(tmp, path)
		}
	}
	if err != nil {
		log.Printf("[LibTV] featured snapshot not saved: %v", err)
	}
}

func (c *libTVFeaturedCache) startRefreshLocked() {
	c.refreshing = true
	c.loading = make(chan struct{})
	c.refreshes.Add(1)
	go c.refresh(c.loading)
}

// refresh 不跟随任何访客的请求取消，否则一个访客关页面就会让所有人拿不到新结果。
func (c *libTVFeaturedCache) refresh(loading chan struct{}) {
	defer c.refreshes.Done()
	var once sync.Once
	release := func() { once.Do(func() { close(loading) }) }
	result, err := c.load(func(partial *LibTVFeaturedResult) {
		c.mu.Lock()
		defer c.mu.Unlock()
		// 只有首次构建先放出部分结果；已有结果时继续用旧的，等这次刷新完整结束再替换。
		if c.result == nil && len(partial.Items) > 0 {
			c.result = partial
			c.expires = c.now().Add(libTVFeaturedRetryAfter)
			release()
		}
	})
	c.mu.Lock()
	c.refreshing = false
	if err != nil {
		c.err = err
		c.expires = c.now().Add(libTVFeaturedRetryAfter)
		c.mu.Unlock()
		release()
		return
	}
	c.result, c.err = result, nil
	c.expires = c.now().Add(libTVFeaturedTTL)
	path, saved := c.snapshotPath, cloneLibTVFeatured(result)
	c.mu.Unlock()
	release()
	if path != "" {
		c.writeSnapshot(path, saved)
	}
}

func (c *libTVFeaturedCache) load(publish func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), libTVFeaturedTimeout)
	defer cancel()
	result, err := c.fetch(ctx, publish)
	if err == nil && len(result.Items) == 0 {
		err = kernel.NewAppError(http.StatusBadGateway, "LibTV 精选画布暂时没有可展示的作品")
	}
	return result, err
}

func cloneLibTVFeatured(result *LibTVFeaturedResult) *LibTVFeaturedResult {
	clone := *result
	clone.Items = append([]LibTVFeaturedItem(nil), result.Items...)
	return &clone
}

type libTVFeaturedCandidate struct {
	item    LibTVGalleryItem
	curated bool
}

func fetchLibTVFeaturedCanvases(ctx context.Context, checks *libTVCanvasChecks, publish func(*LibTVFeaturedResult)) (*LibTVFeaturedResult, error) {
	tags := []int{libTVCuratedTagID, 0}
	feeds := make([][]LibTVGalleryItem, len(tags))
	errs := make([]error, len(tags))
	var wg sync.WaitGroup
	for index, tag := range tags {
		wg.Add(1)
		go func() {
			defer wg.Done()
			feeds[index], errs[index] = listLibTVFeed(ctx, tag)
		}()
	}
	wg.Wait()
	// 任一来源没读全就整体视为失败：缓存继续用上一份结果，不让精选因为少读几页而缩水。
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	candidates := make([]libTVFeaturedCandidate, 0, len(feeds[0])+len(feeds[1]))
	for index, items := range feeds {
		for _, item := range items {
			candidates = append(candidates, libTVFeaturedCandidate{item: item, curated: index == 0})
		}
	}
	result := curateLibTVCanvases(ctx, candidates, func(ctx context.Context, item LibTVGalleryItem) (libTVCanvasCheck, error) {
		return checks.check(ctx, item, inspectLibTVCanvas)
	}, publish)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	keep := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		keep[candidate.item.TemplateUUID] = true
	}
	checks.retain(keep)
	return result, nil
}

// listLibTVFeed 按同一个 requestId 翻页读到最后一页；tagID 为 0 时读公开作品流。
func listLibTVFeed(ctx context.Context, tagID int) ([]LibTVGalleryItem, error) {
	req, err := normalizeLibTVGalleryRequest(LibTVGalleryRequest{Page: 1, PageSize: libTVFeaturedPageSize, TagID: tagID})
	if err != nil {
		return nil, err
	}
	var items []LibTVGalleryItem
	for page := 1; page <= libTVFeaturedFeedPages; page++ {
		req.Page = page
		payload := struct {
			Page      int    `json:"page"`
			PageSize  int    `json:"pageSize"`
			TagID     int    `json:"tagId,omitempty"`
			RequestID string `json:"requestId"`
		}{req.Page, req.PageSize, req.TagID, req.RequestID}
		data, err := requestLibTVPublic(ctx, http.MethodPost, libTVPublicFeedURL, payload)
		if err != nil {
			return nil, err
		}
		gallery, err := decodeLibTVGallery(data, req)
		if err != nil {
			return nil, err
		}
		items = append(items, gallery.Items...)
		if !gallery.HasMore {
			break
		}
	}
	return items, nil
}

// libTVCuratedCandidate 只看列表字段就能排除的作品，不为它们读详情。
func libTVCuratedCandidate(item LibTVGalleryItem) bool {
	if item.CoverURL == "" || item.MediaType != "video" || libTVWatermarkedTemplates[item.TemplateUUID] {
		return false
	}
	if strings.Contains(strings.ToLower(item.Title), "libtv") {
		return false
	}
	for _, tag := range item.Tags {
		if libTVWatermarkTags[strings.TrimSpace(tag.Label)] || strings.Contains(strings.ToLower(tag.Label), "libtv") {
			return false
		}
	}
	return true
}

// curateLibTVCanvases 去重、排序后并发复核每个候选，按排序收录全部通过的作品。
// publish 不为空时，排在前面的候选凑够 libTVFeaturedEarlyCount 个就先交出这一段（与最终结果同序），供首次构建先给访客。
func curateLibTVCanvases(ctx context.Context, candidates []libTVFeaturedCandidate, check func(context.Context, LibTVGalleryItem) (libTVCanvasCheck, error), publish func(*LibTVFeaturedResult)) *LibTVFeaturedResult {
	seen := map[string]bool{}
	ordered := make([]libTVFeaturedCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		uuid := candidate.item.TemplateUUID
		if seen[uuid] || !libTVCuratedCandidate(candidate.item) {
			continue
		}
		seen[uuid] = true
		ordered = append(ordered, candidate)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].curated != ordered[j].curated {
			return ordered[i].curated
		}
		return ordered[i].item.LikeCount > ordered[j].item.LikeCount
	})

	checks := make([]libTVCanvasCheck, len(ordered))
	passed := make([]bool, len(ordered))
	done := make([]bool, len(ordered))
	pick := func(limit int) []LibTVFeaturedItem {
		items := make([]LibTVFeaturedItem, 0, limit)
		for index := range limit {
			if passed[index] {
				items = append(items, LibTVFeaturedItem{LibTVGalleryItem: ordered[index].item, NodeCount: checks[index].Nodes, ConnectionCount: checks[index].Connections})
			}
		}
		return items
	}
	var mu sync.Mutex
	frontier, frontierPassed, published := 0, 0, publish == nil
	jobs := make(chan int)
	var wg sync.WaitGroup
	for range min(libTVFeaturedWorkers, len(ordered)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				// 读不到详情、节点太少、复制会丢东西、画布过大或封面不是横版的作品都不收录。
				result, err := check(ctx, ordered[index].item)
				mu.Lock()
				checks[index], passed[index], done[index] = result, err == nil && result.qualifies(), true
				for frontier < len(ordered) && done[frontier] {
					if passed[frontier] {
						frontierPassed++
					}
					frontier++
				}
				var partial *LibTVFeaturedResult
				if !published && (frontierPassed >= libTVFeaturedEarlyCount || frontier == len(ordered)) {
					published = true
					partial = &LibTVFeaturedResult{Items: pick(frontier), RefreshedAt: time.Now().UTC()}
				}
				mu.Unlock()
				if partial != nil {
					publish(partial)
				}
			}
		}()
	}
	for index := range ordered {
		if ctx.Err() != nil {
			break
		}
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return &LibTVFeaturedResult{Items: pick(len(ordered)), RefreshedAt: time.Now().UTC()}
}

// libTVCanvasCheck 是单个作品的复核结论。
type libTVCanvasCheck struct {
	SnapshotID  int64
	CoverURL    string
	Nodes       int
	Connections int
	Lossless    bool
	CopyBytes   int
	CoverWidth  int
	CoverHeight int
}

func (c libTVCanvasCheck) qualifies() bool {
	return c.Nodes >= libTVCuratedMinNodes && c.Lossless && c.CopyBytes <= libTVFeaturedMaxCopyBytes &&
		c.CoverHeight > 0 && float64(c.CoverWidth) >= libTVFeaturedMinCoverRatio*float64(c.CoverHeight)
}

// libTVCanvasChecks 按作品缓存复核结论：快照版本和封面都没变就直接复用；
// 重新读取失败时沿用上一次的结论，避免一次上游抖动让精选整批缩水。
type libTVCanvasChecks struct {
	mu    sync.Mutex
	items map[string]libTVCanvasCheck
}

func (c *libTVCanvasChecks) check(ctx context.Context, item LibTVGalleryItem, inspect func(context.Context, LibTVGalleryItem) (libTVCanvasCheck, error)) (libTVCanvasCheck, error) {
	c.mu.Lock()
	cached, ok := c.items[item.TemplateUUID]
	c.mu.Unlock()
	if ok && item.snapshotID > 0 && cached.SnapshotID == item.snapshotID && cached.CoverURL == item.CoverURL {
		return cached, nil
	}
	fresh, err := inspect(ctx, item)
	if err != nil {
		if ok {
			return cached, nil
		}
		return fresh, err
	}
	c.mu.Lock()
	c.items[item.TemplateUUID] = fresh
	c.mu.Unlock()
	return fresh, nil
}

// retain 只保留这次列表里还在的作品，下架的不再占内存。
// snapshot 复制当前全部复核结论，用于落盘。
func (c *libTVCanvasChecks) snapshot() map[string]libTVCanvasCheck {
	c.mu.Lock()
	defer c.mu.Unlock()
	copied := make(map[string]libTVCanvasCheck, len(c.items))
	for uuid, check := range c.items {
		copied[uuid] = check
	}
	return copied
}

// seed 用落盘的复核结论补齐缓存；内存里已有的结论更新，不被覆盖。
func (c *libTVCanvasChecks) seed(saved map[string]libTVCanvasCheck) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.items == nil {
		c.items = map[string]libTVCanvasCheck{}
	}
	for uuid, check := range saved {
		if _, exists := c.items[uuid]; !exists {
			c.items[uuid] = check
		}
	}
}

func (c *libTVCanvasChecks) retain(keep map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for uuid := range c.items {
		if !keep[uuid] {
			delete(c.items, uuid)
		}
	}
}

// inspectLibTVCanvas 读详情并按真实导入转换复核；前面的条件都满足时才去读封面尺寸。
func inspectLibTVCanvas(ctx context.Context, item LibTVGalleryItem) (libTVCanvasCheck, error) {
	work, snapshot, err := fetchLibTVPublishedTemplate(ctx, item.TemplateUUID)
	if err != nil {
		return libTVCanvasCheck{}, err
	}
	imported := adaptLibTVTemplate(work, snapshot)
	check := libTVCanvasCheck{
		SnapshotID: item.snapshotID, CoverURL: item.CoverURL, Nodes: len(snapshot.Nodes), Connections: len(snapshot.Edges),
		Lossless: libTVImportLossless(snapshot, imported), CopyBytes: libTVCopiedCanvasBytes(imported),
	}
	if check.Nodes < libTVCuratedMinNodes || !check.Lossless || check.CopyBytes > libTVFeaturedMaxCopyBytes {
		return check, nil
	}
	check.CoverWidth, check.CoverHeight, err = fetchLibTVImageSize(ctx, item.CoverURL)
	return check, err
}

// libTVImportLossless：复制后与原画布一致——节点和连线一个不少，每个媒体节点的有效地址都保留成了结果。
func libTVImportLossless(snapshot *libTVTemplateSnapshot, imported *LibTVImportResult) bool {
	if len(imported.Nodes) != len(snapshot.Nodes) || len(imported.SkippedNodes) > 0 || len(imported.SkippedConnections) > 0 {
		return false
	}
	kept := make(map[string]int, len(imported.Nodes))
	for _, node := range imported.Nodes {
		kept[node.Metadata.NodeKey] = len(node.Results)
	}
	for _, raw := range snapshot.Nodes {
		var data libTVTemplateNodeData
		if json.Unmarshal(raw.Data, &data) != nil {
			return false
		}
		switch libTVTemplateKind(raw, data) {
		case "image", "video", "audio":
		default:
			continue
		}
		want := 0
		for _, value := range data.URL {
			if strings.TrimSpace(value) != "" {
				want++
			}
		}
		if want == 0 && data.Type == "material-style" && strings.TrimSpace(data.CoverURL) != "" {
			want = 1
		}
		if kept[raw.ID] < want {
			return false
		}
	}
	return true
}

// libTVCopiedCanvasBytes 估算复制后整张画布的 JSON 体积：前端把多结果图片节点展开成根节点加每个结果一张卡，
// 其他多结果媒体每个结果一个节点，每张卡都带一份提示词。
func libTVCopiedCanvasBytes(imported *LibTVImportResult) int {
	total := 0
	for _, node := range imported.Nodes {
		encoded, _ := json.Marshal(node)
		copies := 1
		if len(node.Results) > 1 {
			copies = len(node.Results)
			if node.Type == "image" {
				copies++
			}
		}
		total += len(encoded) * copies
	}
	encoded, _ := json.Marshal(imported.Connections)
	return total + len(encoded)
}

// fetchLibTVImageSize 让 LibTV 图床（阿里云 OSS）返回图片尺寸，不下载原图。
func fetchLibTVImageSize(ctx context.Context, rawURL string) (int, int, error) {
	u, err := url.Parse(safeLibTVResourceURL(rawURL))
	if err != nil || u.Host == "" {
		return 0, 0, kernel.NewAppError(http.StatusBadGateway, "LibTV 封面地址无效")
	}
	u.RawQuery = "x-oss-process=image/info"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Accept", "application/json")
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(15 * time.Second)
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return fmt.Errorf("LibTV 不允许重定向") }
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, 0, ctx.Err()
		}
		return 0, 0, kernel.NewAppError(http.StatusBadGateway, "LibTV 封面暂时无法读取")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("LibTV 封面信息返回 HTTP %d", resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return 0, 0, kernel.NewAppError(http.StatusBadGateway, "LibTV 封面信息读取失败")
	}
	return decodeLibTVImageInfo(body)
}

func decodeLibTVImageInfo(body []byte) (int, int, error) {
	var info struct {
		ImageWidth struct {
			Value string `json:"value"`
		} `json:"ImageWidth"`
		ImageHeight struct {
			Value string `json:"value"`
		} `json:"ImageHeight"`
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return 0, 0, kernel.NewAppError(http.StatusBadGateway, "LibTV 封面信息格式已变化")
	}
	width, widthErr := strconv.Atoi(info.ImageWidth.Value)
	height, heightErr := strconv.Atoi(info.ImageHeight.Value)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, 0, kernel.NewAppError(http.StatusBadGateway, "LibTV 封面信息格式已变化")
	}
	return width, height, nil
}
