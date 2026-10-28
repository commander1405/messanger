import { assetUrl } from "../config.js";

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

/** Safe text content only — never use innerHTML for user messages */
export function setText(node, text) {
  node.textContent = text ?? "";
}

export function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fa-IR");
}

export function initials(name) {
  const s = (name || "?").trim();
  return s.slice(0, 2).toUpperCase();
}

export function toast(msg, ms = 2800) {
  const t = el("div", { class: "toast", text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function icon(name) {
  const img = el("img", { src: assetUrl(`assets/icons/${name}.svg`), alt: "" });
  return img;
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function validateUsername(u) {
  return /^[a-z0-9_]{3,24}$/.test(u || "");
}

export function normalizePhone(countryCode, national) {
  const cc = String(countryCode || "").replace(/\D/g, "");
  const n = String(national || "").replace(/\D/g, "");
  if (!cc || !n) return null;
  return `+${cc}${n}`;
}

export function faAuthError(err) {
  const m = (err?.message || err?.error_description || String(err || "")).toLowerCase();
  if (m.includes("rate") && m.includes("email")) {
    return "محدودیت سرویس. از Edge Function احراز هویت استفاده کنید.";
  }
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return "نام کاربری یا رمز عبور نادرست است.";
  }
  if (m.includes("network") || m.includes("fetch") || m.includes("failed to fetch")) {
    return "خطای شبکه. اتصال اینترنت را بررسی کنید.";
  }
  return err?.message || "خطایی رخ داد.";
}
