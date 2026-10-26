import { t, getLanguage, setLanguage, subscribeLanguage, initializeLanguage, localeTag } from "./i18n.js";
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const win = window.__TAURI__.window.getCurrentWindow();
const $ = (id) => document.getElementById(id);

let info = null;
let dir = "";
let mode = "install";
let busy = false;
let finishLaunch = true;
let lastProgress = null;
const errors = new Map();

initializeLanguage();

const mb = (bytes) =>
  bytes >= 1073741824
    ? t("{0} ГБ", { 0: (bytes / 1073741824).toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
    : t("{0} МБ", { 0: Math.max(1, Math.round(bytes / 1048576)) });

function show(name) {
  for (const screen of document.querySelectorAll(".screen")) {
    const active = screen.dataset.screen === name;
    if (screen.classList.contains("active") && !active) {
      screen.classList.add("leaving");
      setTimeout(() => screen.classList.remove("leaving"), 450);
    }
    screen.classList.toggle("active", active);
  }
}

function switchRow(el) {
  el.addEventListener("click", () =>
    el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true")),
  );
}
const checked = (id) => $(id).getAttribute("aria-checked") === "true";

function fact(term, value) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = t(term);
  dd.textContent = value;
  row.append(dt, dd);
  $("facts").append(row);
}

function error(id, text) {
  errors.set(id, text);
  const el = $(id);
  el.textContent = t(text);
  el.hidden = !text;
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("busy", value);
  $("close").disabled = value;
}

const stages = {
  prepare: "Готовим установку…",
  copy: "Копируем",
  finish: "Создаём",
  remove: "Удаляем",
  done: "Готово",
};
let shown = 0;
function paintProgress(payload) {
  const label = t(stages[payload.stage] || "");
  const file = ["Ярлыки", "Данные приложения"].includes(payload.file) ? t(payload.file) : payload.file;
  $("current").textContent = file ? `${label} ${file}` : label;
}
listen("progress", ({ payload }) => {
  lastProgress = payload;
  const value = Math.round(payload.progress);
  $("bar").style.transform = `scaleX(${payload.progress / 100})`;
  // Число догоняет реальный процент, а не прыгает.
  const target = value;
  const tick = () => {
    if (shown === target) return;
    shown += Math.sign(target - shown);
    $("percent").textContent = shown;
    requestAnimationFrame(tick);
  };
  tick();
  paintProgress(payload);
});

async function install() {
  error("setup-error", "");
  setBusy(true);
  show("progress");
  try {
    await invoke("install", { dir, desktop: checked("desktop") });
    setBusy(false);
    finishLaunch = true;
    if (checked("launch")) {
      try {
        await invoke("launch", { dir });
        finishLaunch = false;
        setTimeout(() => invoke("quit", { cleanup: false }), 1600);
      } catch {
        // Оставляем кнопку запуска, если сразу открыть не вышло.
      }
    }
    renderLanguage();
    show("done");
  } catch (e) {
    setBusy(false);
    error("setup-error", String(e));
    show("setup");
  }
}

async function uninstall() {
  error("confirm-error", "");
  setBusy(true);
  show("progress");
  try {
    await invoke("uninstall", { removeData: checked("remove-data") });
    setBusy(false);
    finishLaunch = false;
    renderLanguage();
    show("done");
  } catch (e) {
    setBusy(false);
    error("confirm-error", String(e));
    show("confirm");
  }
}

const sun =
  '<svg viewBox="0 0 24 24"><path d="M16.5 12C16.5 14.4854 14.4854 16.5 12 16.5C9.5147 16.5 7.5 14.4854 7.5 12C7.5 9.5147 9.5147 7.5 12 7.5C14.4854 7.5 16.5 9.5147 16.5 12ZM20.5 12L22 12M18.0104 18.0104L19.0711 19.0711M12 20.5L12 22M5.9896 18.0104L4.9289 19.0711M3.5 12L2 12M5.9896 5.9896L4.9289 4.9289M12 3.5L12 2M18.0104 5.9896L19.0711 4.9289" /></svg>';
const moon =
  '<svg viewBox="0 0 24 24"><path d="M21 12C21 16.9706 16.9706 21 12 21C7.0294 21 3 16.9706 3 12C3 7.0294 7.0294 3 12 3C9.9618 5.5477 10.1652 9.2206 12.4723 11.5277C14.7794 13.8348 18.4523 14.0382 21 12Z" /></svg>';

function paintThemeButton() {
  const dark = document.documentElement.dataset.theme !== "light";
  const icon = $("theme-icon");
  icon.innerHTML = dark ? sun : moon;
  // Перезапуск анимации поворота иконки.
  icon.style.animation = "none";
  void icon.offsetWidth;
  icon.style.animation = "";
  $("theme").setAttribute("aria-label", dark ? t("Светлая тема") : t("Тёмная тема"));
}

function renderLanguage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-language]").forEach((el) => {
    el.setAttribute("aria-pressed", String(el.dataset.language === getLanguage()));
  });
  for (const [id, message] of errors) $(id).textContent = t(message);
  const title = t(mode === "uninstall" ? "Удаление" : "Установка");
  $("window-title").textContent = title;
  document.title = `Wdownloader · ${title}`;
  void win.setTitle(document.title).catch(() => {});
  if (info) {
    $("facts").replaceChildren();
    if (mode === "uninstall") {
      fact("Версия", info.version);
      fact("Папка", t("Будет удалена"));
      $("done-title").textContent = t("Wdownloader удалён");
      $("done-lead").textContent = t("Спасибо, что пользовались. Скачанные файлы на месте.");
    } else {
      fact("Сборка", t(info.offline ? "Офлайн" : "Лёгкая"));
      fact("Размер", info.size ? mb(info.size) : t("Нет данных"));
      fact("Компоненты", t(info.offline ? "Внутри" : "Скачаются при запуске"));
      $("size").textContent = info.size ? t("Займёт {0}", { 0: mb(info.size) }) : "";
      if (info.installed) {
        $("setup-title").textContent = t("Обновить Wdownloader");
        $("setup-lead").textContent = t("Найдена установленная версия. Настройки и история сохранятся.");
        $("install-label").textContent = t("Обновить");
      }
      $("done-title").textContent = t(info.installed ? "Wdownloader обновлён" : "Wdownloader установлен");
    }
  }
  $("finish-label").textContent = t(finishLaunch && mode === "install" ? "Открыть Wdownloader" : "Закрыть");
  if (lastProgress) paintProgress(lastProgress);
  paintThemeButton();
}

