import { NextResponse, type NextRequest } from "next/server";

/**
 * Live speech goes straight from the browser to Soniox over a WebSocket. The
 * long-lived key (SONIOX_KEY) never leaves the server: the browser asks this
 * route for a short-lived, single-use key and connects with that.
 */

export const dynamic = "force-dynamic";

const TEMP_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key";
const NO_STORE = { "Cache-Control": "no-store" };

/** Is live speech available? (Never reveals the key itself.) */
export function GET() {
  return NextResponse.json({ configured: Boolean(process.env.SONIOX_KEY) }, { headers: NO_STORE });
}

/** Mint a temporary key for one real-time transcription stream. */
export async function POST(req: NextRequest) {
  // only this app's own pages may spend the key
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403, headers: NO_STORE });
  }

  const key = process.env.SONIOX_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "SONIOX_KEY is not set on the server. Add it to .env.local and restart." },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const res = await fetch(TEMP_KEY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 60, single_use: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[soniox] temporary key request failed: ${res.status} ${detail}`);
      const hint = res.status === 401 ? " Check that SONIOX_KEY is valid." : res.status === 403 ? " The key needs the Temporary API keys permission." : "";
      return NextResponse.json({ error: `Soniox refused the key request (${res.status}).${hint}` }, { status: 502, headers: NO_STORE });
    }
    const data = (await res.json()) as { api_key?: string; expires_at?: string };
    if (!data.api_key) {
      return NextResponse.json({ error: "Soniox returned no key." }, { status: 502, headers: NO_STORE });
    }
    return NextResponse.json({ api_key: data.api_key, expires_at: data.expires_at }, { headers: NO_STORE });
  } catch (err) {
    console.error("[soniox] could not reach Soniox", err);
    return NextResponse.json({ error: "Could not reach Soniox. Is the venue online?" }, { status: 502, headers: NO_STORE });
  }
}
