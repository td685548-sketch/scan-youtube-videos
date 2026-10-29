import ExcelJS from "exceljs";
import type { AiVideo } from "./store";

const HEADERS = ["#", "Channel", "Title", "Video link", "Topic", "Related topics", "Style", "Format", "Duration", "Published", "Views", "Agents / Automation / Digital Workers"];
const WIDTHS = [5, 18, 62, 46, 28, 38, 26, 20, 10, 12, 11, 34];
const DARK = "FF1F2937";
const GROUP = "FFE5E7EB";

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function format(v: AiVideo): string {
  if (v.isShort) return "Short";
  if (v.durationSeconds < 8 * 60) return "Standard (<8 min)";
  if (v.durationSeconds < 20 * 60) return "Medium (8-20 min)";
  return "Long (20+ min)";
}

interface Row {
  channel: string;
  v: AiVideo;
}

const byDate = (a: Row, b: Row) => b.v.publishedAt.localeCompare(a.v.publishedAt);

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function header(ws: ExcelJS.Worksheet, titles: string[], widths: number[]) {
  styleHeader(ws.addRow(titles));
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titles.length } };
}

function videoRow(ws: ExcelJS.Worksheet, n: number, { channel, v }: Row) {
  const row = ws.addRow([
    n,
    channel,
    v.title,
    { text: v.url, hyperlink: v.url },
    v.topic,
    v.related.join(", "),
    v.style,
    format(v),
    fmtDuration(v.durationSeconds),
    new Date(v.publishedAt.slice(0, 10)),
    v.viewCount,
    v.concepts.join(", "),
  ]);
  row.alignment = { vertical: "middle", wrapText: true };
  row.getCell(4).font = { color: { argb: "FF0563C1" }, underline: true };
  row.getCell(10).numFmt = "yyyy-mm-dd";
  row.getCell(11).numFmt = "#,##0";
}

function flatSheet(wb: ExcelJS.Workbook, name: string, rows: Row[]) {
  const ws = wb.addWorksheet(name);
  header(ws, HEADERS, WIDTHS);
  rows.forEach((r, i) => videoRow(ws, i + 1, r));
}

function count<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

export interface ChannelData {
  name: string;
  handle: string;
  /** Short description of the channel's positioning (from channels.json). */
  positioning?: string;
  /** Videos of the channel checked in this run (AI or not). */
  checked: number;
  /** AI videos found in this run; the report lists only these (the all-time list stays in data/). */
  videos: AiVideo[];
}

export interface ReportInput {
  channels: ChannelData[];
  scannedAt: Date;
}

/** One workbook with the AI videos found in this run, all channels together: Summary, Overview, Videos <date>, By Topic, Topics x Channels, Agents-Automation-Workers. */
export function buildReport(r: ReportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Scan Youtube Videos";
  wb.created = r.scannedAt;
  const day = r.scannedAt.toISOString().slice(0, 10);

  const all: Row[] = r.channels.flatMap((c) => c.videos.map((v) => ({ channel: c.name, v }))).sort(byDate);
  const focus = all.filter((x) => x.v.concepts.length);

  // Summary: totals plus topic and style counts over all channels (same layout as the former per-channel Summary).
  const sm = wb.addWorksheet("Summary");
  const checked = r.channels.reduce((n, c) => n + c.checked, 0);
  const lines = [
    `YouTube AI scan - ${day}`,
    `Scanned: ${r.scannedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Channels: ${r.channels.length}`,
    `AI videos found: ${all.length} (of ${checked} new videos checked)`,
    `Agents / Automation / Digital Workers videos: ${focus.length}`,
  ];
  lines.forEach((l, i) => (sm.getCell(i + 1, 1).value = l));
  sm.getCell(1, 1).font = { bold: true, size: 14 };
  const top = lines.length + 2;
  ["Topic", "Videos"].forEach((t, i) => (sm.getCell(top, 1 + i).value = t));
  ["Style", "Videos"].forEach((t, i) => (sm.getCell(top, 4 + i).value = t));
  for (const c of [1, 2, 4, 5]) {
    const cell = sm.getCell(top, c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  }
  count(all, (x) => x.v.topic).forEach(([k, n], i) => {
    sm.getCell(top + 1 + i, 1).value = k;
    sm.getCell(top + 1 + i, 2).value = n;
  });
  count(all, (x) => x.v.style).forEach(([k, n], i) => {
    sm.getCell(top + 1 + i, 4).value = k;
    sm.getCell(top + 1 + i, 5).value = n;
  });
  [32, 10, 4, 28, 10].forEach((w, i) => (sm.getColumn(i + 1).width = w));

  // Overview: one line per channel.
  const ov = wb.addWorksheet("Overview");
  header(ov, ["Channel", "YouTube link", "Videos checked", "AI videos", "Agents / Automation / DW", "Top topic", "Positioning summary"], [20, 52, 15, 11, 24, 36, 90]);
  for (const c of r.channels) {
    const url = `https://www.youtube.com/${c.handle.startsWith("@") ? c.handle : `channel/${c.handle}`}`;
    const topTopic = count(c.videos, (v) => v.topic)[0];
    const row = ov.addRow([c.name, { text: url, hyperlink: url }, c.checked, c.videos.length, c.videos.filter((v) => v.concepts.length).length, topTopic ? `${topTopic[0]} (${topTopic[1]})` : "", c.positioning ?? ""]);
    row.getCell(2).font = { color: { argb: "FF0563C1" }, underline: true };
    row.alignment = { vertical: "middle", wrapText: true };
  }
  const total = ov.addRow(["TOTAL", "", checked, all.length, focus.length]);
  total.font = { bold: true };
  total.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP } };

  flatSheet(wb, `Videos ${day}`, all);

  const bt = wb.addWorksheet("By Topic");
  header(bt, HEADERS, WIDTHS);
  const topics = count(all, (x) => x.v.topic);
  for (const [topic] of topics) {
    const list = all.filter((x) => x.v.topic === topic);
    const g = bt.addRow([`${topic} (${list.length})`]);
    bt.mergeCells(g.number, 1, g.number, HEADERS.length);
    g.font = { bold: true };
    g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP } };
    list.forEach((x, i) => videoRow(bt, i + 1, x));
  }

  // Topics x Channels: how many videos each channel has per topic.
  const tc = wb.addWorksheet("Topics x Channels");
  header(tc, ["Topic", ...r.channels.map((c) => c.name), "Total"], [32, ...r.channels.map(() => 16), 10]);
  for (const [topic, n] of topics) {
    tc.addRow([topic, ...r.channels.map((c) => c.videos.filter((v) => v.topic === topic).length), n]);
  }

  flatSheet(
    wb,
    "Agents-Automation-Workers",
    [...focus].sort((a, b) => b.v.concepts.length - a.v.concepts.length || byDate(a, b)),
  );
  return wb;
}
