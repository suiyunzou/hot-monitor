"use client";

import {
  Activity,
  AtSign,
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  Eye,
  Globe2,
  Heart,
  Mail,
  MessageCircle,
  Power,
  Radar,
  Repeat2,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type TopicStatus = "confirmed" | "multi-source" | "social" | "verify";
type FilterKey = "all" | TopicStatus;
type DatePreset = "1d" | "7d" | "30d" | "all";
type SourceFilterKey = "all" | "official" | "search" | "social";
type SortKey = "time" | "score" | "views" | "replies";
type ThresholdKey = "all" | "70" | "85";
type TopicLimit = 12 | 30 | 60 | 100;
type ConfigTab = "keywords" | "kol" | "email";

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
  engagement?: TopicEngagement | null;
  totalViews: number;
  totalReplies: number;
  dateLabel: string;
  dateValue: string;
};

type TopicSource = {
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  author?: string | null;
  excerpt?: string | null;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  retweetCount?: number | null;
  replyCount?: number | null;
};

type TopicEngagement = {
  author?: string | null;
  views?: number | null;
  likes?: number | null;
  replies?: number | null;
  retweets?: number | null;
};

export type WatchKeyword = {
  id: string;
  keyword: string;
  enabled: boolean;
};

export type KolAccount = {
  id: string;
  handle: string;
  displayName?: string | null;
  tier: number;
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

type CollectRunEventApiItem = {
  id: string;
  level: string;
  phase: string;
  eventType: string;
  message: string;
  details?: unknown;
  createdAt: string;
};

type RunRawItemApiItem = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  credibilityLevel: string;
  status: string;
  fetchedAt: string;
  query?: string;
  provider?: string;
  keyword?: string;
  snippetOnly: boolean;
  extractionError?: string;
  adoptedByAi: boolean;
};

type RunHotTopicApiItem = {
  id: string;
  title: string;
  hotScore: number;
  confidence: number;
  status: string;
  needsVerification: boolean;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    sourceType: string;
    credibilityLevel: string;
  }>;
};

type CollectRunDetails = {
  run: CollectRunApiItem;
  events: CollectRunEventApiItem[];
  evidenceSummary: {
    rawItemCount: number;
    adoptedCount: number;
    snippetOnlyCount: number;
    providerCounts: Record<string, number>;
    credibilityCounts: Record<string, number>;
  };
  rawItems: RunRawItemApiItem[];
  aiAnalyses: Array<{
    id: string;
    task: string;
    model: string;
    topicId?: string | null;
    createdAt: string;
  }>;
  hotTopics: RunHotTopicApiItem[];
};

type AnalyzeApiResponse = {
  analysisConfigured: boolean;
  model: string;
  pendingRawItems: number;
  sourceCoverage: SourceCoverage;
  totalTopics?: number;
  filters?: {
    q: string;
    status: FilterKey;
    source?: SourceFilterKey;
    sort: SortKey;
    minScore?: number;
    minConfidence?: number;
    dateRangeApplied?: boolean;
    active?: boolean;
    issues?: Array<{
      field: string;
      value: string;
      reason: string;
    }>;
    resultLimit?: number;
    returnedTopics?: number;
    optimized?: {
      databaseCount: boolean;
      databaseLimit: boolean;
      databaseSort: boolean;
      candidateLimit: number;
    };
  };
  topics: HotTopicApiItem[];
};

type SourceCoverage = {
  official: number;
  search: number;
  social: number;
  total: number;
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
    author?: string | null;
    excerpt?: string | null;
    publishedAt?: string | null;
    fetchedAt?: string | null;
    viewCount?: number | null;
    likeCount?: number | null;
    retweetCount?: number | null;
    replyCount?: number | null;
  }>;
};

type RadarDashboardProps = {
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

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "time", label: "新闻时间" },
  { key: "views", label: "观看量" },
  { key: "replies", label: "评论数" }
];

const expandedDatePresets: Array<{ key: DatePreset; label: string }> = [
  { key: "1d", label: "1天" },
  { key: "7d", label: "7天" },
  { key: "30d", label: "30天" },
  { key: "all", label: "全部时间" }
];

const expandedSortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "time", label: "新闻时间" },
  { key: "score", label: "热度" },
  { key: "views", label: "观看量" },
  { key: "replies", label: "评论数" }
];

const sourceOptions: Array<{ key: SourceFilterKey; label: string }> = [
  { key: "all", label: "全部来源" },
  { key: "official", label: "官方" },
  { key: "search", label: "搜索" },
  { key: "social", label: "社交" }
];

const scoreOptions: Array<{ key: ThresholdKey; label: string }> = [
  { key: "all", label: "全部热度" },
  { key: "70", label: "70+" },
  { key: "85", label: "85+" }
];

const confidenceOptions: Array<{ key: ThresholdKey; label: string }> = [
  { key: "all", label: "全部置信" },
  { key: "70", label: "70+" },
  { key: "85", label: "85+" }
];

