"use client";

import {
  Activity,
  BadgeCheck,
  ExternalLink,
  Globe2,
  MessageCircle,
  Power,
  Radar,
  RefreshCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type TopicStatus = "confirmed" | "multi-source" | "social" | "verify";
type FilterKey = "all" | TopicStatus;
type DatePreset = "1d" | "7d";

type Topic = {
  id: string;
  title: string;
  category: string;
  summary: string;
  why: string;
  score: number;
  confidence: number;
  status: TopicStatus;
  sourceCount: number;
  sourceTypes: string[];
  sources: TopicSource[];
  dateLabel: string;
  dateValue: string;
};

type TopicSource = {
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  excerpt?: string | null;
  publishedAt?: string | null;
  fetchedAt?: string | null;
};

export type RawNewsItem = {
  id: string;
  title: string;
  url: string;
  excerpt?: string | null;
  content?: string | null;
  sourceName: string;
  sourceType: string;
  credibilityLevel: string;
  watchKeyword?: string | null;
  fetchedAt: string;
  publishedAt?: string | null;
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
    excerpt?: string | null;
    publishedAt?: string | null;
    fetchedAt?: string | null;
  }>;
};

type RadarDashboardProps = {
  initialRawItems?: RawNewsItem[];
  initialHotTopics?: HotTopicApiItem[];
  initialWatchKeywords?: WatchKeyword[];
};

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "confirmed", label: "已确认" },
  { key: "multi-source", label: "多源线索" },
  { key: "social", label: "社交热议" },
  { key: "verify", label: "待核验" }
];

