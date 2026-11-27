import { t, initializeLanguage, useLanguage } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import Titlebar from "./Titlebar";
import Sidebar from "./Sidebar";
import LanguageSwitch from "./LanguageSwitch";
import LegalDocuments from "./LegalDocuments";
import DownloadPanel from "./DownloadPanel";
import JobList from "./JobList";
import SettingsPage from "./SettingsPage";
import { CreditsModal, HelpModal, PlaybackModal } from "./Dialogs";
import ToolchainBanner, {
  type InstallFailure,
  type InstallProgress,
} from "./ToolchainBanner";
import {
  Check,
  CircleAlert,
  IconContext,
  Moon,
  Sun,
  X,
} from "./icons";
import {
  appearanceKey,
  applyAppearance,
  defaultAppearance,
  parseAppearance,
  resolveTheme,
  revealTheme,
  type Appearance,
} from "../lib/appearance";
import {
  activeStates,
  defaultPrefs,
  errorText,
  type Dependencies,
  type Job,
  type ExtraFormat,
  type SponsorSegment,
  type Page,
  type Prefs,
  type Request,
  type VideoInfo,
  type YtdlpUpdate,
} from "../lib/types";
import type { ClipRange } from "../lib/media";

type Toast = { id: number; text: string; tone: "info" | "error" };

const pages: Record<Page, { title: string; text: string }> = {
  downloads: {
    title: "Скачать медиа",
    text: "",
  },
  history: {
    title: "История загрузок",
    text: "Загруженные файлы, отмены и повторные попытки.",
  },
  settings: {
    title: "Настройки",
    text: "Папка, внешний вид и компоненты приложения.",
  },
};

const legalKey = "wd-legal-accepted";
const legalRevision = "2026-11-28";

export default function App() {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    initializeLanguage();
    try {
      setAccepted(localStorage.getItem(legalKey) === legalRevision);
    } catch {
      setAccepted(false);
    }
  }, []);
  const accept = useCallback(() => {
    try {
      localStorage.setItem(legalKey, legalRevision);
    } catch {
      /* При следующем запуске спросим снова. */
    }
    setAccepted(true);
  }, []);

  if (accepted) return <Workspace />;
  return (
    <div className="app-shell legal-shell">
      <Titlebar />
      <main className="legal-start">
        {accepted === false && <LegalDocuments onAccept={accept} />}
      </main>
    </div>
  );
}

