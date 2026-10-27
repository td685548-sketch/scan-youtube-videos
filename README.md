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

### Step 3: upload to OneDrive and notify Teams

```bash
npm run publish -- --dry-run   # prints the Teams message, uploads nothing
npm run publish                # uploads output/<date>/*.xlsx to OneDrive/<ONEDRIVE_FOLDER>/<date>/ and posts the summary in Teams
```

Needs the `MS_*`, `ONEDRIVE_*` and `TEAMS_WEBHOOK_URL` variables from `.env.example`. Anything not configured is skipped with a warning.

## Handover guide: the daily AI scan (read this first if you are another AI or a new maintainer)

### What it does
Every day at 09:30 Vietnam time (02:30 UTC) a cloud routine scans the YouTube channels in `channels.json`, keeps only videos about AI, builds one Excel report per channel, uploads the reports to OneDrive and posts a short overview in a Teams chat. The first run covered every video published since 2025-01-01; later runs only look at newer uploads.

### Who does what
- **Code** (this repo): fetches videos from the YouTube Data API, merges labels, builds Excel, uploads, posts to Teams, stores state in `data/`.
- **Claude (an AI session)**: decides which videos are about AI and assigns topic, related topics, style and concepts. There is deliberately **no keyword list or other model** doing this. If you take over, you label the videos yourself.

### Pipeline (one run)
```bash
npm install
npm run fetch-new      # -> work/pending/<channel>.json (only videos not seen before)
# YOU label every video in work/pending/*.json -> work/labels/<same file name>.json
npm run build-reports  # merges labels, updates data/<channel>.json, writes output/<date>/*.xlsx + summary.json
npm run publish        # uploads the xlsx files to OneDrive, posts the Teams overview
git add data/ && git commit -m "Daily scan <date>" && git push origin HEAD:refs/heads/claude/cool-babbage-56uk4o
```
`npm run publish -- --dry-run` prints the Teams message without uploading or posting. `npm run fetch-new -- --full --after=2025-01-01` rescans from scratch (add `--channel=@handle` to limit it to one channel).

### Labelling rules (the "YOU label" step)
For each `work/pending/<file>.json` (it has `videos` with title, description, tags, ... and `existingTopics`):
1. Decide per video if it is **mainly about AI** (AI agents, LLMs, AI tools/models, AI automation, digital workers, AI coding, AI safety). Not AI: plain programming, cybersecurity without AI, hardware, lifestyle...
2. Write `work/labels/<same file name>.json`, a JSON array listing **only the AI videos**; unlisted videos count as not AI; write `[]` when there are none:
```json
[{"id": "<video id>", "ai": true, "topic": "AI News & Models", "related": ["AI Risks & Safety"],
  "style": "News / Breakdown", "concepts": ["Agents"]}]
```
3. `topic`: reuse a name from `existingTopics` when it fits; otherwise one of: Automation & Workflows; AI Agents & Digital Workers; Learning AI & Career; Business & Making Money; MCP, APIs & Integrations; AI Coding & App Building; RAG, Memory & Knowledge; AI News & Models; AI Risks & Safety. Invent a new short topic only if none fits. `related`: up to 2 other topics.
4. `style`: Step-by-step tutorial; Warning / Opinion; Explainer; General / Commentary; Comparison; Roadmap / Learning guide; Listicle; Case study / Build-along; News / Breakdown.
5. `concepts`: any of "Agents", "Automation", "Digital Workers" (may be empty).

Only titles, the first 300 characters of the description and tags are available, so be careful with vague titles. `build-reports` deletes the pending and label files of every channel it processes, so never run it twice on the same labels.

### Where things live
| Thing | Location |
|---|---|
| Channels to scan | `channels.json` (`handle` is an `@handle`, or a bare `UC...` channel id when the handle is unknown) |
| Scan state (seen video ids, AI videos found, newest upload date) | `data/<channel>.json`, **committed to git**; the only memory between runs |
| Pending videos / labels (temporary) | `work/pending`, `work/labels` (git-ignored) |
| Excel reports | `output/<date>/<Channel>-AI-videos.xlsx` (git-ignored; the copy lives in OneDrive) |
| Code | `scripts/fetch-new.ts`, `scripts/build-reports.ts`, `scripts/publish.ts`, `lib/report.ts` (Excel), `lib/publish.ts` (OneDrive + Teams), `lib/store.ts` (state), `lib/youtube.ts` |

