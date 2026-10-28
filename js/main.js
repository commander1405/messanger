import { boot } from "./app.js";
import { assetUrl } from "../config.js";

const failSafe = setTimeout(() => {
  const app = document.getElementById("app");
  if (app && app.innerText.includes("بارگذاری")) {
    app.innerHTML = "";
    const p = document.createElement("div");
    p.className = "screen";
    p.innerHTML =
      '<div class="card"><div class="msg-error">بارگذاری بیش از حد طول کشید. صفحه را رفرش کنید.</div></div>';
    app.appendChild(p);
  }
}, 15000);

boot()
  .catch((err) => {
    console.error(err);
    const app = document.getElementById("app");
    if (app) {
      app.textContent = "خطای راه‌اندازی: " + (err?.message || String(err));
    }
  })
  .finally(() => clearTimeout(failSafe));

// PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = new URL("./sw.js", window.location.href).pathname;
    navigator.serviceWorker.register(swUrl).catch((e) => {
      console.warn("SW register failed", e);
    });
  });
}

// Install prompt
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (document.getElementById("install-banner")) return;
  if (window.matchMedia("(display-mode: standalone)").matches) return;
  const bar = document.createElement("div");
  bar.id = "install-banner";
  bar.className = "install-banner";
  bar.innerHTML =
    '<p>DarkKnight را روی دستگاه نصب کنید</p><button type="button" class="btn btn-primary" id="install-btn">نصب</button><button type="button" class="icon-btn" id="install-dismiss" aria-label="بستن">×</button>';
  document.body.appendChild(bar);
  document.getElementById("install-btn").onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    bar.remove();
  };
  document.getElementById("install-dismiss").onclick = () => bar.remove();
}

// Theme from localStorage
try {
  const t = localStorage.getItem("dk-theme");
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "");
  }
} catch (_) {}
