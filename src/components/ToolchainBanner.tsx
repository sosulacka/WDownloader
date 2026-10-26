import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardCopy,
  LoaderCircle,
  RotateCcw,
} from "./icons";

export type InstallProgress = {
  tool: string;
  stage: string;
  downloaded: number;
  total: number | null;
  progress: number | null;
};
export type InstallFailure = { tool: string; message: string; folder: string };
type Props = {
  pending: boolean;
  progress: InstallProgress | null;
  error: InstallFailure | null;
  onRetry: () => void;
  onCheck: () => void;
};
const labels: Record<string, string> = {
  downloading: "Скачиваем",
  downloaded: "Файл получен",
  extracting: "Распаковываем",
  verifying: "Проверяем запуск",
  ready: "Установлен",
};

export default function ToolchainBanner({
  pending,
  progress,
  error,
  onRetry,
  onCheck,
}: Props) {
  const [manual, setManual] = useState(true);
  const [copied, setCopied] = useState(false);
  const [linkError, setLinkError] = useState("");
  if (!pending && !error) return null;
  async function openPage(tool: string) {
    try {
      await invoke("open_tool_download", { tool });
    } catch {
      setLinkError(
        "Откройте github.com и найдите страницу Releases соответствующего проекта ниже.",
      );
    }
  }
  return (
    <section
      className={`toolchain-banner ${error && !pending ? "installation-failed" : ""}`}
      aria-label="Установка компонентов"
      aria-live="polite"
    >
      <div className="toolchain-top">
        {pending ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <CircleAlert size={20} />
        )}
        <div>
          <h2>
            {pending
              ? "Готовим приложение к работе"
              : `Не удалось установить ${error?.tool}`}
          </h2>
          <p>
            {pending
              ? progress
                ? `${labels[progress.stage] || "Подготовка"} ${progress.tool}`
                : "Проверяем недостающие компоненты…"
              : "Загрузка может быть прервана сетью или нехваткой места. Попробуйте ещё раз."}
          </p>
        </div>
        {!pending && (
          <button
            className="button primary small"
            onClick={onRetry}
          >
            <RotateCcw size={14} />
            Повторить установку
          </button>
        )}
        {pending && progress?.progress != null && (
          <span className="install-percent">
            {Math.floor(progress.progress)}%
          </span>
        )}
      </div>
      {pending && (
        <>
          <div className="install-track">
            <i
              className={progress?.progress == null ? "indeterminate" : ""}
              style={{ width: `${progress?.progress ?? 35}%` }}
            />
          </div>
          <span className="install-detail">
            {progress?.total
              ? `${(progress.downloaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} МБ`
              : "Один раз. Компоненты сохранятся на этом устройстве."}
          </span>
        </>
      )}
      {error && !pending && (
        <>
          <p className="installation-error-details">{error.message}</p>
          <button
            className={`manual-toggle ${manual ? "active" : ""}`}
            onClick={() => setManual((v) => !v)}
            aria-expanded={manual}
          >
            Как установить вручную
            <ChevronDown size={14} />
          </button>
          {manual && (
            <div className="manual-install">
              <p>
                Скачайте Windows x64 версии с официальных страниц. Распакуйте
                архивы и положите эти файлы в одну папку:
              </p>
              <div className="manual-tools">
                {[
                  ["yt-dlp", "yt-dlp.exe", "yt-dlp/yt-dlp"],
                  [
                    "FFmpeg",
                    "ffmpeg.exe + ffprobe.exe из папки bin",
                    "yt-dlp/FFmpeg-Builds",
                  ],
                  [
                    "Deno",
                    "deno.exe из deno-x86_64-pc-windows-msvc.zip",
                    "denoland/deno",
                  ],
                ].map(([tool, files, project]) => (
                  <div key={tool}>
                    <div>
                      <strong>{tool}</strong>
                      <span>{files}</span>
                      <small>github.com/{project}/releases/latest</small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => void openPage(tool)}
                    >
                      Скачать
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="manual-folder">
                <code>{error.folder}</code>
                <button
                  className="icon-button"
                  aria-label="Скопировать путь папки"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(error.folder)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2500);
                      })
                      .catch(() =>
                        setLinkError(
                          "Выделите путь папки и скопируйте его через Ctrl+C.",
                        ),
                      );
                  }}
                >
                  {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
                </button>
              </div>
              {linkError && <p>{linkError}</p>}
              <p>Создайте папку, если её нет. После копирования нажмите:</p>
              <button
                className="button ghost small"
                onClick={onCheck}
              >
                <Check size={14} />
                Проверить компоненты
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
