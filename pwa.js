let deferredInstallPrompt = null;

function updateInstallCtas() {
  const buttons = document.querySelectorAll("[data-install-app]");
  buttons.forEach(button => {
    button.hidden = !deferredInstallPrompt;
  });
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallCtas();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallCtas();
});

async function installPharmacyApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  updateInstallCtas();
}

window.installPharmacyApp = installPharmacyApp;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(registration => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            installingWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      setInterval(() => {
        registration.update().catch(() => {});
      }, 60000);
    }).catch(() => {});
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (window.__pharmacySwRefreshing) return;
    window.__pharmacySwRefreshing = true;
    window.location.reload();
  });
}
