package app

// 联网搜索：管理员配置的搜索服务（DeepSeek、博查、秘塔、智谱、Tavily、Serper、自建 SearXNG）和可选的网页读取增强
// （DeepSeek Fetch，或 Jina Reader 云端 / 自建开源版），供首页创作与画布助手的 web_search / web_fetch 使用。密钥按系统设置
// 统一加密保存，只在服务端出站请求时解密；搜索未启用或未配置完整时 web_search 不对模型暴露。

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

const (
	webSearchSettingKey     = "web_search"
	webSearchDefaultResults = 5
	webSearchMaxResults     = 10
	webSearchDefaultDaily   = 100
	webSearchMaxDaily       = 10000
	// 每人每分钟联网调用次数（搜索与网页读取合计）的默认值与上限。
	webSearchDefaultPerMinute = 30
	webSearchMaxPerMinute     = 600
	// webSearchMaxPriceMicrocredits 是每次搜索价格的上限：1 万积分。
	webSearchMaxPriceMicrocredits = 10_000 * CreditScale
	webSearchResponseLimit        = 2 << 20
	webSearchRequestTimeout       = 20 * time.Second
	webSearchSnippetMaxRunes      = 600
	// DeepSeek 搜索的关键词上限（含 site:、after: 等运算符）。
	webSearchDeepSeekQueryRunes = 128
	webReaderJinaURL            = "https://r.jina.ai"
	webReaderDeepSeekURL        = "https://api.deepseek.com/v1/tools/fetch"
	webReaderTimeout            = 25 * time.Second
	webReaderResponseLimit      = 4 << 20
)

var webSearchProviders = map[string]string{
	"deepseek": "https://api.deepseek.com/v1/tools/search",
	"bocha":    "https://api.bochaai.com/v1/web-search",
	"metaso":   "https://metaso.cn/api/v1/search",
	"zhipu":    "https://open.bigmodel.cn/api/paas/v4/web_search",
	"tavily":   "https://api.tavily.com/search",
	"serper":   "https://google.serper.dev/search",
	"searxng":  "",
}

// 智谱 Web Search 的搜索引擎：search_std 是基础版（最便宜），其余为高阶版。
var webSearchZhipuEngines = map[string]bool{"search_std": true, "search_pro": true, "search_pro_sogou": true, "search_pro_quark": true}

type WebSearchSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	Provider   string `json:"provider"`
	BaseURL    string `json:"baseUrl"`
	APIKey     string `json:"apiKey"`
	MaxResults int    `json:"maxResults"`
	Engine     string `json:"engine"`
	DailyLimit int    `json:"dailyLimit"`
	// PerMinuteLimit 是每人每分钟联网调用次数（搜索与网页读取合计）。
	PerMinuteLimit int `json:"perMinuteLimit"`
	// PriceMicrocredits 是每次搜索扣用户的积分（微积分），0 表示免费。
	PriceMicrocredits int64  `json:"priceMicrocredits"`
	ReaderProvider    string `json:"readerProvider"`
	ReaderBaseURL     string `json:"readerBaseUrl"`
	ReaderAPIKey      string `json:"readerApiKey"`
}

type PublicWebSearchSetting struct {
	Enabled           bool      `json:"enabled"`
	Provider          string    `json:"provider"`
	BaseURL           string    `json:"baseUrl"`
	HasAPIKey         bool      `json:"hasApiKey"`
	MaxResults        int       `json:"maxResults"`
	Engine            string    `json:"engine"`
	DailyLimit        int       `json:"dailyLimit"`
	PerMinuteLimit    int       `json:"perMinuteLimit"`
	PriceMicrocredits int64     `json:"priceMicrocredits"`
	ReaderProvider    string    `json:"readerProvider"`
	ReaderBaseURL     string    `json:"readerBaseUrl"`
	ReaderHasAPIKey   bool      `json:"readerHasApiKey"`
	UpdatedBy         string    `json:"updatedBy"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type WebSearchTestRequest struct {
	WebSearchSettingRequest
	Query string `json:"query"`
	// Target 为 reader 时测试网页读取增强：用表单里的读取服务读一次 URL（默认 https://example.com）。
	Target string `json:"target"`
	URL    string `json:"url"`
}

type WebSearchTestResult struct {
	Provider string               `json:"provider"`
	Results  []webSearchResult    `json:"results"`
	Reader   *WebReaderTestResult `json:"reader,omitempty"`
}

type WebReaderTestResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Excerpt string `json:"excerpt"`
	Chars   int    `json:"chars"`
}

type webSearchSettingValue struct {
	Enabled    bool   `json:"enabled"`
	Provider   string `json:"provider"`
	BaseURL    string `json:"baseUrl"`
	APIKey     string `json:"apiKey"`
	MaxResults int    `json:"maxResults"`
	// Engine 只对智谱生效，默认 search_std。
	Engine string `json:"engine,omitempty"`
	// DailyLimit 是每个用户每天实际发往搜索服务的次数上限；命中结果缓存不计入。
	DailyLimit int `json:"dailyLimit,omitempty"`
	// PerMinuteLimit 是每个用户每分钟调用 web_search / web_fetch 的合计次数上限，复用缓存结果也计入；
	// 缺省按 30 次。网页读取不依赖搜索开关，所以这一项对没开搜索的部署同样生效。
	PerMinuteLimit int `json:"perMinuteLimit,omitempty"`
	// PriceMicrocredits 是每次搜索扣用户的积分（微积分，再乘用户分组倍率）；0 或缺省表示免费，
	// 积分功能关闭时也不扣。计费规则见 cloud_agent_web_search_billing.go。
	PriceMicrocredits int64 `json:"priceMicrocredits,omitempty"`
	// ReaderProvider 为 jina 时，服务端直接读取失败或正文过短的网页交给 Jina Reader 渲染；留空只用直接读取。
	ReaderProvider string `json:"readerProvider,omitempty"`
	ReaderBaseURL  string `json:"readerBaseUrl,omitempty"`
	ReaderAPIKey   string `json:"readerApiKey,omitempty"`
}

type webSearchResult struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Snippet     string `json:"snippet,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
}

