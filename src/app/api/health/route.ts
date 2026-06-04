import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "ai-hot-monitor",
    phase: "web-mvp",
    defaultModel: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash"
  });
}
