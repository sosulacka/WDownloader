// Тема применяется до отрисовки, чтобы светлая тема не мигала тёмным фоном.
// Логика повторяет src/lib/appearance.ts.
(function () {
  var root = document.documentElement;
  var theme = "dark";
  try {
    var saved = JSON.parse(localStorage.getItem("wd-appearance") || "null") || {};
    if (["dark", "light", "system"].indexOf(saved.theme) >= 0)
      theme = saved.theme;
    if (theme === "system")
      theme = matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    if (saved.motion === false) root.dataset.motion = "reduced";
  } catch (e) {
    /* Без сохранённых настроек остаётся тема по умолчанию. */
  }
  root.dataset.theme = theme;
})();
