import Segmented from "./Segmented";
import {
  ArrowUpRight,
  Bin2,
  Check,
  Clock,
  Download,
  FolderOpen,
  Headphones,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  Video,
  X,
} from "./icons";
import { timecode } from "../lib/media";
import {
  activeStates,
  duration,
  formatName,
  statusLabels,
  type Job,
  type Page,
  type Request,
} from "../lib/types";

type Props = {
  page: Exclude<Page, "settings">;
  jobs: Job[];
  activeCount: number;
  completedCount: number;
  filter: string;
  setFilter: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  adding: boolean;
  onClear: () => void;
  onShowHistory: () => void;
  onFocusUrl: () => void;
  onPlay: (job: Job) => void;
  onAction: (command: string, args?: Record<string, unknown>) => void;
  onRetry: (request: Request) => void;
};

export default function JobList({
  page,
  jobs,
  activeCount,
  completedCount,
  filter,
  setFilter,
  search,
  setSearch,
  adding,
  onClear,
  onShowHistory,
  onFocusUrl,
  onPlay,
  onAction,
  onRetry,
}: Props) {
  const history = page === "history";
  const pool = history
    ? jobs.filter((j) => !activeStates.includes(j.status))
    : jobs;
  const visible = pool
    .filter(
      (j) =>
        filter === "all" ||
        (filter === "active"
          ? activeStates.includes(j.status)
          : filter === "completed"
            ? j.status === "completed"
            : j.request.kind === filter),
    )
    .filter((j) =>
      j.request.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
  const filters = history
    ? ([
        ["all", "Все"],
        ["video", "Видео"],
        ["audio", "Аудио"],
      ] as const)
    : ([
        ["all", "Все"],
        ["active", "В процессе"],
        ["completed", "Завершённые"],
      ] as const);

  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <h2>
            {history ? "История файлов" : "Ваши загрузки"}
            <span className="count-pill">{pool.length}</span>
          </h2>
          <p>
            {activeCount
              ? `${activeCount} в работе · ${completedCount} завершено`
              : "Всё важное в одном месте."}
          </p>
        </div>
        {history ? (
          <button
            className="button ghost small"
            disabled={pool.length === 0}
            onClick={onClear}
          >
            <Bin2 size={15} />
            Очистить
          </button>
        ) : (
          <button className="text-button" onClick={onShowHistory}>
            Вся история <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      <div className="queue-toolbar">
        <Segmented
          label="Фильтр"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={filters}
        />
        <label className="queue-search">
          <Search size={15} />
          <input
            placeholder="Найти файл…"
            aria-label="Поиск загрузок"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="icon-button"
              aria-label="Сбросить поиск"
              onClick={() => setSearch("")}
            >
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div className="job-list">
        {visible.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              {history ? <Clock size={22} /> : <Download size={22} />}
            </span>
            <h3>
              {search
                ? "Ничего не найдено"
                : history
                  ? "Здесь будет ваша история"
                  : filter === "completed"
                    ? "Пока нет завершённых загрузок"
                    : filter === "active"
                      ? "Сейчас всё спокойно"
                      : "Первая загрузка начинается со ссылки"}
            </h3>
            <p>
              {search
                ? "Попробуйте другое название файла."
                : "Сохраняйте видео и аудио. Остальное мы возьмём на себя."}
            </p>
            {!search && !history && filter === "all" && (
              <button className="button ghost small" onClick={onFocusUrl}>
                <Plus size={14} />
                Добавить ссылку
              </button>
            )}
          </div>
        ) : (
          visible.map((job, index) => (
            <JobRow
              key={job.id}
              job={job}
              index={index}
              adding={adding}
              onPlay={onPlay}
              onAction={onAction}
              onRetry={onRetry}
            />
          ))
        )}
      </div>
    </section>
  );
}

function JobRow({
  job,
  index,
  adding,
  onPlay,
  onAction,
  onRetry,
}: {
  job: Job;
  index: number;
  adding: boolean;
  onPlay: (job: Job) => void;
  onAction: (command: string, args?: Record<string, unknown>) => void;
  onRetry: (request: Request) => void;
}) {
  const { request } = job;
  const running = activeStates.includes(job.status);
  const meta = [
    formatName(request.format),
    request.quality === "best"
      ? "Лучшее качество"
      : request.kind === "video"
        ? `${request.quality}p`
        : `${request.quality} кбит/с`,
    job.speed !== null ? `${(job.speed / 1048576).toFixed(1)} МБ/с` : null,
    request.clip
      ? `${timecode(request.clip.start)} → ${timecode(request.clip.end)}`
      : null,
    job.eta !== null && job.eta > 0 ? `Осталось ${duration(job.eta)}` : null,
    job.status === "completed"
      ? new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "short",
        }).format(job.created)
      : null,
  ].filter(Boolean);

  return (
    <div
      className={`job-row ${job.status}`}
      style={{ "--i": Math.min(index, 12) } as React.CSSProperties}
    >
      <span className="job-icon">
        {request.kind === "audio" ? (
          <Headphones size={19} />
        ) : (
          <Video size={19} />
        )}
      </span>
      <div className="job-content">
        <div className="job-topline">
          <h3 title={request.title}>{request.title}</h3>
          <span className={`job-status ${job.status}`}>
            {job.status === "completed" && <Check size={12} />}
            {job.status === "processing" && (
              <LoaderCircle size={12} className="spin" />
            )}
            {job.status === "downloading" && <i className="pulse-dot" />}
            {statusLabels[job.status]}
          </span>
        </div>
        <div className="job-meta">
          {meta.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
        {(job.status === "downloading" || job.status === "processing") && (
          <div className="progress-row">
            <div
              className={`progress-track ${job.status === "processing" ? "indeterminate" : ""}`}
              role="progressbar"
              aria-label="Прогресс скачивания"
              aria-valuenow={Math.round(job.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i
                style={{
                  transform: `scaleX(${job.status === "processing" ? 1 : job.progress / 100})`,
                }}
              />
            </div>
            <span>
              {job.status === "processing" ? "…" : `${Math.floor(job.progress)}%`}
            </span>
          </div>
        )}
        {job.error && <p className="job-error">{job.error}</p>}
      </div>
      <div className="job-actions">
        {job.status === "completed" && (
          <button
            className="icon-button"
            data-tooltip="Воспроизвести"
            aria-label="Воспроизвести в приложении"
            onClick={() => onPlay(job)}
          >
            <Play size={17} />
          </button>
        )}
        {running ? (
          <button
            className="icon-button"
            data-tooltip="Отменить"
            aria-label={`Отменить: ${request.title}`}
            onClick={() => onAction("cancel_download", { id: job.id })}
          >
            <X size={17} />
          </button>
        ) : job.status === "completed" ? (
          <button
            className="icon-button"
            data-tooltip="Показать в папке"
            aria-label="Показать в папке"
            onClick={() => onAction("open_folder", { id: job.id })}
          >
            <FolderOpen size={17} />
          </button>
        ) : (
          <button
            className="icon-button"
            data-tooltip="Повторить"
            aria-label="Повторить загрузку"
            disabled={adding}
            onClick={() => onRetry(request)}
          >
            <RotateCcw size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
