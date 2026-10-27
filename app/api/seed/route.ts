import { NextResponse } from "next/server";
import { resolveSeed } from "@/lib/seed";
import { searchSeed, relatedArtists, findTrack } from "@/lib/deezer";

export const runtime = "nodejs";

// Quick health check: shows how an input gets read, without spending a Claude call.
// GET /api/seed?input=<link or text>  (&check=Artist|Title to test the verifier)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const input = u.searchParams.get("input") || "";
  try {
    const seed = await resolveSeed(input);
    const dz = await searchSeed(seed.query);
    const related = dz ? (await relatedArtists(dz.artist.id)).slice(0, 10).map((a) => a.name) : [];
    const check = u.searchParams.get("check");
    let verify = null;
    if (check) {
      const [a, t] = check.split("|");
      const hit = await findTrack(a, t);
      verify = hit ? { artist: hit.artist.name, title: hit.title, rank: hit.rank } : null;
    }
    return NextResponse.json({
      seed,
      deezer: dz ? { artist: dz.artist.name, title: dz.title, rank: dz.rank, preview: !!dz.preview } : null,
      related,
      verify,
      hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