Each cloud run is a **fresh sandbox cloned from the default branch** `claude/cool-babbage-56uk4o`, so `data/` must be pushed to that branch at the end of every run, otherwise the next run re-scans the same videos.

### Configuration (secrets are never in git)
Locally: `.env.local` (git-ignored). On the cloud: the environment variables of the cloud environment used by the routine (claude.ai/code, the routine, its environment). Template: `.env.example`.

| Variable | Purpose |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (used by fetch-new) |
| `TEAMS_WEBHOOK_URL` | URL of a Teams Workflows webhook ("Send webhook alerts to a chat") |
| `ONEDRIVE_FLOW_URL` | URL of a Power Automate flow: trigger "When a Teams webhook request is received" (who can trigger: Anyone) followed by OneDrive for Business "Create file" using `triggerBody()?['folder']`, `triggerBody()?['fileName']` and `base64ToBinary(triggerBody()?['contentBase64'])` |
| `ONEDRIVE_FOLDER_URL` | link to the OneDrive folder `YouTube AI Scan`, shown in the Teams message |
| `ONEDRIVE_FOLDER` | optional, default `YouTube AI Scan` |
| `MS_*`, `ONEDRIVE_USER` | optional alternative: upload through Microsoft Graph instead of the flow (needs an Azure app with `Files.ReadWrite.All`) |

The cloud environment must allow network access to `www.googleapis.com`, `defaultf01e930ab52e42b1b70fa8882b5d04.3b.environment.api.powerplatform.com` (both webhooks) and `github.com`. Never paste webhook URLs or keys into chat logs, commits or this README.

### The cloud routine
Name "YouTube AI scan - daily 9:30 (Vietnam)", id `trig_01Ptw96Vs2M6AFcZ24vsvtHk` (https://claude.ai/code/routines/trig_01Ptw96Vs2M6AFcZ24vsvtHk), cron `30 2 * * *` (UTC), model `claude-sonnet-5-5`. Its prompt contains the pipeline above. Manage it with the `RemoteTrigger` tool: `get`, `update` (send the full `job_config`), `run` (run now), `list_runs` and `get_run_log` (debugging). Running it posts a real Teams message and uploads real files.

### Troubleshooting
- **`fetch failed` in publish**: the environment's network access does not allow the powerplatform domain, or a webhook URL is wrong or expired. Check the Network access setting first.
- **Teams message lands in the wrong chat**: the chat is fixed by the Workflows webhook, not by the code. Fix the workflow (or create a new one from inside the target chat) and replace `TEAMS_WEBHOOK_URL`.
- **OneDrive flow answers 202 but no file appears**: the flow runs asynchronously; open its run history on make.powerautomate.com. The folder `YouTube AI Scan` must already exist.
- **Flow says it needs a Power Automate Premium license**: the HTTP-request trigger and the Response action are Premium. Use the "Teams webhook" trigger and no Response action (so there are no per-file links; the Teams message links to the folder).
- **Videos scanned twice / duplicates**: `data/` was not pushed to the default branch, or `build-reports` was run twice on the same labels.
- **A channel is not found**: put its `UC...` channel id in `channels.json` (find it with the YouTube `search.list` API or the channel page).
- **YouTube quota**: 10,000 units per day; a daily run costs about 2 units per 50 new videos plus 1 per page of uploads per channel.

### Things you should know
- Labels come from reading titles and descriptions, not video content, so some are wrong. To fix one, edit the video's entry in `data/<channel>.json` (`topic`, `related`, `style`, `concepts`) and rebuild the report.
- Only the 7 channels in `channels.json` are scanned, and videos published before 2025-01-01 are intentionally not included.
- To change how the Teams message or the Excel files look, edit `lib/publish.ts` or `lib/report.ts`, test with `npm run publish -- --dry-run`, and push to the default branch so the routine picks it up.
