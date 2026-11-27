import { t } from "../lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import MediaEditor from "./MediaEditor";
import Logo from "./Logo";
import { X } from "./icons";
import type { Job } from "../lib/types";

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
  const dialog = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    const opener = document.activeElement;
    dialog.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    if (!closing) return;
    const reduced = document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => onCloseRef.current(), reduced ? 0 : 180);
    return () => clearTimeout(timer);
  }, [closing]);
  return (
    <div
      className={`modal-backdrop ${closing ? "closing" : ""}`}
      onClick={close}
    >
      <section
        className={`modal ${className}`}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            close();
          }
          if (event.key !== "Tab") return;
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          )].filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          const edge = event.shiftKey ? first : last;
          if (event.target === edge) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          }
        }}
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
              <h2 id="playback-title">{job.request.title}</h2>
            </div>
            <button
              className="icon-button"
              data-initial-focus
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
    "Скопируйте ссылку на отдельное видео, запись эфира или трек.",
  ],
  [
    "Выберите формат",
    "Выберите видео или аудио и укажите качество файла.",
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

export function CreditsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <Modal label="credits-title" className="credits-modal" onClose={onClose}>
      {(close) => (
        <>
          <button
            data-initial-focus
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
            data-initial-focus
            className="icon-button modal-close"
            onClick={close}
            aria-label={t("Закрыть")}
          >
            <X size={19} />
          </button>
          <Logo size={40} />
          <h2 id="help-title">{t("Как скачать файл")}</h2>
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
            {t("Всё понятно")}
          </button>
        </>
      )}
    </Modal>
  );
}
