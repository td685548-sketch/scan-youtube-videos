import { readFile } from "node:fs/promises";
import path from "node:path";

// Upload of the daily reports to OneDrive (Microsoft Graph, app-only) and a Teams notification (Workflows webhook).

export interface ChannelResult {
  name: string;
  handle: string;
  file?: string;
  newAi: number;
  totalAi: number;
  newVideos: { title: string; url: string; topic: string }[];
  error?: string;
}

export interface Summary {
  date: string;
  results: ChannelResult[];
}

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface OneDriveConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** UPN / e-mail of the OneDrive owner (used when no drive id is given). */
  user?: string;
  /** Alternative to `user`: a drive id (e.g. a SharePoint document library). */
  driveId?: string;
  folder: string;
}

export function oneDriveConfig(env = process.env): OneDriveConfig | undefined {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, ONEDRIVE_USER, ONEDRIVE_DRIVE_ID } = env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !(ONEDRIVE_USER || ONEDRIVE_DRIVE_ID)) return undefined;
  return {
    tenantId: MS_TENANT_ID,
    clientId: MS_CLIENT_ID,
    clientSecret: MS_CLIENT_SECRET,
    user: ONEDRIVE_USER,
    driveId: ONEDRIVE_DRIVE_ID,
    folder: (env.ONEDRIVE_FOLDER || "YouTube AI Scan").replace(/^\/+|\/+$/g, ""),
  };
}

async function token(c: OneDriveConfig): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Uploads one file (max ~4 MB, enough for these reports) and returns a link to it. Missing folders are created. */
export async function uploadToOneDrive(c: OneDriveConfig, accessToken: string, localFile: string, remoteDir: string): Promise<string> {
  const drive = c.driveId ? `${GRAPH}/drives/${encodeURIComponent(c.driveId)}` : `${GRAPH}/users/${encodeURIComponent(c.user!)}/drive`;
  const remote = `${c.folder}/${remoteDir}/${path.basename(localFile)}`;
  const body = await readFile(localFile);
  const res = await fetch(`${drive}/root:/${encodePath(remote)}:/content?@microsoft.graph.conflictBehavior=replace`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body,
  });
  if (!res.ok) throw new Error(`OneDrive upload of ${path.basename(localFile)} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const item = (await res.json()) as { id: string; webUrl: string };

  // Organisation-wide view link; fall back to the plain URL when the tenant does not allow link creation.
  const link = await fetch(`${drive}/items/${item.id}/createLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "view", scope: "organization" }),
  });
  if (link.ok) return ((await link.json()) as { link: { webUrl: string } }).link.webUrl;
  return item.webUrl;
}

export async function uploadAll(c: OneDriveConfig, s: Summary, log: (m: string) => void): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const accessToken = await token(c);
  const dateDir = s.date.slice(0, 10);
  for (const r of s.results) {
    if (!r.file) continue;
    links.set(r.handle, await uploadToOneDrive(c, accessToken, r.file, dateDir));
    log(`Uploaded ${path.basename(r.file)}`);
  }
  return links;
}

/** Adaptive card in the message format that Teams "Workflows" webhooks accept: a short overview, one line per channel. */
export function buildTeamsMessage(s: Summary, links: Map<string, string>, folderUrl?: string) {
  const day = s.date.slice(0, 10);
  const totalNew = s.results.reduce((n, r) => n + r.newAi, 0);
  const totalAll = s.results.reduce((n, r) => n + r.totalAi, 0);
  const failed = s.results.filter((r) => r.error);
  const body: unknown[] = [
    { type: "TextBlock", text: `YouTube AI scan - ${day}`, weight: "Bolder", size: "Large", wrap: true },
    {
      type: "TextBlock",
      text: totalNew ? `**${totalNew} new AI video(s)** today (${totalAll} in total, ${s.results.length} channels)` : `No new AI videos today (${totalAll} in total, ${s.results.length} channels)`,
      wrap: true,
    },
    {
      type: "FactSet",
      facts: s.results.map((r) => {
        const link = links.get(r.handle);
        const name = link ? `[${r.name}](${link})` : r.name;
        return { title: name, value: r.error ? "failed" : `${r.newAi} new / ${r.totalAi} total` };
      }),
    },
  ];
  if (folderUrl) body.push({ type: "TextBlock", text: `[Open the Excel reports on OneDrive](${folderUrl})`, wrap: true, spacing: "Medium" });
  if (failed.length) body.push({ type: "TextBlock", text: `${failed.length} channel(s) failed: ${failed.map((r) => r.name).join(", ")}. Check the run log.`, color: "Attention", wrap: true });
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body },
      },
    ],
  };
}

export async function postToTeams(url: string, message: unknown): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) });
  if (!res.ok) throw new Error(`Teams webhook failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/**
 * Upload through a Power Automate flow (trigger "When an HTTP request is received" + OneDrive "Create file").
 * Sends {folder, fileName, contentBase64}; if the flow answers with JSON {"link": "..."} (or "webUrl") that link is returned.
 */
export async function uploadViaFlow(flowUrl: string, localFile: string, folder: string): Promise<string | undefined> {
  const res = await fetch(flowUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, fileName: path.basename(localFile), contentBase64: (await readFile(localFile)).toString("base64") }),
  });
  if (!res.ok) throw new Error(`OneDrive flow failed for ${path.basename(localFile)}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  try {
    const j = (await res.json()) as { link?: string; webUrl?: string };
    return j.link || j.webUrl;
  } catch {
    return undefined; // the flow replied without a JSON body
  }
}

export async function uploadAllViaFlow(flowUrl: string, folder: string, s: Summary, log: (m: string) => void): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  for (const r of s.results) {
    if (!r.file) continue;
    const link = await uploadViaFlow(flowUrl, r.file, `${folder}/${s.date.slice(0, 10)}`);
    if (link) links.set(r.handle, link);
    log(`Uploaded ${path.basename(r.file)}`);
  }
  return links;
}
