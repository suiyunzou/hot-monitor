"use client";

import {
  Activity,
  BadgeCheck,
  ExternalLink,
  Globe2,
  Mail,
  MessageCircle,
  Power,
  Radar,
  RefreshCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type TopicStatus = "confirmed" | "multi-source" | "social" | "verify";
type FilterKey = "all" | TopicStatus;

type Topic = {
  title: string;
  category: string;
  summary: string;
  why: string;
  score: number;
  confidence: number;
  status: TopicStatus;
  sourceCount: number;
  sourceTypes: string[];
  sources?: Array<{
    title: string;
    url: string;
    sourceName: string;
    sourceType: string;
  }>;
  time: string;
};

export type RawNewsItem = {
  id: string;
  title: string;
  url: string;
  excerpt?: string;
  sourceName: string;
  sourceType: string;
  credibilityLevel: string;
  watchKeyword?: string | null;
  fetchedAt: string;
  publishedAt?: string;
};

export type WatchKeyword = {
  id: string;
  keyword: string;
  enabled: boolean;
};

type CollectRunApiItem = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt?: string | null;
  fetchedCount: number;
  newCount: number;
  errorMessage?: string | null;
  metadataJson?: string | null;
};

type AnalyzeApiResponse = {
  analysisConfigured: boolean;
  model: string;
  pendingRawItems: number;
  topics: HotTopicApiItem[];
};

export type HotTopicApiItem = {
  id: string;
  title: string;
  summary: string;
  whyItMatters?: string | null;
  category: string;
  hotScore: number;
  confidence: number;
  status: "CONFIRMED" | "MULTI_SOURCE_SIGNAL" | "SOCIAL_BUZZ" | "NEEDS_VERIFICATION";
  needsVerification: boolean;
  sources: Array<{
    title: string;
    url: string;
    sourceType: string;
    sourceName: string;
    credibilityLevel: string;
  }>;
};

const topics: Topic[] = [
  {
    title: "DeepSeek V4 Flash 成为默认分析模型候选",
    category: "model_release",
    summary: "OpenRouter 当前 DeepSeek 快速模型适合高频分类、摘要与聚类，默认模型将通过环境变量保留可替换能力。",
    why: "热点监控系统需要低延迟、高吞吐和稳定结构化输出，快速模型能降低每两小时抓取后的分析成本。",
    score: 91,
    confidence: 86,
    status: "confirmed",
    sourceCount: 2,
    sourceTypes: ["Official", "Search"],
    time: "11:45"
  },
  {
    title: "官方公告优先级高于社交平台转述",
    category: "product_update",
    summary: "系统将 OpenAI、Anthropic、Google DeepMind、Meta AI、xAI 等官网作为事实锚点。",
    why: "这能避免单条推文造成误判，让邮件推送里的结论都能回溯到原始来源。",
    score: 84,
    confidence: 92,
    status: "confirmed",
    sourceCount: 8,
    sourceTypes: ["Official"],
    time: "11:38"
  },
  {
    title: "X 热议只作为早期信号",
    category: "social_signal",
    summary: "twitterapi.io 会用于关键词和重点账号搜索，但只有社交来源的事件会标记为待核验。",
    why: "社交平台适合发现趋势，但不适合单独作为事实依据。",
    score: 73,
    confidence: 61,
    status: "social",
    sourceCount: 12,
    sourceTypes: ["X"],
    time: "11:30"
  },
  {
    title: "搜索落地页正文成为交叉验证入口",
    category: "verification",
    summary: "Google/Bing 结果只作为发现入口，系统必须继续抓取落地页正文，才能进入 AI 分析队列。",
    why: "搜索摘要容易缺上下文，落地页正文能减少标题党和二次转述导致的误判。",
    score: 79,
    confidence: 74,
    status: "multi-source",
    sourceCount: 5,
    sourceTypes: ["Search", "Official"],
    time: "11:18"
  }
];

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "confirmed", label: "已确认" },
  { key: "multi-source", label: "多源线索" },
  { key: "social", label: "社交热议" },
  { key: "verify", label: "待核验" }
];

