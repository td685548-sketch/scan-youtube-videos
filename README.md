# Scan Youtube Videos

Next.js project that scans every video and Short of a YouTube channel
(default: `@Professor-Glitch-automation`) and exports an Excel file:

- one sheet per topic (own tab/header colour, clickable video links, Shorts flagged)
- a dedicated sheet `Agents vs Automation vs DW` with videos about agents, automation or digital workers (most overlapping concepts first)
- a `Summary` sheet

Topics are assigned by Gemini when `GEMINI_API_KEY` is set (free key from Google AI Studio; model via `GEMINI_MODEL`), otherwise by keyword rules in `lib/topics.ts`. If a Gemini batch fails, those videos fall back to the keyword rules. Edit topics in `lib/topics.ts` and the hints in `lib/gemini.ts`.

## Setup

```bash
npm install
cp .env.example .env.local   # set YOUTUBE_API_KEY (YouTube Data API v3)
```

## Usage

```bash
npm run scan                     # writes youtube-videos.xlsx
npm run scan out.xlsx @handle    # custom output / channel
npm run dev                      # then GET http://localhost:3000/api/export
```

## Scan channels about agents / automation / digital workers

```bash
npm run channels                                   # writes youtube-channels.xlsx
npm run channels out.xlsx "AI agents" "n8n"        # custom keywords
SEARCH_PAGES=3 npm run channels                    # deeper search (more API quota)
```

or `GET /api/channels?q=AI%20agents&q=digital%20workers` with `npm run dev`.

Channels are found with the YouTube Data API (`search.list` on channels and videos, ~100 quota units per page per keyword) and nothing is filtered out; they are ranked by relevance. Social links (X, Facebook, Instagram, LinkedIn, TikTok, Threads, Discord, Telegram, GitHub, Skool), websites and emails come from the channel description and the About-page "Links" section (read best-effort through YouTube's internal API, so it may break if YouTube changes it).

## Visual style (thumbnail analysis)

```bash
npm run scan -- --style     # needs GEMINI_API_KEY
```

Gemini looks at each video's thumbnail and labels it Animation / Screen recording / Talking head / Slides / Other, adding `Visual style` and `Conf.` columns plus a separate `Animation style` sheet. A thumbnail is only a hint of the video, so check low-confidence rows. Describe what "Animation" means for you in `STYLE_ANIMATION_DESCRIPTION` (see `.env.example`). Free-tier rate limits are respected by pausing between batches, so a 500-video channel takes several minutes.

## Several API keys and fallback providers

- `GEMINI_API_KEYS=key1,key2` rotates Gemini keys when one hits a rate limit (429); a key that is rejected or out of daily quota is skipped for the rest of the run. Gemini quota is per Google Cloud project, so keys only help if they come from different projects.
- Topic classification falls back Gemini -> Groq (`GROQ_API_KEY`) -> OpenRouter (`OPENROUTER_API_KEY`) -> keyword rules. These fallbacks are text-only; `--style` (thumbnail analysis) uses Gemini keys only.
- Rate-limited and overloaded requests are retried automatically.

## Style analysis for an existing channels file

```bash
npm run channels:style                                   # youtube-channels.xlsx -> youtube-channels-style.xlsx
npm run channels:style in.xlsx out.xlsx                  # custom files
CHANNEL_STYLE_SAMPLES=8 npm run channels:style           # videos sampled per channel (default 5)
```

Reads the `Channels` sheet made by `npm run channels` (needs a `YouTube link` column), takes each channel's latest videos, has Gemini classify their thumbnails, and writes a copy with `Dominant style`, `Animation share`, `Videos analysed`, `Style breakdown` and `Sampled videos` columns plus an `Animation channels` sheet (channels with at least 50% Animation). Needs `YOUTUBE_API_KEY` and a Gemini key; costs about 2 YouTube quota units per channel.

Filters and resuming for `channels:style`:

```bash
npm run channels:style -- --with-concepts --min-subs=1000      # only relevant, non-tiny channels
npm run channels:style -- --limit=50                           # first 50 matching channels (quick test)
npm run channels:style -- --active-days=30                     # skip channels with no upload in the last 30 days
```

Analysed thumbnails are cached in `.style-cache.json` (ignored by git), so after an interruption or error just run the same command again and it continues where it stopped. The cache is discarded automatically if the model or the style descriptions change. Network errors ("fetch failed") are retried automatically.

If Gemini runs out of quota during style analysis, the run no longer loses everything: the Excel file is still written with the channels/videos analysed so far (the rest stay empty / `n/a`) and a `PARTIAL RESULT` warning is printed. Run the same command again after the quota resets to finish the remaining ones from the cache.

## Daily AI scan of the channels in `channels.json` (topics labelled by Claude)

Topics are **not** hardcoded or keyword-based: Claude reads every video and chooses the topic, related topics, style and Agents/Automation/Digital Workers concepts itself.

```bash
npm run fetch-new          # 1. new videos -> work/pending/<channel>.json (first run: whole channel; later: only newer uploads)
#    Claude labels every pending video -> work/labels/<channel>.json  (array of {id, ai, topic, related, style, concepts} for the AI videos only; unlisted videos count as not AI)
npm run build-reports      # 2. merges labels, updates data/<channel>.json (state), writes output/<date>/<channel>-AI-videos.xlsx + summary.json
```

`data/<channel>.json` keeps what was already scanned, so the next run only looks at videos newer than the last scan. `npm run fetch-new -- --full` rescans a channel from scratch.
