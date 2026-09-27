(function () {
  "use strict";
  var key = "bth-theme";
  var preference = "system";
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  try {
    var saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (_) { /* Appearance still works when browser storage is unavailable. */ }

  function apply() {
    var dark = preference === "dark" || (preference === "system" && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = dark ? "#141b24" : "#1b6ec2";
  }
  apply();
  media.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", function () {
    var selector = document.getElementById("themeSelect");
    selector.value = preference;
    selector.addEventListener("change", function () {
      preference = selector.value;
      try {
        if (preference === "system") localStorage.removeItem(key);
        else localStorage.setItem(key, preference);
      } catch (_) { /* Keep the selection for this page even without storage. */ }
      apply();
    });
  });
}());
