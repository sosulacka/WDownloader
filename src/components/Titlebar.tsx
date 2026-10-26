import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Logo from "./Logo";
import { Minus, X } from "./icons";

export default function Titlebar({ busy = false }: { busy?: boolean }) {
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
      <div className="window-drag-region" data-tauri-drag-region>
        <span className="window-logo" data-tauri-drag-region>
          <Logo size={16} busy={busy} />
        </span>
        <span data-tauri-drag-region>DOWNLOADER</span>
      </div>
      <div className="window-controls">
        <button
          onClick={() => perform("minimize")}
          aria-label="Свернуть окно"
          title="Свернуть"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={() => perform("toggleMaximize")}
          aria-label={maximized ? "Восстановить окно" : "Развернуть окно"}
          title={maximized ? "Восстановить" : "Развернуть"}
        >
          <span className={`maximize-icon ${maximized ? "restored" : ""}`} />
        </button>
        <button
          className="window-close"
          onClick={() => perform("close")}
          aria-label="Закрыть приложение"
          title="Закрыть"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
