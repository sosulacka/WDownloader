import { t, localeTag } from "../lib/i18n";
import type { Dispatch, RefObject, SetStateAction } from "react";
import Select from "./Select";
import MediaEditor from "./MediaEditor";
import {
  ArrowDown,
  ArrowRight,
  ClipboardPaste,
  CircleAlert,
  CircleCheck,
  Folder,
  Headphones,
  Link,
  LoaderCircle,
  Video,
  X,
} from "./icons";
import {
  audioFormats,
  cleanPath,
  duration,
  formatHints,
  formatName,
  qualityLabel,
  videoFormats,
  type Prefs,
  type VideoInfo,
} from "../lib/types";
import type { ClipRange } from "../lib/media";

type Props = {
  urlRef: RefObject<HTMLInputElement | null>;
  url: string;
  onUrlChange: (value: string) => void;
  onAnalyze: (e?: { preventDefault: () => void }) => void;
  onPaste: () => void;
  loading: boolean;
  installing: boolean;
  video: VideoInfo | null;
  error: string;
  onDismissError: () => void;
  onRetry: () => void;
  onOpenBrowser: () => void;
  onLogin: () => void;
  prefs: Prefs;
  setPrefs: Dispatch<SetStateAction<Prefs>>;
  quality: string;
  setQuality: (value: string) => void;
  clip: ClipRange | null;
  setClip: (clip: ClipRange | null) => void;
  desktop: boolean;
  adding: boolean;
  onChooseFolder: () => void;
  onDownload: () => void;
};

