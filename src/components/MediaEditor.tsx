import { t } from "../lib/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CircleAlert,
  Fullscreen,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Scissors,
  Volume,
  VolumeX,
  X,
} from "./icons";
import Select from "./Select";
import {
  parseTimecode,
  setBoundary,
  timecode,
  type ClipRange,
  type MediaSource,
} from "../lib/media";

type Preview = { path: string; duration: number; peaks: number[] };
type Progress = { id: string; stage: string; progress: number | null };
type Props = {
  source: MediaSource;
  clip?: ClipRange | null;
  onClipChange?: (clip: ClipRange | null) => void;
  autoPrepare?: boolean;
};
const stages: Record<string, string> = {
  queued: "Ожидаем подготовки",
  downloading: "Загружаем копию для предпросмотра",
  processing: "Готовим воспроизведение",
  waveform: "Строим звуковую волну",
  ready: "Готово",
};

function TimeField({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(timecode(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(timecode(value));
    setInvalid(false);
  }, [value]);
  function commit() {
    const parsed = parseTimecode(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    onChange(parsed);
    setText(timecode(value));
    setInvalid(false);
  }
  return (
    <label className={`time-field ${invalid ? "invalid" : ""}`}>
      <span>{t(label)}</span>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setText(timecode(value));
            setInvalid(false);
          }
        }}
        aria-label={t(label)}
        aria-invalid={invalid}
        inputMode="decimal"
        spellCheck={false}
      />
      <small>{invalid ? t("Формат 00:00.0") : t("мин : сек")}</small>
    </label>
  );
}

