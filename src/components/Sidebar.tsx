import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Logo, { Wordmark } from "./Logo";
import {
  ArrowUpRight,
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
  { page: "downloads", label: "Загрузки", Icon: Download, key: "1" },
  { page: "history", label: "История", Icon: Clock, key: "2" },
  { page: "settings", label: "Настройки", Icon: Settings, key: "3" },
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
  const nav = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ y: number; h: number } | null>(
    null,
  );

  // Три клика подряд (каждый не позже 600 мс после предыдущего) открывают пасхалку.
  // Счётчик в ref, чтобы быстрые клики не читали устаревшее состояние.
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

  useLayoutEffect(() => {
    const selected = nav.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (selected)
      setIndicator({ y: selected.offsetTop, h: selected.offsetHeight });
  }, [page]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <button
          type="button"
          className={`brand-logo ${clicks ? `tap-${clicks}` : ""}`}
          aria-label="Wdownloader"
          onClick={tap}
        >
          <Logo size={30} busy={activeCount > 0} />
        </button>
        <Wordmark />
      </div>
      <nav ref={nav} className="nav" aria-label="Основная навигация">
        {indicator && (
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={{
              transform: `translateY(${indicator.y}px)`,
              height: indicator.h,
            }}
          />
        )}
        {items.map(({ page: target, label, Icon }) => (
          <button
            key={target}
            className="nav-item"
            aria-current={page === target ? "page" : undefined}
            onClick={() => onNavigate(target)}
          >
            <Icon size={18} />
            <span>{label}</span>
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
        <button className="side-link" onClick={onOpenFolder}>
          <FolderOpen size={17} />
          <span>Папка загрузок</span>
          <ArrowUpRight size={14} />
        </button>
        <button className="side-link" onClick={onHelp}>
          <Info size={17} />
          <span>Как это работает</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
    </aside>
  );
}
