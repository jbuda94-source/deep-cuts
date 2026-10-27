import { NextResponse } from "next/server";
import { resolveSeed } from "@/lib/seed";
import { searchSeedMatches } from "@/lib/deezer";

export const runtime = "nodejs";

// GET /api/match?input=<link or text> → possible seed tracks, best guess first,
// each with a 30s preview so the user can confirm the right one by ear.
export async function GET(req: Request) {
  const input = new URL(req.url).searchParams.get("input")?.trim() || "";
  if (!input) return NextResponse.json({ error: "Give me a song." }, { status: 400 });
  try {
    const seed = await resolveSeed(input);
    // A link is a specific track, so fewer alternates are needed.
    const matches = await searchSeedMatches(seed.query, seed.source === "text" ? 6 : 4);
    if (!matches.length) {
      return NextResponse.json(
        { error: `Couldn't find "${seed.query}". Try 'Artist - Song' spelled out.` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      query: seed.query,
      source: seed.source,
      matches: matches.map((t) => ({
        id: t.id,
        artist: t.artist.name,
        title: t.title,
        album: t.album.title,
        cover: t.album.cover_medium,
        preview: t.preview || null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