const statusCopy: Record<TopicStatus, string> = {
  confirmed: "已确认",
  "multi-source": "多源线索",
  social: "社交热议",
  verify: "待核验"
};

const statusIcon: Record<TopicStatus, ReactNode> = {
  confirmed: <BadgeCheck size={16} />,
  "multi-source": <Search size={16} />,
  social: <MessageCircle size={16} />,
  verify: <ShieldAlert size={16} />
};

type RadarDashboardProps = {
  initialRawItems?: RawNewsItem[];
  initialHotTopics?: HotTopicApiItem[];
  initialWatchKeywords?: WatchKeyword[];
};

export function RadarDashboard({
  initialRawItems = [],
  initialHotTopics = [],
  initialWatchKeywords = []
}: RadarDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [activeTopicTitle, setActiveTopicTitle] = useState(
    () =>
      initialRawItems[0]?.title ??
      initialHotTopics[0]?.title ??
      topics[0].title
  );
  const [scanPulse, setScanPulse] = useState(0);
  const [rawItems, setRawItems] = useState<RawNewsItem[]>(initialRawItems);
  const [liveTopics, setLiveTopics] = useState<Topic[]>(() => initialHotTopics.map(mapHotTopic));
  const [watchKeywords, setWatchKeywords] = useState<WatchKeyword[]>(initialWatchKeywords);
  const [keywordsLoaded, setKeywordsLoaded] = useState(initialWatchKeywords.length > 0);
  const [keywordInput, setKeywordInput] = useState("");
  const [scanStatus, setScanStatus] = useState("待命");
  const [analysisStatus, setAnalysisStatus] = useState("待分析");
  const [analysisModel, setAnalysisModel] = useState("deepseek-v4-flash");
  const [pendingRawItems, setPendingRawItems] = useState(0);
  const [analysisConfigured, setAnalysisConfigured] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pendingKeywordIds, setPendingKeywordIds] = useState<string[]>([]);

  const rawItemTopics = useMemo(() => rawItems.map(mapRawItemTopic), [rawItems]);
  const dashboardTopics = useMemo(() => {
    const linkedUrls = new Set(
      liveTopics.flatMap((topic) => topic.sources?.map((source) => source.url) ?? [])
    );
    const freshRawTopics = rawItemTopics.filter((topic) =>
      topic.sources?.some((source) => !linkedUrls.has(source.url))
    );
    const combined = [...freshRawTopics, ...liveTopics];

    return combined.length > 0 ? combined : topics;
  }, [liveTopics, rawItemTopics]);
  const visibleTopics = useMemo(() => {
    if (activeFilter === "all") {
      return dashboardTopics;
    }

    return dashboardTopics.filter((topic) => topic.status === activeFilter);
  }, [activeFilter, dashboardTopics]);

  const activeTopic =
    dashboardTopics.find((topic) => topic.title === activeTopicTitle) ?? visibleTopics[0] ?? dashboardTopics[0];

  useEffect(() => {
    document.documentElement.dataset.hotMonitorHydrated = "true";
    void loadRawItems();
    void loadHotTopics();
    void loadWatchKeywords();
    void loadCollectStatus();
  }, []);

  useEffect(() => {
    if (!isScanning) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadCollectStatus();
    }, 2500);

    return () => window.clearInterval(timer);
  }, [isScanning]);

  useEffect(() => {
    if (!dashboardTopics.some((topic) => topic.title === activeTopicTitle)) {
      setActiveTopicTitle(dashboardTopics[0]?.title ?? topics[0].title);
    }
  }, [activeTopicTitle, dashboardTopics]);

  async function loadRawItems() {
    const response = await fetch("/api/raw-items", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { items: RawNewsItem[] };
    setRawItems(data.items);
  }

  async function loadHotTopics() {
    const response = await fetch("/api/analyze", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as AnalyzeApiResponse;
    setAnalysisConfigured(data.analysisConfigured);
    setAnalysisModel(data.model);
    setPendingRawItems(data.pendingRawItems);
    setAnalysisStatus(formatAnalysisStatus(data));
    setLiveTopics(data.topics.map(mapHotTopic));
  }

  async function loadWatchKeywords() {
    const response = await fetch("/api/watch-keywords", { cache: "no-store" });
    if (!response.ok) {
      setKeywordsLoaded(true);
      return;
    }

    const data = (await response.json()) as { keywords: WatchKeyword[] };
    setWatchKeywords(data.keywords);
    setKeywordsLoaded(true);
  }

  async function loadCollectStatus() {
    const response = await fetch("/api/collect", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { latestRuns: CollectRunApiItem[] };
    const latestRun = data.latestRuns[0];
    if (!latestRun) {
      setScanStatus("待命");
      setIsScanning(false);
      return;
    }

    setScanStatus(formatCollectRunStatus(latestRun));

    if (latestRun.status === "RUNNING") {
      setIsScanning(true);
      return;
    }

    setIsScanning(false);
    await loadRawItems();
    await loadHotTopics();
  }

  async function addWatchKeyword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = keywordInput.trim();

    if (!keyword) {
      return;
    }

    const response = await fetch("/api/watch-keywords", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword })
    });

    if (response.ok) {
      setKeywordInput("");
      await loadWatchKeywords();
    }
  }

  async function toggleWatchKeyword(keyword: WatchKeyword) {
    const nextEnabled = !keyword.enabled;
    setPendingKeywordIds((current) => [...current, keyword.id]);
    setWatchKeywords((current) =>
      current.map((item) => (item.id === keyword.id ? { ...item, enabled: nextEnabled } : item))
    );

    try {
      await fetch(`/api/watch-keywords/${keyword.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ enabled: nextEnabled })
      });
    } finally {
      await loadWatchKeywords();
      setPendingKeywordIds((current) => current.filter((id) => id !== keyword.id));
    }
  }

  async function triggerScan() {
    if (isScanning) {
      return;
    }

    setIsScanning(true);
    setScanPulse((value) => value + 1);
    setScanStatus("采集中");
    let keepPolling = false;

    try {
      const response = await fetch("/api/collect", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          collectors: ["search"],
          keywordOnly: watchKeywords.some((keyword) => keyword.enabled),
          limit: 1,
          background: true
        })
      });
      const result = (await response.json()) as {
        status?: string;
        message?: string;
        newCount?: number;
        errors?: string[];
        keywordCount?: number;
        keywords?: string[];
      };

      if (!response.ok) {
        throw new Error(result.errors?.join("; ") || "collect failed");
      }

      if (result.status === "STARTED") {
        keepPolling = true;
        setScanStatus("后台采集中");
        window.setTimeout(() => {
          void loadCollectStatus();
        }, 900);
        return;
      }

      const keywordText = result.keywords?.length ? ` / ${result.keywords.join("、")}` : "";
      setScanStatus(`${result.status ?? "完成"} / 新增 ${result.newCount ?? 0}${keywordText}`);
      await loadRawItems();
      await loadHotTopics();
    } catch (error) {
      setScanStatus(error instanceof Error ? error.message : "采集失败");
    } finally {
      if (!keepPolling) {
        setIsScanning(false);
      }
    }
  }

  async function triggerAnalysis() {
    if (isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    setAnalysisStatus("分析中");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          limit: 6
        })
      });
      const result = (await response.json()) as {
        analyzedCount?: number;
        topicCount?: number;
        model?: string;
        message?: string;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        if (result.code === "OPENROUTER_NOT_CONFIGURED") {
          setAnalysisStatus("未配置 OpenRouter");
          return;
        }

        throw new Error(result.error || "AI 分析失败");
      }

      if (result.model) {
        setAnalysisModel(result.model);
      }

      if (result.analyzedCount === 0) {
        setAnalysisStatus("无新增线索");
      } else {
        setAnalysisStatus(`完成 / 新增热点 ${result.topicCount ?? 0}`);
      }

      await loadRawItems();
      await loadHotTopics();
    } catch (error) {
      setAnalysisStatus(error instanceof Error ? error.message : "AI 分析失败");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">AI HOT MONITOR / 2H CYCLE</p>
          <h1>AI 情报雷达</h1>
          <p className="hero__lead">
            只追踪官网、X 信号和 Google/Bing 搜索证据。AI 负责筛选和摘要，事实必须能回到原始链接。
          </p>
          <div className="hero__actions">
            <button
              className="scan-button"
              data-hot-monitor-scan="true"
              type="button"
              disabled={isScanning}
              onClick={triggerScan}
              onPointerDown={() => {
                if (!isScanning) {
                  setScanStatus("准备采集");
                }
              }}
            >
              <Zap size={18} />
              {isScanning ? "采集中" : "同步采集"}
            </button>
            <button
              className="scan-button scan-button--secondary"
              data-hot-monitor-analyze="true"
              type="button"
              disabled={isAnalyzing || (!analysisConfigured && pendingRawItems === 0)}
              title={
                analysisConfigured
                  ? `待分析 ${pendingRawItems} 条原始线索`
                  : "需要先配置 OPENROUTER_API_KEY"
              }
              onClick={triggerAnalysis}
            >
              <Sparkles size={18} />
              {isAnalyzing ? "分析中" : "AI 分析"}
            </button>
          </div>
        </div>

        <div className={`pulse pulse--scan-${scanPulse % 2}`} aria-label="monitoring radar">
          <div className="pulse__sweep" />
          <div className="pulse__ring pulse__ring--one" />
          <div className="pulse__ring pulse__ring--two" />
          <div className="pulse__ring pulse__ring--three" />
          <Radar className="pulse__icon" size={54} />
          <span className="pulse__dot pulse__dot--a" />
          <span className="pulse__dot pulse__dot--b" />
          <span className="pulse__dot pulse__dot--c" />
        </div>
      </section>

      <section className="command-strip" aria-label="system status">
        <StatusCell icon={<Settings2 size={18} />} label="自动抓取" value="未启用定时" />
        <StatusCell icon={<Sparkles size={18} />} label="默认模型" value={analysisModel} />
        <StatusCell icon={<Mail size={18} />} label="邮件策略" value="新增热点转发" />
        <StatusCell
          icon={<RefreshCcw size={18} />}
          label="采集状态"
          value={scanStatus}
          statusKey="collect"
        />
        <StatusCell
          icon={<Sparkles size={18} />}
          label="AI 分析"
          value={analysisStatus}
          statusKey="analyze"
        />
      </section>

      <section className="filter-dock" aria-label="topic filters">
        {filters.map((filter) => (
          <button
            className={activeFilter === filter.key ? "filter-dock__item is-active" : "filter-dock__item"}
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </section>

      <section className="dashboard">
        <aside className="source-rail" aria-label="source coverage">
          <div className="panel-title">
            <Activity size={18} />
            <span>来源覆盖</span>
          </div>
          <SourceMeter label="官方网站" value={72} note="事实锚点" />
          <SourceMeter label="X / twitterapi.io" value={54} note="早期信号" />
          <SourceMeter label="Google / Bing" value={63} note="交叉验证" />
          <form className="keyword-box" onSubmit={addWatchKeyword}>
            <label htmlFor="watch-keyword">关注关键词</label>
            <div>
              <input
                id="watch-keyword"
                maxLength={80}
                onChange={(event) => setKeywordInput(event.target.value)}
                placeholder="Claude Code / MCP"
                value={keywordInput}
              />
              <button type="submit">添加</button>
            </div>
          </form>
          <div className="keyword-list" aria-label="watch keywords">
            {!keywordsLoaded ? (
              <span className="keyword-empty">正在读取关注词</span>
            ) : watchKeywords.length === 0 ? (
              <span className="keyword-empty">暂无自定义关注词</span>
            ) : (
              watchKeywords.map((keyword) => (
                <button
                  className={keyword.enabled ? "keyword-chip is-enabled" : "keyword-chip"}
                  key={keyword.id}
                  aria-pressed={keyword.enabled}
                  data-keyword-enabled={String(keyword.enabled)}
                  data-keyword-id={keyword.id}
                  disabled={pendingKeywordIds.includes(keyword.id)}
                  type="button"
                  onClick={() => void toggleWatchKeyword(keyword)}
                >
                  <span className="keyword-chip__label">{keyword.keyword}</span>
                  <span className="keyword-switch" aria-hidden="true">
                    <span className="keyword-switch__knob">
                      <Power size={11} />
                    </span>
                  </span>
                  <strong>{keyword.enabled ? "启用" : "停用"}</strong>
                </button>
              ))
            )}
          </div>
          <div className="warning-note">
            YouTube、哔哩哔哩、RSS、官方 X API 当前阶段不接入。
          </div>
        </aside>

        <section className="topic-stack" aria-label="hot topics">
          {visibleTopics.map((topic, index) => (
            <article
              className={`topic topic--${topic.status} ${
                activeTopic.title === topic.title ? "is-selected" : ""
              }`}
              key={topic.title}
              role="button"
              style={{ animationDelay: `${index * 90}ms` }}
              tabIndex={0}
              onClick={() => setActiveTopicTitle(topic.title)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTopicTitle(topic.title);
                }
              }}
            >
              <div className="topic__header">
                <div>
                  <span className="topic__status">
                    {statusIcon[topic.status]}
                    {statusCopy[topic.status]}
                  </span>
                  <h2>{topic.title}</h2>
                </div>
                <div className="score">
                  <span>{topic.score}</span>
                  <small>HOT</small>
                </div>
              </div>

              <p className="topic__summary">{topic.summary}</p>
              <p className="topic__why">{topic.why}</p>

              <div className="topic__meta">
                <span>{topic.category}</span>
                <span>{topic.sourceCount} 个来源</span>
                <span>可信度 {topic.confidence}%</span>
                <span>{topic.time}</span>
              </div>

              <div className="source-tags">
                {topic.sourceTypes.map((sourceType) => (
                  <span key={sourceType}>{sourceType}</span>
                ))}
              </div>

              {topic.sources && topic.sources.length > 0 ? (
                <div className="topic-links" aria-label="source links">
                  {topic.sources.slice(0, 4).map((source) => {
                    const host = getHost(source.url);

                    return (
                      <a
                        href={source.url}
                        key={source.url}
                        rel="noreferrer"
                        target="_blank"
                        title={source.title}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {host ? (
                          <img
                            alt=""
                            height={16}
                            src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                            width={16}
                          />
                        ) : (
                          <Globe2 size={16} />
                        )}
                        <span>{source.sourceName || host || "来源"}</span>
                        <ExternalLink size={13} />
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </article>
          ))}
        </section>

        <aside className="audit-panel" aria-label="verification rules">
          <div className="panel-title">
            <ShieldAlert size={18} />
            <span>核验面板</span>
          </div>
          <div className="focus-card">
            <span>{statusCopy[activeTopic.status]}</span>
            <strong>{activeTopic.title}</strong>
            <p>{activeTopic.why}</p>
          </div>
          <ol>
            <li>没有来源 URL，不进入热点。</li>
            <li>只有 X 来源，标记为社交热议。</li>
            <li>搜索结果必须抓取落地页正文。</li>
            <li>AI 输出必须引用来源 ID。</li>
          </ol>
        </aside>
      </section>
    </main>
  );
}

function mapHotTopic(topic: HotTopicApiItem): Topic {
  return {
    title: topic.title,
    category: topic.category,
    summary: topic.summary,
    why: topic.whyItMatters ?? "该热点来自真实采集来源，详情可通过右侧来源链接继续追溯。",
    score: topic.hotScore,
    confidence: topic.confidence,
    status: mapTopicStatus(topic.status, topic.needsVerification),
    sourceCount: topic.sources.length,
    sourceTypes: Array.from(new Set(topic.sources.map((source) => source.sourceType))),
    sources: topic.sources.map((source) => ({
      title: source.title,
      url: source.url,
      sourceName: source.sourceName,
      sourceType: source.sourceType
    })),
    time: "实时"
  };
}

function mapRawItemTopic(item: RawNewsItem): Topic {
  const status = mapRawItemStatus(item.sourceType);
  const category = item.watchKeyword ? `关注词：${item.watchKeyword}` : "通用采集";

  return {
    title: item.title,
    category,
    summary: item.excerpt || "已采集到真实来源，正文摘要暂未解析完整。",
    why: "这是搜索或采集返回的原始新闻线索，底部来源链接可直接核验；运行 AI 分析后会进一步生成评分和聚类结果。",
    score: item.credibilityLevel === "OFFICIAL" ? 82 : item.sourceType === "TWITTER" ? 56 : 68,
    confidence: item.credibilityLevel === "OFFICIAL" ? 88 : item.sourceType === "TWITTER" ? 52 : 66,
    status,
    sourceCount: 1,
    sourceTypes: [item.sourceType],
    sources: [
      {
        title: item.title,
        url: item.url,
        sourceName: item.sourceName,
        sourceType: item.sourceType
      }
    ],
    time: formatItemTime(item.publishedAt ?? item.fetchedAt)
  };
}

function mapTopicStatus(status: HotTopicApiItem["status"], needsVerification: boolean): TopicStatus {
  if (status === "SOCIAL_BUZZ") {
    return "social";
  }

  if (status === "NEEDS_VERIFICATION" || needsVerification) {
    return "verify";
  }

  if (status === "MULTI_SOURCE_SIGNAL") {
    return "multi-source";
  }

  return "confirmed";
}

function mapRawItemStatus(sourceType: string): TopicStatus {
  if (sourceType === "TWITTER") {
    return "social";
  }

  if (sourceType === "SEARCH") {
    return "multi-source";
  }

  return "confirmed";
}

function formatItemTime(value?: string) {
  if (!value) {
    return "刚刚";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "实时";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCollectRunStatus(run: CollectRunApiItem) {
  const startedAt = formatClock(run.startedAt);
  const finishedAt = run.finishedAt ? formatClock(run.finishedAt) : "";

  if (run.status === "RUNNING") {
    return `采集中 / ${startedAt} 开始`;
  }

  if (run.status === "FAILED") {
    return `失败 / ${finishedAt || startedAt}`;
  }

  const statusText = run.status === "PARTIAL_SUCCESS" ? "部分完成" : "完成";
  return `${statusText} / 新增 ${run.newCount} / ${finishedAt || startedAt}`;
}

function formatAnalysisStatus(data: {
  analysisConfigured: boolean;
  pendingRawItems: number;
  topics: HotTopicApiItem[];
}) {
  if (!data.analysisConfigured) {
    return "未配置 OpenRouter";
  }

  if (data.pendingRawItems > 0) {
    return `待分析 ${data.pendingRawItems} 条`;
  }

  if (data.topics.length > 0) {
    return `已生成 ${data.topics.length} 个热点`;
  }

  return "待分析";
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function StatusCell({
  icon,
  label,
  statusKey,
  value
}: {
  icon: ReactNode;
  label: string;
  statusKey?: string;
  value: string;
}) {
  return (
    <div data-status-key={statusKey}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourceMeter({
  label,
  value,
  note
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="meter">
      <div className="meter__row">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="meter__track">
        <span style={{ width: `${value}%` }} />
      </div>
      <small>{note}</small>
    </div>
  );
}
