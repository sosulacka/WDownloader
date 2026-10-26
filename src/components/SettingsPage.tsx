import { t } from "../lib/i18n";
import type { Dispatch, SetStateAction } from "react";
import Segmented from "./Segmented";
import LanguageSwitch from "./LanguageSwitch";
import YouTubeSession from "./YouTubeSession";
import Logo, { Wordmark } from "./Logo";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Folder,
  Info,
  Moon,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Video,
  CircleHalf,
} from "./icons";
import type { Appearance, IconStyle, Theme } from "../lib/appearance";
import { cleanPath, type Dependencies, type Prefs, type YtdlpUpdate } from "../lib/types";

type Props = {
  prefs: Prefs;
  setPrefs: Dispatch<SetStateAction<Prefs>>;
  appearance: Appearance;
  onAppearance: (next: Appearance, from?: HTMLElement | null) => void;
  deps: Dependencies | null;
  desktop: boolean;
  checking: boolean;
  installing: boolean;
  ready: boolean;
  onChooseFolder: () => void;
  onCheck: () => void;
  onInstall: () => void;
  updatingYtdlp: boolean;
  ytdlpUpdate: YtdlpUpdate | null;
  ytdlpUpdateError: string;
  onUpdateYtdlp: () => void;
};

const themeOptions: readonly (readonly [Theme, string, typeof Sun])[] = [
  ["dark", "Чёрная", Moon],
  ["light", "Белая", Sun],
  ["system", "Как в системе", CircleHalf],
];
const iconOptions: readonly (readonly [IconStyle, string])[] = [
  ["round", "Скруглённые"],
  ["sharp", "Острые"],
  ["duo", "Двухтон"],
  ["sharp-duo", "Острый двухтон"],
];

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      className="toggle-row"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
    >
      <span>
        <strong>{t(label)}</strong>
        {description && <small>{t(description)}</small>}
      </span>
      <span className="toggle">
        <i />
      </span>
    </button>
  );
}

