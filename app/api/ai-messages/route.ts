import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const GAS_URL = process.env.TASK_APP_GAS_URL;
const GAS_TOKEN = process.env.TASK_APP_GAS_TOKEN;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(request: Request) {
  if (!GAS_URL || !GAS_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: "GAS URL or token is not configured",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit") || "80";

  const url = `${GAS_URL}?action=listAiMessages&limit=${encodeURIComponent(
    limit,
  )}&token=${encodeURIComponent(GAS_TOKEN)}&ts=${Date.now()}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  const text = await res.text();

  try {
    return NextResponse.json(JSON.parse(text), {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid GAS response",
        raw: text,
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(request: Request) {
  if (!GAS_URL || !GAS_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: "GAS URL or token is not configured",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const body = await request.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json(
      {
        ok: false,
        error: "message is required",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const res = await fetch(GAS_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      action: "addAiMessage",
      role: "user",
      message,
      token: GAS_TOKEN,
    }),
  });

  const text = await res.text();

  try {
    return NextResponse.json(JSON.parse(text), {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid GAS response",
        raw: text,
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}