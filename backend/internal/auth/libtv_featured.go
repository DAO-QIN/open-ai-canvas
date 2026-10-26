package auth

import (
	"context"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// 首页「精选画布」：列表接口不带节点数，需要逐个读作品详情。
// 这里把结果在进程内缓存一段时间，所有访客共用一次上游读取，避免每次打开首页都给 LibTV 发多次请求，
// 也避免同一出口 IP 的访客很快用完每分钟的读取额度。
const (
	libTVFeaturedLimit      = 5
	libTVFeaturedFeedSize   = 20
	libTVFeaturedTTL        = 10 * time.Minute
	libTVFeaturedRetryAfter = time.Minute
	libTVFeaturedTimeout    = 25 * time.Second
)

type LibTVFeaturedItem struct {
	LibTVGalleryItem
	// NodeCount / ConnectionCount 为 0 表示详情暂时读不到，前端不显示数量。
	NodeCount       int `json:"nodeCount"`
	ConnectionCount int `json:"connectionCount"`
}

type LibTVFeaturedResult struct {
	Items       []LibTVFeaturedItem `json:"items"`
	RefreshedAt time.Time           `json:"refreshedAt"`
}

type libTVFeaturedCache struct {
	mu      sync.Mutex
	result  *LibTVFeaturedResult
	expires time.Time
	now     func() time.Time
	fetch   func(context.Context) (*LibTVFeaturedResult, error)
}

var libTVFeatured = &libTVFeaturedCache{now: time.Now, fetch: fetchLibTVFeatured}

func (s *Service) LibTVFeatured(ctx context.Context, actor *model.User) (*LibTVFeaturedResult, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := s.allowLibTVGalleryRead(ctx, actor.ID); err != nil {
		return nil, err
	}
	return libTVFeatured.get(ctx)
}

// get 在锁内刷新：同一时刻只有一个请求去读上游，其余请求等待后直接用新结果。
// 上游失败时若有旧结果则继续返回旧结果，并在一分钟后再试，不让首页整块消失。
func (c *libTVFeaturedCache) get(ctx context.Context) (*LibTVFeaturedResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.result != nil && now.Before(c.expires) {
		return cloneLibTVFeatured(c.result), nil
	}
	// 刷新不跟随单个访客的请求取消，否则一个访客关页面就会让所有人拿不到新结果。
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), libTVFeaturedTimeout)
	defer cancel()
	result, err := c.fetch(fetchCtx)
	if err != nil {
		if c.result != nil {
			c.expires = now.Add(libTVFeaturedRetryAfter)
			return cloneLibTVFeatured(c.result), nil
		}
		return nil, err
	}
	c.result = result
	c.expires = now.Add(libTVFeaturedTTL)
	return cloneLibTVFeatured(result), nil
}

func cloneLibTVFeatured(result *LibTVFeaturedResult) *LibTVFeaturedResult {
	clone := *result
	clone.Items = append([]LibTVFeaturedItem(nil), result.Items...)
	return &clone
}

func fetchLibTVFeatured(ctx context.Context) (*LibTVFeaturedResult, error) {
	req, err := normalizeLibTVGalleryRequest(LibTVGalleryRequest{Page: 1, PageSize: libTVFeaturedFeedSize})
	if err != nil {
		return nil, err
	}
	payload := struct {
		Page      int    `json:"page"`
		PageSize  int    `json:"pageSize"`
		RequestID string `json:"requestId"`
	}{req.Page, req.PageSize, req.RequestID}
	data, err := requestLibTVPublic(ctx, "POST", libTVPublicFeedURL, payload)
	if err != nil {
		return nil, err
	}
	gallery, err := decodeLibTVGallery(data, req)
	if err != nil {
		return nil, err
	}
	return buildLibTVFeatured(ctx, gallery.Items, func(ctx context.Context, uuid string) (int, int, error) {
		_, snapshot, err := fetchLibTVPublishedTemplate(ctx, uuid)
		if err != nil {
			return 0, 0, err
		}
		return len(snapshot.Nodes), len(snapshot.Edges), nil
	}), nil
}

// buildLibTVFeatured 取前几个有封面的作品，并发读取节点数；单个详情失败只让该卡片不显示数量。
func buildLibTVFeatured(ctx context.Context, items []LibTVGalleryItem, counts func(context.Context, string) (int, int, error)) *LibTVFeaturedResult {
	picked := make([]LibTVFeaturedItem, 0, libTVFeaturedLimit)
	for _, item := range items {
		if strings.TrimSpace(item.CoverURL) == "" {
			continue
		}
		picked = append(picked, LibTVFeaturedItem{LibTVGalleryItem: item})
		if len(picked) == libTVFeaturedLimit {
			break
		}
	}
	var wg sync.WaitGroup
	for index := range picked {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			if nodes, connections, err := counts(ctx, picked[index].TemplateUUID); err == nil {
				picked[index].NodeCount = nodes
				picked[index].ConnectionCount = connections
			}
		}(index)
	}
	wg.Wait()
	return &LibTVFeaturedResult{Items: picked, RefreshedAt: time.Now().UTC()}
}
