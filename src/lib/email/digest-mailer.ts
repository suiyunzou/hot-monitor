import nodemailer from "nodemailer";
import { prisma } from "@/lib/db/prisma";

export type EmailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
};

export type DigestTopic = {
  id: string;
  title: string;
  summary: string;
  whyItMatters: string | null;
  category: string;
  hotScore: number;
  confidence: number;
  status: string;
  dateLabel: string;
  sources: Array<{ title: string; url: string; sourceName: string }>;
};

export type SendDigestResult =
  | { configured: false; sent: false; reason: "EMAIL_NOT_CONFIGURED" }
  | { configured: true; sent: false; reason: "NO_NEW_TOPICS"; recipient: string }
  | {
      configured: true;
      sent: false;
      reason: "SEND_FAILED";
      error: string;
      digestId: string;
      recipient: string;
    }
  | {
      configured: true;
      sent: true;
      digestId: string;
      subject: string;
      recipient: string;
      topicCount: number;
      messageId?: string;
    };

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "已确认",
  MULTI_SOURCE_SIGNAL: "多源线索",
  SOCIAL_BUZZ: "社交热议",
  NEEDS_VERIFICATION: "待核验"
};

/**
 * Read SMTP settings from the environment. Returns null when any required value
 * is missing so callers can degrade to a "未配置" state instead of throwing.
 */
export function getEmailConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = (process.env.MAIL_FROM || process.env.SMTP_USER)?.trim();
  const to = process.env.MAIL_TO?.trim();
  const parsedPort = Number.parseInt(process.env.SMTP_PORT || "587", 10);

  if (!host || !user || !pass || !from || !to) {
    return null;
  }

  return {
    host,
    port: Number.isNaN(parsedPort) ? 587 : parsedPort,
    user,
    pass,
    from,
    to
  };
}

export function isEmailConfigured(): boolean {
  return getEmailConfig() !== null;
}

/**
 * Hot topics that have never been part of a successfully sent digest.
 * A topic counts as "already pushed" only when it belongs to an EmailDigest
 * with status SUCCESS, so failed attempts stay eligible for retry.
 */
export async function findUnsentTopics(limit: number): Promise<DigestTopic[]> {
  const topics = await prisma.hotTopic.findMany({
    where: {
      emailItems: {
        none: {
          digest: {
            status: "SUCCESS"
          }
        }
      }
    },
    orderBy: [{ hotScore: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      sources: {
        include: {
          rawItem: {
            select: {
              title: true,
              url: true,
              publishedAt: true,
              fetchedAt: true,
              source: { select: { name: true } }
            }
          }
        }
      }
    }
  });

  return topics.map((topic) => {
    const firstSource = topic.sources[0]?.rawItem;
    const dateValue = firstSource?.publishedAt ?? firstSource?.fetchedAt ?? topic.createdAt;

    return {
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      whyItMatters: topic.whyItMatters,
      category: topic.category,
      hotScore: topic.hotScore,
      confidence: topic.confidence,
      status: topic.status,
      dateLabel: formatDateLabel(dateValue),
      sources: topic.sources.map((link) => ({
        title: link.rawItem.title,
        url: link.rawItem.url,
        sourceName: link.rawItem.source.name
      }))
    };
  });
}

export async function countUnsentTopics(): Promise<number> {
  return prisma.hotTopic.count({
    where: {
      emailItems: {
        none: {
          digest: {
            status: "SUCCESS"
          }
        }
      }
    }
  });
}

/**
 * Build and send a digest of new hot topics. Persists an EmailDigest record up
 * front (status SENDING) so its linked topics are tracked even if the SMTP send
 * fails, then flips the record to SUCCESS or FAILED.
 */
export async function sendHotTopicDigest(
  options: { limit?: number; force?: boolean } = {}
): Promise<SendDigestResult> {
  const config = getEmailConfig();
  if (!config) {
    return { configured: false, sent: false, reason: "EMAIL_NOT_CONFIGURED" };
  }

  const limit = options.limit ?? 10;
  const topics = await findUnsentTopics(limit);

  if (topics.length === 0 && !options.force) {
    return { configured: true, sent: false, reason: "NO_NEW_TOPICS", recipient: config.to };
  }

  const subject = buildSubject(topics.length);
  const digest = await prisma.emailDigest.create({
    data: {
      subject,
      recipient: config.to,
      status: "SENDING",
      items: {
        create: topics.map((topic) => ({ topicId: topic.id }))
      }
    }
  });

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass }
    });

    const info = await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text: renderDigestText(topics),
      html: renderDigestHtml(topics)
    });

    await prisma.emailDigest.update({
      where: { id: digest.id },
      data: { status: "SUCCESS", sentAt: new Date() }
    });

    return {
      configured: true,
      sent: true,
      digestId: digest.id,
      subject,
      recipient: config.to,
      topicCount: topics.length,
      messageId: info.messageId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.emailDigest.update({
      where: { id: digest.id },
      data: { status: "FAILED", errorMessage: message }
    });

    return {
      configured: true,
      sent: false,
      reason: "SEND_FAILED",
      error: message,
      digestId: digest.id,
      recipient: config.to
    };
  }
}

