package auth

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// 精选画布（首页前 5 个 +「全部画布」页）：只展示一小批节点多、可复制、画面干净的公开作品。
//
// 筛选规则：
//   - 来自 LibTV 自己的「精选画布」标签（tagId 1000），不是全部公开作品流；
//   - 必须有成片和封面，节点数不少于 libTVCuratedMinNodes，且模板确实能导入（失效 / 空画布不展示）；
//   - 跳过 LibTV 活动赛道、品牌广告赛道和标题/标签带 LibTV 的合作作品——这些封面常直接带 LibTV 水印；
//   - 再跳过人工复核发现封面带 LibTV 水印的作品（libTVWatermarkedTemplates）；
//   - 按点赞数排序取前 libTVCuratedLimit 个。
//
// 列表要逐个读详情才能知道节点数，所以结果在进程内缓存，所有访客共用一次上游读取。
const (
	libTVCuratedTagID       = 1000
	libTVCuratedLimit       = 20
	libTVCuratedMinNodes    = 100
	libTVCuratedFeedPages   = 20
	libTVCuratedPageSize    = 20
	libTVCuratedDetailLimit = 4
	libTVFeaturedTTL        = 30 * time.Minute
	libTVFeaturedRetryAfter = time.Minute
	libTVFeaturedTimeout    = 90 * time.Second
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

// 人工复核：封面画面直接带 LibTV 水印的作品（2026-10-27 复核 LibTV 精选画布点赞前 40 与公开流前 200）。
var libTVWatermarkedTemplates = map[string]bool{
	"9b73b351334c4281adbc36ca6510efad": true, // AI教程｜4步完成TVC广告制作
	"1569f41b4f794942a0d2e51c1a2afec8": true, // 风雪山神庙（右下角 LibTV）
	"413f8e567bd548c988ce4757cd479ac5": true, // 云阙天宫（右下角 LibTV）
	"d3f34a5ebd584bbcb79b1e1ab146b28a": true, // iPhone air 产品展示
	"504f0f1c6e844e18b4ad82a54d8c298d": true, // 智能运动手表 TVC
	"59db0bf7162247248996844172485565": true, // 身在其中（黑客松）
	"587f124265454aa1ad2833d5bcca0928": true, // 暴走机关（王者无界）
	"67d0e9ab23b44506834fefbc50d1927e": true, // 小米空调 TVC
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
	expires    time.Time
	refreshing bool
	refreshes  sync.WaitGroup
	now        func() time.Time
	fetch      func(context.Context) (*LibTVFeaturedResult, error)
}

var libTVFeatured = &libTVFeaturedCache{now: time.Now, fetch: fetchLibTVCuratedCanvases}

func (s *Service) LibTVFeatured(ctx context.Context, actor *model.User) (*LibTVFeaturedResult, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := s.allowLibTVGalleryRead(ctx, actor.ID); err != nil {
		return nil, err
	}
	return libTVFeatured.get(ctx)
}

// get：有缓存就立即返回（过期时在后台刷新一次，期间继续用旧结果）；
// 只有进程刚启动、还没有任何结果时才同步读取上游，此时并发请求排队等同一次读取。
// 上游失败或挑不出作品时保留旧结果，一分钟后再试，不让首页整块消失。
func (c *libTVFeaturedCache) get(ctx context.Context) (*LibTVFeaturedResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.result != nil {
		if !c.now().Before(c.expires) && !c.refreshing {
			c.refreshing = true
			c.refreshes.Add(1)
			go c.refresh()
		}
		return cloneLibTVFeatured(c.result), nil
	}
	result, err := c.load(ctx)
	if err != nil {
		return nil, err
	}
	c.result = result
	c.expires = c.now().Add(libTVFeaturedTTL)
	return cloneLibTVFeatured(result), nil
}

func (c *libTVFeaturedCache) refresh() {
	defer c.refreshes.Done()
	result, err := c.load(context.Background())
	c.mu.Lock()
	defer c.mu.Unlock()
	c.refreshing = false
	if err != nil {
		c.expires = c.now().Add(libTVFeaturedRetryAfter)
		return
	}
	c.result = result
	c.expires = c.now().Add(libTVFeaturedTTL)
}

// load 读取上游；刷新不跟随单个访客的请求取消，否则一个访客关页面就会让所有人拿不到新结果。
func (c *libTVFeaturedCache) load(ctx context.Context) (*LibTVFeaturedResult, error) {
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), libTVFeaturedTimeout)
	defer cancel()
	result, err := c.fetch(fetchCtx)
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