export default function MediaEditor({
  source,
  clip = null,
  onClipChange,
  autoPrepare = false,
}: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [speed, setSpeed] = useState("1");
  const [loop, setLoop] = useState(false);
  const [clickMode, setClickMode] = useState<"seek" | "start" | "end">("seek");
  const [dragging, setDragging] = useState<"seek" | "start" | "end" | null>(
    null,
  );
  const requestId = useRef<string | null>(null);
  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const alive = useRef(true);
  const timeline = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLElement>(null);
  const clipRef = useRef(clip);
  const loopRef = useRef(loop);
  const prepared = useRef(false);
  const waveformId = useId().replace(/:/g, "");
  const total = Math.max(0.1, preview?.duration || source.duration || 0.1);
  const range = clip || { start: 0, end: total };
  clipRef.current = clip;
  loopRef.current = loop;

  useEffect(() => {
    alive.current = true;
    let stop: (() => void) | undefined;
    if (isTauri())
      void listen<Progress>("preview-update", ({ payload }) => {
        if (alive.current && payload.id === requestId.current)
          setProgress(payload);
      }).then((unlisten) => {
        if (alive.current) stop = unlisten;
        else unlisten();
      });
    return () => {
      alive.current = false;
      stop?.();
      media.current?.pause();
      if (requestId.current && isTauri())
        void invoke("cancel_download", { id: requestId.current });
    };
  }, []);

  useEffect(() => {
    if (autoPrepare && !prepared.current) {
      prepared.current = true;
      void prepare();
    }
  }, [autoPrepare]);
  useEffect(() => {
    if (media.current) {
      media.current.volume = volume;
      media.current.playbackRate = Number(speed);
    }
  }, [volume, speed, preview]);

  async function prepare() {
    if (pending) return;
    if (!isTauri()) {
      setError(t("Предпросмотр доступен в настольном приложении."));
      return;
    }
    const id = crypto.randomUUID();
    requestId.current = id;
    setPending(true);
    setError("");
    setProgress({ id, stage: "queued", progress: null });
    try {
      const result = await invoke<Preview>("prepare_preview", {
        url: source.url || null,
        jobId: source.jobId || null,
        kind: source.kind,
        requestId: id,
      });
      if (!alive.current || requestId.current !== id) return;
      setPreview(result);
      if (clip && clip.end > result.duration)
        onClipChange?.({
          start: Math.min(clip.start, result.duration - 0.1),
          end: result.duration,
        });
    } catch (e) {
      if (alive.current && requestId.current === id) setError(String(e));
    } finally {
      if (alive.current && requestId.current === id) {
        requestId.current = null;
        setPending(false);
      }
    }
  }

  function cancel() {
    if (requestId.current) {
      void invoke("cancel_download", { id: requestId.current });
      requestId.current = null;
    }
    setPending(false);
    setProgress(null);
  }
  function seek(value: number) {
    const seconds = Math.max(0, Math.min(value, total));
    setCurrent(seconds);
    if (media.current) media.current.currentTime = seconds;
  }
  async function togglePlayback() {
    if (!media.current || !preview) return;
    if (media.current.paused) {
      if (
        clip &&
        (media.current.currentTime < clip.start ||
          media.current.currentTime >= clip.end - 0.03)
      )
        seek(clip.start);
      try {
        await media.current.play();
      } catch {
        setError(
          t("Не удалось начать воспроизведение. Повторите подготовку предпросмотра."),
        );
      }
    } else media.current.pause();
  }
  function updateTime() {
    if (!media.current) return;
    const time = media.current.currentTime;
    const selection = clipRef.current;
    if (selection && time >= selection.end && !media.current.paused) {
      if (loopRef.current) {
        media.current.currentTime = selection.start;
        setCurrent(selection.start);
      } else {
        media.current.pause();
        media.current.currentTime = selection.end;
        setCurrent(selection.end);
      }
    } else setCurrent(time);
  }
  function boundary(which: "start" | "end", value: number) {
    const next = setBoundary(
      clipRef.current || { start: 0, end: total },
      which,
      value,
      total,
    );
    onClipChange?.(next);
  }
  function position(event: React.PointerEvent<HTMLElement>) {
    const rect = timeline.current!.getBoundingClientRect();
    return (
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total
    );
  }
  function drag(
    event: React.PointerEvent<HTMLElement>,
    mode: "seek" | "start" | "end",
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(mode);
    const value = position(event);
    if (mode === "seek") seek(value);
    else boundary(mode, value);
  }
  function move(event: React.PointerEvent<HTMLElement>) {
    if (!dragging) return;
    const value = position(event);
    if (dragging === "seek") seek(value);
    else boundary(dragging, value);
  }
  const waveform =
    preview?.peaks
      .map((peak, i) => {
        const x = (i / preview.peaks.length) * 1200;
        const h = Math.max(1, peak * 61);
        return `M${x.toFixed(1)},${(70 - h).toFixed(1)}V${(70 + h).toFixed(1)}`;
      })
      .join(" ") || "";
  const mediaProps = {
    src: preview ? convertFileSrc(preview.path) : undefined,
    preload: "metadata",
    onTimeUpdate: updateTime,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      if (loopRef.current && !clipRef.current && media.current) {
        media.current.currentTime = 0;
        void media.current.play();
      } else setPlaying(false);
    },
    onLoadedMetadata: () => {
      if (media.current) {
        media.current.volume = volume;
        media.current.playbackRate = Number(speed);
      }
    },
    onError: () => {
      if (preview)
        setError(
          t("Не удалось открыть медиадорожку. Проверьте файл или подготовьте предпросмотр заново."),
        );
    },
  };

  return (
    <section
      ref={editor}
      className={`media-editor ${source.kind === "audio" ? "audio-editor" : ""}`}
      aria-label={t("Предпросмотр и обрезка")}
    >
      <div className="editor-heading">
        <span>
          <Play size={14} />
          {source.kind === "audio" ? t("АУДИОПЛЕЕР") : t("ВИДЕОПЛЕЕР")}
        </span>
        {onClipChange && (
          <button
            className={`trim-switch ${clip ? "active" : ""}`}
            aria-pressed={!!clip}
            onClick={() => {
              onClipChange(clip ? null : { start: 0, end: total });
              setClickMode("seek");
            }}
          >
            <Scissors size={15} />
            {t("Обрезать фрагмент")}<span className="mini-toggle">
              <i />
            </span>
          </button>
        )}
      </div>
      {source.kind === "video" && (
        <div className={`video-stage ${preview ? "loaded" : ""}`}>
          {preview ? (
            <video
              ref={(el) => {
                media.current = el;
              }}
              {...mediaProps}
              playsInline
              onClick={() => void togglePlayback()}
            />
          ) : (
            <>
              {source.thumbnail && (
                <img
                  src={source.thumbnail}
                  alt={t("Превью видео")}
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="video-stage-shade" />
              {!pending && (
                <button className="preview-play" onClick={() => void prepare()}>
                  <Play size={22} />
                  <span>{t("Подготовить просмотр")}</span>
                </button>
              )}
            </>
          )}
          {pending && (
            <div className="preview-pending">
              <LoaderCircle size={25} className="spin" />
              <strong>{t(stages[progress?.stage || "queued"] || "Подготовка")}</strong>
              {progress?.progress !== null &&
                progress?.progress !== undefined && (
                  <span>{Math.round(progress.progress)}%</span>
                )}
              <button className="text-button" onClick={cancel}>
                {t("Отменить")}{" "}<X size={13} />
              </button>
            </div>
          )}
        </div>
      )}
      {source.kind === "audio" && (
        <audio
          ref={(el) => {
            media.current = el;
          }}
          {...mediaProps}
        />
      )}
      {source.kind === "audio" && !preview && (
        <div className="audio-prepare">
          {pending ? (
            <>
              <LoaderCircle className="spin" size={20} />
              <div>
                <strong>{t(stages[progress?.stage || "queued"] || "Подготовка")}</strong>
                <small>
                  {progress?.progress != null
                    ? `${Math.round(progress.progress)}%`
                    : t("Можно отменить в любой момент")}
                </small>
              </div>
              <button
                className="icon-button"
                onClick={cancel}
                aria-label={t("Отменить подготовку")}
              >
                <X size={17} />
              </button>
            </>
          ) : (
            <>
              <Headphones size={24} />
              <div>
                <strong>{t("Услышьте, прежде чем сохранить")}</strong>
                <small>{t("Подготовим аудио и настоящую звуковую волну.")}</small>
              </div>
              <button
                className="button ghost small"
                onClick={() => void prepare()}
              >
                <Play size={14} />
                {t("Прослушать")}</button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="editor-error" role="alert">
          <CircleAlert size={16} />
          <span>{t(error)}</span>
          <button
            className="text-button"
            onClick={() => {
              setPreview(null);
              void prepare();
            }}
          >
            {t("Повторить")}</button>
        </div>
      )}
      <div className="editor-body">
        <div className="timeline-topline">
          <span>{clip ? t("СОХРАНИТСЯ ВЫДЕЛЕННАЯ ЧАСТЬ") : t("ШКАЛА ВРЕМЕНИ")}</span>
          {clip && (
            <div className="click-modes">
              <span>{t("Клик:")}</span>
              {(
                [
                  ["seek", t("Позиция")],
                  ["start", t("Начало")],
                  ["end", t("Конец")],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setClickMode(mode)}
                  className={clickMode === mode ? "active" : ""}
                  aria-pressed={clickMode === mode}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          ref={timeline}
          className={`waveform-timeline ${clip ? "trimming" : ""} ${dragging ? "dragging" : ""}`}
          onPointerDown={(event) => drag(event, clip ? clickMode : "seek")}
          onPointerMove={move}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
          role="group"
          aria-label={t("Шкала времени")}
        >
          <div className="timeline-grid" />
          {preview ? (
            <svg
              className="waveform"
              viewBox="0 0 1200 140"
              preserveAspectRatio="none"
              aria-label={t("Звуковая волна")}
            >
              <defs>
                <clipPath id={waveformId}>
                  <rect
                    x={(range.start / total) * 1200}
                    y="0"
                    width={((range.end - range.start) / total) * 1200}
                    height="140"
                  />
                </clipPath>
              </defs>
              <path className="wave-dim" d={waveform} strokeWidth="1" />
              <path
                d={waveform}
                className="wave-on"
                strokeWidth="1"
                clipPath={`url(#${waveformId})`}
              />
            </svg>
          ) : (
            <div className="waveform-placeholder">
              <span>
                {pending
                  ? t("Подготавливаем дорожку…")
                  : t("Точные границы можно задать до загрузки предпросмотра")}
              </span>
            </div>
          )}
          {clip && (
            <>
              <div
                className="trim-mask left"
                style={{ width: `${(range.start / total) * 100}%` }}
              />
              <div
                className="trim-mask right"
                style={{ width: `${(1 - range.end / total) * 100}%` }}
              />
              <div
                className="trim-selection"
                style={{
                  left: `${(range.start / total) * 100}%`,
                  width: `${((range.end - range.start) / total) * 100}%`,
                }}
              />
              <span
                className="selection-length"
                style={{
                  left: `${((range.start + range.end) / 2 / total) * 100}%`,
                }}
              >
                {timecode(range.end - range.start)}
              </span>
              {(["start", "end"] as const).map((which) => (
                <button
                  key={which}
                  type="button"
                  role="slider"
                  aria-label={
                    which === "start" ? t("Начало фрагмента") : t("Конец фрагмента")
                  }
                  aria-valuemin={which === "start" ? 0 : range.start + 0.1}
                  aria-valuemax={which === "start" ? range.end - 0.1 : total}
                  aria-valuenow={range[which]}
                  aria-valuetext={timecode(range[which])}
                  className={`trim-handle ${which}`}
                  style={{ left: `${(range[which] / total) * 100}%` }}
                  onPointerDown={(event) => drag(event, which)}
                  onPointerMove={move}
                  onPointerUp={() => setDragging(null)}
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 1 : 0.1;
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      boundary(
                        which,
                        range[which] +
                          (event.key === "ArrowLeft" ? -step : step),
                      );
                    }
                    if (event.key === "Home") {
                      event.preventDefault();
                      boundary(which, 0);
                    }
                    if (event.key === "End") {
                      event.preventDefault();
                      boundary(which, total);
                    }
                  }}
                >
                  <i />
                  <span>{timecode(range[which])}</span>
                </button>
              ))}
            </>
          )}
          <button
            className="playhead"
            style={{ left: `${(current / total) * 100}%` }}
            onPointerDown={(event) => drag(event, "seek")}
            onPointerMove={move}
            onPointerUp={() => setDragging(null)}
            role="slider"
            aria-label={t("Позиция воспроизведения")}
            aria-valuenow={current}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuetext={timecode(current)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                seek(current + (event.key === "ArrowLeft" ? -1 : 1));
              }
            }}
          >
            <i />
          </button>
        </div>
        <div className="timeline-ticks">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i}>{timecode((i / 4) * total)}</span>
          ))}
        </div>
        <div className="player-controls">
          <button
            className="player-play"
            onClick={() => void togglePlayback()}
            disabled={!preview}
            aria-label={playing ? t("Пауза") : t("Воспроизвести")}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="player-time">
            {timecode(current)}
            <span> / {timecode(total)}</span>
          </span>
          <div className="volume-control">
            <button
              className="icon-button"
              onClick={() => setVolume((v) => (v ? 0 : 0.8))}
              aria-label={volume ? t("Выключить звук") : t("Включить звук")}
            >
              {volume ? <Volume size={17} /> : <VolumeX size={17} />}
            </button>
            <input
              className="custom-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label={t("Громкость")}
              style={
                {
                  "--range-progress": `${volume * 100}%`,
                } as React.CSSProperties
              }
            />
          </div>
          <button
            className={`icon-button loop-button ${loop ? "active" : ""}`}
            onClick={() => setLoop((v) => !v)}
            aria-label={t("Повторять выделение")}
            aria-pressed={loop}
            data-tooltip={t("Повторять выделение")}
          >
            <Repeat size={17} />
          </button>
          <div className="speed-select">
            <Select
              label={t("Скорость воспроизведения")}
              value={speed}
              onChange={setSpeed}
            >
              {["0.5", "0.75", "1", "1.25", "1.5", "2"].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </Select>
          </div>
          {source.kind === "video" && (
            <button
              className="icon-button"
              disabled={!preview}
              aria-label={t("Полный экран")}
              data-tooltip={t("Полный экран")}
              onClick={() => void editor.current?.requestFullscreen()}
            >
              <Fullscreen size={17} />
            </button>
          )}
        </div>
        {clip && onClipChange && (
          <div className="trim-fields">
            <div>
              <TimeField
                value={range.start}
                label={t("Начало фрагмента")}
                onChange={(value) => boundary("start", value)}
              />
              <button
                className="set-boundary"
                onClick={() => boundary("start", current)}
                data-tooltip={t("Поставить начало в текущую позицию")}
                aria-label={t("Начало в текущей позиции")}
              >
                [<span>←</span>
              </button>
            </div>
            <span className="trim-fields-dash">→</span>
            <div>
              <TimeField
                value={range.end}
                label={t("Конец фрагмента")}
                onChange={(value) => boundary("end", value)}
              />
              <button
                className="set-boundary"
                onClick={() => boundary("end", current)}
                data-tooltip={t("Поставить конец в текущую позицию")}
                aria-label={t("Конец в текущей позиции")}
              >
                <span>→</span>]
              </button>
            </div>
            <div className="trim-summary">
              <span>{t("Длительность фрагмента")}</span>
              <strong>{timecode(range.end - range.start)}</strong>
              <button
                className="text-button"
                onClick={() => {
                  onClipChange({ start: 0, end: total });
                  seek(0);
                }}
              >
                <RotateCcw size={13} />
                {t("Сбросить")}</button>
            </div>
          </div>
        )}
        <p className="editor-hint">
          {clip
            ? t("Тяните границы или задайте время вручную. Стрелки: 0,1 с, Shift + стрелки: 1 с.")
            : source.jobId
              ? t("Воспроизведение локального файла. Громкость и скорость настраиваются.")
              : t("Для предпросмотра загружается облегчённая копия. Итоговый файл сохранится в выбранном качестве.")}
        </p>
      </div>
    </section>
  );
}
