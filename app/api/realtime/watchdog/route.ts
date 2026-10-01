import { NextResponse } from "next/server";
import { controlWatchdog } from "@/lib/server/sessionWatchdog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token) || (body.action !== "heartbeat" && body.action !== "close")) {
    return NextResponse.json({ error: "Invalid watchdog request." }, { status: 400 });
  }
  const status = controlWatchdog(body.token, body.action);
  if (!status) return NextResponse.json({ error: "Session watchdog unavailable." }, { status: 404 });
  return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