func fetchLibTVCuratedCanvases(ctx context.Context) (*LibTVFeaturedResult, error) {
	req, err := normalizeLibTVGalleryRequest(LibTVGalleryRequest{Page: 1, PageSize: libTVCuratedPageSize, TagID: libTVCuratedTagID})
	if err != nil {
		return nil, err
	}
	var items []LibTVGalleryItem
	for page := 1; page <= libTVCuratedFeedPages; page++ {
		req.Page = page
		payload := struct {
			Page      int    `json:"page"`
			PageSize  int    `json:"pageSize"`
			TagID     int    `json:"tagId"`
			RequestID string `json:"requestId"`
		}{req.Page, req.PageSize, req.TagID, req.RequestID}
		data, err := requestLibTVPublic(ctx, http.MethodPost, libTVPublicFeedURL, payload)
		if err != nil {
			if len(items) > 0 {
				break // 已读到的部分足够挑选，后续页失败不影响
			}
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
	return curateLibTVCanvases(ctx, items, func(ctx context.Context, uuid string) (libTVCanvasStats, error) {
		work, snapshot, err := fetchLibTVPublishedTemplate(ctx, uuid)
		if err != nil {
			return libTVCanvasStats{}, err
		}
		imported := adaptLibTVTemplate(work, snapshot)
		return libTVCanvasStats{Nodes: len(snapshot.Nodes), Connections: len(snapshot.Edges), Importable: imported.ImportedNodeCount}, nil
	}), nil
}

type libTVCanvasStats struct {
	Nodes       int
	Connections int
	Importable  int
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

// curateLibTVCanvases 去重、按点赞排序，再按顺序读详情，凑够节点多且能导入的作品为止。
func curateLibTVCanvases(ctx context.Context, items []LibTVGalleryItem, stats func(context.Context, string) (libTVCanvasStats, error)) *LibTVFeaturedResult {
	seen := map[string]bool{}
	candidates := make([]LibTVGalleryItem, 0, len(items))
	for _, item := range items {
		if seen[item.TemplateUUID] || !libTVCuratedCandidate(item) {
			continue
		}
		seen[item.TemplateUUID] = true
		candidates = append(candidates, item)
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].LikeCount > candidates[j].LikeCount })

	picked := make([]LibTVFeaturedItem, 0, libTVCuratedLimit)
	for start := 0; start < len(candidates) && len(picked) < libTVCuratedLimit; start += libTVCuratedDetailLimit {
		batch := candidates[start:min(start+libTVCuratedDetailLimit, len(candidates))]
		results := make([]libTVCanvasStats, len(batch))
		errs := make([]error, len(batch))
		var wg sync.WaitGroup
		for index := range batch {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				results[index], errs[index] = stats(ctx, batch[index].TemplateUUID)
			}(index)
		}
		wg.Wait()
		for index, item := range batch {
			// 读不到详情、节点太少、或没有可导入节点的作品都视为失效，不展示。
			if errs[index] != nil || results[index].Nodes < libTVCuratedMinNodes || results[index].Importable == 0 {
				continue
			}
			picked = append(picked, LibTVFeaturedItem{LibTVGalleryItem: item, NodeCount: results[index].Nodes, ConnectionCount: results[index].Connections})
			if len(picked) == libTVCuratedLimit {
				break
			}
		}
		if ctx.Err() != nil {
			break
		}
	}
	return &LibTVFeaturedResult{Items: picked, RefreshedAt: time.Now().UTC()}
}
