import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  countUnsentTopics,
  findUnsentTopics,
  isEmailConfigured,
  renderDigestHtml,
  sendHotTopicDigest
} from "@/lib/email/digest-mailer";

export const dynamic = "force-dynamic";

const sendRequestSchema = z.object({
  limit: z.number().int().min(1).max(30).optional(),
  force: z.boolean().optional()
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // ?preview=1 renders the digest HTML for the current unsent topics so the
  // template can be inspected in a browser without actually sending mail.
  if (searchParams.get("preview")) {
    const topics = await findUnsentTopics(10);
    return new NextResponse(renderDigestHtml(topics), {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  const [unsentCount, recentDigests] = await Promise.all([
    countUnsentTopics(),
    prisma.emailDigest.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { _count: { select: { items: true } } }
    })
  ]);

  return NextResponse.json({
    configured: isEmailConfigured(),
    recipient: process.env.MAIL_TO?.trim() || null,
    unsentCount,
    digests: recentDigests.map((digest) => ({
      id: digest.id,
      subject: digest.subject,
      recipient: digest.recipient,
      status: digest.status,
      topicCount: digest._count.items,
      sentAt: digest.sentAt,
      errorMessage: digest.errorMessage,
      createdAt: digest.createdAt
    }))
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = sendRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid email request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await sendHotTopicDigest(parsed.data);

    if (!result.configured) {
      return NextResponse.json(
        { error: "SMTP 未配置，请先在环境变量中填写邮件配置", code: "EMAIL_NOT_CONFIGURED" },
        { status: 409 }
      );
    }

    if (!result.sent && result.reason === "SEND_FAILED") {
      return NextResponse.json(
        { error: result.error, code: "SEND_FAILED", digestId: result.digestId },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
