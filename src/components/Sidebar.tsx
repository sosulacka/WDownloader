import { t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import Logo, { Wordmark } from "./Logo";
import {
  Clock,
  Download,
  FolderOpen,
  Info,
  Settings,
} from "./icons";
import type { Page } from "../lib/types";

type Props = {
  page: Page;
  onNavigate: (page: Page) => void;
  activeCount: number;
  historyCount: number;
  onOpenFolder: () => void;
  onHelp: () => void;
  onSecret: () => void;
};

const items = [
  { page: "downloads", label: "Загрузки", Icon: Download },
  { page: "history", label: "История", Icon: Clock },
  { page: "settings", label: "Настройки", Icon: Settings },
] as const;

export default function Sidebar({
  page,
  onNavigate,
  activeCount,
  historyCount,
  onOpenFolder,
  onHelp,
  onSecret,
}: Props) {
  // Три быстрых клика открывают пасхалку.
  const [clicks, setClicks] = useState(0);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  function tap() {
    clearTimeout(tapTimer.current);
    tapCount.current += 1;
    if (tapCount.current >= 3) {
      tapCount.current = 0;
      setClicks(0);
      onSecret();
      return;
    }
    setClicks(tapCount.current);
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
      setClicks(0);
    }, 600);
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <button
          type="button"
          className={`brand-logo ${clicks ? `tap-${clicks}` : ""}`}
          aria-label="Wdownloader"
          onClick={tap}
        >
          <Logo size={32} />
        </button>
        <Wordmark />
      </div>
      <nav className="nav" aria-label={t("Основная навигация")}>
        {items.map(({ page: target, label, Icon }) => (
          <button
            key={target}
            className="nav-item"
            aria-label={t(label)}
            aria-current={page === target ? "page" : undefined}
            onClick={() => onNavigate(target)}
          >
            <Icon size={20} />
            <span>{t(label)}</span>
            {target === "downloads" && activeCount > 0 && (
              <span className="nav-badge live">{activeCount}</span>
            )}
            {target === "history" && historyCount > 0 && (
              <span className="nav-badge">{historyCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="side-link" aria-label={t("Папка загрузок")} onClick={onOpenFolder}>
          <FolderOpen size={18} />
          <span>{t("Папка загрузок")}</span>
        </button>
        <button className="side-link" aria-label={t("Как это работает")} onClick={onHelp}>
          <Info size={18} />
          <span>{t("Как это работает")}</span>
        </button>
      </div>
    </aside>
  );
}
