import { CONFIG, isConfigured, assetUrl } from "../config.js";
import {
  getSession, onAuthChange, signOut, sendPhoneOtp, verifyPhoneOtp,
  signInEmail, signUpEmail, signUpWithUsername, signInWithUsername,
  recoverUsernamePassword, finalizeProfileClaim,
} from "./auth.js";
import {
  ensureProfile, updateProfile, searchUsers, uploadAvatar,
  getPublicProfile, startPresenceHeartbeat,
} from "./profiles.js";
import {
  listConversations, openPrivateChat, loadMessages, sendMessage, markRead,
  subscribeMessages, subscribeTyping, setTyping, uploadAttachment, getAttachmentUrl,
  createGroup, createChannel, searchPublicChannels, joinPublicChannel,
  listMembers, groupAddMember, groupLeave,
} from "./chat.js";
import { $, el, setText, formatTime, initials, toast, icon, faAuthError } from "./utils.js";

const state = {
  session: null,
  profile: null,
  conversations: [],
  activeId: null,
  messages: [],
  unsubMsg: null,
  unsubTyping: null,
  phonePending: null,
  resendAt: 0,
  presenceStop: null,
  sending: false,
};

export async function boot() {
  const root = $("#app");
  if (!isConfigured()) {
    root.replaceChildren(renderSetupScreen());
    return;
  }
  onAuthChange(async (session) => {
    state.session = session;
    if (session) {
      try {
        state.profile = await ensureProfile();
        if (!state.profile?.username) {
          root.replaceChildren(renderUsernameGate());
          return;
        }
        await showMain();
      } catch (e) {
        root.replaceChildren(renderAuthScreen(faAuthError(e)));
      }
    } else {
      root.replaceChildren(renderAuthScreen());
    }
  });
  setupConnectivityBanner();
  const session = await getSession();
  state.session = session;
  if (!session) root.replaceChildren(renderAuthScreen());
}

function setupConnectivityBanner() {
  const ensure = () => {
    let b = document.getElementById("offline-banner");
    if (!navigator.onLine) {
      if (!b) {
        b = el("div", { id: "offline-banner", class: "offline-banner", text: "اتصال اینترنت برقرار نیست. برخی قابلیت‌ها موقتاً از دسترس خارج‌اند." });
        document.body.prepend(b);
      }
    } else if (b) b.remove();
  };
  window.addEventListener("online", ensure);
  window.addEventListener("offline", ensure);
  ensure();
}

function renderSetupScreen() {
  return el("div", { class: "screen" }, [
    el("div", { class: "card" }, [
      brand(),
      el("div", { class: "msg-error", text: "پیکربندی Supabase ناقص است." }),
      el("p", {
        class: "msg-info",
        text: "فایل config.js را باز کنید و SUPABASE_URL و SUPABASE_ANON_KEY را از داشبورد پروژه Supabase خودتان وارد کنید. هرگز service_role را در فرانت‌اند نگذارید.",
      }),
      el("p", {
        style: "color:var(--text-dim);font-size:0.85rem;line-height:1.7",
        text: "سپس migrationهای sql/001_schema.sql ، sql/002_rls.sql و sql/003_storage.sql را در SQL Editor اجرا کنید و Auth Redirect را روی آدرس GitHub Pages تنظیم کنید.",
      }),
    ]),
  ]);
}

function brand() {
  return el("div", { class: "brand" }, [
    el("img", { src: assetUrl("assets/logo.svg"), alt: CONFIG.APP_NAME }),
    el("h1", { text: CONFIG.APP_NAME }),
    el("p", { text: "پیام‌رسان امن و مدرن" }),
  ]);
}