func (s *Service) AdminWebSearchSetting(actor *model.User) (*PublicWebSearchSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readWebSearchSetting()
	if err != nil {
		return nil, err
	}
	public := publicWebSearchSetting(setting, value)
	return &public, nil
}

func (s *Service) UpdateWebSearchSetting(actor *model.User, req WebSearchSettingRequest) (*PublicWebSearchSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readWebSearchSetting()
	if err != nil {
		return nil, err
	}
	next, err := webSearchSettingFromRequest(req, current)
	if err != nil {
		return nil, err
	}
	setting := &model.SystemSetting{Key: webSearchSettingKey, UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.saveWebSearchSetting(setting, next); err != nil {
		return nil, err
	}
	// 密钥配置的修改必须留痕：审计写入失败时如实报错，管理员重新读取即可看到已保存的配置。
	detail := map[string]any{
		"enabled": next.Enabled, "provider": next.Provider, "dailyLimit": next.DailyLimit, "perMinuteLimit": next.PerMinuteLimit, "priceMicrocredits": next.PriceMicrocredits, "readerProvider": next.ReaderProvider,
		"keyChanged": strings.TrimSpace(req.APIKey) != "", "readerKeyChanged": strings.TrimSpace(req.ReaderAPIKey) != "",
	}
	if err := s.appendAdminAudit(actor, "web_search_settings.update", "system_setting", webSearchSettingKey, "更新联网搜索配置", detail); err != nil {
		return nil, err
	}
	public := publicWebSearchSetting(setting, next)
	return &public, nil
}

// TestAdminWebSearchSetting 用表单里的配置（未填密钥时沿用已保存的）实际搜一次或读一次网页，不保存配置。
func (s *Service) TestAdminWebSearchSetting(actor *model.User, req WebSearchTestRequest) (*WebSearchTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, current, err := s.readWebSearchSetting()
	if err != nil {
		return nil, err
	}
	candidate := req.WebSearchSettingRequest
	// 测试只验证服务连通，不扣积分，也不因表单里尚未填好的价格报错。
	candidate.PriceMicrocredits = current.PriceMicrocredits
	if req.Target == "reader" {
		// 只测读取服务：搜索部分可以还没配完整。
		candidate.Enabled = false
		value, err := webSearchSettingFromRequest(candidate, current)
		if err != nil {
			return nil, err
		}
		if value.ReaderProvider == "" {
			return nil, BadAuthRequest("请先选择网页读取增强服务")
		}
		target := strings.TrimSpace(req.URL)
		if target == "" {
			target = "https://example.com"
		}
		parsed, err := ValidateOutboundURL(target)
		if err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), webReaderTimeout)
		defer cancel()
		page, err := runWebReader(ctx, value, parsed.String())
		if err != nil {
			return nil, err
		}
		return &WebSearchTestResult{Provider: value.Provider, Results: []webSearchResult{}, Reader: &WebReaderTestResult{
			Title: truncateRunes(page.Title, 200), URL: truncateRunes(page.URL, 2000), Excerpt: truncateRunes(page.Text, 300), Chars: utf8.RuneCountInString(page.Text),
		}}, nil
	}
	candidate.Enabled = true
	value, err := webSearchSettingFromRequest(candidate, current)
	if err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		query = "AI 视频创作"
	}
	ctx, cancel := context.WithTimeout(context.Background(), webSearchRequestTimeout)
	defer cancel()
	results, err := runWebSearch(ctx, value, query, min(3, value.MaxResults), "")
	if err != nil {
		return nil, err
	}
	return &WebSearchTestResult{Provider: value.Provider, Results: results}, nil
}

