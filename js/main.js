import { boot } from "./app.js";

boot().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) {
    app.textContent = "خطای راه‌اندازی: " + (err?.message || String(err));
  }
});