function renderAuthScreen(errMsg = "") {
  const wrap = el("div", { class: "screen" });
  const card = el("div", { class: "card" });
  card.append(brand());

  const tabs = el("div", { class: "tabs" });
  const userTab = el("button", { class: "active", type: "button", text: "نام کاربری" });
  const phoneTab = el("button", { type: "button", text: "تلفن" });
  const emailTab = el("button", { type: "button", text: "ایمیل" });
  tabs.append(userTab, phoneTab, emailTab);

  const errBox = el("div", { class: errMsg ? "msg-error" : "msg-error hidden", text: errMsg || "" });
  const body = el("div");

  function showErr(m) {
    errBox.classList.remove("hidden");
    setText(errBox, m);
  }
  function clearErr() {
    errBox.classList.add("hidden");
    setText(errBox, "");
  }

  function usernameForm(mode) {
    body.replaceChildren();
    const isReg = mode === "register";
    body.append(el("div", {
      class: "msg-info",
      text: isReg
        ? "رمز عبور فقط در سیستم احراز هویت ذخیره می‌شود (نه در پروفایل). نام کاربری یکتا الزامی است."
        : "ورود با نام کاربری و رمز عبور.",
    }));
    if (isReg) {
      body.append(el("div", { class: "field" }, [
        el("label", { text: "نام نمایشی" }),
        el("input", { id: "dn", placeholder: "مثلاً آریا", autocomplete: "nickname" }),
      ]));
    }
    body.append(
      el("div", { class: "field" }, [
        el("label", { text: "نام کاربری" }),
        el("input", { id: "uname", placeholder: "commander04", autocomplete: "username" }),
      ]),
      el("div", { class: "field" }, [
        el("label", { text: "رمز عبور" }),
        el("input", { id: "pw", type: "password", placeholder: "حداقل ۶ کاراکتر", autocomplete: isReg ? "new-password" : "current-password" }),
      ]),
    );
    if (isReg) {
      const row = el("div", { class: "row" });
      row.append(
        el("div", { class: "field" }, [
          el("label", { text: "جنسیت (اختیاری)" }),
          (() => {
            const s = el("select", { id: "gender" });
            for (const [v, l] of [["", "—"], ["male", "مرد"], ["female", "زن"], ["other", "سایر"], ["unspecified", "ترجیح می‌دهم نگویم"]]) {
              s.append(el("option", { value: v, text: l }));
            }
            return s;
          })(),
        ]),
        el("div", { class: "field" }, [
          el("label", { text: "کشور (اختیاری)" }),
          el("input", { id: "country", placeholder: "ایران" }),
        ]),
      );
      body.append(row);
    }
    const btn = el("button", {
      class: "btn btn-primary", type: "button",
      text: isReg ? "ثبت‌نام" : "ورود",
    });
    body.append(btn);
    if (!isReg) {
      const rec = el("button", { class: "btn btn-ghost", type: "button", text: "بازیابی رمز عبور", style: "margin-top:8px" });
      body.append(rec);
      rec.onclick = async () => {
        clearErr();
        await recoverUsernamePassword($("#uname").value);
        toast("اگر حسابی با این نام کاربری وجود داشته باشد، دستور بازیابی ارسال می‌شود.");
      };
      const toReg = el("button", { class: "btn btn-ghost", type: "button", text: "ساخت حساب جدید", style: "margin-top:8px" });
      body.append(toReg);
      toReg.onclick = () => usernameForm("register");
    } else {
      const toLogin = el("button", { class: "btn btn-ghost", type: "button", text: "حساب دارم — ورود", style: "margin-top:8px" });
      body.append(toLogin);
      toLogin.onclick = () => usernameForm("login");
    }
    btn.onclick = async () => {
      clearErr();
      btn.disabled = true;
      try {
        if (isReg) {
          await signUpWithUsername({
            username: $("#uname").value,
            password: $("#pw").value,
            displayName: $("#dn")?.value,
            gender: $("#gender")?.value || null,
            country: $("#country")?.value || "",
          });
          // اگر session بلافاصله نبود (تأیید ایمیل)، راهنما
          const s = await getSession();
          if (!s) toast("ثبت‌نام انجام شد. اگر تأیید ایمیل فعال است، صندوق را بررسی کنید؛ در غیر این صورت وارد شوید.");
          else {
            try {
              await finalizeProfileClaim(
                $("#uname").value.trim().toLowerCase(),
                ($("#dn")?.value || $("#uname").value).trim(),
                $("#gender")?.value || null,
                $("#country")?.value || "",
              );
            } catch (_) { /* profile may already exist via edge */ }
          }
        } else {
          await signInWithUsername($("#uname").value, $("#pw").value);
        }
      } catch (e) {
        showErr(e.message || faAuthError(e));
      } finally {
        btn.disabled = false;
      }
    };
  }

  function phoneForm() {
    body.replaceChildren();
    if (!CONFIG.ENABLE_PHONE_AUTH) {
      body.append(el("div", { class: "msg-info", text: "احراز هویت تلفنی در config غیرفعال است." }));
      return;
    }
    body.append(el("div", { class: "msg-info", text: "نیاز به SMS Provider فعال در Supabase Auth دارد." }));
    const row = el("div", { class: "row" });
    row.append(
      el("div", { class: "field" }, [el("label", { text: "کد کشور" }), el("input", { id: "cc", value: "98", inputmode: "numeric" })]),
      el("div", { class: "field" }, [el("label", { text: "شماره موبایل" }), el("input", { id: "phone", placeholder: "9121234567", inputmode: "numeric" })]),
    );
    body.append(row);
    const otpField = el("div", { class: "field hidden", id: "otp-wrap" }, [
      el("label", { text: "کد تأیید" }),
      el("input", { id: "otp", placeholder: "123456", inputmode: "numeric" }),
    ]);
    body.append(otpField);
    const btn = el("button", { class: "btn btn-primary", type: "button", text: "ارسال کد" });
    const btnVerify = el("button", { class: "btn btn-primary hidden", type: "button", text: "تأیید کد" });
    body.append(btn, el("div", { style: "height:8px" }), btnVerify);
    btn.onclick = async () => {
      clearErr();
      btn.disabled = true;
      try {
        if (Date.now() < state.resendAt) throw new Error("برای ارسال مجدد کمی صبر کنید.");
        const p = await sendPhoneOtp($("#cc").value, $("#phone").value);
        state.phonePending = p;
        state.resendAt = Date.now() + 60000;
        otpField.classList.remove("hidden");
        btnVerify.classList.remove("hidden");
        setText(btn, "ارسال مجدد کد");
        toast("اگر SMS پیکربندی شده باشد، کد ارسال می‌شود.");
      } catch (e) {
        showErr(faAuthError(e));
      } finally {
        btn.disabled = false;
      }
    };
    btnVerify.onclick = async () => {
      clearErr();
      btnVerify.disabled = true;
      try {
        await verifyPhoneOtp(state.phonePending, $("#otp").value.trim());
      } catch (e) {
        showErr(faAuthError(e));
      } finally {
        btnVerify.disabled = false;
      }
    };
  }

  function emailForm() {
    body.replaceChildren();
    if (!CONFIG.ENABLE_EMAIL_DEV_AUTH) {
      body.append(el("div", { class: "msg-info", text: "ورود ایمیلی در config غیرفعال است." }));
      return;
    }
    body.append(el("div", { class: "msg-info", text: "مسیر ایمیل برای مواقعی است که تلفن یا Edge Function آماده نیست." }));
    body.append(
      el("div", { class: "field" }, [el("label", { text: "نام نمایشی" }), el("input", { id: "dn", placeholder: "نام شما" })]),
      el("div", { class: "field" }, [el("label", { text: "ایمیل" }), el("input", { id: "em", type: "email", placeholder: "you@example.com" })]),
      el("div", { class: "field" }, [el("label", { text: "رمز عبور" }), el("input", { id: "pw", type: "password" })]),
    );
    const row = el("div", { class: "row" });
    const loginBtn = el("button", { class: "btn btn-primary", type: "button", text: "ورود" });
    const regBtn = el("button", { class: "btn btn-ghost", type: "button", text: "ثبت‌نام" });
    row.append(loginBtn, regBtn);
    body.append(row);
    loginBtn.onclick = async () => {
      clearErr();
      try { await signInEmail($("#em").value.trim(), $("#pw").value); }
      catch (e) { showErr(faAuthError(e)); }
    };
    regBtn.onclick = async () => {
      clearErr();
      try {
        await signUpEmail($("#em").value.trim(), $("#pw").value, $("#dn").value.trim());
        toast("ثبت‌نام انجام شد.");
      } catch (e) { showErr(faAuthError(e)); }
    };
  }

  function setTab(active) {
    for (const b of [userTab, phoneTab, emailTab]) b.classList.remove("active");
    active.classList.add("active");
  }
  userTab.onclick = () => { setTab(userTab); usernameForm("login"); };
  phoneTab.onclick = () => { setTab(phoneTab); phoneForm(); };
  emailTab.onclick = () => { setTab(emailTab); emailForm(); };

  card.append(tabs, errBox, body);
  usernameForm("login");
  wrap.append(card);
  return wrap;
}

