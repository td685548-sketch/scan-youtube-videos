import ExcelJS from "exceljs";
import type { AiVideo } from "./store";

const HEADERS = ["#", "Title", "Video link", "Topic", "Related topics", "Style", "Format", "Duration", "Published", "Views", "Agents / Automation / Digital Workers"];
const WIDTHS = [5, 62, 46, 28, 38, 26, 20, 10, 12, 11, 34];
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

const concepts = (v: AiVideo) => v.concepts.join(", ");
const byDate = (a: AiVideo, b: AiVideo) => b.publishedAt.localeCompare(a.publishedAt);

function header(ws: ExcelJS.Worksheet) {
  const row = ws.addRow(HEADERS);
  row.height = 22;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
}

function videoRow(ws: ExcelJS.Worksheet, n: number, v: AiVideo) {
  const row = ws.addRow([
    n,
    v.title,
    { text: v.url, hyperlink: v.url },
    v.topic,
    v.related.join(", "),
    v.style,
    format(v),
    fmtDuration(v.durationSeconds),
    new Date(v.publishedAt.slice(0, 10)),
    v.viewCount,
    concepts(v),
  ]);
  row.alignment = { vertical: "middle", wrapText: true };
  row.getCell(3).font = { color: { argb: "FF0563C1" }, underline: true };
  row.getCell(9).numFmt = "yyyy-mm-dd";
  row.getCell(10).numFmt = "#,##0";
}

function flatSheet(wb: ExcelJS.Workbook, name: string, videos: AiVideo[]) {
  const ws = wb.addWorksheet(name);
  header(ws);
  videos.forEach((v, i) => videoRow(ws, i + 1, v));
}

function count<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

export interface ReportInput {
  name: string;
  handle: string;
  videos: AiVideo[];
  /** Videos found in this run (shown in an extra "New videos" sheet). */
  fresh: AiVideo[];
  scannedAt: Date;
  /** Videos on the channel that were checked in total (AI or not). */
  totalScanned: number;
}

export function buildReport(r: ReportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Scan Youtube Videos";
  wb.created = r.scannedAt;
  const videos = [...r.videos].sort(byDate);
  const focus = videos.filter((v) => v.concepts.length);

  const s = wb.addWorksheet("Summary");
  const lines = [
    `Channel: ${r.name}`,
    `https://www.youtube.com/${r.handle.startsWith("@") ? r.handle : `channel/${r.handle}`}`,
    `Scanned: ${r.scannedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Total AI videos: ${videos.length} (of ${r.totalScanned} videos on the channel)`,
    `New AI videos in this run: ${r.fresh.length}`,
    `Agents / Automation / Digital Workers videos: ${focus.length}`,
  ];
  lines.forEach((l, i) => (s.getCell(i + 1, 1).value = l));
  s.getCell(1, 1).font = { bold: true, size: 14 };
  const top = lines.length + 2;
  ["Topic", "Videos"].forEach((t, i) => (s.getCell(top, 1 + i).value = t));
  ["Style", "Videos"].forEach((t, i) => (s.getCell(top, 4 + i).value = t));
  for (const c of [1, 2, 4, 5]) {
    const cell = s.getCell(top, c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  }
  count(videos, (v) => v.topic).forEach(([k, n], i) => {
    s.getCell(top + 1 + i, 1).value = k;
    s.getCell(top + 1 + i, 2).value = n;
  });
  count(videos, (v) => v.style).forEach(([k, n], i) => {
    s.getCell(top + 1 + i, 4).value = k;
    s.getCell(top + 1 + i, 5).value = n;
  });
  [32, 10, 4, 28, 10].forEach((w, i) => (s.getColumn(i + 1).width = w));

  if (r.fresh.length) flatSheet(wb, `New ${r.scannedAt.toISOString().slice(0, 10)}`, [...r.fresh].sort(byDate));
  flatSheet(wb, "All Videos", videos);

  const bt = wb.addWorksheet("By Topic");
  header(bt);
  for (const [topic] of count(videos, (v) => v.topic)) {
    const list = videos.filter((v) => v.topic === topic);
    const g = bt.addRow([`${topic} (${list.length})`]);
    bt.mergeCells(g.number, 1, g.number, HEADERS.length);
    g.font = { bold: true };
    g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP } };
    list.forEach((v, i) => videoRow(bt, i + 1, v));
  }

  flatSheet(
    wb,
    "Agents-Automation-Workers",
    [...focus].sort((a, b) => b.concepts.length - a.concepts.length || byDate(a, b)),
  );
  return wb;
}
