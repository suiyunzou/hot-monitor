/**
 * 轻量结构化日志工具，输出到 Node.js 进程标准输出。
 * 格式：[HH:mm:ss] [CONTEXT] LEVEL  message  (可选数据)
 */

import { prisma } from "@/lib/db/prisma";

type LogLevel = "info" | "warn" | "error" | "debug";

export type CollectRunEventInput = {
  runId: string;
  level: LogLevel;
  phase: string;
  eventType: string;
  message: string;
  details?: unknown;
};

const ICONS: Record<LogLevel, string> = {
  info: "✓",
  warn: "⚠",
  error: "✗",
  debug: "·"
};

const LABELS: Record<LogLevel, string> = {
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  debug: "DEBUG"
};

function timestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function emit(level: LogLevel, context: string, message: string, data?: unknown): void {
  const icon = ICONS[level];
  const label = LABELS[level];
  const prefix = `[${timestamp()}] [${label}] [${context}]`;
  const line = `${prefix} ${icon} ${message}`;

  if (data === undefined) {
    console.log(line);
  } else if (data instanceof Error) {
    console.log(line, `\n  ${data.message}`);
  } else if (typeof data === "object") {
    console.log(line, JSON.stringify(data, null, 0));
  } else {
    console.log(line, data);
  }
}

export async function recordCollectRunEvent(input: CollectRunEventInput): Promise<void> {
  try {
    await (prisma as any).collectRunEvent.create({
      data: {
        runId: input.runId,
        level: input.level.toUpperCase(),
        phase: input.phase,
        eventType: input.eventType,
        message: input.message,
        detailsJson: input.details === undefined ? undefined : JSON.stringify(input.details)
      }
    });
  } catch (error) {
    emit("warn", "logger", `运行事件写入失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function emitRunEvent(
  level: LogLevel,
  defaultContext: string,
  input: Omit<CollectRunEventInput, "level" | "phase"> & { phase?: string }
): Promise<void> {
  emit(level, defaultContext, input.message);
  return recordCollectRunEvent({
    runId: input.runId,
    level,
    phase: input.phase ?? defaultContext,
    eventType: input.eventType,
    message: input.message,
    details: input.details
  });
}

function createLogger(defaultContext: string) {
  return {
    info: (message: string, data?: unknown) => emit("info", defaultContext, message, data),
    warn: (message: string, data?: unknown) => emit("warn", defaultContext, message, data),
    error: (message: string, data?: unknown) => emit("error", defaultContext, message, data),
    debug: (message: string, data?: unknown) => emit("debug", defaultContext, message, data),
    event: (input: Omit<CollectRunEventInput, "phase"> & { phase?: string }) =>
      emitRunEvent(input.level, defaultContext, input),
    runInfo: (input: Omit<CollectRunEventInput, "level" | "phase"> & { phase?: string }) =>
      emitRunEvent("info", defaultContext, input),
    runWarn: (input: Omit<CollectRunEventInput, "level" | "phase"> & { phase?: string }) =>
      emitRunEvent("warn", defaultContext, input),
    runError: (input: Omit<CollectRunEventInput, "level" | "phase"> & { phase?: string }) =>
      emitRunEvent("error", defaultContext, input),
    runDebug: (input: Omit<CollectRunEventInput, "level" | "phase"> & { phase?: string }) =>
      emitRunEvent("debug", defaultContext, input),
    /** 输出一条带装饰的分隔标题行，便于在日志流中标记阶段边界 */
    section: (title: string) => {
      const bar = "─".repeat(Math.max(0, 60 - title.length));
      console.log(`\n[${timestamp()}] ── ${title} ${bar}`);
    },
    runSection: (runId: string, title: string, details?: unknown) => {
      const bar = "─".repeat(Math.max(0, 60 - title.length));
      console.log(`\n[${timestamp()}] ── ${title} ${bar}`);
      return recordCollectRunEvent({
        runId,
        level: "info",
        phase: defaultContext,
        eventType: "phase",
        message: title,
        details
      });
    }
  };
}

/** 通用根 logger，直接调用时 context 为 "app" */
export const log = createLogger("app");

/** 按模块名创建带固定 context 前缀的 logger */
export function makeLogger(context: string) {
  return createLogger(context);
}
