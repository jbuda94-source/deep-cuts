# Deep Cuts

Paste a Spotify or YouTube link (or type `Artist - Song`) and get 10 tracks with the same feel that a streaming algorithm won't surface.

**How it works**
1. Reads the seed from the link (Spotify page metadata / YouTube oEmbed) or your text.
2. Looks the seed up on Deezer and pulls its "related artists" — the obvious picks — so Claude can steer *around* them.
3. Claude proposes ~28 deep cuts matched on sound (tempo, texture, era, scene).
4. Every pick is checked against Deezer: unknown tracks are flagged, and anything over the popularity ceiling (track rank / artist fan count) for your chosen depth is dropped.
5. You get 10, with 30-sec previews and Spotify/YouTube links. "Dig again" excludes what you've already seen.

**Engines**
- **Free graph engine (default, no keys):** skips the seed's direct "related artists" (what radio plays), walks 2–3 hops out on Deezer's artist graph, keeps small artists several paths agree on, and takes a non-hit track from each.
- **AI engine (optional):** set `GEMINI_API_KEY` (free tier at aistudio.google.com, no card) or `ANTHROPIC_API_KEY`. AI picks are verified on Deezer and topped up by the graph engine if too few survive. If the AI call fails, the graph engine takes over.

**Env vars (all optional)**
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
