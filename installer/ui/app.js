const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const win = window.__TAURI__.window.getCurrentWindow();
const $ = (id) => document.getElementById(id);

let info = null;
let dir = "";
let mode = "install";
let busy = false;

const mb = (bytes) =>
  bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(1)} ГБ`
    : `${Math.max(1, Math.round(bytes / 1048576))} МБ`;

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
  dt.textContent = term;
  dd.textContent = value;
  row.append(dt, dd);
  $("facts").append(row);
}

function error(id, text) {
  const el = $(id);
  el.textContent = text;
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
listen("progress", ({ payload }) => {
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
  const label = stages[payload.stage] || "";
  $("current").textContent = payload.file ? `${label} ${payload.file}` : label;
});

async function install() {
  error("setup-error", "");
  setBusy(true);
  $("progress-step").textContent = "Установка";
  show("progress");
  try {
    await invoke("install", { dir, desktop: checked("desktop") });
    setBusy(false);
    $("done-title").textContent = info.installed ? "Wdownloader обновлён" : "Wdownloader установлен";
    if (checked("launch")) {
      await invoke("launch", { dir }).catch(() => {});
      setTimeout(() => invoke("quit", { cleanup: false }), 1600);
      $("finish-label").textContent = "Закрыть";
    }
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
  $("progress-step").textContent = "Удаление";
  show("progress");
  try {
    await invoke("uninstall", { removeData: checked("remove-data") });
    setBusy(false);
    $("done-title").textContent = "Wdownloader удалён";
    $("done-lead").textContent = "Спасибо, что пользовались. Скачанные файлы на месте.";
    $("finish-label").textContent = "Закрыть";
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
  $("theme").setAttribute("aria-label", dark ? "Светлая тема" : "Тёмная тема");
}

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
paintThemeButton();

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
  const picked = await invoke("pick_dir", { current: dir });
  if (picked) {
    dir = picked;
    $("dir").textContent = dir;
  }
});
$("install").addEventListener("click", install);
$("uninstall").addEventListener("click", uninstall);
$("finish").addEventListener("click", async () => {
  if (mode === "install" && $("finish-label").textContent.startsWith("Открыть"))
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
  if (mode === "uninstall") {
    $("window-title").textContent = "Удаление";
    $("hero-eyebrow").textContent = "Удаление";
    fact("Версия", info.version);
    fact("Папка", "Будет удалена");
    show("confirm");
    return;
  }
  fact("Сборка", info.offline ? "Офлайн" : "Лёгкая");
  fact("Размер", info.size ? mb(info.size) : "Нет данных");
  fact("Компоненты", info.offline ? "Внутри" : "Скачаются при запуске");
  $("size").textContent = info.size ? `Займёт ${mb(info.size)}` : "";
  if (info.installed) {
    $("setup-title").textContent = "Обновить Wdownloader";
    $("setup-lead").textContent = "Найдена установленная версия. Настройки и история сохранятся.";
    $("install-label").textContent = "Обновить";
  }
  if (!info.ready) {
    $("install").disabled = true;
    error("setup-error", "В этом файле нет приложения. Соберите установщик через npm run setup:build.");
  }
  show("setup");
})();
