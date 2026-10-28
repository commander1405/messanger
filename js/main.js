import { boot } from "./app.js";

const failSafe = setTimeout(() => {
  const app = document.getElementById("app");
  if (app && app.innerText.includes("بارگذاری")) {
    app.innerHTML = "";
    const p = document.createElement("div");
    p.className = "screen";
    p.innerHTML = '<div class="card"><div class="msg-error">بارگذاری بیش از حد طول کشید. صفحه را رفرش کنید. اگر ادامه داشت، کش مرورگر را پاک کنید.</div></div>';
    app.appendChild(p);
  }
}, 12000);

boot()
  .catch((err) => {
    console.error(err);
    const app = document.getElementById("app");
    if (app) {
      app.textContent = "خطای راه‌اندازی: " + (err?.message || String(err));
    }
  })
  .finally(() => clearTimeout(failSafe));
