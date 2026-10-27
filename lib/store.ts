import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VideoItem } from "./types";

/** Label written by Claude for one scanned video (work/labels/<channel>.json holds an array of these). */
export interface VideoLabel {
  id: string;
  /** false when the video is not mainly about AI; the other fields are then ignored. */
  ai: boolean;
  /** Short topic name chosen by Claude after reading the video (reuse names from `existingTopics` when they fit). */
  topic: string;
  /** Up to 2 other topics that also apply. */
  related: string[];
  /** e.g. "Step-by-step tutorial", "Explainer", "Comparison", "Listicle", "News / Breakdown", "Warning / Opinion". */
  style: string;
  /** Subset of "Agents", "Automation", "Digital Workers" the video is about. */
  concepts: string[];
}

export interface AiVideo extends VideoItem {
  topic: string;
  related: string[];
  style: string;
  concepts: string[];
  /** ISO time of the run that first found this video. */
  scannedAt: string;
}

export interface ChannelState {
  handle: string;
  name: string;
  /** Newest upload date seen so far; later runs only fetch videos newer than this. */
  lastPublishedAt?: string;
  lastScanAt?: string;
  /** Every video id scanned (AI or not), so nothing is classified twice. */
  seen: string[];
  /** Only the videos labelled as AI. */
  videos: AiVideo[];
}

export const DATA_DIR = "data";
export const WORK_DIR = "work";

export const slug = (handle: string) => handle.replace(/^@/, "").replace(/[^\w-]+/g, "_");

export async function loadState(handle: string, name: string): Promise<ChannelState> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${slug(handle)}.json`), "utf8")) as ChannelState;
  } catch {
    return { handle, name, seen: [], videos: [] };
  }
}

export async function saveState(state: ChannelState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, `${slug(state.handle)}.json`), JSON.stringify(state, null, 1));
}
