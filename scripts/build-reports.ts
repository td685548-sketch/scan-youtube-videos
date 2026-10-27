import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildReport } from "../lib/report";
import type { ChannelResult } from "../lib/publish";
import { loadState, saveState, slug, WORK_DIR, type AiVideo, type VideoLabel } from "../lib/store";
import type { VideoItem } from "../lib/types";

// Step 2 of the daily scan: merge the labels Claude wrote (work/labels/<channel>.json) with the videos from
// work/pending/<channel>.json, update data/<channel>.json and write output/<date>/<channel>-AI-videos.xlsx
// plus output/<date>/summary.json (used for the OneDrive upload and the Teams message).
//
// Usage: npm run build-reports [-- --out=output]
const outRoot = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "output";

interface Pending {
  channel: string;
  handle: string;
  full: boolean;
  videos: VideoItem[];
}

const CONCEPTS = ["Agents", "Automation", "Digital Workers"];

function validate(p: Pending, labels: VideoLabel[]): Map<string, VideoLabel> {
  const byId = new Map(labels.map((l) => [l.id, l]));
  // The labels file lists the AI videos only; a pending video without a label was reviewed and is not about AI.
  const unknown = labels.filter((l) => !p.videos.some((v) => v.id === l.id));
  if (unknown.length) throw new Error(`${unknown.length} label(s) do not match a pending video, e.g. ${unknown[0].id}`);
  for (const l of byId.values()) {
    if (typeof l.ai !== "boolean") throw new Error(`Label ${l.id}: "ai" must be true or false`);
    if (l.ai && (!l.topic?.trim() || !l.style?.trim())) throw new Error(`Label ${l.id}: AI videos need a topic and a style`);
  }
  return byId;
}

async function main() {
  const now = new Date();
  const dir = path.join(outRoot, now.toISOString().slice(0, 10));
  await mkdir(dir, { recursive: true });
  const results: ChannelResult[] = [];

  for (const file of (await readdir(path.join(WORK_DIR, "pending"))).filter((f) => f.endsWith(".json"))) {
    const pending: Pending = JSON.parse(await readFile(path.join(WORK_DIR, "pending", file), "utf8"));
    const base = { name: pending.channel, handle: pending.handle };
    try {
      const labels = validate(pending, JSON.parse(await readFile(path.join(WORK_DIR, "labels", file), "utf8")));
      const prev = await loadState(pending.handle, pending.channel);
      const state = pending.full ? { ...prev, seen: [], videos: [], lastPublishedAt: undefined } : prev;
      const first = !state.lastPublishedAt;
      const scannedAt = now.toISOString();

      const fresh: AiVideo[] = [];
      for (const v of pending.videos) {
        const l = labels.get(v.id);
        if (!l?.ai) continue;
        fresh.push({
          ...v,
          topic: l.topic.trim(),
          related: (l.related ?? []).filter((r) => r !== l.topic).slice(0, 2),
          style: l.style.trim(),
          concepts: (l.concepts ?? []).filter((c) => CONCEPTS.includes(c)),
          scannedAt,
        });
      }
      state.seen = [...state.seen, ...pending.videos.map((v) => v.id)];
      state.videos = [...state.videos, ...fresh];
      state.name = pending.channel;
      state.lastScanAt = scannedAt;
      state.lastPublishedAt = [state.lastPublishedAt ?? "", ...pending.videos.map((v) => v.publishedAt)].sort().at(-1) || undefined;

      const wb = buildReport({
        name: pending.channel,
        handle: pending.handle,
        videos: state.videos,
        fresh: first ? [] : fresh,
        scannedAt: now,
        totalScanned: state.seen.length,
      });
      const out = path.join(dir, `${pending.channel.replace(/[^\w-]+/g, "_")}-AI-videos.xlsx`);
      await wb.xlsx.writeFile(out);
      await saveState(state);
      // Consumed: remove so that running build-reports twice cannot add the same videos again.
      await rm(path.join(WORK_DIR, "pending", file));
      await rm(path.join(WORK_DIR, "labels", file));
      console.log(`${pending.channel}: ${fresh.length} new AI video(s), ${state.videos.length} in total -> ${out}`);
      results.push({
        ...base,
        file: out,
        newAi: fresh.length,
        totalAi: state.videos.length,
        newVideos: fresh.map((v) => ({ title: v.title, url: v.url, topic: v.topic })),
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`${pending.channel}: FAILED - ${error}`);
      results.push({ ...base, newAi: 0, totalAi: 0, newVideos: [], error });
    }
  }

  await writeFile(path.join(dir, "summary.json"), JSON.stringify({ date: now.toISOString(), results }, null, 1));
  if (results.some((r) => r.error)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