// WebSearchSession 是会话接口里的联网搜索状态。enabled 决定前端是否显示「联网搜索」开关（管理员已开启且配置完整）；
// price 是当前账号每次搜索实际扣的积分（已乘分组倍率，积分未开启或免费时为 0）。价格算不出来（如分组配置缺失）
// 时返回 nil，不阻断会话读取；真正搜索时同一错误会如实报给用户。
func (s *Service) WebSearchSession(user *model.User) (enabled bool, price *int64) {
	_, value, err := s.readWebSearchSetting()
	if err != nil || !value.Enabled || !webSearchSettingReady(value) {
		return false, nil
	}
	if user == nil {
		return true, nil
	}
	amount, _, err := s.webSearchUserPrice(user.ID, value)
	if err != nil {
		return true, nil
	}
	return true, &amount
}

// webSearchConfigured 决定本轮是否向模型暴露 web_search；建 run 时冻结，运行中不变。
func (s *Service) webSearchConfigured() bool {
	_, value, err := s.readWebSearchSetting()
	return err == nil && value.Enabled && webSearchSettingReady(value)
}

func webSearchSettingReady(value webSearchSettingValue) bool {
	if _, known := webSearchProviders[value.Provider]; !known {
		return false
	}
	if value.Provider == "searxng" {
		return value.BaseURL != ""
	}
	return value.APIKey != ""
}

func webReaderReady(value webSearchSettingValue) bool {
	switch value.ReaderProvider {
	case "jina":
		return true
	case "deepseek":
		return webReaderAPIKey(value) != ""
	}
	return false
}

// webReaderAPIKey 返回读取服务使用的密钥。DeepSeek 读取没有单独填写密钥时沿用 DeepSeek 搜索的密钥，
// 但只在两者发往同一服务地址时沿用，不把密钥带到另一个主机。
func webReaderAPIKey(value webSearchSettingValue) string {
	if value.ReaderAPIKey != "" || value.ReaderProvider != "deepseek" || value.Provider != "deepseek" || value.APIKey == "" {
		return value.ReaderAPIKey
	}
	origin := webEndpointOrigin(firstNonEmpty(value.BaseURL, webSearchProviders["deepseek"]))
	if origin != "" && origin == webEndpointOrigin(firstNonEmpty(value.ReaderBaseURL, webReaderDeepSeekURL)) {
		return value.APIKey
	}
	return ""
}

// webEndpointOrigin 返回 scheme://host:port（补全默认端口），用来判断两个地址是否指向同一服务。
func webEndpointOrigin(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	port := parsed.Port()
	if port == "" {
		port = map[string]string{"https": "443", "http": "80"}[scheme]
	}
	return scheme + "://" + strings.ToLower(parsed.Hostname()) + ":" + port
}

func (s *Service) readWebSearchSetting() (*model.SystemSetting, webSearchSettingValue, error) {
	setting, err := s.repo.SystemSetting(webSearchSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, normalizeWebSearchSetting(webSearchSettingValue{}), nil
	}
	if err != nil {
		return nil, webSearchSettingValue{}, err
	}
	value := webSearchSettingValue{}
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, webSearchSettingValue{}, errors.New("联网搜索配置格式无效")
		}
	}
	if value.APIKey, err = s.decryptSettingSecret(value.APIKey); err != nil {
		return nil, webSearchSettingValue{}, err
	}
	if value.ReaderAPIKey, err = s.decryptSettingSecret(value.ReaderAPIKey); err != nil {
		return nil, webSearchSettingValue{}, err
	}
	return setting, normalizeWebSearchSetting(value), nil
}

