import type { ClipRange } from "./media";

export type Page = "downloads" | "history" | "settings";
export type Kind = "video" | "audio";
export type Status =
  | "queued"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type VideoInfo = {
  id: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  heights: number[];
  views: number | null;
};
export type Request = {
  url: string;
  title: string;
  kind: Kind;
  format: string;
  quality: string;
  folder: string;
  metadata: boolean;
  clip?: ClipRange | null;
};
export type Job = {
  id: string;
  request: Request;
  status: Status;
  progress: number;
  speed: number | null;
  eta: number | null;
  file: string | null;
  error: string | null;
  created: number;
};
export type Dependencies = {
  ytDlp: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  deno: string | null;
  folder: string;
  toolsFolder: string;
};
export type YtdlpUpdate = {
  status: "updated" | "current" | "recent" | "deferred" | "unsupported";
  version: string | null;
};
export type Prefs = {
  folder: string;
  metadata: boolean;
  kind: Kind;
  videoFormat: string;
  audioFormat: string;
  audioQuality: string;
};

export const activeStates: Status[] = ["queued", "downloading", "processing"];
export const statusLabels: Record<Status, string> = {
  queued: "В очереди",
  downloading: "Скачивание",
  processing: "Обработка",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
};
export const videoFormats = ["mp4", "mkv", "webm", "mov"];
export const audioFormats = [
  "mp3",
  "m4a",
  "wav",
  "flac",
  "opus",
  "aac",
  "vorbis",
];
export const formatHints: Record<string, string> = {
  mp4: "Универсальный",
  mkv: "Лучшее сочетание",
  webm: "VP9 / AV1",
  mov: "Для Apple",
  mp3: "Универсальный",
  m4a: "AAC в MP4",
  wav: "Без доп. сжатия",
  flac: "Без доп. сжатия",
  opus: "Компактный",
  aac: "Совместимый",
  vorbis: "Открытый",
};
export const defaultPrefs: Prefs = {
  folder: "",
  metadata: true,
  kind: "video",
  videoFormat: "mp4",
  audioFormat: "mp3",
  audioQuality: "best",
};

export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export const duration = (n: number) =>
  n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
export const qualityLabel = (n: number) =>
  `${n}p${n >= 4320 ? " · 8K" : n >= 2160 ? " · 4K" : n >= 1440 ? " · 2K" : n >= 1080 ? " · Full HD" : n >= 720 ? " · HD" : ""}`;
export const formatName = (format: string) =>
  format === "vorbis" ? "OGG" : format.toUpperCase();
export const cleanPath = (path: string) => path.replace(/^\\\\\?\\/, "");