function buildSubject(count: number) {
  const today = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  if (count === 0) {
    return `AI 热点日报 · ${today}`;
  }
  return `AI 热点日报 · ${count} 条新增 · ${today}`;
}

export function renderDigestHtml(topics: DigestTopic[]): string {
  const cards = topics.length === 0 ? renderEmptyCard() : topics.map(renderTopicCard).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f6f7f4;font-family:'Segoe UI','Microsoft YaHei',sans-serif;color:#182029;">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">
    <div style="border:1px solid rgba(23,32,26,0.12);border-radius:16px;background:linear-gradient(135deg,#ffffff,#ece5d7);padding:22px 24px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;color:#c44f35;font-weight:700;">AI HOT MONITOR / DAILY DIGEST</p>
      <h1 style="margin:0;font-size:26px;line-height:1.1;">AI 情报雷达 · 热点日报</h1>
      <p style="margin:10px 0 0;color:#66707c;font-size:14px;">本期共 ${topics.length} 条新增热点，均来自真实采集来源，请结合来源链接核验。</p>
    </div>
    ${cards}
    <p style="margin:24px 4px 0;color:#9aa3ad;font-size:12px;line-height:1.6;">本邮件由 AI 情报雷达自动生成。新闻事实来自原始来源，AI 仅负责摘要、评分与分类。已推送过的热点不会重复发送。</p>
  </div>
</body>
</html>`;
}

function renderTopicCard(topic: DigestTopic): string {
  const statusLabel = STATUS_LABEL[topic.status] ?? topic.status;
  const sources = topic.sources
    .slice(0, 5)
    .map(
      (source) =>
        `<a href="${escapeHtml(source.url)}" style="display:inline-block;margin:0 8px 6px 0;padding:5px 9px;border:1px solid rgba(23,32,26,0.16);border-radius:999px;color:#182029;text-decoration:none;font-size:12px;">${escapeHtml(
          source.sourceName || hostOf(source.url) || "来源"
        )}</a>`
    )
    .join("");

  return `<div style="border:1px solid rgba(23,32,26,0.12);border-left:5px solid #c44f35;border-radius:14px;background:#ffffff;padding:18px 20px;margin-bottom:14px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
      <td style="vertical-align:top;">
        <span style="display:inline-block;font-size:12px;color:#c44f35;font-weight:700;">${escapeHtml(statusLabel)}</span>
        <h2 style="margin:6px 0 0;font-size:19px;line-height:1.25;">${escapeHtml(topic.title)}</h2>
      </td>
      <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
        <span style="display:inline-block;min-width:46px;padding:6px 0;border-radius:8px;background:#182029;color:#fff;font-size:18px;font-weight:800;text-align:center;">${topic.hotScore}</span>
        <div style="font-size:10px;color:#9aa3ad;margin-top:2px;">HOT</div>
      </td>
    </tr></table>
    <p style="margin:12px 0 0;font-size:14px;line-height:1.6;">${escapeHtml(topic.summary)}</p>
    ${topic.whyItMatters ? `<p style="margin:8px 0 0;color:#66707c;font-size:13px;line-height:1.6;">为什么重要：${escapeHtml(topic.whyItMatters)}</p>` : ""}
    <p style="margin:12px 0 6px;color:#9aa3ad;font-size:12px;">${escapeHtml(topic.category)} · 可信度 ${topic.confidence}% · ${escapeHtml(topic.dateLabel)}</p>
    <div>${sources}</div>
  </div>`;
}

function renderEmptyCard(): string {
  return `<div style="border:1px dashed rgba(23,32,26,0.2);border-radius:14px;background:#ffffff;padding:24px;text-align:center;color:#66707c;">
    暂无新增热点。下次采集分析产生新热点后会自动纳入日报。
  </div>`;
}

function renderDigestText(topics: DigestTopic[]): string {
  if (topics.length === 0) {
    return "AI 情报雷达 · 热点日报\n\n暂无新增热点。";
  }

  const lines = topics.map((topic, index) => {
    const statusLabel = STATUS_LABEL[topic.status] ?? topic.status;
    const sources = topic.sources
      .slice(0, 5)
      .map((source) => `  - ${source.sourceName || hostOf(source.url) || "来源"}: ${source.url}`)
      .join("\n");
    return [
      `${index + 1}. [${statusLabel} · HOT ${topic.hotScore}] ${topic.title}`,
      `   ${topic.summary}`,
      topic.whyItMatters ? `   为什么重要：${topic.whyItMatters}` : "",
      `   ${topic.category} · 可信度 ${topic.confidence}% · ${topic.dateLabel}`,
      sources
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `AI 情报雷达 · 热点日报（${topics.length} 条新增）\n\n${lines.join("\n\n")}`;
}

function formatDateLabel(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    return "未知日期";
  }
  return value.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