const datePresets: Array<{ key: DatePreset; label: string }> = [
  { key: "1d", label: "1天" },
  { key: "7d", label: "7天" }
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

export function RadarDashboard({
  initialRawItems = [],
  initialHotTopics = [],
  initialWatchKeywords = []
}: RadarDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("7d");
  const [activeTopicId, setActiveTopicId] = useState(
    () => initialHotTopics[0]?.id ?? initialRawItems[0]?.id ?? ""
  );
  const [scanPulse, setScanPulse] = useState(0);
  const [rawItems, setRawItems] = useState<RawNewsItem[]>(initialRawItems);
  const [liveTopics, setLiveTopics] = useState<Topic[]>(() => initialHotTopics.map(mapHotTopic));
  const [watchKeywords, setWatchKeywords] = useState<WatchKeyword[]>(initialWatchKeywords);
  const [keywordsLoaded, setKeywordsLoaded] = useState(initialWatchKeywords.length > 0);
  const [keywordInput, setKeywordInput] = useState("");
  const [scanStatus, setScanStatus] = useState("等待自动抓取");
  const [analysisStatus, setAnalysisStatus] = useState("等待自动分析");
  const [analysisModel, setAnalysisModel] = useState("deepseek/deepseek-v4-flash");
  const [pendingRawItems, setPendingRawItems] = useState(0);
  const [analysisConfigured, setAnalysisConfigured] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pendingKeywordIds, setPendingKeywordIds] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(() => new Date());
  const [nextRefreshAt, setNextRefreshAt] = useState<Date>(() => addMinutes(new Date(), 60));
  const [clockNow, setClockNow] = useState<Date>(() => new Date());
  const [mounted, setMounted] = useState(false);
  const lastAutoAnalyzeAt = useRef(0);

  const dateQuery = useMemo(() => buildDateQuery(datePreset), [datePreset]);
  const refreshSummary = useMemo(
    () => formatRefreshSummary(lastUpdatedAt, nextRefreshAt, clockNow),
    [clockNow, lastUpdatedAt, nextRefreshAt]
  );

  const rawItemTopics = useMemo(() => rawItems.map(mapRawItemTopic), [rawItems]);
  const dashboardTopics = useMemo(() => {
    const linkedUrls = new Set(liveTopics.flatMap((topic) => topic.sources.map((source) => source.url)));
    const freshRawTopics = rawItemTopics.filter((topic) =>
      topic.sources.some((source) => !linkedUrls.has(source.url))
    );
    return [...liveTopics, ...freshRawTopics].sort(compareTopicDate);
  }, [liveTopics, rawItemTopics]);
  const visibleTopics = useMemo(() => {
    if (activeFilter === "all") {
      return dashboardTopics;
    }
    return dashboardTopics.filter((topic) => topic.status === activeFilter);
  }, [activeFilter, dashboardTopics]);

  const activeTopic =
    dashboardTopics.find((topic) => topic.id === activeTopicId) ?? visibleTopics[0] ?? dashboardTopics[0];

  useEffect(() => {
    document.documentElement.dataset.hotMonitorHydrated = "true";
    setMounted(true);
    void refreshDashboard();
    void loadWatchKeywords();
    void loadCollectStatus();

    const initialTimer = window.setTimeout(() => {
      void triggerScan({ automatic: true });
    }, 1200);
    const hourlyTimer = window.setInterval(() => {
      void triggerScan({ automatic: true });
    }, 60 * 60 * 1000);
    const clockTimer = window.setInterval(() => {
      setClockNow(new Date());
    }, 60 * 1000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(hourlyTimer);
      window.clearInterval(clockTimer);
    };
    // Initial timers should be installed once; date changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateQuery]);

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
    if (!dashboardTopics.some((topic) => topic.id === activeTopicId)) {
      setActiveTopicId(dashboardTopics[0]?.id ?? "");
    }
  }, [activeTopicId, dashboardTopics]);

  useEffect(() => {
    if (!analysisConfigured || pendingRawItems === 0 || isAnalyzing) {
      return;
    }

    const now = Date.now();
    if (now - lastAutoAnalyzeAt.current < 30_000) {
      return;
    }

    lastAutoAnalyzeAt.current = now;
    void triggerAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisConfigured, pendingRawItems, isAnalyzing]);

  async function refreshDashboard() {
    await Promise.all([loadRawItems(), loadHotTopics()]);
    setLastUpdatedAt(new Date());
  }

  async function loadRawItems() {
    const response = await fetch(`/api/raw-items${dateQuery}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { items: RawNewsItem[] };
    setRawItems(data.items);
  }

  async function loadHotTopics() {
    const response = await fetch(`/api/analyze${dateQuery}`, { cache: "no-store" });
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
      setScanStatus("等待自动抓取");
      setIsScanning(false);
      return;
    }

    setScanStatus(formatCollectRunStatus(latestRun));

    if (latestRun.status === "RUNNING") {
      setIsScanning(true);
      return;
    }

    setIsScanning(false);
    await refreshDashboard();
  }

  async function addWatchKeyword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = keywordInput.trim();
    if (!keyword) {
      return;
    }

    const response = await fetch("/api/watch-keywords", {
      method: "POST",
      headers: { "content-type": "application/json" },
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
      const response = await fetch(`/api/watch-keywords/${keyword.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled })
      });

      if (!response.ok) {
        throw new Error("关注词开关保存失败");
      }
    } catch (error) {
      setWatchKeywords((current) =>
        current.map((item) => (item.id === keyword.id ? { ...item, enabled: keyword.enabled } : item))
      );
      setScanStatus(error instanceof Error ? error.message : "关注词开关保存失败");
    } finally {
      setPendingKeywordIds((current) => current.filter((id) => id !== keyword.id));
    }
  }

  async function triggerScan(options: { automatic?: boolean } = {}) {
    if (isScanning) {
      return;
    }

    setIsScanning(true);
    setScanPulse((value) => value + 1);
    setScanStatus(options.automatic ? "自动抓取中" : "手动抓取中");
    if (options.automatic) {
      setNextRefreshAt(addMinutes(new Date(), 60));
    }
    let keepPolling = false;

    try {
      const response = await fetch("/api/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collectors: ["search"],
          keywordOnly: watchKeywords.some((keyword) => keyword.enabled),
          limit: 5,
          background: true,
          autoAnalyze: true
        })
      });
      const result = (await response.json()) as {
        status?: string;
        errors?: string[];
        duplicateCount?: number;
      };

      if (!response.ok) {
        throw new Error(result.errors?.join("; ") || "collect failed");
      }

      keepPolling = true;
      setNextRefreshAt(addMinutes(new Date(), 60));
      setScanStatus("后台抓取中");
      window.setTimeout(() => {
        void loadCollectStatus();
      }, 900);
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
    setAnalysisStatus("自动分析中");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 8 })
      });
      const result = (await response.json()) as {
        analyzedCount?: number;
        topicCount?: number;
        model?: string;
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

      setAnalysisStatus(
        result.analyzedCount === 0 ? "暂无新增线索" : `完成 / 新增热点 ${result.topicCount ?? 0}`
      );
      await refreshDashboard();
    } catch (error) {
      setAnalysisStatus(error instanceof Error ? error.message : "AI 分析失败");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function selectTopicFilter(filter: FilterKey) {
    setActiveFilter(filter);
  }

  function selectDatePreset(preset: DatePreset) {
    setDatePreset(preset);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <div className={`radar-mark radar-mark--scan-${scanPulse % 2}`} aria-label="monitoring radar">
            <span className="radar-mark__sweep" />
            <span className="radar-mark__ring" />
            <Radar className="radar-mark__icon" size={20} />
          </div>
          <div className="topbar__heading">
            <p className="eyebrow">AI HOT MONITOR / 1H AUTO CYCLE</p>
            <h1>AI 情报雷达</h1>
          </div>
        </div>

        <div className="topbar__status" aria-label="system status">
          <StatusPill
            icon={<RefreshCcw size={14} />}
            label="采集"
            value={scanStatus}
            tone={isScanning ? "running" : "idle"}
          />
          <StatusPill
            icon={<Sparkles size={14} />}
            label="AI 分析"
            value={analysisStatus}
            title={`默认模型 ${analysisModel}`}
            tone={isAnalyzing ? "running" : "idle"}
          />
          <StatusPill icon={<Activity size={14} />} label="待分析" value={`${pendingRawItems} 条`} />
        </div>

        <div className="topbar__actions">
          <button
            className="scan-button"
            data-hot-monitor-scan="true"
            type="button"
            disabled={isScanning}
            onClick={() => void triggerScan()}
          >
            <Zap size={18} />
            {isScanning ? "抓取中" : "立即抓取"}
          </button>
        </div>
      </header>

      <section className="filter-dock" aria-label="topic filters">
        <div className="filter-dock__buttons">
          {filters.map((filter) => (
            <button
              className={activeFilter === filter.key ? "filter-dock__item is-active" : "filter-dock__item"}
              key={filter.key}
              type="button"
              onClick={() => selectTopicFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="date-filter" aria-label="news date filters">
          <div className="date-filter__range" role="group" aria-label="news date range">
          {datePresets.map((preset) => (
            <button
              className={datePreset === preset.key ? "is-active" : ""}
              key={preset.key}
              type="button"
              onClick={() => selectDatePreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
          </div>
          <p className="refresh-copy" suppressHydrationWarning>
            {mounted ? (
              <>
                <span>更新于 {refreshSummary.updatedAgo}</span>
                <span aria-hidden="true">·</span>
                <span>{refreshSummary.refreshIn}</span>
              </>
            ) : (
              <span>同步中…</span>
            )}
          </p>
        </div>
      </section>

      <section className="dashboard">
        <aside className="source-rail" aria-label="source coverage">
          <div className="panel-title">
            <Activity size={18} />
            <span>来源与关键词</span>
          </div>
          <SourceMeter label="官方与原始来源" value={72} note="优先作为事实锚点" />
          <SourceMeter label="搜索发现" value={63} note="用于发现和交叉验证" />
          <SourceMeter label="社交信号" value={54} note="只作为早期趋势" />
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
        </aside>

        <section className="topic-stack" aria-label="hot topics">
          {visibleTopics.length === 0 ? (
            <div className="empty-state">
              <strong>当前筛选范围暂无新闻</strong>
              <span>可放宽日期范围，或等待下一次自动抓取。</span>
            </div>
          ) : (
            visibleTopics.map((topic, index) => (
              <article
                className={`topic topic--${topic.status} ${activeTopic?.id === topic.id ? "is-selected" : ""}`}
                key={topic.id}
                role="button"
                style={{ animationDelay: `${index * 60}ms` }}
                tabIndex={0}
                onClick={() => setActiveTopicId(topic.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveTopicId(topic.id);
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

                <div className="topic__body">
                  <p className="topic__summary">{topic.summary}</p>
                  <p className="topic__why">{topic.why}</p>
                </div>

                <div className="topic__meta">
                  <span>{topic.category}</span>
                  <span>{topic.sourceCount} 个来源</span>
                  <span>可信度 {topic.confidence}%</span>
                  <span>{topic.dateLabel}</span>
                </div>

                <div className="source-tags">
                  {topic.sourceTypes.map((sourceType) => (
                    <span key={sourceType}>{formatSourceType(sourceType)}</span>
                  ))}
                </div>

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
              </article>
            ))
          )}
        </section>

        <aside className="audit-panel" aria-label="verification rules">
          <div className="panel-title">
            <ShieldAlert size={18} />
            <span>当前焦点</span>
          </div>
          {activeTopic ? (
            <div className="focus-card">
              <span>{statusCopy[activeTopic.status]}</span>
              <strong>{activeTopic.title}</strong>
              <p>{activeTopic.summary}</p>
              <p>{activeTopic.why}</p>
              <div className="focus-card__meta">
                <span>{activeTopic.category}</span>
                <span>可信度 {activeTopic.confidence}%</span>
                <span>{activeTopic.dateLabel}</span>
              </div>
              <div className="focus-card__sources">
                {activeTopic.sources.slice(0, 5).map((source) => (
                  <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                    {source.sourceName || getHost(source.url) || "来源"}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <ol>
            <li>新闻日期优先使用原文发布日期，没有发布日期时使用抓取时间。</li>
            <li>AI 分析在采集后自动执行，不需要用户悬浮或点击。</li>
            <li>卡片摘要来自 AI 热点结果；未分析线索使用原始摘要和正文截断。</li>
            <li>同一来源同一 URL 已存在时会去重，不会重复入库。</li>
          </ol>
        </aside>
      </section>
    </main>
  );
}

function mapHotTopic(topic: HotTopicApiItem): Topic {
  const firstSource = topic.sources[0];
  const dateValue = firstSource?.publishedAt ?? firstSource?.fetchedAt ?? "";

  return {
    id: topic.id,
    title: topic.title,
    category: topic.category,
    summary: trimText(topic.summary, 260),
    why: trimText(topic.whyItMatters || "该热点来自已采集来源，建议结合底部来源继续核验影响范围。", 220),
    score: topic.hotScore,
    confidence: topic.confidence,
    status: mapTopicStatus(topic.status, topic.needsVerification),
    sourceCount: topic.sources.length,
    sourceTypes: Array.from(new Set(topic.sources.map((source) => source.sourceType))),
    sources: topic.sources,
    dateLabel: formatDateLabel(dateValue),
    dateValue
  };
}

function mapRawItemTopic(item: RawNewsItem): Topic {
  const status = mapRawItemStatus(item.sourceType);
  const category = item.watchKeyword ? `关注词：${item.watchKeyword}` : "原始线索";
  const summary = trimText(item.excerpt || item.content || item.title, 260);
  const why =
    item.excerpt || item.content
      ? "这是采集到的原始新闻线索，已尽量展示摘要；AI 自动分析后会生成更稳定的热点评分和影响判断。"
      : "该来源暂未解析出正文摘要，可通过来源链接继续核验。";

  return {
    id: item.id,
    title: item.title,
    category,
    summary,
    why,
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
        sourceType: item.sourceType,
        excerpt: item.excerpt,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt
      }
    ],
    dateLabel: formatDateLabel(item.publishedAt ?? item.fetchedAt),
    dateValue: item.publishedAt ?? item.fetchedAt
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

function buildDateQuery(preset: DatePreset) {
  const params = new URLSearchParams();
  const now = new Date();
  const start = new Date(now);
  const days = preset === "1d" ? 0 : 6;
  start.setDate(now.getDate() - days);
  params.set("startDate", toDateInputValue(start));
  params.set("endDate", toDateInputValue(now));

  const query = params.toString();
  return query ? `?${query}` : "";
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatRefreshSummary(lastUpdatedAt: Date, nextRefreshAt: Date, now: Date) {
  return {
    updatedAgo: formatUpdatedAgo(now.getTime() - lastUpdatedAt.getTime()),
    refreshIn: formatRefreshIn(nextRefreshAt.getTime() - now.getTime())
  };
}

function formatUpdatedAgo(diffMs: number) {
  const minutes = Math.max(0, Math.round(diffMs / 60_000));

  if (minutes <= 0) {
    return "刚刚";
  }

  return `${minutes} 分钟前`;
}

function formatRefreshIn(diffMs: number) {
  const minutes = Math.max(0, Math.round(diffMs / 60_000));

  if (minutes <= 0) {
    return "即将刷新";
  }

  return `将于 ${minutes} 分钟后刷新`;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatAnalysisStatus(data: AnalyzeApiResponse) {
  if (!data.analysisConfigured) {
    return "未配置 OpenRouter";
  }
  if (data.pendingRawItems > 0) {
    return `待分析 ${data.pendingRawItems} 条`;
  }
  if (data.topics.length > 0) {
    return `已生成 ${data.topics.length} 个热点`;
  }
  return "等待自动分析";
}

function formatCollectRunStatus(run: CollectRunApiItem) {
  const startedAt = formatClock(run.startedAt);
  const finishedAt = run.finishedAt ? formatClock(run.finishedAt) : "";
  const duplicateCount = parseCollectRunDuplicateCount(run.metadataJson);

  if (run.status === "RUNNING") {
    return `采集中 / ${startedAt} 开始`;
  }
  if (run.status === "FAILED") {
    return `失败 / ${finishedAt || startedAt}`;
  }

  const statusText = run.status === "PARTIAL_SUCCESS" ? "部分完成" : "完成";
  return `${statusText} / 抓取 ${run.fetchedCount} / 新增 ${run.newCount} / 重复 ${duplicateCount} / ${
    finishedAt || startedAt
  }`;
}

function parseCollectRunDuplicateCount(metadataJson?: string | null) {
  if (!metadataJson) {
    return 0;
  }

  try {
    const metadata = JSON.parse(metadataJson) as { duplicateCount?: number };
    return metadata.duplicateCount ?? 0;
  } catch {
    return 0;
  }
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(value?: string | null) {
  if (!value) {
    return "未知日期";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知日期";
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function compareTopicDate(a: Topic, b: Topic) {
  return new Date(b.dateValue).getTime() - new Date(a.dateValue).getTime();
}

function trimText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatSourceType(value: string) {
  const map: Record<string, string> = {
    OFFICIAL: "官方",
    SEARCH: "搜索",
    TWITTER: "X"
  };
  return map[value] ?? value;
}

function getHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function StatusPill({
  icon,
  label,
  value,
  title,
  tone = "idle"
}: {
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
  tone?: "idle" | "running";
}) {
  return (
    <div className="status-pill" data-tone={tone} title={title}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourceMeter({ label, value, note }: { label: string; value: number; note: string }) {
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
