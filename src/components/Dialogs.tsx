import { t } from "../lib/i18n";
import { useEffect, useState, type ReactNode } from "react";
import MediaEditor from "./MediaEditor";
import Logo from "./Logo";
import { ArrowRight, ArrowUpRight, X } from "./icons";
import type { Job } from "../lib/types";

/** Окно с анимацией закрытия: onClose вызывается после выхода. */
function Modal({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);
  useEffect(() => {
    if (!closing) return;
    const reduced = document.documentElement.dataset.motion === "reduced";
    const timer = setTimeout(onClose, reduced ? 0 : 180);
    return () => clearTimeout(timer);
  }, [closing, onClose]);
  return (
    <div
      className={`modal-backdrop ${closing ? "closing" : ""}`}
      onClick={close}
    >
      <section
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label}
        onClick={(event) => event.stopPropagation()}
      >
        {children(close)}
      </section>
    </div>
  );
}

export function PlaybackModal({
  job,
  onClose,
}: {
  job: Job;
  onClose: () => void;
}) {
  return (
    <Modal label="playback-title" className="playback-modal" onClose={onClose}>
      {(close) => (
        <>
          <div className="modal-heading">
            <div>
              <span className="eyebrow">{t("Локальный файл")}</span>
              <h2 id="playback-title">{job.request.title}</h2>
            </div>
            <button
              className="icon-button"
              autoFocus
              onClick={close}
              aria-label={t("Закрыть плеер")}
            >
              <X size={19} />
            </button>
          </div>
          <MediaEditor
            key={job.id}
            source={{
              jobId: job.id,
              title: job.request.title,
              kind: job.request.kind,
              duration: 0,
            }}
            autoPrepare
          />
        </>
      )}
    </Modal>
  );
}

const steps = [
  [
    "Вставьте ссылку",
    "Обычное видео, Shorts или запись завершённой трансляции YouTube.",
  ],
  [
    "Выберите своё",
    "Видео с аудио или только звук. Затем формат, качество и папку.",
  ],
  [
    "Сохраните",
    "Загрузки идут по очереди. Задачу можно отменить или повторить.",
  ],
];

const credits = [
  ["Разработчик", "CYN"],
  ["Discord", "@syswow64deleted"],
];

/** Пасхалка: открывается тройным кликом по логотипу. */
export function CreditsModal({
  onClose,
  onOpenSite,
}: {
  onClose: () => void;
  onOpenSite: () => void;
}) {
  return (
    <Modal label="credits-title" className="credits-modal" onClose={onClose}>
      {(close) => (
        <>
          <button
            autoFocus
            className="icon-button modal-close"
            onClick={close}
            aria-label={t("Закрыть")}
          >
            <X size={19} />
          </button>
          <span className="credits-logo">
            <Logo size={56} />
          </span>
          <h2 id="credits-title" className="credits-title">
            {["CREATED", "BY", "WTEAM"].map((word, i) => (
              <span key={word} style={{ "--i": i } as React.CSSProperties}>
                {word}
              </span>
            ))}
          </h2>
          <dl className="credits-list">
            {credits.map(([term, value]) => (
              <div key={t(term)}>
                <dt>{t(term)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <button className="credits-link" onClick={onOpenSite}>
            wteam.su
            <ArrowUpRight size={17} />
          </button>
        </>
      )}
    </Modal>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="help-title" className="help-modal" onClose={onClose}>
      {(close) => (
        <>
          <button
            autoFocus
            className="icon-button modal-close"
            onClick={close}
            aria-label={t("Закрыть")}
          >
            <X size={19} />
          </button>
          <Logo size={40} />
          <span className="eyebrow">{t("Ничего лишнего")}</span>
          <h2 id="help-title">{t("От ссылки до файла.")}</h2>
          <ol className="help-steps">
            {steps.map(([title, text], i) => (
              <li
                key={title}
                style={{ "--i": i } as React.CSSProperties}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{t(title)}</h3>
                  <p>{t(text)}</p>
                </div>
              </li>
            ))}
          </ol>
          <button className="button primary" onClick={close}>
            {t("Всё понятно")}{" "}<ArrowRight size={16} />
          </button>
        </>
      )}
    </Modal>
  );
}
