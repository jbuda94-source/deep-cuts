// Turns whatever the user typed (Spotify link, YouTube link, or plain text)
// into a search string we can hand to Deezer and Claude.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function meta(html: string, prop: string) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i"
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeEntities(m[1]) : "";
}

// Strips the junk YouTube titles carry: (Official Video), [HD], | Label, etc.
function cleanYouTubeTitle(t: string) {
  return t
    .replace(/\(([^)]*(official|video|audio|lyric|visuali[sz]er|hd|4k|remaster)[^)]*)\)/gi, "")
    .replace(/\[([^\]]*(official|video|audio|lyric|visuali[sz]er|hd|4k|premiere)[^\]]*)\]/gi, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Seed = { query: string; source: "spotify" | "youtube" | "text"; raw: string };

async function fromSpotify(url: string): Promise<string | null> {
  // The track page has og:title = track and og:description = "Artist · Album · Song · Year"
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (res.ok) {
      const html = await res.text();
      const title = meta(html, "og:title");
      // <title>Song - song and lyrics by Artist | Spotify</title>
      const tag = decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1] || "");
      const byTag = tag.match(/song(?: and lyrics)? by (.+?)\s*\|\s*Spotify/i)?.[1];
      if (title && byTag) return `${byTag.split(",")[0].trim()} - ${title}`;
      // og:description: "Listen to X on Spotify. Artist · Song · 1987" or "Artist · Album · Song · 1987"
      const desc = meta(html, "og:description").replace(/^Listen to .*? on Spotify\.\s*/i, "");
      const artist = desc.split("·")[0]?.trim();
      if (title && artist && !/spotify|^song$/i.test(artist)) return `${artist} - ${title}`;
    }
  } catch {}
  // The embed page carries the artist list in its JSON payload.
  try {
    const id = url.match(/track\/([A-Za-z0-9]+)/)?.[1];
    if (id) {
      const res = await fetch(`https://open.spotify.com/embed/track/${id}`, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const html = await res.text();
        const name = html.match(/"name":"([^"]+)","uri":"spotify:track:/)?.[1];
        const artist = html.match(/"artists":\[\{"name":"([^"]+)"/)?.[1];
        if (name && artist) return `${artist} - ${name}`;
      }
    }
  } catch {}
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const j = await res.json();
      if (j.title) return j.title as string;
    }
  } catch {}
  return null;
}

async function fromYouTube(url: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (!res.ok) return null;
    const j = await res.json();
    const title = cleanYouTubeTitle(j.title || "");
    const author = String(j.author_name || "").replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "");
    // Most music titles already read "Artist - Track"; if not, prepend the channel.
    if (/\s[-–—]\s/.test(title)) return title;
    return author ? `${author} - ${title}` : title;
  } catch {
    return null;
  }
}

export async function resolveSeed(input: string): Promise<Seed> {
  const raw = input.trim();
  if (/open\.spotify\.com\/(intl-[a-z]+\/)?track\//i.test(raw) || /spotify\.link\//i.test(raw)) {
    const q = await fromSpotify(raw.split("?")[0]);
    if (q) return { query: q, source: "spotify", raw };
    throw new Error("Couldn't read that Spotify link. Try typing the artist and song instead.");
  }
  if (/(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(raw)) {
    const q = await fromYouTube(raw.replace("music.youtube.com", "www.youtube.com"));
    if (q) return { query: q, source: "youtube", raw };
    throw new Error("Couldn't read that YouTube link. Try typing the artist and song instead.");
  }
  if (/open\.spotify\.com\/(album|playlist|artist)/i.test(raw)) {
    throw new Error("That's an album/playlist/artist link — paste a single track link.");
  }
  return { query: raw, source: "text", raw };
}