export default function SettingsPage({
  prefs,
  setPrefs,
  appearance,
  onAppearance,
  deps,
  desktop,
  checking,
  installing,
  ready,
  onChooseFolder,
  onCheck,
  onInstall,
  updatingYtdlp,
  ytdlpUpdate,
  ytdlpUpdateError,
  onUpdateYtdlp,
}: Props) {
  const tools = [
    ["yt-dlp", t("Загрузка видео и получение форматов"), deps?.ytDlp],
    ["FFmpeg", t("Конвертация и объединение дорожек"), deps?.ffmpeg],
    ["ffprobe", t("Проверка длительности и медиадорожек"), deps?.ffprobe],
    ["Deno", t("JavaScript для извлечения видео YouTube"), deps?.deno],
  ] as const;

  return (
    <div className="settings-grid">
      <section className="card settings-card appearance-card">
        <div className="card-title">
          <span className="card-title-icon">
            <Palette size={18} />
          </span>
          <div>
            <h2>{t("Внешний вид")}</h2>
            <p>{t("Тема, иконки и движение интерфейса.")}</p>
          </div>
        </div>
        <div className="settings-language">
          <div>
            <span className="field-label">{t("Язык интерфейса")}</span>
            <p>{t("Изменения применяются сразу.")}</p>
          </div>
          <LanguageSwitch />
        </div>
        <span className="field-label">{t("Тема")}</span>
        <div className="theme-options" role="radiogroup" aria-label={t("Тема")}>
          {themeOptions.map(([theme, label, Icon]) => (
            <button
              key={theme}
              type="button"
              role="radio"
              aria-checked={appearance.theme === theme}
              className={`theme-card ${theme}`}
              onClick={(event) =>
                onAppearance({ ...appearance, theme }, event.currentTarget)
              }
            >
              <span className="theme-preview" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="theme-card-label">
                <Icon size={15} />
                {t(label)}
                <span className="radio" />
              </span>
            </button>
          ))}
        </div>
        <span className="field-label">{t("Иконки")}</span>
        <div className="icon-style-row">
          <Segmented
            label={t("Стиль иконок")}
            value={appearance.iconStyle}
            onChange={(iconStyle) => onAppearance({ ...appearance, iconStyle })}
            options={iconOptions}
          />
          <div className="icon-sample" aria-hidden="true">
            <Download size={20} />
            <Video size={20} />
            <Folder size={20} />
            <Sparkles size={20} />
          </div>
        </div>
        <span className="field-label">{t("Толщина линий")}</span>
        <Segmented
          label={t("Толщина линий")}
          value={String(appearance.stroke)}
          onChange={(value) =>
            onAppearance({ ...appearance, stroke: Number(value) })
          }
          options={[
            ["1.5", t("Тонкие")],
            ["1.75", t("Средние")],
            ["2", t("Плотные")],
          ]}
        />
        <Toggle
          checked={appearance.motion}
          onChange={() =>
            onAppearance({ ...appearance, motion: !appearance.motion })
          }
          label={t("Анимации")}
          description={t("Плавные переходы, появление элементов и смена темы.")}
        />
      </section>

      <section className="card settings-card">
        <div className="card-title">
          <span className="card-title-icon">
            <Folder size={18} />
          </span>
          <div>
            <h2>{t("Сохранение файлов")}</h2>
            <p>{t("Параметры для новых загрузок.")}</p>
          </div>
        </div>
        <span className="field-label">{t("Папка по умолчанию")}</span>
        <button
          className="settings-folder"
          onClick={(event) => {
            const selection = window.getSelection();
            if (
              selection &&
              !selection.isCollapsed &&
              selection.anchorNode &&
              event.currentTarget.contains(selection.anchorNode)
            ) return;
            onChooseFolder();
          }}
        >
          <Folder size={17} />
          <span>
            {prefs.folder ? cleanPath(prefs.folder) : t("Выбрать папку загрузок")}
          </span>
          <ChevronRight size={15} />
        </button>
        <Toggle
          checked={prefs.metadata}
          onChange={() => setPrefs((p) => ({ ...p, metadata: !p.metadata }))}
          label={t("Сохранять метаданные")}
          description={t("Название, автор и главы, если формат их поддерживает.")}
        />
      </section>

      <YouTubeSession desktop={desktop} />

      <section className="card settings-card wide">
        <div className="card-title">
          <span className="card-title-icon">
            <SlidersHorizontal size={18} />
          </span>
          <div>
            <h2>{t("Компоненты приложения")}</h2>
            <p>{t("Локальные инструменты для скачивания и обработки.")}</p>
          </div>
          <button
            className="icon-button"
            onClick={onCheck}
            disabled={checking || !desktop}
            aria-label={t("Проверить компоненты")}
            data-tooltip={t("Повторить проверку")}
          >
            <RotateCcw size={17} className={checking ? "spin" : ""} />
          </button>
        </div>
        <div className="dependency-grid">
          {tools.map(([name, description, path]) => (
            <div className={`dependency ${path ? "ok" : ""}`} key={name}>
              <span className="dependency-icon">
                {path ? <Check size={16} /> : <CircleAlert size={16} />}
              </span>
              <div>
                <strong>{name}</strong>
                <p>{t(description)}</p>
                {path && <small title={path}>{cleanPath(path)}</small>}
              </div>
              <span className="dependency-status">
                {path ? t("Готов") : desktop ? t("Не найден") : "Desktop"}
              </span>
            </div>
          ))}
        </div>
        <div className="setup-note">
          <Info size={16} />
          <span>
            {t("Недостающие компоненты устанавливаются при запуске. При ошибке можно повторить установку или открыть инструкцию выше.")}</span>
          <button
            className="button ghost small"
            disabled={!desktop || installing || ready}
            onClick={onInstall}
          >
            {installing
              ? t("Устанавливаем…")
              : ready
                ? t("Все компоненты готовы")
                : t("Установить компоненты")}
          </button>
        </div>
        <div className="ytdlp-updater">
          <div>
            <strong>{t("Автообновление yt-dlp")}</strong>
            <p>{t("Проверка при запуске, не чаще раза в сутки. Новая версия проверяется по SHA256; при ошибке старая остаётся на месте.")}</p>
            {ytdlpUpdate?.version && !ytdlpUpdateError && (
              <small>{t("Версия yt-dlp: {0}", { 0: ytdlpUpdate.version })}</small>
            )}
            {ytdlpUpdate?.status === "deferred" && <small>{t("Повторите проверку после завершения загрузок и предпросмотра.")}</small>}
            {ytdlpUpdate?.status === "unsupported" && <small>{t("Автообновление доступно для Windows x64.")}</small>}
          </div>
          <button type="button" className="button secondary small" disabled={!desktop || installing || updatingYtdlp} onClick={onUpdateYtdlp}>
            <RotateCcw size={15} className={updatingYtdlp ? "spin" : ""} />
            {t(updatingYtdlp ? "Проверяем…" : ytdlpUpdateError ? "Повторить обновление" : "Проверить обновление yt-dlp")}
          </button>
        </div>
        {ytdlpUpdateError && <div className="inline-error" role="alert"><CircleAlert size={17} /><span>{t(ytdlpUpdateError)}</span></div>}
      </section>

      <section className="card settings-card wide about-card">
        <Logo size={44} />
        <div>
          <Wordmark />
          <p>{t("Версия 0.1.1 · Rust + Tauri v2 + Astro · Иконки Keyline Icons")}</p>
          <small>
            {t("Обработка идёт на вашем устройстве. FLAC и WAV сохраняют результат декодирования и не восстанавливают качество, потерянное при сжатии на YouTube.")}</small>
        </div>
      </section>
    </div>
  );
}