function renderUsernameGate() {
  const wrap = el("div", { class: "screen" });
  const card = el("div", { class: "card" }, [
    brand(),
    el("div", { class: "msg-info", text: "برای ادامه یک نام کاربری یکتا انتخاب کنید (مثل commander04)." }),
    el("div", { class: "field" }, [
      el("label", { text: "نام کاربری" }),
      el("input", { id: "uname", placeholder: "commander04", autocomplete: "username" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { text: "نام نمایشی" }),
      el("input", { id: "dname", value: state.profile?.display_name || "", placeholder: "نام شما" }),
    ]),
    el("div", { id: "ug-err", class: "msg-error hidden" }),
    el("button", {
      class: "btn btn-primary", type: "button", text: "ذخیره و ادامه",
      onclick: async () => {
        const err = $("#ug-err");
        try {
          state.profile = await updateProfile({
            username: $("#uname").value.trim().toLowerCase(),
            display_name: $("#dname").value.trim() || "کاربر",
          });
          await showMain();
        } catch (e) {
          err.classList.remove("hidden");
          setText(err, e.message || String(e));
        }
      },
    }),
  ]);
  wrap.append(card);
  return wrap;
}

async function showMain() {
  if (state.presenceStop) { try { state.presenceStop(); } catch (_) {} }
  state.presenceStop = startPresenceHeartbeat();
  const root = $("#app");
  const shell = el("div", { class: "app-shell" });
  const main = el("div", { class: "main", id: "main" });

  const sidebar = el("aside", { class: "sidebar" });
  const header = el("div", { class: "sidebar-header" }, [
    el("img", { class: "logo", src: assetUrl("assets/logo.svg"), alt: "" }),
    el("h2", { text: CONFIG.APP_SHORT }),
    el("button", {
      class: "icon-btn", title: "جستجو و گفتگوی جدید", type: "button",
      onclick: () => openSearchPanel(),
    }, [icon("search")]),
    el("button", {
      class: "icon-btn", title: "تنظیمات", type: "button",
      onclick: () => openSettingsPanel(),
    }, [icon("settings")]),
  ]);

  const nav = el("div", { class: "nav-tabs" });
  const tabChats = el("button", { class: "active", type: "button", text: "گفتگوها" });
  const tabChannels = el("button", { type: "button", text: "کانال‌ها" });
  nav.append(tabChats, tabChannels);

  const list = el("div", { class: "list", id: "conv-list" });
  sidebar.append(header, nav, list);

  const chat = el("section", { class: "chat", id: "chat-pane" });
  chat.append(el("div", { class: "empty" }, [
    el("strong", { text: "گفتگویی انتخاب نشده" }),
    el("span", { text: "از فهرست یک گفتگو را باز کنید یا کاربر جدیدی جستجو کنید." }),
  ]));

  main.append(sidebar, chat);
  shell.append(main);
  root.replaceChildren(shell);

  let mode = "chats";
  tabChats.onclick = async () => {
    mode = "chats";
    tabChats.classList.add("active");
    tabChannels.classList.remove("active");
    await refreshConversations();
  };
  tabChannels.onclick = async () => {
    mode = "channels";
    tabChannels.classList.add("active");
    tabChats.classList.remove("active");
    await refreshChannelsDiscover();
  };

  await refreshConversations();
}

async function refreshConversations() {
  const list = $("#conv-list");
  setText(list, "در حال بارگذاری...");
  try {
    state.conversations = await listConversations();
    list.replaceChildren();
    if (!state.conversations.length) {
      list.append(el("div", { class: "empty", text: "هنوز گفتگویی ندارید. با جستجو شروع کنید." }));
      return;
    }
    for (const c of state.conversations) {
      list.append(renderConvItem(c));
    }
  } catch (e) {
    setText(list, e.message || "خطا در بارگذاری");
  }
}

async function refreshChannelsDiscover() {
  const list = $("#conv-list");
  setText(list, "در حال بارگذاری کانال‌ها...");
  try {
    const channels = await searchPublicChannels("");
    list.replaceChildren();
    list.append(el("button", {
      class: "btn btn-primary", type: "button", text: "ساخت کانال جدید",
      style: "margin:8px 0",
      onclick: async () => {
        const title = prompt("نام کانال:");
        if (!title) return;
        const id = await createChannel(title, "", true);
        toast("کانال ساخته شد");
        await openConversation(id);
      },
    }));
    list.append(el("button", {
      class: "btn btn-ghost", type: "button", text: "ساخت گروه",
      style: "margin:8px 0",
      onclick: async () => {
        const title = prompt("نام گروه:");
        if (!title) return;
        const id = await createGroup(title, []);
        toast("گروه ساخته شد");
        await openConversation(id);
      },
    }));
    for (const c of channels) {
      const item = el("div", { class: "list-item", onclick: async () => {
        try {
          await joinPublicChannel(c.id);
          await openConversation(c.id);
        } catch (e) {
          toast(e.message || "خطا");
        }
      }});
      item.append(
        el("div", { class: "avatar", text: initials(c.title) }),
        el("div", { class: "list-meta" }, [
          el("div", { class: "title" }, [el("span", { text: c.title || "کانال" })]),
          el("div", { class: "preview", text: c.description || "کانال عمومی" }),
        ]),
      );
      list.append(item);
    }
  } catch (e) {
    setText(list, e.message || "خطا");
  }
}

function renderConvItem(c) {
  const title = c.title || "گفتگو";
  const item = el("div", {
    class: `list-item${state.activeId === c.id ? " active" : ""}`,
    onclick: () => openConversation(c.id),
  });
  const av = el("div", { class: "avatar" });
  if (c.avatar_url) av.append(el("img", { src: c.avatar_url, alt: "" }));
  else setText(av, initials(title));
  const meta = el("div", { class: "list-meta" }, [
    el("div", { class: "title" }, [
      el("span", { text: title }),
      el("time", { text: formatTime(c.last_message_at) }),
    ]),
    el("div", { class: "preview" }, [
      el("span", { text: c.type === "channel" ? "کانال" : c.type === "group" ? "گروه" : "خصوصی" }),
      c.unread ? el("span", { class: "badge", text: String(c.unread) }) : null,
    ]),
  ]);
  item.append(av, meta);
  return item;
}

async function openConversation(id) {
  state.activeId = id;
  const main = $("#main");
  main?.classList.add("show-chat");
  await refreshConversations();

  if (state.unsubMsg) state.unsubMsg();
  if (state.unsubTyping) state.unsubTyping();

  const pane = $("#chat-pane");
  const conv = state.conversations.find((c) => c.id === id) || { id, title: "گفتگو" };

  const header = el("div", { class: "chat-header" }, [
    el("button", {
      class: "icon-btn", type: "button", title: "بازگشت",
      onclick: () => { main.classList.remove("show-chat"); },
    }, [icon("back")]),
    el("div", { class: "avatar" }, [
      conv.avatar_url ? el("img", { src: conv.avatar_url, alt: "" }) : document.createTextNode(initials(conv.title || "?")),
    ]),
    el("div", { class: "info" }, [
      el("h3", { text: conv.title || "گفتگو" }),
      el("span", { id: "chat-sub", text: conv.type || "" }),
    ]),
  ]);

  const messagesEl = el("div", { class: "messages", id: "messages" });
  const typingEl = el("div", { class: "typing", id: "typing" });
  const composer = el("div", { class: "composer" });
  const fileInput = el("input", { type: "file", class: "hidden", id: "file-input" });
  const attachBtn = el("button", {
    class: "icon-btn", type: "button", title: "پیوست",
    onclick: () => fileInput.click(),
  }, [icon("attach")]);
  const ta = el("textarea", { id: "composer-input", rows: 1, placeholder: "پیام بنویسید..." });
  const sendBtn = el("button", { class: "send", type: "button", title: "ارسال" }, [icon("send")]);
  composer.append(attachBtn, fileInput, ta, sendBtn);

  pane.replaceChildren(header, messagesEl, typingEl, composer);

  try {
    state.messages = await loadMessages(id);
    renderMessages(messagesEl, state.messages, { conversationId: id });
    await markRead(id);
  } catch (e) {
    setText(messagesEl, e.message || "خطا در دریافت پیام‌ها");
  }

  // members button for groups
  if (conv.type === "group" || conv.type === "channel") {
    const memBtn = el("button", {
      class: "icon-btn", type: "button", title: "اعضا",
      onclick: () => openMembersPanel(id, conv),
    }, [icon("users")]);
    header.append(memBtn);
  }

  state.unsubMsg = subscribeMessages(id, async (row) => {
    if (state.messages.some((m) => m.id === row.id || (row.client_id && m.client_id === row.client_id))) return;
    state.messages.push(row);
    renderMessages(messagesEl, state.messages, { conversationId: id });
    await markRead(id);
  });
  state.unsubTyping = subscribeTyping(id, (row) => {
    if (!row || row.user_id === state.profile?.id) return;
    setText(typingEl, "در حال نوشتن...");
    setTimeout(() => setText(typingEl, ""), CONFIG.TYPING_TTL_MS);
  });

  let typingTimer = null;
  ta.addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(id), 400);
  });

  async function doSend(attachment = null) {
    if (state.sending) return;
    const body = ta.value;
    if (!body.trim() && !attachment) return;
    if (!navigator.onLine) {
      toast("آفلاین هستید. پس از اتصال دوباره تلاش کنید.");
      return;
    }
    ta.value = "";
    state.sending = true;
    sendBtn.disabled = true;
    try {
      const msg = await sendMessage(id, body, attachment);
      if (!state.messages.some((m) => m.id === msg.id || (msg.client_id && m.client_id === msg.client_id))) {
        state.messages.push(msg);
        renderMessages(messagesEl, state.messages, { conversationId: id });
      }
    } catch (e) {
      ta.value = body;
      toast(e.message || "ارسال ناموفق");
    } finally {
      state.sending = false;
      sendBtn.disabled = false;
    }
  }
  sendBtn.onclick = () => doSend();
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      doSend();
    }
  });
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      toast("در حال آپلود...");
      const att = await uploadAttachment(id, file);
      await doSend(att);
      toast("پیوست ارسال شد");
    } catch (e) {
      toast(e.message || "آپلود ناموفق");
    }
  };
}

