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
    <section className="card download-panel" aria-label="Новая загрузка">
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
            placeholder="Вставьте ссылку на видео с YouTube"
            aria-label="Ссылка на видео YouTube"
            autoComplete="off"
            spellCheck={false}
          />
          {props.url && (
            <button
              className="icon-button"
              type="button"
              onClick={() => props.onUrlChange("")}
              aria-label="Очистить ссылку"
            >
              <X size={15} />
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            onClick={props.onPaste}
            data-tooltip="Вставить из буфера"
            aria-label="Вставить из буфера"
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
              Анализируем
            </>
          ) : (
            <>
              Найти
              <ArrowRight size={17} />
            </>
          )}
        </button>
        <span className="url-scan" aria-hidden="true" />
      </form>

      {props.error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={17} />
          <span>{props.error}</span>
          <button
            className="icon-button"
            aria-label="Закрыть ошибку"
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
            <p>Получаем информацию и доступные разрешения…</p>
          </div>
        </div>
      )}

      {video && !loading && (
        <div className="video-card">
          <div className="thumbnail">
            <img
              src={video.thumbnail}
              alt="Превью видео"
              referrerPolicy="no-referrer"
            />
            <span>{duration(video.duration)}</span>
          </div>
          <div className="video-card-body">
            <span className="found-label">
              <CircleCheck size={14} />
              Видео найдено
            </span>
            <h2>{video.title}</h2>
            <p>
              {video.channel}
              {video.views !== null && (
                <>
                  <span className="dot-sep" />
                  {new Intl.NumberFormat("ru-RU", {
                    notation: "compact",
                  }).format(video.views)}{" "}
                  просмотров
                </>
              )}
              {video.heights.length > 0 && (
                <>
                  <span className="dot-sep" />
                  до {Math.max(...video.heights)}p
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="config-grid">
        <div className="config-block">
          <span className="field-label">Что скачиваем</span>
          <div className="kind-options" role="radiogroup" aria-label="Тип файла">
            {(
              [
                ["video", Video, "Видео + аудио", "Полная версия"],
                ["audio", Headphones, "Только аудио", "Музыка и подкасты"],
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
          <span className="field-label">Формат</span>
          <div className="format-chips" role="radiogroup" aria-label="Формат файла">
            {formats.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                className={`chip ${format === f ? "active" : ""}`}
                onClick={() => setFormat(f)}
                data-tooltip={formatHints[f]}
              >
                {formatName(f)}
              </button>
            ))}
          </div>
          {prefs.kind === "video" ? (
            <Select
              label="Качество видео"
              value={props.quality}
              onChange={props.setQuality}
            >
              <option value="best">Лучшее доступное</option>
              {video?.heights.map((h) => (
                <option key={h} value={h}>
                  {qualityLabel(h)}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              label="Качество аудио"
              value={prefs.audioQuality}
              onChange={(v) => setPrefs((p) => ({ ...p, audioQuality: v }))}
              disabled={["wav", "flac"].includes(format)}
            >
              <option value="best">Лучшее доступное</option>
              {["320", "256", "192", "128"].map((q) => (
                <option key={q} value={q}>
                  {q} кбит/с
                </option>
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
          title={prefs.folder || "Выбрать папку"}
        >
          <Folder size={16} />
          <span className="folder-path-label">Сохранить в</span>
          <span className="folder-path-value">
            {prefs.folder
              ? cleanPath(prefs.folder)
              : props.desktop
                ? "Определяем папку…"
                : "Загрузки / Wdownloader"}
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
          Скачать{" "}
          {clip ? "фрагмент" : prefs.kind === "audio" ? "аудио" : "видео"}
          <span className="button-format">{formatName(format)}</span>
        </button>
      </div>
    </section>
  );
}
