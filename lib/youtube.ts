import type { VideoItem } from "./types";

const API = "https://www.googleapis.com/youtube/v3";
// YouTube Shorts can be up to 3 minutes long.
const SHORT_MAX_SECONDS = 180;

export async function api<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`);
  if (!res.ok) {
    throw new Error(`YouTube API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function parseDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export interface FetchOptions {
  /** ISO date of the newest video already scanned; older uploads are not fetched again. */
  since?: string;
  /** Video ids already scanned. */
  known?: Set<string>;
}

export async function fetchChannelVideos(handle: string, key: string, opts: FetchOptions = {}): Promise<VideoItem[]> {
  const ch = await api<{ items?: { id: string; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
    "channels",
    // A bare 24-character "UC..." value is a channel id (for channels whose @handle is unknown or changed).
    { part: "contentDetails", ...(/^UC[\w-]{22}$/.test(handle) ? { id: handle } : { forHandle: handle.startsWith("@") ? handle : `@${handle}` }) },
    key,
  );
  const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error(`Channel ${handle} not found`);

  const ids: string[] = [];
  // The uploads playlist is newest-first, so paging can stop once a page is older than the last scan (2-day safety margin).
  const stopBefore = opts.since ? Date.parse(opts.since) - 2 * 86_400_000 : -Infinity;
  let pageToken = "";
  do {
    const page = await api<{
      nextPageToken?: string;
      items: { contentDetails: { videoId: string; videoPublishedAt?: string } }[];
    }>(
      "playlistItems",
      { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(pageToken && { pageToken }) },
      key,
    );
    ids.push(...page.items.map((i) => i.contentDetails.videoId).filter((id) => !opts.known?.has(id)));
    const oldest = Math.min(...page.items.map((i) => Date.parse(i.contentDetails.videoPublishedAt ?? "") || Infinity));
    pageToken = oldest < stopBefore ? "" : (page.nextPageToken ?? "");
  } while (pageToken);

  const videos: VideoItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await api<{
      items: {
        id: string;
        snippet: { title: string; description: string; tags?: string[]; publishedAt: string };
        contentDetails: { duration: string };
        statistics: { viewCount?: string; likeCount?: string };
      }[];
    }>("videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(",") }, key);
    for (const v of batch.items) {
      const durationSeconds = parseDuration(v.contentDetails.duration);
      const isShort = durationSeconds <= SHORT_MAX_SECONDS || /#shorts?\b/i.test(v.snippet.title);
      videos.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        tags: v.snippet.tags ?? [],
        publishedAt: v.snippet.publishedAt,
        durationSeconds,
        isShort,
        viewCount: Number(v.statistics.viewCount ?? 0),
        likeCount: Number(v.statistics.likeCount ?? 0),
        url: isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
      });
    }
  }
  return videos;
}