function renderMessages(container, messages, opts = {}) {
  container.replaceChildren();
  if (messages.length >= 1) {
    const loadBtn = el("button", {
      class: "load-older", type: "button", text: "بارگذاری پیام‌های قبلی",
      onclick: async () => {
        const first = messages[0];
        if (!first || !opts.conversationId) return;
        loadBtn.disabled = true;
        try {
          const older = await loadMessages(opts.conversationId, { before: first.created_at });
          if (!older.length) {
            setText(loadBtn, "پیام قدیمی‌تری نیست");
            return;
          }
          const ids = new Set(state.messages.map((x) => x.id));
          const merged = [...older.filter((x) => !ids.has(x.id)), ...state.messages];
          state.messages = merged;
          renderMessages(container, state.messages, opts);
        } catch (e) {
          toast(e.message || "خطا");
          loadBtn.disabled = false;
        }
      },
    });
    container.append(loadBtn);
  }
  for (const m of messages) {
    const mine = m.sender_id === state.profile?.id;
    const bubble = el("div", { class: `msg ${mine ? "mine" : "theirs"}` });
    const textNode = el("div");
    setText(textNode, m.body || "");
    bubble.append(textNode);
    if (m.attachment_path) {
      const box = el("div", { class: "attach" });
      const mime = m.attachment_mime || "";
      getAttachmentUrl(m.attachment_path)
        .then((url) => {
          if (mime.startsWith("image/")) box.append(el("img", { src: url, alt: m.attachment_name || "" }));
          else if (mime.startsWith("video/")) box.append(el("video", { src: url, controls: true }));
          else if (mime.startsWith("audio/")) box.append(el("audio", { src: url, controls: true }));
          else box.append(el("a", { href: url, target: "_blank", rel: "noopener", text: m.attachment_name || "دانلود فایل" }));
        })
        .catch(() => setText(box, "پیوست در دسترس نیست"));
      bubble.append(box);
    }
    bubble.append(el("div", { class: "meta", text: formatTime(m.created_at) }));
    container.append(bubble);
  }
  container.scrollTop = container.scrollHeight;
}

