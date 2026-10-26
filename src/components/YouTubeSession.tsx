import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "../lib/i18n";
import { errorText } from "../lib/types";
import { CircleAlert, Check, Folder, Link, LoaderCircle } from "./icons";

export default function YouTubeSession({ desktop }: { desktop: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const busy = working || connected === null;

  useEffect(() => {
    let disposed = false;
    if (!desktop) {
      setConnected(false);
      return;
    }
    invoke<boolean>("youtube_session_connected")
      .then((value) => { if (!disposed) setConnected(value); })
      .catch((e) => {
        if (!disposed) {
          setConnected(false);
          setError(errorText(e));
        }
      });
    return () => { disposed = true; };
  }, [desktop]);

  async function importSession() {
    setWorking(true);
    setError("");
    try {
      const path = await open({
        title: t("Файл сессии YouTube"),
        multiple: false,
        directory: false,
        filters: [{ name: "Netscape cookies.txt", extensions: ["txt"] }],
      });
      if (typeof path === "string") {
        setConnected(await invoke<boolean>("import_youtube_session", { path }));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  }

  async function disconnect() {
    setWorking(true);
    setError("");
    try {
      setConnected(await invoke<boolean>("clear_youtube_session"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="card settings-card wide session-card">
      <div className="card-title">
        <span className="card-title-icon"><Link size={18} /></span>
        <div>
          <h2>{t("Сессия YouTube")}</h2>
          <p>{t("Своя учётная запись, когда YouTube требует вход.")}</p>
        </div>
        <span className="session-status" role="status">
          {busy ? <LoaderCircle size={15} className="spin" /> : connected ? <Check size={15} /> : null}
          {t(busy ? "Проверяем…" : connected ? "Подключена" : "Без входа")}
        </span>
      </div>
      <p className="session-description">
        {t("Импортируйте cookies.txt своей сессии в формате Netscape. Сохраняются только cookies youtube.com, локально на этом устройстве. Они используются yt-dlp при обращении к YouTube.")}
      </p>
      <div className="session-actions">
        <button type="button" className="button secondary small" disabled={!desktop || busy} onClick={() => void importSession()}>
          <Folder size={15} />
          {t(connected ? "Заменить файл сессии" : "Импортировать cookies.txt")}
        </button>
        {connected && (
          <button type="button" className="button ghost small" disabled={!desktop || busy} onClick={() => void disconnect()}>
            {t("Отключить сессию")}
          </button>
        )}
        <button type="button" className="button ghost small" disabled={!desktop} onClick={() => {
          void invoke("open_youtube_session_help").catch((e) => setError(errorText(e)));
        }}>
          {t("Как получить файл")}
        </button>
      </div>
      <p className="session-description session-note">
        {t("Файл даёт доступ к вашей сессии: никому его не отправляйте. Подключение не гарантирует прохождение проверок YouTube. Изменения действуют для новых запросов.")}
      </p>
      {error && <div className="inline-error" role="alert"><CircleAlert size={17} /><span>{t(error)}</span></div>}
    </section>
  );
}
