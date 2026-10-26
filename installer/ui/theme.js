// Тема ставится до отрисовки, чтобы не мигало.
(function () {
  var theme = "dark";
  try {
    theme = localStorage.getItem("wd-setup-theme") || theme;
  } catch (e) {
    /* Без хранилища остаётся тёмная. */
  }
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
})();
