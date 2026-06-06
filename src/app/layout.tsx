import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Hot Monitor",
  description: "A verified AI intelligence radar for official news, X signals, and search evidence."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  if (window.__hotMonitorNativeFallback) return;
  window.__hotMonitorNativeFallback = true;

  const isHydrated = () => document.documentElement.dataset.hotMonitorHydrated === "true";
  const collectStatus = () => document.querySelector('[data-status-key="collect"] strong');
  const analyzeStatus = () => document.querySelector('[data-status-key="analyze"] strong');
  const setStatus = (text) => {
    const node = collectStatus();
    if (node) node.textContent = text;
  };
  const setAnalyzeStatus = (text) => {
    const node = analyzeStatus();
    if (node) node.textContent = text;
  };
  const formatClock = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };
  const formatRun = (run) => {
    const startedAt = formatClock(run.startedAt);
    const finishedAt = run.finishedAt ? formatClock(run.finishedAt) : "";
    if (run.status === "RUNNING") return "采集中 / " + startedAt + " 开始";
    if (run.status === "FAILED") return "失败 / " + (finishedAt || startedAt);
    const status = run.status === "PARTIAL_SUCCESS" ? "部分完成" : "完成";
    return status + " / 新增 " + run.newCount + " / " + (finishedAt || startedAt);
  };
  const refreshCollectStatus = async () => {
    const response = await fetch("/api/collect", { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    const latestRun = data.latestRuns && data.latestRuns[0];
    if (!latestRun) {
      setStatus("待命");
      return false;
    }
    setStatus(formatRun(latestRun));
    return latestRun.status === "RUNNING";
  };
  const pollCollectStatus = () => {
    let count = 0;
    const timer = window.setInterval(async () => {
      count += 1;
      try {
        const running = await refreshCollectStatus();
        if (!running || count > 40) {
          window.clearInterval(timer);
          const scanButton = document.querySelector("[data-hot-monitor-scan]");
          if (scanButton) {
            scanButton.disabled = false;
            scanButton.lastChild.textContent = "立即更新";
          }
        }
      } catch {
        window.clearInterval(timer);
        setStatus("状态读取失败");
      }
    }, 2500);
  };

  document.addEventListener("click", async (event) => {
    if (isHydrated()) return;

    const scanButton = event.target.closest && event.target.closest("[data-hot-monitor-scan]");
    if (scanButton) {
      event.preventDefault();
      event.stopPropagation();
      scanButton.disabled = true;
      if (scanButton.lastChild) scanButton.lastChild.textContent = "更新中";
      setStatus("后台更新中");
      try {
        const response = await fetch("/api/collect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ collectors: ["search"], keywordOnly: true, limit: 1, background: true })
        });
        if (!response.ok) throw new Error("collect failed");
        window.setTimeout(() => void refreshCollectStatus(), 900);
        pollCollectStatus();
      } catch {
        scanButton.disabled = false;
        if (scanButton.lastChild) scanButton.lastChild.textContent = "立即更新";
        setStatus("采集失败");
      }
      return;
    }

    const analyzeButton = event.target.closest && event.target.closest("[data-hot-monitor-analyze]");
    if (analyzeButton) {
      event.preventDefault();
      event.stopPropagation();
      analyzeButton.disabled = true;
      if (analyzeButton.lastChild) analyzeButton.lastChild.textContent = "分析中";
      setAnalyzeStatus("分析中");
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 6 })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (result && result.code === "OPENROUTER_NOT_CONFIGURED") {
            setAnalyzeStatus("未配置 OpenRouter");
          } else {
            setAnalyzeStatus((result && result.error) || "AI 分析失败");
          }
          return;
        }
        if (result && result.analyzedCount === 0) {
          setAnalyzeStatus("无新增线索");
        } else {
          setAnalyzeStatus("完成 / 新增热点 " + ((result && result.topicCount) || 0));
        }
      } catch {
        setAnalyzeStatus("AI 分析失败");
      } finally {
        analyzeButton.disabled = false;
        if (analyzeButton.lastChild) analyzeButton.lastChild.textContent = "AI 分析";
      }
      return;
    }

    const keywordButton = event.target.closest && event.target.closest("[data-keyword-id]");
    if (keywordButton) {
      event.preventDefault();
      event.stopPropagation();
      const keywordId = keywordButton.dataset.keywordId;
      const nextEnabled = keywordButton.getAttribute("aria-pressed") !== "true";
      const label = keywordButton.querySelector("strong");
      keywordButton.disabled = true;
      keywordButton.setAttribute("aria-pressed", String(nextEnabled));
      keywordButton.dataset.keywordEnabled = String(nextEnabled);
      keywordButton.classList.toggle("is-enabled", nextEnabled);
      if (label) label.textContent = nextEnabled ? "启用" : "停用";
      try {
        const response = await fetch("/api/watch-keywords/" + encodeURIComponent(keywordId), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled })
        });
        if (!response.ok) throw new Error("keyword update failed");
      } catch {
        const reverted = !nextEnabled;
        keywordButton.setAttribute("aria-pressed", String(reverted));
        keywordButton.dataset.keywordEnabled = String(reverted);
        keywordButton.classList.toggle("is-enabled", reverted);
        if (label) label.textContent = reverted ? "启用" : "停用";
        setStatus("关键词更新失败");
      } finally {
        keywordButton.disabled = false;
      }
    }
  }, true);
})();
`
          }}
        />
      </body>
    </html>
  );
}
