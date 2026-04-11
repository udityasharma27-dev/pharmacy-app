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
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
