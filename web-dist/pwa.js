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
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .catch(() => {});

    if ("caches" in window) {
      caches.keys()
        .then(keys => Promise.all(keys.map(key => caches.delete(key))))
        .catch(() => {});
    }
  });
}