func (s *Service) saveWebSearchSetting(setting *model.SystemSetting, value webSearchSettingValue) error {
	stored := normalizeWebSearchSetting(value)
	var err error
	if stored.APIKey, err = s.encryptSettingSecret(stored.APIKey); err != nil {
		return err
	}
	if stored.ReaderAPIKey, err = s.encryptSettingSecret(stored.ReaderAPIKey); err != nil {
		return err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	setting.ValueJSON = string(encoded)
	return s.repo.SaveSystemSetting(setting)
}

func webSearchSettingFromRequest(req WebSearchSettingRequest, current webSearchSettingValue) (webSearchSettingValue, error) {
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if engine := strings.ToLower(strings.TrimSpace(req.Engine)); provider == "zhipu" && engine != "" && !webSearchZhipuEngines[engine] {
		return webSearchSettingValue{}, BadAuthRequest("智谱搜索引擎只支持 search_std、search_pro、search_pro_sogou 或 search_pro_quark")
	}
	if req.DailyLimit < 0 || req.DailyLimit > webSearchMaxDaily {
		return webSearchSettingValue{}, BadAuthRequest(fmt.Sprintf("每人每天搜索次数须在 1 到 %d 之间", webSearchMaxDaily))
	}
	if req.PerMinuteLimit < 0 || req.PerMinuteLimit > webSearchMaxPerMinute {
		return webSearchSettingValue{}, BadAuthRequest(fmt.Sprintf("每人每分钟联网次数须在 1 到 %d 之间", webSearchMaxPerMinute))
	}
	// 价格是计费写路径的输入：越界直接拒绝，不夹到边界值，也不把非法值当免费。
	if req.PriceMicrocredits < 0 || req.PriceMicrocredits > webSearchMaxPriceMicrocredits {
		return webSearchSettingValue{}, BadAuthRequest(fmt.Sprintf("每次搜索消耗的积分须在 0 到 %d 之间", webSearchMaxPriceMicrocredits/CreditScale))
	}
	next := normalizeWebSearchSetting(webSearchSettingValue{
		Enabled: req.Enabled, Provider: req.Provider, BaseURL: req.BaseURL, APIKey: req.APIKey, MaxResults: req.MaxResults, Engine: req.Engine, DailyLimit: req.DailyLimit,
		PerMinuteLimit: req.PerMinuteLimit, PriceMicrocredits: req.PriceMicrocredits, ReaderProvider: req.ReaderProvider, ReaderBaseURL: req.ReaderBaseURL, ReaderAPIKey: req.ReaderAPIKey,
	})
	// 密钥只写不读：留空且服务和地址都没变时沿用已保存的密钥；换服务或地址必须重新填写，不把旧密钥发到新地址。
	if next.APIKey == "" && next.Provider == current.Provider && next.BaseURL == current.BaseURL {
		next.APIKey = current.APIKey
	}
	if next.ReaderAPIKey == "" && next.ReaderProvider != "" && next.ReaderProvider == current.ReaderProvider && next.ReaderBaseURL == current.ReaderBaseURL {
		next.ReaderAPIKey = current.ReaderAPIKey
	}
	if next.Provider != "" {
		if _, known := webSearchProviders[next.Provider]; !known {
			return next, BadAuthRequest("请选择联网搜索服务")
		}
	} else if next.Enabled {
		return next, BadAuthRequest("请选择联网搜索服务")
	}
	for _, address := range []struct{ value, label string }{{next.BaseURL, "搜索服务地址"}, {next.ReaderBaseURL, "网页读取服务地址"}} {
		if address.value == "" {
			continue
		}
		if len(address.value) > 512 {
			return next, BadAuthRequest(address.label + "过长")
		}
		if _, err := ValidateOutboundURL(address.value); err != nil {
			return next, err
		}
	}
	// 读取增强与搜索开关无关（网页读取总是可用），所以不论是否开启搜索都要求配置完整。
	switch next.ReaderProvider {
	case "", "jina":
	case "deepseek":
		if webReaderAPIKey(next) == "" {
			return next, BadAuthRequest("请填写 DeepSeek API Key；搜索服务也选 DeepSeek 时可以留空，共用同一个 Key")
		}
	default:
		return next, BadAuthRequest("网页读取增强只支持 DeepSeek Fetch 或 Jina Reader")
	}
	if !next.Enabled {
		return next, nil
	}
	if next.Provider == "searxng" && next.BaseURL == "" {
		return next, BadAuthRequest("请填写 SearXNG 服务地址")
	}
	if next.Provider != "searxng" && next.APIKey == "" {
		return next, BadAuthRequest("请填写搜索服务 API Key")
	}
	return next, nil
}

func normalizeWebSearchSetting(value webSearchSettingValue) webSearchSettingValue {
	value.Provider = strings.ToLower(strings.TrimSpace(value.Provider))
	value.BaseURL = strings.TrimRight(strings.TrimSpace(value.BaseURL), "/")
	value.APIKey = strings.TrimSpace(value.APIKey)
	if value.MaxResults <= 0 {
		value.MaxResults = webSearchDefaultResults
	}
	value.MaxResults = min(value.MaxResults, webSearchMaxResults)
	value.Engine = strings.ToLower(strings.TrimSpace(value.Engine))
	if value.Provider != "zhipu" {
		value.Engine = ""
	} else if !webSearchZhipuEngines[value.Engine] {
		value.Engine = "search_std"
	}
	if value.DailyLimit <= 0 {
		value.DailyLimit = webSearchDefaultDaily
	}
	value.DailyLimit = min(value.DailyLimit, webSearchMaxDaily)
	if value.PerMinuteLimit <= 0 {
		value.PerMinuteLimit = webSearchDefaultPerMinute
	}
	value.PerMinuteLimit = min(value.PerMinuteLimit, webSearchMaxPerMinute)
	value.ReaderProvider = strings.ToLower(strings.TrimSpace(value.ReaderProvider))
	value.ReaderBaseURL = strings.TrimRight(strings.TrimSpace(value.ReaderBaseURL), "/")
	value.ReaderAPIKey = strings.TrimSpace(value.ReaderAPIKey)
	if value.ReaderProvider == "" {
		value.ReaderBaseURL, value.ReaderAPIKey = "", ""
	}
	return value
}

func publicWebSearchSetting(setting *model.SystemSetting, value webSearchSettingValue) PublicWebSearchSetting {
	result := PublicWebSearchSetting{
		Enabled: value.Enabled, Provider: value.Provider, BaseURL: value.BaseURL, HasAPIKey: value.APIKey != "", MaxResults: value.MaxResults, Engine: value.Engine, DailyLimit: value.DailyLimit,
		PerMinuteLimit: value.PerMinuteLimit, PriceMicrocredits: value.PriceMicrocredits, ReaderProvider: value.ReaderProvider, ReaderBaseURL: value.ReaderBaseURL, ReaderHasAPIKey: value.ReaderAPIKey != "",
	}
	if setting != nil {
		result.UpdatedBy, result.CreatedAt, result.UpdatedAt = setting.UpdatedBy, setting.CreatedAt, setting.UpdatedAt
	}
	return result
}

func webSearchEndpoint(value webSearchSettingValue) (string, error) {
	endpoint := webSearchProviders[value.Provider]
	if value.BaseURL != "" {
		endpoint = value.BaseURL
		if value.Provider == "searxng" && !strings.HasSuffix(endpoint, "/search") {
			endpoint += "/search"
		}
	}
	if endpoint == "" {
		return "", BadAuthRequest("联网搜索服务地址未配置")
	}
	if _, err := ValidateOutboundURL(endpoint); err != nil {
		return "", err
	}
	return endpoint, nil
}

func webSearchSnippet(values ...string) string {
	for _, value := range values {
		value = strings.Join(strings.Fields(value), " ")
		if value != "" {
			return truncateRunes(value, webSearchSnippetMaxRunes)
		}
	}
	return ""
}

// webSearchClip 按字截断关键词，不加省略号（省略号会被当成搜索词）。
func webSearchClip(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		runes = runes[:max(limit, 0)]
	}
	return strings.TrimSpace(string(runes))
}

