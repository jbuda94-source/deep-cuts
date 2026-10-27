import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Temporary diagnostics: checks which public music databases respond from Vercel.
const UA = "RabbitHole/1.0 ( jbuda94-source/deep-cuts on GitHub )";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const url = u.searchParams.get("url");
  const allowed = /^https:\/\/(musicbrainz\.org|labs\.api\.listenbrainz\.org|api\.listenbrainz\.org|api\.deezer\.com|cdnt-preview\.dzcdn\.net)\//;
  if (!url || !allowed.test(url)) return NextResponse.json({ error: "url not allowed" }, { status: 400 });
  const method = u.searchParams.get("method") || "GET";
  const body = u.searchParams.get("body");
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": UA, ...(body ? { "content-type": "application/json" } : {}) },
      body: body || undefined,
    });
    const ct = res.headers.get("content-type") || "";
    const text = ct.includes("audio") ? `[audio ${(await res.arrayBuffer()).byteLength} bytes]` : (await res.text()).slice(0, 6000);
    return NextResponse.json({ status: res.status, ct, ms: Date.now() - t0, text });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