function openSearchPanel() {
  const overlay = el("div", { class: "panel" });
  const inner = el("div", { class: "panel-inner" });
  inner.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
      el("h3", { text: "جستجوی کاربر" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("div", { class: "field" }, [
      el("input", { id: "user-q", placeholder: "نام کاربری یا نام نمایشی" }),
    ]),
    el("div", { id: "user-results", class: "list" }),
  );
  overlay.append(inner);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);

  const run = async () => {
    const q = $("#user-q").value;
    const box = $("#user-results");
    try {
      const users = await searchUsers(q);
      box.replaceChildren();
      for (const u of users) {
        if (u.id === state.profile?.id) continue;
        const item = el("div", {
          class: "list-item",
          onclick: async () => {
            overlay.remove();
            await openProfileView(u.id);
          },
        });
        const av = el("div", { class: "avatar" });
        if (u.avatar_url) av.append(el("img", { src: u.avatar_url, alt: "" }));
        else setText(av, initials(u.display_name || u.username));
        item.append(
          av,
          el("div", { class: "list-meta" }, [
            el("div", { class: "title", text: u.display_name || u.username }),
            el("div", { class: "preview", text: u.username ? `@${u.username}` : "" }),
          ]),
        );
        box.append(item);
      }
      if (!box.children.length) setText(box, "نتیجه‌ای نیست");
    } catch (e) {
      setText(box, e.message || "خطا");
    }
  };
  $("#user-q").addEventListener("input", () => {
    clearTimeout(openSearchPanel._t);
    openSearchPanel._t = setTimeout(run, 300);
  });
}


