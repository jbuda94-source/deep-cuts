# Rabbit Hole

Paste a Spotify or YouTube link (or type `Artist - Song`), confirm the track by ear, and get 10 deep cuts that sound like it and mix in key. Tap **Go deeper** on any result to make it the new seed and keep going.

**How it works**
1. **Seed:** reads the link (Spotify page metadata / YouTube oEmbed) or your text, shows the closest Deezer matches with previews, and you pick the right recording.
2. **Song-level matches:** looks the recording up on MusicBrainz and pulls *similar recordings* from ListenBrainz — what real listeners play in the same sessions as that exact song. Deeper settings take a second hop out from the best matches.
3. **Deep cuts only:** each candidate is checked on Deezer and dropped if the track (rank) or artist (fan count) is over the ceiling for your depth. The seed artist, its most obvious neighbours, and anything already on your trail are excluded.
4. **Mix in key:** key and BPM are detected from each 30-second preview (chroma + Krumhansl–Kessler key profiles; spectral-flux tempo) and shown as Camelot codes. With **In key first** on, tracks that are the same key, ±1 on the wheel, or the relative major/minor are ranked first.
5. **Fallbacks:** if listening data is thin for a rare song, the Deezer artist graph fills the gaps. An optional AI layer (`GEMINI_API_KEY`, free tier) adds picks and powers the steer box.

**Env vars (all optional)**
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

Key/BPM come from 30 seconds of audio, so treat them as close estimates — confirm by ear before a big blend.
