export type ClipRange = { start: number; end: number };
export type MediaSource = {
  url?: string;
  jobId?: string;
  title: string;
  duration: number;
  thumbnail?: string;
  kind: "audio" | "video";
};

export function timecode(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${rest}`;
}

export function parseTimecode(input: string): number | null {
  const text = input.trim().replace(",", ".");
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(text)) return null;
  const parts = text.split(":").map(Number);
  if (parts.length > 1 && parts.slice(1).some((n) => n >= 60)) return null;
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
  return Number.isFinite(seconds) ? seconds : null;
}

export function setBoundary(
  range: ClipRange,
  boundary: "start" | "end",
  seconds: number,
  duration: number,
): ClipRange {
  const value = Math.round(seconds * 10) / 10;
  return boundary === "start"
    ? { start: Math.max(0, Math.min(value, range.end - 0.1)), end: range.end }
    : {
        start: range.start,
        end: Math.max(range.start + 0.1, Math.min(value, duration)),
      };
}
