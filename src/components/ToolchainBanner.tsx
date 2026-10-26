import { t } from "../lib/i18n";
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
        t("Откройте github.com и найдите страницу Releases соответствующего проекта ниже."),
      );
    }
  }
  return (
    <section
      className={`toolchain-banner ${error && !pending ? "installation-failed" : ""}`}
      aria-label={t("Установка компонентов")}
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
              ? t("Готовим приложение к работе")
              : t("Не удалось установить {0}", { 0: t(error?.tool || "компоненты") })}
          </h2>
          <p>
            {pending
              ? progress
                ? `${t(labels[progress.stage] || "Подготовка")} ${t(progress.tool)}`
                : t("Проверяем недостающие компоненты…")
              : t("Загрузка может быть прервана сетью или нехваткой места. Попробуйте ещё раз.")}
          </p>
        </div>
        {!pending && (
          <button
            className="button primary small"
            onClick={onRetry}
          >
            <RotateCcw size={14} />
            {t("Повторить установку")}</button>
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
              ? t("{0} / {1} МБ", { 0: (progress.downloaded / 1048576).toFixed(1), 1: (progress.total / 1048576).toFixed(1) })
              : t("Один раз. Компоненты сохранятся на этом устройстве.")}
          </span>
        </>
      )}
      {error && !pending && (
        <>
          <p className="installation-error-details">{t(error.message)}</p>
          <button
            className={`manual-toggle ${manual ? "active" : ""}`}
            onClick={() => setManual((v) => !v)}
            aria-expanded={manual}
          >
            {t("Как установить вручную")}<ChevronDown size={14} />
          </button>
          {manual && (
            <div className="manual-install">
              <p>
                {t("Скачайте Windows x64 версии с официальных страниц. Распакуйте архивы и положите эти файлы в одну папку:")}</p>
              <div className="manual-tools">
                {[
                  ["yt-dlp", "yt-dlp.exe", "yt-dlp/yt-dlp"],
                  [
                    "FFmpeg",
                    t("ffmpeg.exe + ffprobe.exe из папки bin"),
                    "yt-dlp/FFmpeg-Builds",
                  ],
                  [
                    "Deno",
                    t("deno.exe из deno-x86_64-pc-windows-msvc.zip"),
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
                      {t("Скачать")}<ArrowUpRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="manual-folder">
                <code>{t(error.folder)}</code>
                <button
                  className="icon-button"
                  aria-label={t("Скопировать путь папки")}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(error.folder)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2500);
                      })
                      .catch(() =>
                        setLinkError(
                          t("Выделите путь папки и скопируйте его через Ctrl+C."),
                        ),
                      );
                  }}
                >
                  {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
                </button>
              </div>
              {linkError && <p>{t(linkError)}</p>}
              <p>{t("Создайте папку, если её нет. После копирования нажмите:")}</p>
              <button
                className="button ghost small"
                onClick={onCheck}
              >
                <Check size={14} />
                {t("Проверить компоненты")}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