document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
});
subscribeLanguage(renderLanguage);

function applyTheme(next) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("wd-setup-theme", next);
  } catch (e) {
    /* Тема останется до закрытия окна. */
  }
  paintThemeButton();
}

// Новая тема расходится кругом от кнопки, как в приложении.
$("theme").addEventListener("click", (event) => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced) {
    applyTheme(next);
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  root.classList.add("theme-transition");
  const transition = document.startViewTransition(() => applyTheme(next));
  transition.ready
    .then(
      () =>
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 620, easing: "cubic-bezier(.7,0,.2,1)", pseudoElement: "::view-transition-new(root)" },
        ).finished,
    )
    .catch(() => {})
    .finally(() => root.classList.remove("theme-transition"));
});
renderLanguage();

// Пасхалка: три клика по логотипу, каждый не позже 600 мс после предыдущего.
let taps = 0;
let tapTimer;
function openCredits() {
  const box = $("credits");
  box.hidden = false;
  box.classList.remove("closing");
  // Перезапуск анимаций при повторном открытии.
  box.querySelectorAll("*").forEach((el) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  });
  $("credits-close").focus();
}
function closeCredits() {
  const box = $("credits");
  if (box.hidden) return;
  box.classList.add("closing");
  setTimeout(() => {
    box.hidden = true;
    box.classList.remove("closing");
  }, 180);
}
$("logo").addEventListener("click", () => {
  clearTimeout(tapTimer);
  taps += 1;
  const logo = $("logo");
  logo.classList.remove("tap-1", "tap-2");
  if (taps >= 3) {
    taps = 0;
    openCredits();
    return;
  }
  logo.classList.add(`tap-${taps}`);
  tapTimer = setTimeout(() => {
    taps = 0;
    logo.classList.remove("tap-1", "tap-2");
  }, 600);
});
$("credits").addEventListener("click", (e) => e.target === $("credits") && closeCredits());
$("credits-close").addEventListener("click", closeCredits);
$("credits-site").addEventListener("click", () => invoke("open_site").catch(() => {}));
document.addEventListener("keydown", (e) => e.key === "Escape" && closeCredits());

$("minimize").addEventListener("click", () => win.minimize());
$("close").addEventListener("click", () => !busy && invoke("quit", { cleanup: false }));
$("cancel").addEventListener("click", () => invoke("quit", { cleanup: false }));
$("folder").addEventListener("click", async () => {
  const picked = await invoke("pick_dir", { current: dir, language: getLanguage() });
  if (picked) {
    dir = picked;
    $("dir").textContent = dir;
  }
});
$("install").addEventListener("click", install);
$("uninstall").addEventListener("click", uninstall);
$("finish").addEventListener("click", async () => {
  if (mode === "install" && finishLaunch)
    await invoke("launch", { dir }).catch(() => {});
  invoke("quit", { cleanup: mode === "uninstall" });
});
["desktop", "launch", "remove-data"].forEach((id) => switchRow($(id)));
document.addEventListener("contextmenu", (e) => e.preventDefault());

(async () => {
  info = await invoke("info");
  mode = info.mode;
  dir = info.dir;
  $("version").textContent = info.version;
  $("dir").textContent = dir;
  $("uninstall-dir").textContent = dir;
  if (mode === "install" && !info.ready) {
    $("install").disabled = true;
    error("setup-error", "В этом файле нет приложения. Соберите установщик через npm run setup:build.");
  }
  renderLanguage();
  show(mode === "uninstall" ? "confirm" : "setup");
})();
