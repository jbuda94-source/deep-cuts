# Deep Cuts

Paste a Spotify or YouTube link (or type `Artist - Song`) and get 10 tracks with the same feel that a streaming algorithm won't surface.

**How it works**
1. Reads the seed from the link (Spotify page metadata / YouTube oEmbed) or your text.
2. Looks the seed up on Deezer and pulls its "related artists" — the obvious picks — so Claude can steer *around* them.
3. Claude proposes ~28 deep cuts matched on sound (tempo, texture, era, scene).
4. Every pick is checked against Deezer: unknown tracks are flagged, and anything over the popularity ceiling (track rank / artist fan count) for your chosen depth is dropped.
5. You get 10, with 30-sec previews and Spotify/YouTube links. "Dig again" excludes what you've already seen.

**Env vars (Vercel → Settings → Environment Variables)**
- `ANTHROPIC_API_KEY` — required
- `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-5-5`
