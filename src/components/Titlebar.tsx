import { t } from "../lib/i18n";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "./icons";

export default function Titlebar() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const window = getCurrentWindow();
    const update = async () => {
      const value = await window.isMaximized();
      if (!disposed) setMaximized(value);
    };
    void update();
    void window.onResized(update).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function perform(action: "minimize" | "toggleMaximize" | "close") {
    if (isTauri()) void getCurrentWindow()[action]().catch(console.error);
  }

  return (
    <div className="window-titlebar">
      <div className="window-drag-region" data-tauri-drag-region />
      <div className="window-controls">
        <button
          onClick={() => perform("minimize")}
          aria-label={t("Свернуть окно")}
          title={t("Свернуть")}
        >
          <Minus size={15} />
        </button>
        <button
          onClick={() => perform("toggleMaximize")}
          aria-label={maximized ? t("Восстановить окно") : t("Развернуть окно")}
          title={maximized ? t("Восстановить") : t("Развернуть")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            {maximized ? (
              <>
                <path d="M6 5V4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
                <rect x="3" y="6" width="7" height="7" rx="1" />
              </>
            ) : <rect x="3.5" y="3.5" width="9" height="9" rx="1.25" />}
          </svg>
        </button>
        <button
          className="window-close"
          onClick={() => perform("close")}
          aria-label={t("Закрыть приложение")}
          title={t("Закрыть")}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
