(function () {
  var root = document.documentElement;
  try { var t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch (e) {}
  // English is the default; Spanish is opt-in via the toggle or ?lang=es.
  var q = new URLSearchParams(location.search).get("lang");
  function set(l) {
    root.dataset.lang = l; root.lang = l;
    document.querySelectorAll(".lang button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.l === l)); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".lang button");
    if (b) { set(b.dataset.l); history.replaceState(null, "", b.dataset.l === "en" ? location.pathname : "?lang=" + b.dataset.l); }
  });
  set(q === "es" ? "es" : "en");
})();