// webSearchAfterDate 把 freshness 换成 after: 运算符用的起始日期（UTC）；不限时间时返回空。
// 按固定天数回推，避免按月回推在 31 日落到下个月初。
func webSearchAfterDate(freshness string, now time.Time) string {
	days := map[string]int{"oneDay": 1, "oneWeek": 7, "oneMonth": 30, "oneYear": 365}[freshness]
	if days == 0 {
		return ""
	}
	return now.AddDate(0, 0, -days).Format("2006-01-02")
}

// runWebSearch 调用配置的搜索服务；只返回 http(s) 来源，错误信息不包含密钥或上游原文。
func runWebSearch(ctx context.Context, value webSearchSettingValue, query string, count int, freshness string) ([]webSearchResult, error) {
	if !webSearchSettingReady(value) {
		return nil, BadAuthRequest("联网搜索未配置")
	}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return nil, BadAuthRequest("搜索关键词须为 1–200 字")
	}
	count = max(1, min(count, value.MaxResults))
	endpoint, err := webSearchEndpoint(value)
	if err != nil {
		return nil, err
	}
	var req *http.Request
	jsonBody := func(payload any) (*http.Request, error) {
		raw, _ := json.Marshal(payload)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
		if err == nil {
			request.Header.Set("Content-Type", "application/json")
		}
		return request, err
	}
	bearer := func(request *http.Request, err error) (*http.Request, error) {
		if err == nil {
			request.Header.Set("Authorization", "Bearer "+value.APIKey)
		}
		return request, err
	}
	timeRanges := map[string]string{"oneDay": "day", "oneWeek": "week", "oneMonth": "month", "oneYear": "year"}
	switch value.Provider {
	case "deepseek":
		// DeepSeek 没有时间范围参数，用 after: 运算符按发布日期过滤；关键词连同运算符不超过 128 字。
		// 不发送用户原话（ori_question）和用户 IP（localization），只发模型写的关键词。
		deepseekQuery := webSearchClip(query, webSearchDeepSeekQueryRunes)
		if after := webSearchAfterDate(freshness, time.Now().UTC()); after != "" {
			operator := " after:" + after
			deepseekQuery = webSearchClip(query, webSearchDeepSeekQueryRunes-utf8.RuneCountInString(operator)) + operator
		}
		req, err = bearer(jsonBody(map[string]any{"query": deepseekQuery, "count": count, "need_content": false}))
	case "bocha":
		if freshness == "" {
			freshness = "noLimit"
		}
		req, err = bearer(jsonBody(map[string]any{"query": query, "count": count, "summary": true, "freshness": freshness}))
	case "metaso":
		// 秘塔没有时间范围参数；freshness 由模型在关键词里写明年份或时间。
		req, err = bearer(jsonBody(map[string]any{"q": query, "scope": "webpage", "size": count, "includeSummary": false, "conciseSnippet": false}))
	case "zhipu":
		// 智谱建议关键词不超过 70 字。
		payload := map[string]any{"search_query": webSearchClip(query, 70), "search_engine": value.Engine, "search_intent": false, "count": count, "content_size": "medium"}
		if freshness != "" {
			payload["search_recency_filter"] = freshness
		}
		req, err = bearer(jsonBody(payload))
	case "tavily":
		payload := map[string]any{"query": query, "max_results": count, "search_depth": "basic", "topic": "general"}
		if days := timeRanges[freshness]; days != "" {
			payload["time_range"] = days
		}
		req, err = bearer(jsonBody(payload))
	case "serper":
		payload := map[string]any{"q": query, "num": count}
		if tbs := map[string]string{"oneDay": "qdr:d", "oneWeek": "qdr:w", "oneMonth": "qdr:m", "oneYear": "qdr:y"}[freshness]; tbs != "" {
			payload["tbs"] = tbs
		}
		req, err = jsonBody(payload)
		if err == nil {
			req.Header.Set("X-API-KEY", value.APIKey)
		}
	case "searxng":
		target, parseErr := url.Parse(endpoint)
		if parseErr != nil {
			return nil, BadAuthRequest("SearXNG 服务地址无效")
		}
		params := target.Query()
		params.Set("q", query)
		params.Set("format", "json")
		// 面向普通用户：过滤成人内容（中等强度）。
		params.Set("safesearch", "1")
		if timeRange := timeRanges[freshness]; timeRange != "" {
			params.Set("time_range", timeRange)
		}
		target.RawQuery = params.Encode()
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
		if err == nil && value.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+value.APIKey)
		}
	default:
		return nil, BadAuthRequest("不支持的联网搜索服务")
	}
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	ApplyDefaultOutboundHeaders(req)
	resp, err := OutboundHTTPClient(webSearchRequestTimeout).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, NewAppError(504, "联网搜索超时，请稍后重试")
		}
		return nil, NewAppError(502, "联网搜索服务暂时无法访问")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, webSearchResponseLimit+1))
	if err != nil || len(body) > webSearchResponseLimit {
		return nil, NewAppError(502, "联网搜索返回内容无法读取")
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, NewAppError(502, "联网搜索服务拒绝了请求，请检查 API Key 或服务权限")
	}
	if resp.StatusCode == http.StatusPaymentRequired {
		return nil, NewAppError(502, "联网搜索服务余额不足，需要管理员充值后才能继续使用")
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, NewAppError(429, "联网搜索服务限流或额度不足，请稍后重试")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, NewAppError(502, fmt.Sprintf("联网搜索服务返回错误（HTTP %d）", resp.StatusCode))
	}
	results, err := parseWebSearchResults(value.Provider, body)
	if err != nil {
		return nil, err
	}
	if len(results) > count {
		results = results[:count]
	}
	return results, nil
}