const topicLimitOptions: Array<{ key: TopicLimit; label: string }> = [
  { key: 12, label: "12条" },
  { key: 30, label: "30条" },
  { key: 60, label: "60条" },
  { key: 100, label: "100条" }
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

const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

function formatPipelineSummary(
  details: CollectRunDetails | null,
  pendingRawItems: number,
  isScanning: boolean
) {
  if (!details) {
    return isScanning ? "采集中…" : "暂无运行记录";
  }

  const { run, hotTopics } = details;
  let statusText: string;
  if (isScanning || run.status === "RUNNING") {
    statusText = "采集中";
  } else if (run.status === "FAILED") {
    statusText = "失败";
  } else if (run.status === "PARTIAL_SUCCESS") {
    statusText = "部分完成";
  } else {
    statusText = "完成";
  }

  const parts = [statusText, `新增 ${run.newCount}`];
  if (pendingRawItems > 0) {
    parts.push(`待分析 ${pendingRawItems}`);
  } else if (hotTopics.length > 0) {
    parts.push(`热点 ${hotTopics.length}`);
  }

  return parts.join(" · ");
}

export function RadarDashboard({
  initialHotTopics = [],
  initialWatchKeywords = []
}: RadarDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("7d");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sourceFilter, setSourceFilter] = useState<SourceFilterKey>("all");
  const [scoreFilter, setScoreFilter] = useState<ThresholdKey>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ThresholdKey>("all");
  const [topicLimit, setTopicLimit] = useState<TopicLimit>(30);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTopicId, setActiveTopicId] = useState(() => initialHotTopics[0]?.id ?? "");
  const [scanPulse, setScanPulse] = useState(0);
  const [liveTopics, setLiveTopics] = useState<Topic[]>(() => initialHotTopics.map(mapHotTopic));
  const [watchKeywords, setWatchKeywords] = useState<WatchKeyword[]>(initialWatchKeywords);
  const [keywordsLoaded, setKeywordsLoaded] = useState(initialWatchKeywords.length > 0);
  const [keywordInput, setKeywordInput] = useState("");
  const [runDetails, setRunDetails] = useState<CollectRunDetails | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState("等待自动分析");
  const [analysisModel, setAnalysisModel] = useState("deepseek/deepseek-v4-flash");
  const [pendingRawItems, setPendingRawItems] = useState(0);
  const [sourceCoverage, setSourceCoverage] = useState<SourceCoverage>({
    official: 0,
    search: 0,
    social: 0,
    total: 0
  });
  const [filterSummary, setFilterSummary] = useState("筛选结果加载中");
  const [filterError, setFilterError] = useState("");
  const [analysisConfigured, setAnalysisConfigured] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState<string | null>(null);
  const [unsentTopicCount, setUnsentTopicCount] = useState(0);
  const [emailStatus, setEmailStatus] = useState("尚未发送");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [kolAccounts, setKolAccounts] = useState<KolAccount[]>([]);
  const [kolLoaded, setKolLoaded] = useState(false);
  const [kolHandleInput, setKolHandleInput] = useState("");
  const [kolTierInput, setKolTierInput] = useState<1 | 2>(2);
  const [pendingKolIds, setPendingKolIds] = useState<string[]>([]);
  const [pendingKeywordIds, setPendingKeywordIds] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(() => new Date());
  const [nextRefreshAt, setNextRefreshAt] = useState<Date>(() => getNextScheduledRefresh(new Date()));
  const [clockNow, setClockNow] = useState<Date>(() => new Date());
  const [mounted, setMounted] = useState(false);
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>("keywords");
  const [pipelineExpanded, setPipelineExpanded] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const lastAutoAnalyzeAt = useRef(0);
  const isScanningRef = useRef(isScanning);
  const watchKeywordsRef = useRef(watchKeywords);

  const trimmedSearch = searchQuery.trim();
  const topicsQuery = useMemo(
    () =>
      buildTopicsQuery(
        datePreset,
        trimmedSearch,
        activeFilter,
        sortKey,
        sourceFilter,
        scoreFilter,
        confidenceFilter,
        topicLimit
      ),
    [activeFilter, confidenceFilter, datePreset, scoreFilter, sortKey, sourceFilter, topicLimit, trimmedSearch]
  );
  const refreshSummary = useMemo(
    () => formatRefreshSummary(lastUpdatedAt, nextRefreshAt, clockNow),
    [clockNow, lastUpdatedAt, nextRefreshAt]
  );
  const configSummary = useMemo(() => {
    const enabledKeywords = watchKeywords.filter((keyword) => keyword.enabled).length;
    const kolCount = kolAccounts.length;
    const emailLabel = emailConfigured ? "邮件已配置" : "邮件未配置";
    return `${enabledKeywords} 个关键词 · ${kolCount} 个 KOL · ${emailLabel}`;
  }, [emailConfigured, kolAccounts, watchKeywords]);
  const pipelineSummary = useMemo(
    () => formatPipelineSummary(runDetails, pendingRawItems, isScanning),
    [isScanning, pendingRawItems, runDetails]
  );
  const advancedFilterCount = useMemo(() => {
    return [sourceFilter !== "all", scoreFilter !== "all", confidenceFilter !== "all", topicLimit !== 30].filter(Boolean)
      .length;
  }, [confidenceFilter, scoreFilter, sourceFilter, topicLimit]);

  // Only AI-analyzed (Chinese, scored) topics become cards. Raw collected items
  // stay as a "分析中" count until the pipeline summarizes + translates them.
  const dashboardTopics = useMemo(() => liveTopics, [liveTopics]);
  const visibleTopics = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return dashboardTopics;
    }
    return dashboardTopics.filter((topic) => matchesSearch(topic, query));
  }, [dashboardTopics, searchQuery]);

  const activeTopic =
    dashboardTopics.find((topic) => topic.id === activeTopicId) ?? visibleTopics[0] ?? dashboardTopics[0];

  useEffect(() => {
    document.documentElement.dataset.hotMonitorHydrated = "true";
    setMounted(true);
    setNextRefreshAt(getNextScheduledRefresh(new Date()));
    void refreshDashboard();
    void loadWatchKeywords();
    void loadCollectStatus();
    void loadEmailStatus();
    void loadKolAccounts();

    let intervalTimer: number | undefined;
    const refreshTimer = window.setTimeout(() => {
      void triggerScan({ automatic: true });
      intervalTimer = window.setInterval(() => {
        void triggerScan({ automatic: true });
      }, AUTO_REFRESH_INTERVAL_MS);
    }, getNextScheduledRefresh(new Date()).getTime() - Date.now());
    const clockTimer = window.setInterval(() => {
      setClockNow(new Date());
    }, 60 * 1000);

    return () => {
      window.clearTimeout(refreshTimer);
      if (intervalTimer !== undefined) {
        window.clearInterval(intervalTimer);
      }
      window.clearInterval(clockTimer);
    };
    // Initial timers should be installed once; date changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    watchKeywordsRef.current = watchKeywords;
  }, [watchKeywords]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshDashboard();
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsQuery]);

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
    if (!configDrawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConfigDrawerOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [configDrawerOpen]);

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
    await loadHotTopics();
    setLastUpdatedAt(new Date());
  }

  async function loadHotTopics() {
    try {
      const response = await fetch(`/api/analyze${topicsQuery}`, { cache: "no-store" });
      if (!response.ok) {
        setFilterError(`Filter request failed: HTTP ${response.status}`);
        return;
      }

      const data = (await response.json()) as AnalyzeApiResponse;
      setAnalysisConfigured(data.analysisConfigured);
      setAnalysisModel(data.model);
      setPendingRawItems(data.pendingRawItems);
      setSourceCoverage(data.sourceCoverage ?? { official: 0, search: 0, social: 0, total: 0 });
      setAnalysisStatus(formatAnalysisStatus(data));
      setLiveTopics(data.topics.map(mapHotTopic));
      setFilterSummary(formatFilterSummary(data));
      setFilterError(formatFilterIssues(data));
    } catch (error) {
      setFilterError(`Filter request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  async function loadEmailStatus() {
    const response = await fetch("/api/email", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as {
      configured: boolean;
      recipient: string | null;
      unsentCount: number;
      digests: Array<{ status: string; topicCount: number; sentAt?: string | null }>;
    };

    setEmailConfigured(data.configured);
    setEmailRecipient(data.recipient);
    setUnsentTopicCount(data.unsentCount);

    const lastSuccess = data.digests.find((digest) => digest.status === "SUCCESS");
    if (lastSuccess?.sentAt) {
      setEmailStatus(`上次发送 ${formatClock(lastSuccess.sentAt)} · ${lastSuccess.topicCount} 条`);
    } else if (!data.configured) {
      setEmailStatus("未配置 SMTP");
    } else {
      setEmailStatus("尚未发送");
    }
  }

  async function sendEmailDigest() {
    if (isSendingEmail) {
      return;
    }

    setIsSendingEmail(true);
    setEmailStatus("发送中");

    try {
      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 10 })
      });
      const result = (await response.json()) as {
        sent?: boolean;
        reason?: string;
        topicCount?: number;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        if (result.code === "EMAIL_NOT_CONFIGURED") {
          setEmailStatus("未配置 SMTP");
          return;
        }
        throw new Error(result.error || "邮件发送失败");
      }

      if (result.sent) {
        setEmailStatus(`已发送 ${result.topicCount ?? 0} 条`);
      } else if (result.reason === "NO_NEW_TOPICS") {
        setEmailStatus("暂无新增热点可发送");
      } else {
        setEmailStatus("未发送");
      }

      await loadEmailStatus();
    } catch (error) {
      setEmailStatus(error instanceof Error ? error.message : "邮件发送失败");
    } finally {
      setIsSendingEmail(false);
    }
  }

  async function loadKolAccounts() {
    const response = await fetch("/api/kol-accounts", { cache: "no-store" });
    if (!response.ok) {
      setKolLoaded(true);
      return;
    }

    const data = (await response.json()) as { accounts: KolAccount[] };
    setKolAccounts(data.accounts);
    setKolLoaded(true);
  }

  async function addKolAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handle = kolHandleInput.trim().replace(/^@/, "");
    if (!handle) {
      return;
    }

    const response = await fetch("/api/kol-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, tier: kolTierInput })
    });

    if (response.ok) {
      setKolHandleInput("");
      await loadKolAccounts();
    }
  }

  async function toggleKolAccount(account: KolAccount) {
    const nextEnabled = !account.enabled;
    setPendingKolIds((current) => [...current, account.id]);
    setKolAccounts((current) =>
      current.map((item) => (item.id === account.id ? { ...item, enabled: nextEnabled } : item))
    );

    try {
      const response = await fetch(`/api/kol-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled })
      });
      if (!response.ok) {
        throw new Error("KOL 开关保存失败");
      }
    } catch {
      setKolAccounts((current) =>
        current.map((item) => (item.id === account.id ? { ...item, enabled: account.enabled } : item))
      );
    } finally {
      setPendingKolIds((current) => current.filter((id) => id !== account.id));
    }
  }

  async function deleteKolAccount(account: KolAccount) {
    setPendingKolIds((current) => [...current, account.id]);
    const previous = kolAccounts;
    setKolAccounts((current) => current.filter((item) => item.id !== account.id));

    try {
      const response = await fetch(`/api/kol-accounts/${account.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("删除失败");
      }
    } catch {
      setKolAccounts(previous);
    } finally {
      setPendingKolIds((current) => current.filter((id) => id !== account.id));
    }
  }

  async function loadCollectStatus() {
    const response = await fetch("/api/collect", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { latestRuns: CollectRunApiItem[]; runDetails?: CollectRunDetails | null };
    const latestRun = data.latestRuns[0];
    setRunDetails(data.runDetails ?? null);
    if (!latestRun) {
      setIsScanning(false);
      isScanningRef.current = false;
      return;
    }

    if (latestRun.status === "RUNNING") {
      setIsScanning(true);
      isScanningRef.current = true;
      return;
    }

    setIsScanning(false);
    isScanningRef.current = false;
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
    } finally {
      setPendingKeywordIds((current) => current.filter((id) => id !== keyword.id));
    }
  }

  async function deleteWatchKeyword(keyword: WatchKeyword) {
    setPendingKeywordIds((current) => [...current, keyword.id]);
    const previous = watchKeywords;
    setWatchKeywords((current) => current.filter((item) => item.id !== keyword.id));

    try {
      const response = await fetch(`/api/watch-keywords/${keyword.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("删除失败");
      }
    } catch {
      setWatchKeywords(previous);
    } finally {
      setPendingKeywordIds((current) => current.filter((id) => id !== keyword.id));
    }
  }

  async function triggerScan(options: { automatic?: boolean } = {}) {
    if (isScanningRef.current) {
      if (options.automatic) {
        setNextRefreshAt(getNextScheduledRefresh(new Date()));
      }
      return;
    }

    isScanningRef.current = true;
    setIsScanning(true);
    setScanPulse((value) => value + 1);
    if (options.automatic) {
      setNextRefreshAt(getNextScheduledRefresh(new Date()));
    }
    let keepPolling = false;

    try {
      const response = await fetch("/api/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collectors: ["search", "twitterapi-io", "official"],
          keywordOnly: watchKeywordsRef.current.some((keyword) => keyword.enabled),
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
      window.setTimeout(() => {
        void loadCollectStatus();
      }, 900);
    } catch {
    } finally {
      if (!keepPolling) {
        isScanningRef.current = false;
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

  function openConfigDrawer(tab: ConfigTab = "keywords") {
    setConfigTab(tab);
    setConfigDrawerOpen(true);
  }

  function closeConfigDrawer() {
    setConfigDrawerOpen(false);
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
            <p className="eyebrow">AI HOT MONITOR / 30M AUTO CYCLE</p>
            <h1>AI 情报雷达</h1>
          </div>
        </div>

        <div className="topbar__status" aria-label="system status">
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
            className="config-button"
            type="button"
            aria-expanded={configDrawerOpen}
            aria-controls="collect-config-drawer"
            onClick={() => openConfigDrawer()}
          >
            <SlidersHorizontal size={16} />
            采集配置
          </button>
          <button
            className="scan-button"
            data-hot-monitor-scan="true"
            type="button"
            disabled={isScanning}
            onClick={() => void triggerScan()}
          >
            <Zap size={18} />
            {isScanning ? "更新中" : "立即更新"}
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

        <div className="filter-dock__tools">
          <div className="filter-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="搜索热点"
              maxLength={80}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索标题 / 摘要 / 来源 / 作者"
              type="text"
              value={searchQuery}
            />
            {searchQuery ? (
              <button
                className="filter-search__clear"
                type="button"
                aria-label="清除搜索"
                title="清除搜索"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <label className="filter-select" aria-label="sort topics">
            <span>{"\u6392\u5e8f"}</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              {expandedSortOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={advancedFiltersOpen ? "filter-dock__advanced-toggle is-active" : "filter-dock__advanced-toggle"}
            type="button"
            aria-expanded={advancedFiltersOpen}
            onClick={() => setAdvancedFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal size={15} />
            <span className="filter-dock__advanced-label">
              {"\u7b5b\u9009"}{advancedFilterCount > 0 ? ` ${advancedFilterCount}` : ""}
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div className={advancedFiltersOpen ? "filter-dropdown-panel" : "filter-dropdown-panel is-collapsed"}>
            <label
              className="compact-filter-select"
              aria-label="source filters"
              title={`来源：${sourceOptions.find((option) => option.key === sourceFilter)?.label ?? "全部来源"}`}
            >
              <Globe2 size={16} aria-hidden="true" />
              {sourceFilter !== "all" ? <span>{sourceOptions.find((option) => option.key === sourceFilter)?.label}</span> : null}
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilterKey)}>
                {sourceOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="compact-filter-select"
              aria-label="score filters"
              title={`热度：${scoreOptions.find((option) => option.key === scoreFilter)?.label ?? "全部热度"}`}
            >
              <Zap size={16} aria-hidden="true" />
              {scoreFilter !== "all" ? <span>{scoreOptions.find((option) => option.key === scoreFilter)?.label}</span> : null}
              <select value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value as ThresholdKey)}>
                {scoreOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="compact-filter-select"
              aria-label="confidence filters"
              title={`置信：${confidenceOptions.find((option) => option.key === confidenceFilter)?.label ?? "全部置信"}`}
            >
              <BadgeCheck size={16} aria-hidden="true" />
              {confidenceFilter !== "all" ? (
                <span>{confidenceOptions.find((option) => option.key === confidenceFilter)?.label}</span>
              ) : null}
              <select
                value={confidenceFilter}
                onChange={(event) => setConfidenceFilter(event.target.value as ThresholdKey)}
              >
                {confidenceOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="compact-filter-select"
              aria-label="topic limit"
              title={`展示：${topicLimitOptions.find((option) => option.key === topicLimit)?.label ?? "30条"}`}
            >
              <Eye size={16} aria-hidden="true" />
              <span>{topicLimitOptions.find((option) => option.key === topicLimit)?.label}</span>
              <select value={topicLimit} onChange={(event) => setTopicLimit(Number(event.target.value) as TopicLimit)}>
                {topicLimitOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="date-filter" aria-label="news date filters">
          <div className="date-filter__range" role="group" aria-label="news date range">
          {expandedDatePresets.map((preset) => (
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
        <div className="filter-dock__meta" aria-live="polite">
          <span>{filterSummary}</span>
          {filterError ? <strong>{filterError}</strong> : null}
        </div>
      </section>

      <section className="dashboard">
        <aside className="source-rail" aria-label="source coverage">
          <div className="panel-title">
            <Activity size={18} />
            <span>来源覆盖</span>
          </div>
          <SourceMeter
            label="官方与原始来源"
            value={sourceCoverage.official}
            note={sourceCoverage.total === 0 ? "暂无数据" : "优先作为事实锚点"}
          />
          <SourceMeter
            label="搜索发现"
            value={sourceCoverage.search}
            note={sourceCoverage.total === 0 ? "暂无数据" : "用于发现和交叉验证"}
          />
          <SourceMeter
            label="社交信号"
            value={sourceCoverage.social}
            note={sourceCoverage.total === 0 ? "暂无数据" : "只作为早期趋势"}
          />
          <button
            className="source-rail__summary"
            type="button"
            aria-label="打开采集配置"
            onClick={() => openConfigDrawer()}
          >
            {configSummary}
          </button>
        </aside>

        <section className="topic-stack" aria-label="hot topics">
          {visibleTopics.length === 0 ? (
            <div className="empty-state">
              {!analysisConfigured ? (
                <>
                  <strong>未配置 OpenRouter，暂无法分析与翻译</strong>
                  <span>配置 OPENROUTER_API_KEY 后，采集到的线索会自动概括、翻译为中文并打分展示。</span>
                </>
              ) : pendingRawItems > 0 ? (
                <>
                  <strong>已采集 {pendingRawItems} 条线索，正在分析翻译…</strong>
                  <span>采集后自动进入 AI 分析与中文翻译队列，完成后在此展示为卡片。</span>
                </>
              ) : (
                <>
                  <strong>当前筛选范围暂无新闻</strong>
                  <span>可放宽日期范围，或等待下一次自动更新。</span>
                </>
              )}
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
                    <small>热度</small>
                  </div>
                </div>

                <div className="topic__body">
                  <p className="topic__summary">{topic.summary}</p>
                  <p className="topic__why">{topic.why}</p>
                </div>

                <div className="topic__meta">
                  <span>{topic.category}</span>
                  <span>{topic.sourceCount} 个来源</span>
                  <span className="topic__cred">可信度 {topic.confidence}%</span>
                  <span>{topic.dateLabel}</span>
                </div>

                {topic.engagement ? (
                  <div className="topic__engagement" aria-label="x engagement">
                    <span className="topic__engagement-badge">X</span>
                    {topic.engagement.author ? (
                      <a
                        className="topic__engagement-author"
                        href={`https://x.com/${topic.engagement.author}`}
                        rel="noreferrer"
                        target="_blank"
                        title={`@${topic.engagement.author}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <AtSign size={13} />{topic.engagement.author}
                      </a>
                    ) : null}
                    {topic.engagement.views != null ? (
                      <span title="浏览量"><Eye size={13} />{formatCount(topic.engagement.views)}</span>
                    ) : null}
                    {topic.engagement.replies != null ? (
                      <span title="评论数"><MessageCircle size={13} />{formatCount(topic.engagement.replies)}</span>
                    ) : null}
                    {topic.engagement.likes != null ? (
                      <span title="点赞数"><Heart size={13} />{formatCount(topic.engagement.likes)}</span>
                    ) : null}
                    {topic.engagement.retweets != null ? (
                      <span title="转发数"><Repeat2 size={13} />{formatCount(topic.engagement.retweets)}</span>
                    ) : null}
                  </div>
                ) : null}

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
          <div className="audit-panel__pipeline">
            <button
              className={`audit-panel__summary ${pipelineExpanded ? "is-expanded" : ""}`}
              type="button"
              aria-expanded={pipelineExpanded}
              aria-controls="audit-pipeline-details"
              onClick={() => setPipelineExpanded((expanded) => !expanded)}
            >
              <ChevronDown className="audit-panel__chevron" size={14} aria-hidden="true" />
              <span className="audit-panel__summary-text">{pipelineSummary}</span>
              <span className="audit-panel__summary-action">运行详情</span>
            </button>
            {pipelineExpanded ? (
              <div className="audit-panel__details" id="audit-pipeline-details">
                <DataFlowPanel details={runDetails} />
                <ol>
                  <li>新闻日期优先使用原文发布日期，没有发布日期时使用抓取时间。</li>
                  <li>AI 分析在采集后自动执行，不需要用户悬浮或点击。</li>
                  <li>卡片摘要来自 AI 热点结果；未分析线索使用原始摘要和正文截断。</li>
                  <li>同一来源同一 URL 已存在时会去重，不会重复入库。</li>
                </ol>
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      {configDrawerOpen ? (
        <div
          className="config-drawer"
          id="collect-config-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="config-drawer-title"
        >
          <button
            className="config-drawer__backdrop"
            type="button"
            aria-label="关闭采集配置"
            onClick={closeConfigDrawer}
          />
          <div className="config-drawer__panel">
            <header className="config-drawer__header">
              <div>
                <p className="eyebrow">COLLECT CONFIG</p>
                <h2 id="config-drawer-title">采集配置</h2>
              </div>
              <button
                className="config-drawer__close"
                type="button"
                aria-label="关闭"
                onClick={closeConfigDrawer}
              >
                <X size={18} />
              </button>
            </header>

            <div className="config-drawer__tabs" role="tablist" aria-label="采集配置分类">
              <button
                className={configTab === "keywords" ? "is-active" : ""}
                role="tab"
                type="button"
                aria-selected={configTab === "keywords"}
                onClick={() => setConfigTab("keywords")}
              >
                关键词
              </button>
              <button
                className={configTab === "kol" ? "is-active" : ""}
                role="tab"
                type="button"
                aria-selected={configTab === "kol"}
                onClick={() => setConfigTab("kol")}
              >
                关注账号
              </button>
              <button
                className={configTab === "email" ? "is-active" : ""}
                role="tab"
                type="button"
                aria-selected={configTab === "email"}
                onClick={() => setConfigTab("email")}
              >
                邮件
              </button>
            </div>

            <div className="config-drawer__body">
              {configTab === "keywords" ? (
                <div role="tabpanel" aria-label="关键词">
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
                        <div
                          className={keyword.enabled ? "keyword-item is-enabled" : "keyword-item"}
                          key={keyword.id}
                        >
                          <button
                            className="keyword-chip"
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
                          <button
                            className="keyword-item__delete"
                            type="button"
                            aria-label={`删除 ${keyword.keyword}`}
                            disabled={pendingKeywordIds.includes(keyword.id)}
                            onClick={() => void deleteWatchKeyword(keyword)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {configTab === "kol" ? (
                <div className="kol-box" aria-label="kol whitelist" role="tabpanel">
                  <div className="kol-box__head">
                    <Users size={16} />
                    <span>关注账号 · X KOL</span>
                  </div>
                  <form className="kol-form" onSubmit={addKolAccount}>
                    <input
                      aria-label="KOL handle"
                      maxLength={40}
                      onChange={(event) => setKolHandleInput(event.target.value)}
                      placeholder="@handle 如 sama"
                      value={kolHandleInput}
                    />
                    <select
                      aria-label="KOL 层级"
                      value={kolTierInput}
                      onChange={(event) => setKolTierInput(Number(event.target.value) === 1 ? 1 : 2)}
                    >
                      <option value={1}>官方</option>
                      <option value={2}>大V</option>
                    </select>
                    <button type="submit">添加</button>
                  </form>
                  <div className="kol-list">
                    {!kolLoaded ? (
                      <span className="keyword-empty">正在读取关注账号</span>
                    ) : kolAccounts.length === 0 ? (
                      <span className="keyword-empty">暂无关注账号</span>
                    ) : (
                      kolAccounts.map((account) => (
                        <div
                          className={account.enabled ? "kol-item is-enabled" : "kol-item"}
                          key={account.id}
                        >
                          <button
                            className="kol-item__main"
                            type="button"
                            aria-pressed={account.enabled}
                            disabled={pendingKolIds.includes(account.id)}
                            onClick={() => void toggleKolAccount(account)}
                            title={account.enabled ? "点击停用" : "点击启用"}
                          >
                            <span className={account.tier === 1 ? "kol-tier kol-tier--official" : "kol-tier"}>
                              {account.tier === 1 ? "官方" : "大V"}
                            </span>
                            <span className="kol-item__handle">@{account.handle}</span>
                            <strong>{account.enabled ? "启用" : "停用"}</strong>
                          </button>
                          <button
                            className="kol-item__delete"
                            type="button"
                            aria-label={`删除 ${account.handle}`}
                            disabled={pendingKolIds.includes(account.id)}
                            onClick={() => void deleteKolAccount(account)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {configTab === "email" ? (
                <div className="email-box" aria-label="email digest" role="tabpanel">
                  <div className="email-box__head">
                    <Mail size={16} />
                    <span>邮件日报</span>
                    <em className={emailConfigured ? "email-box__dot is-on" : "email-box__dot"} aria-hidden="true" />
                  </div>
                  <p className="email-box__status">{emailStatus}</p>
                  <p className="email-box__meta">
                    {emailConfigured
                      ? `收件人 ${emailRecipient ?? "—"} · 待发送 ${unsentTopicCount} 条`
                      : "在环境变量填写 SMTP 配置后启用，未发送过的热点不会重复推送。"}
                  </p>
                  <button
                    className="email-box__send"
                    type="button"
                    disabled={isSendingEmail || !emailConfigured}
                    onClick={() => void sendEmailDigest()}
                  >
                    <Send size={14} />
                    {isSendingEmail ? "发送中" : "发送热点日报"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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
    engagement: pickTopEngagement(topic.sources),
    totalViews: sumSourceMetric(topic.sources, "viewCount"),
    totalReplies: sumSourceMetric(topic.sources, "replyCount"),
    dateLabel: formatDateLabel(dateValue),
    dateValue
  };
}

/** Aggregate a numeric engagement metric across all sources for sorting. */
function sumSourceMetric(
  sources: HotTopicApiItem["sources"],
  key: "viewCount" | "replyCount"
) {
  return sources.reduce((total, source) => total + (source[key] ?? 0), 0);
}

/** Engagement of the most-liked tweet source, for the card's metric chips. */
function pickTopEngagement(sources: HotTopicApiItem["sources"]): TopicEngagement | null {
  const tweets = sources.filter(
    (source) => source.sourceType === "TWITTER" && (source.viewCount != null || source.likeCount != null)
  );
  if (tweets.length === 0) {
    return null;
  }

  const top = tweets.reduce((best, current) =>
    (current.likeCount ?? 0) > (best.likeCount ?? 0) ? current : best
  );
  return {
    author: top.author,
    views: top.viewCount,
    likes: top.likeCount,
    replies: top.replyCount,
    retweets: top.retweetCount
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

function buildTopicsQuery(
  preset: DatePreset,
  search: string,
  status: FilterKey,
  sort: SortKey,
  source: SourceFilterKey,
  score: ThresholdKey,
  confidence: ThresholdKey,
  limit: TopicLimit
) {
  const params = new URLSearchParams();

  if (preset !== "all") {
    const now = new Date();
    const start = new Date(now);
    const daysByPreset: Record<Exclude<DatePreset, "all">, number> = {
      "1d": 0,
      "7d": 6,
      "30d": 29
    };
    start.setDate(now.getDate() - daysByPreset[preset]);
    params.set("startDate", toDateInputValue(start));
    params.set("endDate", toDateInputValue(now));
  }

  if (search) {
    params.set("q", search);
  }
  if (status !== "all") {
    params.set("status", status);
  }
  if (source !== "all") {
    params.set("source", source);
  }
  if (sort !== "time") {
    params.set("sort", sort);
  }
  if (score !== "all") {
    params.set("minScore", score);
  }
  if (confidence !== "all") {
    params.set("minConfidence", confidence);
  }
  if (limit !== 30) {
    params.set("limit", String(limit));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function getNextScheduledRefresh(date: Date) {
  const next = new Date(date);
  next.setSeconds(0, 0);

  if (next.getMinutes() < 30) {
    next.setMinutes(30);
    return next;
  }

  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next;
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
    return "即将更新";
  }

  return `将于 ${minutes} 分钟后更新`;
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

function formatFilterSummary(data: AnalyzeApiResponse) {
  const filters = data.filters;
  const total = data.totalTopics ?? data.topics.length;
  const returned = filters?.returnedTopics ?? data.topics.length;
  const sourceText = getOptionLabel(sourceOptions, filters?.source ?? "all");
  const sortText = getOptionLabel(expandedSortOptions, filters?.sort ?? "time");
  const scoreText = filters?.minScore ? `热度 ${filters.minScore}+` : "全部热度";
  const confidenceText = filters?.minConfidence ? `置信 ${filters.minConfidence}+` : "全部置信";
  const dateText = filters?.dateRangeApplied ? "当前时间范围" : "全部时间";
  return `命中 ${total} 条，展示 ${returned} 条 · ${dateText} · ${sourceText} · ${scoreText} · ${confidenceText} · 按${sortText}排序`;
}

function getOptionLabel<T extends string | number>(options: Array<{ key: T; label: string }>, key: T) {
  return options.find((option) => option.key === key)?.label ?? String(key);
}

function formatFilterIssues(data: AnalyzeApiResponse) {
  const issues = data.filters?.issues ?? [];
  if (issues.length === 0) {
    return "";
  }
  return issues.map((issue) => `${issue.field}=${issue.value}: ${issue.reason}`).join(" | ");
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

/** Case-insensitive keyword match across a topic's text and source metadata. */
function matchesSearch(topic: Topic, query: string) {
  const haystack = [
    topic.title,
    topic.summary,
    topic.why,
    topic.category,
    ...topic.sources.map((source) => source.sourceName ?? ""),
    ...topic.sources.map((source) => source.title ?? ""),
    ...topic.sources.map((source) => source.author ?? "")
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
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

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${value}`;
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
        <span style={{ width: `${value}%` }} aria-hidden="true" />
      </div>
      <small>{note}</small>
    </div>
  );
}

function DataFlowPanel({ details }: { details: CollectRunDetails | null }) {
  if (!details) {
    return (
      <section className="data-flow">
        <div className="data-flow__head">
          <span>数据流转</span>
          <strong>暂无运行记录</strong>
        </div>
        <p className="data-flow__empty">启动一次采集后，这里会展示搜索、证据、AI 分析和热点产出的链路。</p>
      </section>
    );
  }

  const visibleEvents = details.events.filter((event) => event.level !== "DEBUG").slice(-8).reverse();
  const queryLabels = Array.from(
    new Set(details.rawItems.map((item) => item.query || item.keyword).filter((value): value is string => Boolean(value)))
  ).slice(0, 4);
  const providerText = formatCountMap(details.evidenceSummary.providerCounts);
  const credibilityText = formatCountMap(details.evidenceSummary.credibilityCounts, formatCredibilityLevel);

  return (
    <section className="data-flow">
      <div className="data-flow__head">
        <span>数据流转</span>
        <strong>{formatCollectRunStatus(details.run)}</strong>
      </div>

      <div className="data-flow__metrics">
        <span>证据 {details.evidenceSummary.rawItemCount}</span>
        <span>AI采用 {details.evidenceSummary.adoptedCount}</span>
        <span>摘要降级 {details.evidenceSummary.snippetOnlyCount}</span>
        <span>热点 {details.hotTopics.length}</span>
      </div>

      <div className="data-flow__block">
        <small>搜索路径</small>
        <p>{queryLabels.length > 0 ? queryLabels.join(" / ") : "本轮暂无可展示查询"}</p>
        <em>{providerText || "暂无 provider 统计"}</em>
      </div>

      <div className="data-flow__block">
        <small>证据质量</small>
        <p>{credibilityText || "暂无可信度统计"}</p>
        <div className="data-flow__evidence">
          {details.rawItems.slice(0, 5).map((item) => (
            <a href={item.url} key={item.id} rel="noreferrer" target="_blank" title={item.title}>
              <span>{item.adoptedByAi ? "已采用" : item.status === "NEW" ? "待分析" : "未采用"}</span>
              <strong>{trimText(item.title, 48)}</strong>
              <em>{formatCredibilityLevel(item.credibilityLevel)} · {item.provider || formatSourceType(item.sourceType)}</em>
            </a>
          ))}
        </div>
      </div>

      <div className="data-flow__block">
        <small>AI 产出</small>
        {details.hotTopics.length === 0 ? (
          <p>本轮尚未生成热点，AI 分析记录 {details.aiAnalyses.length} 条。</p>
        ) : (
          <div className="data-flow__topics">
            {details.hotTopics.slice(0, 4).map((topic) => (
              <div key={topic.id}>
                <strong>{trimText(topic.title, 50)}</strong>
                <span>热度 {topic.hotScore} · 可信 {topic.confidence}% · 来源 {topic.sources.length}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="data-flow__block">
        <small>关键事件</small>
        <div className="data-flow__events">
          {visibleEvents.length === 0 ? (
            <p>暂无关键事件</p>
          ) : (
            visibleEvents.map((event) => (
              <div className={`data-flow__event data-flow__event--${event.level.toLowerCase()}`} key={event.id}>
                <span>{event.level}</span>
                <p>{event.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function formatCountMap(counts: Record<string, number>, formatKey: (key: string) => string = (key) => key) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${formatKey(key)} ${count}`)
    .join(" / ");
}

function formatCredibilityLevel(value: string) {
  const map: Record<string, string> = {
    OFFICIAL: "官方",
    PRIMARY: "一手",
    MEDIA: "媒体",
    SOCIAL_VERIFIED: "认证社交",
    SOCIAL: "社交",
    SEARCH_SNIPPET: "搜索摘要"
  };
  return map[value] ?? value;
}