function Workspace() {
  useLanguage();
  const [page, setPage] = useState<Page>("downloads");
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const [prefersDark, setPrefersDark] = useState(true);
  const [desktop, setDesktop] = useState(false);
  const [deps, setDeps] = useState<Dependencies | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [installError, setInstallError] = useState<InstallFailure | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [quality, setQuality] = useState("best");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [savingExtra, setSavingExtra] = useState(false);
  const [sponsorBlock, setSponsorBlock] = useState(false);
  const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
  const [sponsorStatus, setSponsorStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [updatingYtdlp, setUpdatingYtdlp] = useState(false);
  const [ytdlpUpdate, setYtdlpUpdate] = useState<YtdlpUpdate | null>(null);
  const [ytdlpUpdateError, setYtdlpUpdateError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [clip, setClip] = useState<ClipRange | null>(null);
  const [playbackJob, setPlaybackJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const requestCounter = useRef(0);
  const installerBusy = useRef(false);
  const updaterBusy = useRef(false);
  const toastCounter = useRef(0);
  const downloadBusy = useRef(false);
  const extraBusy = useRef(false);
  const active = jobs.filter((j) => activeStates.includes(j.status));
  const finished = jobs.filter((j) => !activeStates.includes(j.status));
  const completed = jobs.filter((j) => j.status === "completed");
  const ready =
    !!deps?.ytDlp && !!deps?.ffmpeg && !!deps?.ffprobe && !!deps?.deno;
  const kind = video && !video.hasVideo ? "audio" : video && !video.hasAudio ? "video" : prefs.kind;
  const dark = resolveTheme(appearance.theme, prefersDark) === "dark";

  function notify(text: string, tone: Toast["tone"] = "info") {
    setToastLeaving(false);
    setToast({ id: ++toastCounter.current, text, tone });
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("wd-preferences") || "null",
      );
      if (saved) setPrefs({ ...defaultPrefs, ...saved });
      setAppearance(
        parseAppearance(
          JSON.parse(localStorage.getItem(appearanceKey) || "null"),
        ),
      );
    } catch {
      /* Старые настройки можно пропустить. */
    }
    setLoaded(true);
    const query = matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);
    const onScheme = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    query.addEventListener("change", onScheme);
    const native = isTauri();
    setDesktop(native);
    if (!native) return () => query.removeEventListener("change", onScheme);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let stopInstall: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<Job>("download-update", ({ payload }) => {
          if (disposed) return;
          setJobs((previous) =>
            [payload, ...previous.filter((j) => j.id !== payload.id)].sort(
              (a, b) => b.created - a.created,
            ),
          );
        });
        if (disposed) {
          unlisten();
          return;
        }
        stopInstall = await listen<InstallProgress>(
          "install-progress",
          ({ payload }) => {
            if (!disposed) setInstallProgress(payload);
          },
        );
        if (disposed) {
          stopInstall();
          return;
        }
        const dependencies = await invoke<Dependencies>("check_dependencies");
        if (disposed) return;
        setDeps(dependencies);
        if (
          !dependencies.ytDlp ||
          !dependencies.ffmpeg ||
          !dependencies.ffprobe ||
          !dependencies.deno
        )
          void runInstaller();
        else
          void updateYtdlp(false);
        setPrefs((p) => ({ ...p, folder: p.folder || dependencies.folder }));
        const history = await invoke<Job[]>("get_jobs");
        if (disposed) return;
        setJobs((previous) => {
          const merged = new Map(history.map((j) => [j.id, j]));
          previous.forEach((j) => merged.set(j.id, j));
          return [...merged.values()].sort((a, b) => b.created - a.created);
        });
      } catch (e) {
        if (!disposed) setError(errorText(e));
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
      stopInstall?.();
      query.removeEventListener("change", onScheme);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("wd-preferences", JSON.stringify(prefs));
    } catch {
      /* Настройки останутся в этой сессии. */
    }
  }, [prefs, loaded]);
  useEffect(() => {
    applyAppearance(appearance, prefersDark);
    if (!loaded) return;
    try {
      localStorage.setItem(appearanceKey, JSON.stringify(appearance));
    } catch {
      /* Внешний вид останется в этой сессии. */
    }
  }, [appearance, prefersDark, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const zoom = appearance.scale / 100;
    if (!desktop) {
      root.style.setProperty("--browser-zoom", String(zoom));
      return;
    }
    let current = true;
    void getCurrentWebview().setZoom(zoom).then(
      () => { if (current) root.style.removeProperty("--browser-zoom"); },
      () => { if (current) root.style.setProperty("--browser-zoom", String(zoom)); },
    );
    return () => { current = false; };
  }, [appearance.scale, desktop, loaded]);
  useEffect(() => {
    if (!toast) return;
    const leave = setTimeout(() => setToastLeaving(true), 4000);
    const clear = setTimeout(() => setToast(null), 4250);
    return () => {
      clearTimeout(leave);
      clearTimeout(clear);
    };
  }, [toast]);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        navigate("downloads");
        setTimeout(() => urlRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!video || !sponsorBlock) {
      setSponsorSegments([]);
      setSponsorStatus("idle");
      return;
    }
    let current = true;
    setSponsorStatus("loading");
    void invoke<SponsorSegment[]>("sponsor_segments", { url: video.url }).then((segments) => {
      if (!current) return;
      setSponsorSegments(segments);
      setSponsorStatus("ready");
    }).catch(() => {
      if (current) setSponsorStatus("error");
    });
    return () => { current = false; };
  }, [sponsorBlock, video]);

  function changeAppearance(next: Appearance, from?: HTMLElement | null) {
    const before = resolveTheme(appearance.theme, prefersDark);
    const after = resolveTheme(next.theme, prefersDark);
    if (before === after) {
      setAppearance(next);
      return;
    }
    const rect = from?.getBoundingClientRect();
    revealTheme(
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      () => {
        flushSync(() => setAppearance(next));
        applyAppearance(next, prefersDark);
      },
    );
  }

  function navigate(next: Page) {
    setPage(next);
    setFilter("all");
    setSearch("");
    mainRef.current?.scrollTo({ top: 0 });
  }
  function changeUrl(value: string) {
    requestCounter.current++;
    setUrl(value);
    setVideo(null);
    setClip(null);
    setSponsorBlock(false);
    setLoading(false);
    setError("");
  }
  async function analyze(e?: { preventDefault: () => void }) {
    e?.preventDefault();
    if (!url.trim()) {
      urlRef.current?.focus();
      return;
    }
    if (!desktop) {
      setError(
        t("Откройте настольное приложение: npm run desktop. Браузер показывает только интерфейс."),
      );
      return;
    }
    const number = ++requestCounter.current;
    setLoading(true);
    setError("");
    setVideo(null);
    setClip(null);
    setSponsorBlock(false);
    try {
      const result = await invoke<VideoInfo>("inspect_video", { url });
      if (number === requestCounter.current) {
        setVideo(result);
        setQuality("best");
      }
    } catch (e) {
      if (number === requestCounter.current) setError(errorText(e));
    } finally {
      if (number === requestCounter.current) setLoading(false);
    }
  }
  async function youtubeLogin() {
    try {
      if (await invoke<boolean>("youtube_login")) {
        notify(t("Вход выполнен, повторяем запрос"));
        void analyze();
      }
    } catch (e) {
      notify(errorText(e), "error");
    }
  }
  async function paste() {
    try {
      changeUrl(await navigator.clipboard.readText());
      urlRef.current?.focus();
    } catch {
      notify(t("Нажмите Ctrl+V в поле ссылки."));
      urlRef.current?.focus();
    }
  }
  async function chooseFolder() {
    if (!desktop) {
      notify(t("Выбор папки доступен в настольном приложении."));
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("Папка для загрузок"),
      });
      if (typeof selected === "string")
        setPrefs((p) => ({ ...p, folder: selected }));
    } catch (e) {
      notify(errorText(e), "error");
    }
  }
  async function addDownload(request?: Request) {
    if (downloadBusy.current || (!video && !request)) return;
    if (!ready) {
      setError(t("Проверьте yt-dlp, FFmpeg и Deno в настройках приложения."));
      if (page !== "downloads")
        notify(t("Проверьте компоненты в настройках."), "error");
      return;
    }
    const format =
      kind === "video" ? prefs.videoFormat : prefs.audioFormat;
    downloadBusy.current = true;
    setAdding(true);
    setError("");
    try {
      const job = await invoke<Job>("start_download", {
        request: request || {
          url: video!.url,
          title: video!.title,
          kind,
          format,
          quality: kind === "video" ? quality : prefs.audioQuality,
          folder: prefs.folder,
          metadata: prefs.metadata,
          clip,
          sponsorBlock: sponsorBlock && video!.platform === "YouTube",
          normalizeAudio: kind === "audio" && prefs.normalizeAudio,
          removeSilence: kind === "audio" && prefs.removeSilence,
          enhanceVoice: kind === "audio" && prefs.enhanceVoice,
        },
      });
      setJobs((previous) =>
        previous.some((j) => j.id === job.id) ? previous : [job, ...previous],
      );
      notify(t("Загрузка добавлена в очередь"));
    } catch (e) {
      setError(errorText(e));
      if (page !== "downloads") notify(errorText(e), "error");
    } finally {
      downloadBusy.current = false;
      setAdding(false);
    }
  }
  async function saveExtra(format: ExtraFormat, language?: string) {
    if (!video || extraBusy.current) return;
    extraBusy.current = true;
    setSavingExtra(true);
    try {
      const path = await invoke<string>("save_extra", { url: video.url, folder: prefs.folder, format, language });
      const filename = path.split(/[\\/]/).at(-1) || path;
      notify(t("Файл сохранён: {0}", { 0: filename }));
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      extraBusy.current = false;
      setSavingExtra(false);
    }
  }
  async function action(command: string, args?: Record<string, unknown>) {
    if (!desktop) {
      notify(t("Откройте настольную версию приложения."));
      return false;
    }
    try {
      await invoke(command, args);
      return true;
    } catch (e) {
      notify(errorText(e), "error");
      return false;
    }
  }
  async function clearHistory() {
    const cleared = await action("clear_history");
    if (cleared)
      setJobs((previous) =>
        previous.filter((j) => activeStates.includes(j.status)),
      );
  }
  async function checkDependencies() {
    setChecking(true);
    try {
      const result = await invoke<Dependencies>("check_dependencies");
      setDeps(result);
      if (result.ytDlp && result.ffmpeg && result.ffprobe && result.deno)
        setInstallError(null);
      notify(t("Проверка компонентов завершена"));
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setChecking(false);
    }
  }
  async function runInstaller() {
    if (installerBusy.current) return;
    installerBusy.current = true;
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    try {
      setDeps(await invoke<Dependencies>("ensure_dependencies"));
      void updateYtdlp(false);
    } catch (e) {
      const failure = e as Partial<InstallFailure>;
      setInstallError({
        tool: failure?.tool || "компоненты",
        message: failure?.message || errorText(e),
        folder:
          failure?.folder ||
          deps?.toolsFolder ||
          "Папка данных приложения / tools",
      });
      try {
        setDeps(await invoke<Dependencies>("check_dependencies"));
      } catch {
        /* Основную ошибку уже показываем. */
      }
    } finally {
      installerBusy.current = false;
      setInstalling(false);
    }
  }

  async function updateYtdlp(force: boolean) {
    if (updaterBusy.current) return;
    updaterBusy.current = true;
    setUpdatingYtdlp(true);
    setYtdlpUpdateError("");
    try {
      const result = await invoke<YtdlpUpdate>("update_ytdlp", { force });
      setYtdlpUpdate(result);
      if (result.status === "updated") {
        setDeps(await invoke<Dependencies>("check_dependencies"));
        notify(t("yt-dlp обновлён до {0}", { 0: result.version }));
      }
    } catch (e) {
      setYtdlpUpdateError(errorText(e));
      notify(t("Не удалось обновить yt-dlp. Повторите проверку в настройках."), "error");
    } finally {
      updaterBusy.current = false;
      setUpdatingYtdlp(false);
    }
  }

  const heading = pages[page];

  return (
    <IconContext.Provider
      value={{ style: appearance.iconStyle, stroke: appearance.stroke }}
    >
      <div className="app-shell">
        <Titlebar />
        <Sidebar
          page={page}
          onNavigate={navigate}
          activeCount={active.length}
          historyCount={finished.length}
          onOpenFolder={() => void action("open_folder", { id: null, folder: prefs.folder })}
          onHelp={() => setShowHelp(true)}
          onSecret={() => setShowCredits(true)}
        />
        <div className="main-shell" ref={mainRef}>
          <header className="topbar">
            <div className="topbar-right">
              <LanguageSwitch />
              <span className="shortcut-hint">
                <kbd>Ctrl</kbd>
                <kbd>L</kbd>
                <span>{t("ссылка")}</span>
              </span>
              <button
                className="button ghost theme-flip"
                aria-label={dark ? t("Светлая тема") : t("Тёмная тема")}
                onClick={(event) =>
                  changeAppearance(
                    { ...appearance, theme: dark ? "light" : "dark" },
                    event.currentTarget,
                  )
                }
              >
                <span key={dark ? "dark" : "light"} className="theme-flip-icon">
                  {dark ? <Sun size={18} /> : <Moon size={18} />}
                </span>
                {dark ? t("Светлая тема") : t("Тёмная тема")}
              </button>
            </div>
          </header>
          <main key={page} className={`page page-${page}`}>
            <div className="page-heading">
              <h1>{t(heading.title)}</h1>
              {heading.text && <p>{t(heading.text)}</p>}
            </div>

            <ToolchainBanner
              pending={installing}
              progress={installProgress}
              error={installError}
              onRetry={() => void runInstaller()}
              onCheck={() => void checkDependencies()}
            />

            {page === "downloads" && (
              <DownloadPanel
                urlRef={urlRef}
                url={url}
                onUrlChange={changeUrl}
                onAnalyze={analyze}
                onPaste={() => void paste()}
                loading={loading}
                installing={installing}
                video={video}
                error={error}
                onDismissError={() => setError("")}
                onRetry={() => void analyze()}
                onOpenBrowser={() => void invoke("open_in_browser", { url }).catch((e) => notify(errorText(e), "error"))}
                onLogin={() => void youtubeLogin()}
                prefs={prefs}
                setPrefs={setPrefs}
                kind={kind}
                quality={quality}
                setQuality={setQuality}
                clip={clip}
                setClip={setClip}
                desktop={desktop}
                adding={adding}
                onChooseFolder={() => void chooseFolder()}
                onDownload={() => void addDownload()}
                onSaveExtra={(format, language) => void saveExtra(format, language)}
                savingExtra={savingExtra}
                sponsorBlock={sponsorBlock}
                sponsorSegments={sponsorSegments}
                sponsorStatus={sponsorStatus}
                onSponsorBlock={setSponsorBlock}
              />
            )}

            {page === "settings" ? (
              <SettingsPage
                prefs={prefs}
                setPrefs={setPrefs}
                appearance={appearance}
                onAppearance={changeAppearance}
                deps={deps}
                desktop={desktop}
                checking={checking}
                installing={installing}
                ready={ready}
                onChooseFolder={() => void chooseFolder()}
                onCheck={() => void checkDependencies()}
                onInstall={() => void runInstaller()}
                updatingYtdlp={updatingYtdlp}
                ytdlpUpdate={ytdlpUpdate}
                ytdlpUpdateError={ytdlpUpdateError}
                onUpdateYtdlp={() => void updateYtdlp(true)}
              />
            ) : (
              <JobList
                page={page}
                jobs={jobs}
                activeCount={active.length}
                completedCount={completed.length}
                filter={filter}
                setFilter={setFilter}
                search={search}
                setSearch={setSearch}
                adding={adding}
                onClear={() => void clearHistory()}
                onShowHistory={() => navigate("history")}
                onFocusUrl={() => {
                  urlRef.current?.focus();
                  mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onPlay={setPlaybackJob}
                onAction={(command, args) => void action(command, args)}
                onRetry={(request) => void addDownload(request)}
              />
            )}
          </main>
        </div>
        {toast && (
          <div
            key={toast.id}
            className={`toast ${toast.tone} ${toastLeaving ? "leaving" : ""}`}
            role="status"
          >
            {toast.tone === "error" ? (
              <CircleAlert size={17} />
            ) : (
              <Check size={17} />
            )}
            <span>{t(toast.text)}</span>
            <button
              className="icon-button"
              onClick={() => setToast(null)}
              aria-label={t("Закрыть уведомление")}
            >
              <X size={15} />
            </button>
            <i className="toast-timer" />
          </div>
        )}
        {playbackJob && (
          <PlaybackModal
            job={playbackJob}
            onClose={() => setPlaybackJob(null)}
          />
        )}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showCredits && <CreditsModal onClose={() => setShowCredits(false)} />}
      </div>
    </IconContext.Provider>
  );
}
