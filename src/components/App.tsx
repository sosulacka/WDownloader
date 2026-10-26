import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Titlebar from "./Titlebar";
import Sidebar from "./Sidebar";
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
  type Page,
  type Prefs,
  type Request,
  type VideoInfo,
} from "../lib/types";
import type { ClipRange } from "../lib/media";

type Toast = { id: number; text: string; tone: "info" | "error" };

const pages: Record<Page, { title: [string, string]; text: string }> = {
  downloads: {
    title: ["Сохраните", "нужное."],
    text: "Видео или только звук. В нужном качестве и формате.",
  },
  history: {
    title: ["История", "загрузок."],
    text: "Загруженные файлы, отмены и повторные попытки.",
  },
  settings: {
    title: ["Всё", "под контролем."],
    text: "Папка, внешний вид и компоненты приложения.",
  },
};

export default function App() {
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
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [clip, setClip] = useState<ClipRange | null>(null);
  const [playbackJob, setPlaybackJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const requestCounter = useRef(0);
  const installerBusy = useRef(false);
  const toastCounter = useRef(0);
  const active = jobs.filter((j) => activeStates.includes(j.status));
  const finished = jobs.filter((j) => !activeStates.includes(j.status));
  const completed = jobs.filter((j) => j.status === "completed");
  const ready =
    !!deps?.ytDlp && !!deps?.ffmpeg && !!deps?.ffprobe && !!deps?.deno;
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        navigate("downloads");
        setTimeout(() => urlRef.current?.focus(), 0);
      }
      if (e.key === "Escape") {
        setShowHelp(false);
        setShowCredits(false);
        setPlaybackJob(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  /** Меняет вид; если тема поменялась, новая расходится кругом от кнопки. */
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
        "Откройте настольное приложение: npm run desktop. Браузер показывает только интерфейс.",
      );
      return;
    }
    const number = ++requestCounter.current;
    setLoading(true);
    setError("");
    setVideo(null);
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
  async function paste() {
    try {
      changeUrl(await navigator.clipboard.readText());
      urlRef.current?.focus();
    } catch {
      notify("Нажмите Ctrl+V в поле ссылки.");
      urlRef.current?.focus();
    }
  }
  async function chooseFolder() {
    if (!desktop) {
      notify("Выбор папки доступен в настольном приложении.");
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Папка для загрузок",
      });
      if (typeof selected === "string")
        setPrefs((p) => ({ ...p, folder: selected }));
    } catch (e) {
      notify(errorText(e), "error");
    }
  }
  async function addDownload(request?: Request) {
    if (adding || (!video && !request)) return;
    if (!ready) {
      setError("Проверьте yt-dlp, FFmpeg и Deno в настройках приложения.");
      if (page !== "downloads")
        notify("Проверьте компоненты в настройках.", "error");
      return;
    }
    const format =
      prefs.kind === "video" ? prefs.videoFormat : prefs.audioFormat;
    setAdding(true);
    setError("");
    try {
      const job = await invoke<Job>("start_download", {
        request: request || {
          url: video!.url,
          title: video!.title,
          kind: prefs.kind,
          format,
          quality: prefs.kind === "video" ? quality : prefs.audioQuality,
          folder: prefs.folder,
          metadata: prefs.metadata,
          clip,
        },
      });
      setJobs((previous) =>
        previous.some((j) => j.id === job.id) ? previous : [job, ...previous],
      );
      notify("Загрузка добавлена в очередь");
    } catch (e) {
      setError(errorText(e));
      if (page !== "downloads") notify(errorText(e), "error");
    } finally {
      setAdding(false);
    }
  }
  async function action(command: string, args?: Record<string, unknown>) {
    if (!desktop) {
      notify("Откройте настольную версию приложения.");
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
      notify("Проверка компонентов завершена");
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

  const heading = pages[page];

  return (
    <IconContext.Provider
      value={{ style: appearance.iconStyle, stroke: appearance.stroke }}
    >
      <div className="app-shell">
        <Titlebar busy={active.length > 0} />
        <Sidebar
          page={page}
          onNavigate={navigate}
          activeCount={active.length}
          historyCount={finished.length}
          onOpenFolder={() => void action("open_folder", { id: null })}
          onHelp={() => setShowHelp(true)}
          onSecret={() => setShowCredits(true)}
        />
        <div className="main-shell" ref={mainRef}>
          <header className="topbar">
            <div className="topbar-right">
              <span className="shortcut-hint">
                <kbd>Ctrl</kbd>
                <kbd>L</kbd>
                <span>ссылка</span>
              </span>
              <button
                className="icon-button theme-flip"
                aria-label={dark ? "Светлая тема" : "Тёмная тема"}
                data-tooltip={dark ? "Светлая тема" : "Тёмная тема"}
                onClick={(event) =>
                  changeAppearance(
                    { ...appearance, theme: dark ? "light" : "dark" },
                    event.currentTarget,
                  )
                }
              >
                <span key={dark ? "dark" : "light"} className="theme-flip-icon">
                  {dark ? <Sun size={17} /> : <Moon size={17} />}
                </span>
              </button>
            </div>
          </header>
          <main key={page} className="page">
            <div className="page-heading">
              <div>
                <h1>
                  {heading.title[0]} <span>{heading.title[1]}</span>
                </h1>
                <p>{heading.text}</p>
              </div>
              {page !== "settings" && (
                <dl className="heading-stats">
                  <div>
                    <dt>В работе</dt>
                    <dd>{active.length}</dd>
                  </div>
                  <div>
                    <dt>Готово</dt>
                    <dd>{completed.length}</dd>
                  </div>
                </dl>
              )}
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
                prefs={prefs}
                setPrefs={setPrefs}
                quality={quality}
                setQuality={setQuality}
                clip={clip}
                setClip={setClip}
                desktop={desktop}
                adding={adding}
                onChooseFolder={() => void chooseFolder()}
                onDownload={() => void addDownload()}
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
            <span>{toast.text}</span>
            <button
              className="icon-button"
              onClick={() => setToast(null)}
              aria-label="Закрыть уведомление"
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
        {showCredits && (
          <CreditsModal
            onClose={() => setShowCredits(false)}
            onOpenSite={() => void action("open_team_site")}
          />
        )}
      </div>
    </IconContext.Provider>
  );
}
