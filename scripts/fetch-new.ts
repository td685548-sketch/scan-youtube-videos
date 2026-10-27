import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadState, slug, WORK_DIR } from "../lib/store";
import { fetchChannelVideos } from "../lib/youtube";

// Step 1 of the daily scan: fetch the videos nobody has labelled yet and write them to work/pending/<channel>.json.
// First run for a channel (no data/<handle>.json) fetches every video; later runs only fetch newer uploads.
// Claude then reads each pending file, labels every video (work/labels/<channel>.json) and runs `npm run build-reports`.
//
// Usage: npm run fetch-new [-- --full] [-- --after=2025-01-01] [-- --channel=@handle]
const args = process.argv.slice(2);
const full = args.includes("--full");
// --after=YYYY-MM-DD: skip older videos (they are not labelled and never fetched again, since later runs only look at newer uploads).
const after = args.find((a) => a.startsWith("--after="))?.slice(8);
const only = args.find((a) => a.startsWith("--channel="))?.slice(10).toLowerCase();

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("Missing YOUTUBE_API_KEY (see .env.example)");
  const channels: { name: string; handle: string }[] = JSON.parse(await readFile("channels.json", "utf8"));
  const dir = path.join(WORK_DIR, "pending");
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(WORK_DIR, "labels"), { recursive: true });
  let total = 0;

  for (const ch of channels.filter((c) => !only || c.handle.toLowerCase() === only)) {
    try {
    const state = await loadState(ch.handle, ch.name);
    const since = full ? undefined : state.lastPublishedAt;
    const known = new Set(full ? [] : state.seen);
    const fetched = (await fetchChannelVideos(ch.handle, key, { since, known })).filter((v) => !after || v.publishedAt >= after);
    total += fetched.length;
    console.log(`${ch.name} (${ch.handle}): ${fetched.length} video(s) to label${since ? ` (new since ${since})` : " (first run, whole channel)"}`);
    await writeFile(
      path.join(dir, `${slug(ch.handle)}.json`),
      JSON.stringify(
        {
          channel: ch.name,
          handle: ch.handle,
          full,
          // Topic names used so far for this channel: reuse them when they fit so the report stays consistent.
          existingTopics: [...new Set(full ? [] : state.videos.map((v) => v.topic))],
          videos: fetched.map((v) => ({
            id: v.id,
            title: v.title,
            description: v.description.replace(/\s+/g, " ").slice(0, 300),
            tags: v.tags.slice(0, 10),
            publishedAt: v.publishedAt,
            durationSeconds: v.durationSeconds,
            isShort: v.isShort,
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            url: v.url,
          })),
        },
        null,
        1,
      ),
    );
    } catch (e) {
      console.error(`${ch.name} (${ch.handle}): FAILED - ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${total} video(s) waiting for labels in ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
