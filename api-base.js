(function () {
  function normalizeBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function getDefaultBase() {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      if (window.location.protocol === "https:" && window.location.hostname === "localhost") {
        return "";
      }
      return normalizeBase(window.location.origin);
    }
    return "";
  }

  function isWebOrigin() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function getApiBaseUrl() {
    const saved = normalizeBase(localStorage.getItem("apiBaseUrl"));
    const fallback = getDefaultBase();
    if (isWebOrigin() && fallback) return fallback;
    return saved || fallback;
  }

  function saveApiBaseUrl(url) {
    const normalized = normalizeBase(url);
    if (normalized) localStorage.setItem("apiBaseUrl", normalized);
    return normalized;
  }

  function ensureApiBaseUrl() {
    const base = getApiBaseUrl();
    if (!base) {
      window.location.href = "index.html";
      throw new Error("API server URL is not configured.");
    }
    return base;
  }

  window.getApiBaseUrl = getApiBaseUrl;
  window.saveApiBaseUrl = saveApiBaseUrl;
  window.ensureApiBaseUrl = ensureApiBaseUrl;
})();