func parseWebSearchResults(provider string, body []byte) ([]webSearchResult, error) {
	results := []webSearchResult{}
	seen := map[string]bool{}
	add := func(title, link, snippet, site, published string) {
		link = strings.TrimSpace(link)
		parsed, err := url.Parse(link)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || seen[link] {
			return
		}
		seen[link] = true
		title = strings.Join(strings.Fields(title), " ")
		if title == "" {
			title = parsed.Host
		}
		if site == "" {
			site = parsed.Hostname()
		}
		results = append(results, webSearchResult{Title: truncateRunes(title, 200), URL: truncateRunes(link, 1000), Snippet: snippet, SiteName: truncateRunes(strings.TrimSpace(site), 80), PublishedAt: truncateRunes(strings.TrimSpace(published), 40)})
	}
	invalid := NewAppError(502, "联网搜索返回格式无法识别")
	switch provider {
	case "deepseek":
		var payload struct {
			Results []struct {
				Title    string `json:"title"`
				URL      string `json:"url"`
				Snippet  string `json:"snippet"`
				Summary  string `json:"summary"`
				SiteName string `json:"site_name"`
				Date     string `json:"date"`
			} `json:"results"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, invalid
		}
		for _, item := range payload.Results {
			published := item.Date
			if parsed, err := time.Parse(time.RFC3339, published); err == nil {
				published = parsed.UTC().Format("2006-01-02")
			}
			// 长摘要（600–800 字）是写给模型读的，比短摘要信息多，Agent 可以少读几次网页。
			add(item.Title, item.URL, webSearchSnippet(item.Summary, item.Snippet), item.SiteName, published)
		}
	case "bocha":
		type page struct {
			Name          string `json:"name"`
			URL           string `json:"url"`
			Snippet       string `json:"snippet"`
			Summary       string `json:"summary"`
			SiteName      string `json:"siteName"`
			DatePublished string `json:"datePublished"`
		}
		var payload struct {
			Code     *int   `json:"code"`
			Message  string `json:"msg"`
			WebPages struct {
				Value []page `json:"value"`
			} `json:"webPages"`
			Data struct {
				WebPages struct {
					Value []page `json:"value"`
				} `json:"webPages"`
			} `json:"data"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, invalid
		}
		if payload.Code != nil && *payload.Code != 200 && *payload.Code != 0 {
			return nil, NewAppError(502, "联网搜索服务返回错误，请检查 API Key 或额度")
		}
		pages := payload.Data.WebPages.Value
		if len(pages) == 0 {
			pages = payload.WebPages.Value
		}
		for _, item := range pages {
			add(item.Name, item.URL, webSearchSnippet(item.Summary, item.Snippet), item.SiteName, item.DatePublished)
		}
	case "metaso":
		var payload struct {
			Webpages []struct {
				Title   string `json:"title"`
				Link    string `json:"link"`
				Snippet string `json:"snippet"`
				Summary string `json:"summary"`
				Date    string `json:"date"`
			} `json:"webpages"`
			ErrMsg string `json:"errMsg"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, invalid
		}
		if payload.ErrMsg != "" && len(payload.Webpages) == 0 {
			return nil, NewAppError(502, "秘塔搜索返回错误，请检查 API Key 或额度")
		}
		for _, item := range payload.Webpages {
			add(item.Title, item.Link, webSearchSnippet(item.Snippet, item.Summary), "", item.Date)
		}
	case "zhipu":
		var payload struct {
			SearchResult []struct {
				Title       string `json:"title"`
				Content     string `json:"content"`
				Link        string `json:"link"`
				Media       string `json:"media"`
				PublishDate string `json:"publish_date"`
			} `json:"search_result"`
			Error *struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, invalid
		}
		if payload.Error != nil && len(payload.SearchResult) == 0 {
			return nil, NewAppError(502, "智谱搜索返回错误，请检查 API Key、余额或搜索引擎")
		}
		for _, item := range payload.SearchResult {
			add(item.Title, item.Link, webSearchSnippet(item.Content), item.Media, item.PublishDate)
		}
	case "tavily":
		var payload struct {
			Results []struct {
				Title         string `json:"title"`
				URL           string `json:"url"`
				Content       string `json:"content"`
				PublishedDate string `json:"published_date"`
			} `json:"results"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, invalid
		}
		for _, item := range payload.Results {
			add(item.Title, item.URL, webSearchSnippet(item.Content), "", item.PublishedDate)
		}
	case "serper":
		var payload struct {
			Organic []struct {
				Title   string `json:"title"`
				Link    string `json:"link"`
				Snippet string `json:"snippet"`
				Date    string `json:"date"`
			} `json:"organic"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, invalid
		}
		for _, item := range payload.Organic {
			add(item.Title, item.Link, webSearchSnippet(item.Snippet), "", item.Date)
		}
	case "searxng":
		var payload struct {
			Results []struct {
				Title         string `json:"title"`
				URL           string `json:"url"`
				Content       string `json:"content"`
				PublishedDate string `json:"publishedDate"`
			} `json:"results"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, NewAppError(502, "SearXNG 未返回 JSON，请在 settings.yml 的 search.formats 中启用 json")
		}
		for _, item := range payload.Results {
			add(item.Title, item.URL, webSearchSnippet(item.Content), "", item.PublishedDate)
		}
	}
	return results, nil
}

