import { NextResponse } from "next/server";

const GAS_URL = process.env.TASK_APP_GAS_URL;
const GAS_TOKEN = process.env.TASK_APP_GAS_TOKEN;

export async function GET() {
  if (!GAS_URL || !GAS_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "GAS URL or token is not configured" },
      { status: 500 },
    );
  }

  const url = `${GAS_URL}?action=listAiMessages&limit=80&token=${encodeURIComponent(
    GAS_TOKEN,
  )}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const text = await res.text();

  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid GAS response", raw: text },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!GAS_URL || !GAS_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "GAS URL or token is not configured" },
      { status: 500 },
    );
  }

  const body = await request.json();

  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "addAiMessage",
      role: "user",
      message: body.message,
      token: GAS_TOKEN,
    }),
  });

  const text = await res.text();

  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid GAS response", raw: text },
      { status: 500 },
    );
  }
}