async function openMembersPanel(conversationId, conv) {
  const overlay = el("div", { class: "panel" });
  const inner = el("div", { class: "panel-inner" });
  inner.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
      el("h3", { text: "اعضای " + (conv.title || "گروه") }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
  );
  const list = el("div", { class: "list" });
  setText(list, "در حال بارگذاری...");
  inner.append(list);
  if (conv.role === "owner" || conv.role === "admin") {
    inner.append(el("button", {
      class: "btn btn-primary", type: "button", text: "افزودن عضو با نام کاربری",
      style: "margin-top:10px",
      onclick: async () => {
        const uname = prompt("نام کاربری فرد:");
        if (!uname) return;
        try {
          const found = await searchUsers(uname.trim());
          const user = (found || []).find((u) => u.username === uname.trim().toLowerCase()) || found?.[0];
          if (!user) throw new Error("کاربر پیدا نشد");
          await groupAddMember(conversationId, user.id);
          toast("عضو اضافه شد");
          overlay.remove();
          openMembersPanel(conversationId, conv);
        } catch (e) {
          toast(e.message || "خطا");
        }
      },
    }));
  }
  inner.append(el("button", {
    class: "btn btn-danger", type: "button", text: "خروج از گفتگو",
    style: "margin-top:8px",
    onclick: async () => {
      if (!confirm("از این گروه/کانال خارج می‌شوید؟")) return;
      try {
        await groupLeave(conversationId);
        overlay.remove();
        state.activeId = null;
        await refreshConversations();
        $("#chat-pane")?.replaceChildren(el("div", { class: "empty" }, [
          el("strong", { text: "گفتگویی انتخاب نشده" }),
        ]));
        toast("خارج شدید");
      } catch (e) {
        toast(e.message || "خطا");
      }
    },
  }));
  overlay.append(inner);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  try {
    const members = await listMembers(conversationId);
    list.replaceChildren();
    for (const m of members || []) {
      const row = el("div", { class: "member-row" });
      const av = el("div", { class: "avatar" });
      if (m.avatar_url) av.append(el("img", { src: m.avatar_url, alt: "" }));
      else setText(av, initials(m.display_name || m.username || "?"));
      row.append(
        av,
        el("div", { class: "list-meta", style: "flex:1" }, [
          el("div", { class: "title", text: m.display_name || m.username || "کاربر" }),
          el("div", { class: "preview", text: m.username ? "@" + m.username : "" }),
        ]),
        el("span", { class: "role-tag", text: m.role || "member" }),
      );
      row.style.cursor = "pointer";
      row.onclick = () => openProfileView(m.user_id);
      list.append(row);
    }
    if (!list.children.length) setText(list, "عضوی نیست");
  } catch (e) {
    setText(list, e.message || "خطا");
  }
}