export default function DownloadPanel(props: Props) {
  const { prefs, setPrefs, video, loading, clip } = props;
  const format = prefs.kind === "video" ? prefs.videoFormat : prefs.audioFormat;
  const formats = prefs.kind === "video" ? videoFormats : audioFormats;
  const setFormat = (value: string) =>
    setPrefs((p) => ({
      ...p,
      [p.kind === "video" ? "videoFormat" : "audioFormat"]: value,
    }));

  return (
    <section className="card download-panel" aria-label={t("Новая загрузка")}>
      <form
        onSubmit={props.onAnalyze}
        className={`url-form ${loading ? "busy" : ""}`}
      >
        <div className="url-input">
          <Link size={19} />
          <input
            ref={props.urlRef}
            value={props.url}
            onChange={(e) => props.onUrlChange(e.target.value)}
            placeholder={t("Вставьте ссылку на видео с YouTube")}
            aria-label={t("Ссылка на видео YouTube")}
            autoComplete="off"
            spellCheck={false}
          />
          {props.url && (
            <button
              className="icon-button"
              type="button"
              onClick={() => props.onUrlChange("")}
              aria-label={t("Очистить ссылку")}
            >
              <X size={15} />
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            onClick={props.onPaste}
            data-tooltip={t("Вставить из буфера")}
            aria-label={t("Вставить из буфера")}
          >
            <ClipboardPaste size={18} />
          </button>
        </div>
        <button
          type="submit"
          className="button primary analyze-button"
          disabled={loading || !props.url.trim() || props.installing}
        >
          {loading ? (
            <>
              <LoaderCircle className="spin" size={17} />
              {t("Анализируем")}</>
          ) : (
            <>
              {t("Найти")}<ArrowRight size={17} />
            </>
          )}
        </button>
        <span className="url-scan" aria-hidden="true" />
      </form>

      {props.error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={17} />
          <div className="inline-error-body">
            <span>{t(props.error)}</span>
            {props.desktop && props.url.trim() && (
              <div className="inline-error-actions">
                {/не бот|вход|sign in|not a bot/i.test(props.error) && (
                  <button type="button" className="button primary small" onClick={props.onLogin}>
                    {t("Войти в YouTube")}
                  </button>
                )}
                <button type="button" className="button ghost small" onClick={props.onRetry}>
                  {t("Повторить")}
                </button>
                <button type="button" className="button ghost small" onClick={props.onOpenBrowser}>
                  {t("Открыть в браузере")}
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-button"
            aria-label={t("Закрыть ошибку")}
            onClick={props.onDismissError}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {loading && (
        <div className="video-card loading" aria-hidden="true">
          <div className="skeleton thumbnail-skeleton" />
          <div className="video-card-body">
            <div className="skeleton text-skeleton" />
            <div className="skeleton text-skeleton short" />
            <p>{t("Получаем информацию и доступные разрешения…")}</p>
          </div>
        </div>
      )}

      {video && !loading && (
        <div className="video-card">
          <div className="thumbnail">
            <img
              src={video.thumbnail}
              alt={t("Превью видео")}
              referrerPolicy="no-referrer"
            />
            <span>{duration(video.duration)}</span>
          </div>
          <div className="video-card-body">
            <span className="found-label">
              <CircleCheck size={14} />
              {t("Видео найдено")}</span>
            <h2>{video.title}</h2>
            <p>
              {video.channel}
              {video.views !== null && (
                <>
                  <span className="dot-sep" />
                  {new Intl.NumberFormat(localeTag(), {
                    notation: "compact",
                  }).format(video.views)}{" "}
                  {t("просмотров")}</>
              )}
              {video.heights.length > 0 && (
                <>
                  <span className="dot-sep" />
                  {t("до")}{" "}{Math.max(...video.heights)}p
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="config-grid">
        <div className="config-block">
          <span className="field-label">{t("Что скачиваем")}</span>
          <div className="kind-options" role="radiogroup" aria-label={t("Тип файла")}>
            {(
              [
                ["video", Video, t("Видео + аудио"), t("Полная версия")],
                ["audio", Headphones, t("Только аудио"), t("Музыка и подкасты")],
              ] as const
            ).map(([kind, Icon, title, text]) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={prefs.kind === kind}
                className={`kind-card ${prefs.kind === kind ? "active" : ""}`}
                onClick={() => setPrefs((p) => ({ ...p, kind }))}
              >
                <span className="kind-icon">
                  <Icon size={20} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </span>
                <span className="radio" />
              </button>
            ))}
          </div>
        </div>

        <div className="config-block">
          <span className="field-label">{t("Формат")}</span>
          <div className="format-chips" role="radiogroup" aria-label={t("Формат файла")}>
            {formats.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                className={`chip ${format === f ? "active" : ""}`}
                onClick={() => setFormat(f)}
                data-tooltip={t(formatHints[f])}
              >
                {formatName(f)}
              </button>
            ))}
          </div>
          {prefs.kind === "video" ? (
            <Select
              label={t("Качество видео")}
              value={props.quality}
              onChange={props.setQuality}
            >
              <option value="best">{t("Лучшее доступное")}</option>
              {video?.heights.map((h) => (
                <option key={h} value={h}>
                  {qualityLabel(h)}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              label={t("Качество аудио")}
              value={prefs.audioQuality}
              onChange={(v) => setPrefs((p) => ({ ...p, audioQuality: v }))}
              disabled={["wav", "flac"].includes(format)}
            >
              <option value="best">{t("Лучшее доступное")}</option>
              {["320", "256", "192", "128"].map((q) => (
                <option key={q} value={q}>
                  {q} {" "}{t("кбит/с")}</option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {video && (
        <MediaEditor
          key={`${video.id}-${prefs.kind}`}
          source={{
            url: video.url,
            title: video.title,
            duration: video.duration,
            thumbnail: video.thumbnail,
            kind: prefs.kind,
          }}
          clip={clip}
          onClipChange={props.setClip}
        />
      )}

      <div className="download-footer">
        <button
          onClick={props.onChooseFolder}
          className="folder-path"
          title={prefs.folder || t("Выбрать папку")}
        >
          <Folder size={16} />
          <span className="folder-path-label">{t("Сохранить в")}</span>
          <span className="folder-path-value">
            {prefs.folder
              ? cleanPath(prefs.folder)
              : props.desktop
                ? t("Определяем папку…")
                : t("Загрузки / Wdownloader")}
          </span>
        </button>
        <button
          className={`button primary download-button ${video ? "ready" : ""}`}
          disabled={!video || loading || props.adding}
          onClick={props.onDownload}
        >
          {props.adding ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <span className="download-arrow">
              <ArrowDown size={18} />
            </span>
          )}
          {t("Скачать")}{" "}
          {clip ? t("фрагмент") : prefs.kind === "audio" ? t("аудио") : t("видео")}
          <span className="button-format">{formatName(format)}</span>
        </button>
      </div>
    </section>
  );
}