type webReaderPage struct {
	Title string
	URL   string
	Text  string
}

// runWebReader 交给配置的读取服务取网页正文。目标地址由调用方先做出站校验；
// 自建读取服务要放在不能访问内网的网络里，避免 DNS 重绑定绕过校验。
func runWebReader(ctx context.Context, value webSearchSettingValue, target string) (webReaderPage, error) {
	switch value.ReaderProvider {
	case "jina":
		return runJinaReader(ctx, value, target)
	case "deepseek":
		return runDeepSeekFetch(ctx, value, target)
	}
	return webReaderPage{}, BadAuthRequest("网页读取增强未配置")
}

// postWebReader 发出读取请求并读回响应体（最多 4MB）；网络错误和超时换成不含上游原文的提示。
func postWebReader(ctx context.Context, endpoint, apiKey string, target string, headers map[string]string) (int, []byte, error) {
	if _, err := ValidateOutboundURL(endpoint); err != nil {
		return 0, nil, err
	}
	raw, _ := json.Marshal(map[string]string{"url": target})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, BadAuthRequest("网页读取服务地址无效")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	ApplyDefaultOutboundHeaders(req)
	resp, err := OutboundHTTPClient(webReaderTimeout).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, NewAppError(504, "网页读取服务超时")
		}
		return 0, nil, NewAppError(502, "网页读取服务暂时无法访问")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, webReaderResponseLimit+1))
	if err != nil {
		return 0, nil, NewAppError(502, "网页读取服务返回内容无法读取")
	}
	if len(body) > webReaderResponseLimit {
		body = body[:webReaderResponseLimit]
	}
	return resp.StatusCode, body, nil
}