async function openProfileView(userId) {
  const overlay = el("div", { class: "panel" });
  const inner = el("div", { class: "panel-inner" });
  inner.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
      el("h3", { text: "پروفایل" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
  );
  const box = el("div");
  setText(box, "در حال بارگذاری...");
  inner.append(box);
  overlay.append(inner);
  document.body.append(overlay);
  try {
    const p = await getPublicProfile(userId);
    if (!p) { setText(box, "پیدا نشد"); return; }
    box.replaceChildren();
    const av = el("div", { class: "avatar", style: "width:72px;height:72px;margin:0 auto 12px" });
    if (p.avatar_url) av.append(el("img", { src: p.avatar_url, alt: "" }));
    else setText(av, initials(p.display_name || p.username));
    box.append(av);
    box.append(el("h3", { style: "text-align:center", text: p.display_name || "—" }));
    box.append(el("p", { style: "text-align:center;color:var(--text-dim)", text: p.username ? "@" + p.username : "" }));
    if (p.bio) box.append(el("p", { text: p.bio }));
    if (p.country) box.append(el("p", { style: "color:var(--text-dim);font-size:0.85rem", text: "کشور: " + p.country }));
    if (p.is_online === true) box.append(el("p", { style: "color:var(--online);font-size:0.85rem", text: "آنلاین" }));
    else if (p.last_seen_at) box.append(el("p", { style: "color:var(--text-mute);font-size:0.85rem", text: "آخرین بازدید: " + formatTime(p.last_seen_at) }));
    if (p.id !== state.profile?.id) {
      box.append(el("button", {
        class: "btn btn-primary", type: "button", text: "شروع گفتگو",
        style: "margin-top:12px",
        onclick: async () => {
          const cid = await openPrivateChat(p.id);
          overlay.remove();
          await refreshConversations();
          await openConversation(cid);
        },
      }));
    }
  } catch (e) {
    setText(box, e.message || "خطا");
  }
}

function openSettingsPanel() {
  const overlay = el("div", { class: "panel" });
  const inner = el("div", { class: "panel-inner" });
  const p = state.profile || {};
  inner.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
      el("h3", { text: "پروفایل و تنظیمات" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("div", { class: "field" }, [el("label", { text: "نام کاربری" }), el("input", { id: "s-user", value: p.username || "" })]),
    el("div", { class: "field" }, [el("label", { text: "نام نمایشی" }), el("input", { id: "s-name", value: p.display_name || "" })]),
    el("div", { class: "field" }, [el("label", { text: "بیو" }), el("textarea", { id: "s-bio", rows: "3" })]),
    el("div", { class: "field" }, [el("label", { text: "کشور" }), el("input", { id: "s-country", value: p.country || "" })]),
    el("div", { class: "field" }, [
      el("label", { text: "جنسیت" }),
      (() => {
        const s = el("select", { id: "s-gender" });
        for (const [v, l] of [["unspecified", "ترجیح می‌دهم نگویم"], ["male", "مرد"], ["female", "زن"], ["other", "سایر"]]) {
          const o = el("option", { value: v, text: l });
          if ((p.gender || "unspecified") === v) o.selected = true;
          s.append(o);
        }
        return s;
      })(),
    ]),
    el("div", { class: "field" }, [el("label", { text: "آواتار" }), el("input", { id: "s-av", type: "file", accept: "image/*" })]),
    el("button", {
      class: "btn btn-primary", type: "button", text: "ذخیره",
      onclick: async () => {
        try {
          const file = $("#s-av").files?.[0];
          if (file) await uploadAvatar(file);
          state.profile = await updateProfile({
            username: $("#s-user").value.trim().toLowerCase(),
            display_name: $("#s-name").value.trim(),
            bio: $("#s-bio").value,
            country: $("#s-country")?.value || "",
            gender: $("#s-gender")?.value || "unspecified",
          });
          toast("ذخیره شد");
          overlay.remove();
        } catch (e) {
          toast(e.message || "خطا");
        }
      },
    }),
    el("div", { style: "height:10px" }),
    el("button", {
      class: "btn btn-danger", type: "button", text: "خروج از حساب",
      onclick: async () => { await signOut(); overlay.remove(); },
    }),
    el("p", {
      style: "color:var(--text-mute);font-size:0.8rem;margin-top:16px;line-height:1.6",
      text: "تماس صوتی/تصویری در config خاموش است تا WebRTC و TURN آماده شود.",
    }),
  );
  $("#s-bio").value = p.bio || "";
  overlay.append(inner);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}
