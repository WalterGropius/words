/**
 * Mints a short-lived Soniox key for the browser, so the real SONIOX_API_KEY
 * never leaves the server. Each key opens one stream and expires in a minute;
 * an open stream keeps running after its key expires.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const key = process.env.SONIOX_API_KEY;
  if (!key) {
    return Response.json({ error: "SONIOX_API_KEY is not set. Add it to .env.local and restart the server." }, { status: 500 });
  }
  try {
    const res = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 60, single_use: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return Response.json({ error: `Soniox refused the key request (${res.status}). ${detail}` }, { status: 502 });
    }
    const data = (await res.json()) as { api_key: string };
    return Response.json({ apiKey: data.api_key });
  } catch (err) {
    return Response.json({ error: `Could not reach Soniox: ${(err as Error).message}` }, { status: 502 });
  }
}
