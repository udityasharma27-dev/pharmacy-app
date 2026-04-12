(function () {
  const PUBLIC_API_BASE = "https://lumiere-de-vie-pharma-qhh0.onrender.com";

  function normalizeBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function getDefaultBase() {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      const origin = normalizeBase(window.location.origin);
      const isLocalHttpDev = window.location.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(window.location.hostname);

      if (isLocalHttpDev) {
        return origin;
      }

      if (window.location.protocol === "https:" && window.location.hostname === "localhost") {
        return normalizeBase(PUBLIC_API_BASE);
      }

      if (origin === normalizeBase(PUBLIC_API_BASE)) {
        return origin;
      }

      return normalizeBase(PUBLIC_API_BASE);
    }
    return normalizeBase(PUBLIC_API_BASE);
  }

  function isWebOrigin() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function getApiBaseUrl() {
    const fallback = getDefaultBase();
    if (isWebOrigin() && fallback) return fallback;
    return fallback;
  }

  function saveApiBaseUrl(url) {
    return normalizeBase(url) || getApiBaseUrl();
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
  window.PUBLIC_API_BASE = normalizeBase(PUBLIC_API_BASE);
})();
