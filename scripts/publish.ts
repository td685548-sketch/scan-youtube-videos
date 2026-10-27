import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildTeamsMessage, oneDriveConfig, postToTeams, uploadAll, uploadAllViaFlow, type Summary } from "../lib/publish";

// Step 3 of the daily scan: upload output/<date>/*.xlsx to OneDrive and post a summary in Teams.
// Uses the newest output/<date>/summary.json written by `npm run build-reports`.
//
// Usage: npm run publish [-- --dry-run] [-- --out=output]
//   --dry-run  print the Teams message and skip the upload / webhook (no credentials needed)
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outRoot = args.find((a) => a.startsWith("--out="))?.slice(6) ?? "output";

async function main() {
  const days = (await readdir(outRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const day = days.at(-1);
  if (!day) throw new Error(`No report folder in ${outRoot}; run build-reports first`);
  const summary: Summary = JSON.parse(await readFile(path.join(outRoot, day, "summary.json"), "utf8"));

  let links = new Map<string, string>();
  const od = oneDriveConfig();
  if (dryRun) console.log("Dry run: nothing is uploaded or posted.");
  else if (process.env.ONEDRIVE_FLOW_URL) {
    links = await uploadAllViaFlow(process.env.ONEDRIVE_FLOW_URL, process.env.ONEDRIVE_FOLDER || "YouTube AI Scan", summary, console.log);
  } else if (!od) console.warn("OneDrive is not configured (ONEDRIVE_FLOW_URL, or MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and ONEDRIVE_USER / ONEDRIVE_DRIVE_ID); skipping upload.");
  else links = await uploadAll(od, summary, console.log);

  const message = buildTeamsMessage(summary, links, process.env.ONEDRIVE_FOLDER_URL);
  const webhook = process.env.TEAMS_WEBHOOK_URL;
  if (dryRun) console.log(JSON.stringify(message, null, 1));
  else if (!webhook) console.warn("TEAMS_WEBHOOK_URL is not set; skipping the Teams message.");
  else {
    await postToTeams(webhook, message);
    console.log("Posted the summary to Teams.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
