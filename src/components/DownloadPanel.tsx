import { t, localeTag } from "../lib/i18n";
import { useEffect, useId, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import Select from "./Select";
import MediaEditor from "./MediaEditor";
import {
  Download,
  ClipboardPaste,
  CircleAlert,
  Folder,
  Headphones,
  Link,
  LoaderCircle,
  Scissors,
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
  type Kind,
  type ExtraFormat,
  type SponsorSegment,
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
  kind: Kind;
  setPrefs: Dispatch<SetStateAction<Prefs>>;
  quality: string;
  setQuality: (value: string) => void;
  clip: ClipRange | null;
  setClip: (clip: ClipRange | null) => void;
  desktop: boolean;
  adding: boolean;
  onChooseFolder: () => void;
  onDownload: () => void;
  onSaveExtra: (format: ExtraFormat, language?: string) => void;
  savingExtra: boolean;
  sponsorBlock: boolean;
  sponsorSegments: SponsorSegment[];
  sponsorStatus: "idle" | "loading" | "ready" | "error";
  onSponsorBlock: (enabled: boolean) => void;
};

export default function DownloadPanel(props: Props) {
  const { prefs, setPrefs, video, loading, clip } = props;
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewId = useId();
  useEffect(() => { setPreviewOpen(false); }, [video?.url]);
  const [coverFormat, setCoverFormat] = useState("jpg");
  const [subtitleFormat, setSubtitleFormat] = useState("srt");
  const [subtitleLanguage, setSubtitleLanguage] = useState("");
  const preferredLanguages = [subtitleLanguage, localeTag().split("-")[0], "en"];
  const language = preferredLanguages.find((lang) => video?.subtitles.includes(lang))
    || video?.subtitles[0] || "";
  const languageNames = new Intl.DisplayNames([localeTag()], { type: "language" });
  const languageName = (code: string) => {
    try { return languageNames.of(code) || code; } catch { return code; }
  };
  const format = props.kind === "video" ? prefs.videoFormat : prefs.audioFormat;
  const formats = props.kind === "video" ? videoFormats : audioFormats;
  const setFormat = (value: string) =>
    setPrefs((p) => ({
      ...p,
      [props.kind === "video" ? "videoFormat" : "audioFormat"]: value,
    }));

  const sponsorHints = {
    idle: "По отметкам SponsorBlock",
    loading: "Ищем отметки SponsorBlock…",
    ready: props.sponsorSegments.length ? "По отметкам SponsorBlock" : "В SponsorBlock нет отметок для этого видео.",
    error: "Не удалось показать отметки SponsorBlock.",
  };
  const sponsorHint = clip ? "SponsorBlock доступен при сохранении целиком." : sponsorHints[props.sponsorStatus];

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
            placeholder={t("Вставьте ссылку на видео или трек")}
            aria-label={t("Ссылка на видео или трек")}
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
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
              {t("Открыть")}
            </>
          )}
        </button>
      </form>
      {!video && !loading && <p className="platforms">YouTube, VK Видео, Twitch, TikTok, SoundCloud</p>}

      {props.error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={17} />
          <div className="inline-error-body">
            <span>{t(props.error)}</span>
            {props.desktop && props.url.trim() && (
              <div className="inline-error-actions">
                {/YouTube.*(?:не бот|вход|sign in|not a bot)/i.test(props.error) && (
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
            <p>{t("Загружаем данные о файле…")}</p>
          </div>
        </div>
      )}

      {video && !loading && (
        <div className="video-card">
          <div className="thumbnail">
            {video.hasVideo ? <Video size={32} /> : <Headphones size={32} />}
            {video.thumbnail && <img src={video.thumbnail} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
            {video.duration > 0 && <span>{duration(video.duration)}</span>}
          </div>
          <div className="video-card-body">
            <span className="source-label">{video.platform}</span>
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
            <button
              type="button"
              className="button preview-toggle"
              aria-expanded={previewOpen}
              aria-controls={previewId}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen ? <X size={16} /> : <Scissors size={18} />}
              {t(previewOpen ? "Свернуть предпросмотр" : "Предпросмотр и обрезка")}
            </button>
          </div>
        </div>
      )}

      {video && (
        <>
          <div id={previewId} className="preview-panel" hidden={!previewOpen}>
            {previewOpen && <MediaEditor
              key={`${video.url}-${props.kind}`}
              source={{
                url: video.url,
                title: video.title,
                duration: video.duration,
                thumbnail: video.thumbnail,
                kind: props.kind,
              }}
              clip={clip}
              onClipChange={props.sponsorBlock ? undefined : props.setClip}
              sponsorSegments={props.sponsorBlock ? props.sponsorSegments : []}
            />}
          </div>
          <div className="config-grid">
            <div className="config-block">
              <span className="field-label">{t("Что скачиваем")}</span>
              <div className="kind-options" role="radiogroup" aria-label={t("Тип файла")}>
                {(
                  [
                    ["video", Video, t("Видео")],
                    ["audio", Headphones, t("Только аудио")],
                  ] as const
                ).map(([kind, Icon, title]) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={props.kind === kind}
                    disabled={kind === "video" ? !video.hasVideo : !video.hasAudio}
                    className={`kind-card ${props.kind === kind ? "active" : ""}`}
                    onClick={() => setPrefs((p) => ({ ...p, kind }))}
                  >
                    <span className="kind-icon">
                      <Icon size={20} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                    </span>
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
              {props.kind === "video" ? (
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

          {(video.platform === "YouTube" || props.kind === "audio") && (
            <fieldset className="processing-options">
              <legend>{t("Обработка")}</legend>
              {video.platform === "YouTube" && (
                <div>
                  <label className="option-check">
                    <input type="checkbox" checked={props.sponsorBlock} aria-describedby="sponsorblock-note" disabled={!!clip} onChange={(event) => props.onSponsorBlock(event.target.checked)} />
                    {t("Вырезать рекламу и интро")}
                  </label>
                  <small id="sponsorblock-note" role="status">{t(sponsorHint)}</small>
                </div>
              )}
              {props.kind === "audio" && ([
                ["normalizeAudio", "Нормализовать громкость", "Цель −16 LUFS"],
                ["removeSilence", "Вырезать паузы", "Паузы от 0,6 секунды"],
                ["enhanceVoice", "Выделить речь", "Усиливает диалоги в центре звуковой дорожки"],
              ] as const).map(([key, label, hint]) => (
                <div key={key}>
                  <label className="option-check">
                    <input type="checkbox" checked={prefs[key]} aria-describedby={`audio-option-${key}`} onChange={(event) => setPrefs((p) => ({ ...p, [key]: event.target.checked }))} />
                    {t(label)}
                  </label>
                  <small id={`audio-option-${key}`}>{t(hint)}</small>
                </div>
              ))}
            </fieldset>
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
              className="button primary download-button"
              disabled={loading || props.adding}
              onClick={props.onDownload}
            >
              {props.adding ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Download size={20} />
              )}
              {t("Скачать")}{" "}
              {clip ? t("фрагмент") : props.kind === "audio" ? t("аудио") : t("видео")}
              <span className="button-format">{formatName(format)}</span>
            </button>
          </div>
          {(video.thumbnail || video.subtitles.length > 0) && (
            <div className="extra-files" aria-label={t("Дополнительные файлы")}>
              {video.thumbnail && <div className="extra-row">
                <button type="button" className="button ghost small" disabled={props.savingExtra} onClick={() => props.onSaveExtra(coverFormat as ExtraFormat)}>{t("Сохранить обложку")}</button>
                <select aria-label={t("Формат обложки")} value={coverFormat} onChange={(event) => setCoverFormat(event.target.value)}>
                  <option value="jpg">JPG</option><option value="webp">WebP</option>
                </select>
              </div>}
              {video.subtitles.length > 0 && <div className="extra-row">
                <button type="button" className="button ghost small" disabled={props.savingExtra} onClick={() => props.onSaveExtra(subtitleFormat as ExtraFormat, language)}>{t("Скачать субтитры")}</button>
                <select aria-label={t("Язык субтитров")} value={language} onChange={(event) => setSubtitleLanguage(event.target.value)}>
                  {video.subtitles.map((code) => <option key={code} value={code}>{languageName(code)}</option>)}
                </select>
                <select aria-label={t("Формат субтитров")} value={subtitleFormat} onChange={(event) => setSubtitleFormat(event.target.value)}>
                  <option value="srt">SRT</option><option value="txt">TXT</option>
                </select>
              </div>}
              {props.savingExtra && <span className="extra-progress" role="status"><LoaderCircle className="spin" size={14} />{t("Сохраняем…")}</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