// runDeepSeekFetch 用 DeepSeek Fetch 抓取网页并取 Markdown 正文。只有抓到正文才计费；
// 页面不可用、被站点拦截、内容类型不受支持或没有可提取正文时返回 404，不计费。
func runDeepSeekFetch(ctx context.Context, value webSearchSettingValue, target string) (webReaderPage, error) {
	apiKey := webReaderAPIKey(value)
	if apiKey == "" {
		return webReaderPage{}, BadAuthRequest("请填写 DeepSeek API Key")
	}
	status, body, err := postWebReader(ctx, firstNonEmpty(value.ReaderBaseURL, webReaderDeepSeekURL), apiKey, target, nil)
	if err != nil {
		return webReaderPage{}, err
	}
	switch {
	case status == http.StatusUnauthorized:
		return webReaderPage{}, NewAppError(502, "网页读取服务拒绝了请求，请检查 DeepSeek API Key")
	case status == http.StatusPaymentRequired:
		return webReaderPage{}, NewAppError(502, "网页读取服务余额不足，需要管理员充值 DeepSeek 账户")
	case status == http.StatusForbidden:
		return webReaderPage{}, NewAppError(502, "网页读取服务按安全策略拒绝读取该网页")
	case status == http.StatusNotFound:
		return webReaderPage{}, NewAppError(502, "网页读取服务没能读到这个网页的正文（页面不可用、被站点拦截或格式不受支持）")
	case status == http.StatusTooManyRequests:
		return webReaderPage{}, NewAppError(429, "网页读取服务限流，请稍后重试")
	case status < 200 || status >= 300:
		return webReaderPage{}, NewAppError(502, fmt.Sprintf("网页读取服务未能读取该网页（HTTP %d）", status))
	}
	var payload struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return webReaderPage{}, NewAppError(502, "网页读取服务返回格式无法识别")
	}
	page := webReaderPage{URL: target, Title: strings.Join(strings.Fields(payload.Title), " "), Text: strings.TrimSpace(strings.ToValidUTF8(payload.Content, ""))}
	if page.Text == "" {
		return webReaderPage{}, NewAppError(502, "网页读取服务没有返回正文")
	}
	return page, nil
}

// runJinaReader 交给 Jina Reader（云端 r.jina.ai 或自建开源版）渲染网页并取正文：能读脚本渲染的页面和 PDF。
func runJinaReader(ctx context.Context, value webSearchSettingValue, target string) (webReaderPage, error) {
	// 正文只留文字：图片和链接地址对模型是噪音，还会挤占正文字数。
	status, body, err := postWebReader(ctx, firstNonEmpty(value.ReaderBaseURL, webReaderJinaURL)+"/", value.ReaderAPIKey, target, map[string]string{"X-Retain-Images": "none", "X-Retain-Links": "text"})
	if err != nil {
		return webReaderPage{}, err
	}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return webReaderPage{}, NewAppError(502, "网页读取服务拒绝了请求，请检查 Jina API Key")
	case status == http.StatusTooManyRequests:
		return webReaderPage{}, NewAppError(429, "网页读取服务限流，请稍后重试或配置 Jina API Key")
	case status < 200 || status >= 300:
		return webReaderPage{}, NewAppError(502, fmt.Sprintf("网页读取服务未能读取该网页（HTTP %d）", status))
	}
	var payload struct {
		Data struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"data"`
	}
	page := webReaderPage{URL: target}
	if json.Unmarshal(body, &payload) == nil && (payload.Data.Content != "" || payload.Data.Title != "") {
		page.Title, page.Text = payload.Data.Title, payload.Data.Content
		if payload.Data.URL != "" {
			page.URL = payload.Data.URL
		}
	} else {
		// 纯文本响应："Title: …" / "URL Source: …" / "Markdown Content:" 之后是正文。
		text := strings.ToValidUTF8(string(body), "")
		for _, line := range strings.SplitN(text, "\n", 8) {
			if title, ok := strings.CutPrefix(strings.TrimSpace(line), "Title:"); ok && page.Title == "" {
				page.Title = strings.TrimSpace(title)
			}
		}
		if _, content, ok := strings.Cut(text, "Markdown Content:"); ok {
			text = content
		}
		page.Text = text
	}
	page.Title = strings.Join(strings.Fields(page.Title), " ")
	page.Text = strings.TrimSpace(strings.ToValidUTF8(page.Text, ""))
	if page.Text == "" {
		return webReaderPage{}, NewAppError(502, "网页读取服务没有返回正文")
	}
	return page, nil
}
