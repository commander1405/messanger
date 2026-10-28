import { CONFIG, isConfigured, assetUrl } from "../config.js";
import {
  getSession, onAuthChange, signOut,
  signUpWithUsername, signInWithUsername, finalizeProfileClaim,
} from "./auth.js";
import {
  ensureProfile, updateProfile, searchUsers, uploadAvatar,
  getPublicProfile, startPresenceHeartbeat, findUserByUsername,
} from "./profiles.js";
import {
  listConversations, openPrivateChat, loadMessages, sendMessage, markRead,
  subscribeMessages, subscribeTyping, setTyping, uploadAttachment, getAttachmentUrl,
  createGroup, createChannel, searchPublicChannels, joinPublicChannel,
  listMembers, groupAddMember, groupLeave, ensureSavedMessages,
  editMessage, deleteMessage, setConversationArchived, setConversationMuted, toggleReaction,
  forwardMessage, searchInConversation, loadReactions, blockUser, unblockUser,
  listBlockedUsers, listContacts, createInviteLink, joinByInvite, revokeInviteLink,
  submitReport, uploadVoiceBlob,
  updateConversationMeta, setMemberRole, removeMember, pinMessage,
  getMemberCount, uploadConversationAvatar, saveDraft, loadDraft,
} from "./chat.js";
import { $, el, setText, formatTime, initials, toast, icon, faAuthError } from "./utils.js";

const state = {
  session: null,
  profile: null,
  replyTo: null,
  editingId: null,
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

  setupConnectivityBanner();

  let handling = false;
  async function enterApp() {
    if (handling) return;
    handling = true;
    try {
      state.session = await getSession();
      if (!state.session) {
        root.replaceChildren(renderAuthScreen());
        return;
      }
      try {
        state.profile = await ensureProfile();
      } catch (e) {
        console.error("ensureProfile", e);
        root.replaceChildren(renderAuthScreen(
          "پروفایل بارگذاری نشد. اگر تازه دیتابیس ساخته‌اید، migrationهای SQL را اجرا کنید. " + (e.message || "")
        ));
        return;
      }
      if (!state.profile?.username) {
        root.replaceChildren(renderUsernameGate());
        return;
      }
      await showMain();
    } finally {
      handling = false;
    }
  }

  // بازیابی نشست — با timeout تا صفحه روی «بارگذاری» نماند
  let existing = null;
  try {
    existing = await Promise.race([
      getSession(),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
  } catch (e) {
    console.error("getSession boot", e);
    existing = null;
  }
  if (existing) {
    try {
      await enterApp();
    } catch (e) {
      console.error("enterApp boot", e);
      root.replaceChildren(renderAuthScreen(e.message || "خطا در ورود به برنامه"));
    }
  } else {
    root.replaceChildren(renderAuthScreen());
  }

  // رویدادهای بعدی (ورود/خروج) — INITIAL_SESSION را نادیده می‌گیریم تا دوبار رندر نشود
  onAuthChange((event, session) => {
    if (event === "INITIAL_SESSION") return;
    state.session = session;
    if (session) {
      // بدون await تا setSession قفل نشود
      setTimeout(() => {
        enterApp().catch((e) => console.error("enterApp", e));
      }, 0);
    } else {
      if (state.presenceStop) {
        try { state.presenceStop(); } catch (_) {}
        state.presenceStop = null;
      }
      if (state.unsubMsg) { try { state.unsubMsg(); } catch (_) {} state.unsubMsg = null; }
      if (state.unsubTyping) { try { state.unsubTyping(); } catch (_) {} state.unsubTyping = null; }
      root.replaceChildren(renderAuthScreen());
    }
  });
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
  const loginTab = el("button", { class: "active", type: "button", text: "ورود" });
  const regTab = el("button", { type: "button", text: "ثبت‌نام" });
  tabs.append(loginTab, regTab);

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

  function form(mode) {
    body.replaceChildren();
    const isReg = mode === "register";
    loginTab.classList.toggle("active", !isReg);
    regTab.classList.toggle("active", isReg);

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
        el("input", {
          id: "pw",
          type: "password",
          placeholder: "حداقل ۶ کاراکتر",
          autocomplete: isReg ? "new-password" : "current-password",
        }),
      ]),
    );
    if (isReg) {
      const row = el("div", { class: "row" });
      row.append(
        el("div", { class: "field" }, [
          el("label", { text: "جنسیت (اختیاری)" }),
          (() => {
            const s = el("select", { id: "gender" });
            for (const [v, l] of [
              ["", "—"],
              ["male", "مرد"],
              ["female", "زن"],
              ["other", "سایر"],
              ["unspecified", "ترجیح می‌دهم نگویم"],
            ]) {
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
      class: "btn btn-primary",
      type: "button",
      text: isReg ? "ثبت‌نام" : "ورود",
    });
    body.append(btn);

    const switchBtn = el("button", {
      class: "btn btn-ghost",
      type: "button",
      style: "margin-top:8px",
      text: isReg ? "حساب دارم — ورود" : "ساخت حساب جدید",
    });
    body.append(switchBtn);
    switchBtn.onclick = () => form(isReg ? "login" : "register");

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
          try {
            await finalizeProfileClaim(
              $("#uname").value.trim().toLowerCase(),
              ($("#dn")?.value || $("#uname").value).trim(),
              $("#gender")?.value || null,
              $("#country")?.value || "",
            );
          } catch (_) { /* profile ممکن است از Edge آمده باشد */ }
        } else {
          await signInWithUsername($("#uname").value, $("#pw").value);
        }
        // هدایت صریح بعد از موفقیت (وابسته نبودن فقط به onAuthChange)
        const appRoot = document.getElementById("app");
        state.session = await getSession();
        state.profile = await ensureProfile();
        if (!state.profile?.username) {
          appRoot.replaceChildren(renderUsernameGate());
        } else {
          await showMain();
        }
      } catch (e) {
        showErr(e.message || "خطا در احراز هویت");
      } finally {
        btn.disabled = false;
      }
    };
  }

  loginTab.onclick = () => form("login");
  regTab.onclick = () => form("register");
  card.append(tabs, errBox, body);
  form("login");
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
    el("img", { class: "logo", src: assetUrl("assets/logo.svg"), alt: "DarkKnight" }),
    el("h2", { text: CONFIG.APP_SHORT }),
    el("span", { class: "user-tag", text: state.profile?.username ? ("@" + state.profile.username) : "" }),
    el("div", { class: "header-actions" }, [
      el("button", {
        class: "icon-btn", title: "جستجو", type: "button",
        onclick: () => openSearchPanel(),
      }, [icon("search")]),
      el("button", {
        class: "icon-btn", title: "مخاطبان", type: "button",
        onclick: () => openContactsPanel(),
      }, [icon("users")]),
      el("button", {
        class: "icon-btn", title: "ساخت گروه یا کانال", type: "button",
        onclick: () => openCreatePanel(),
      }, [icon("plus")]),
      el("button", {
        class: "icon-btn", title: "تنظیمات و پروفایل", type: "button",
        onclick: () => openSettingsPanel(),
      }, [icon("settings")]),
    ]),
  ]);

  const searchBar = el("div", { class: "search-bar" }, [
    el("input", {
      id: "sidebar-search",
      type: "search",
      placeholder: "جستجو در گفتگوها…",
      autocomplete: "off",
    }),
  ]);

  const filters = el("div", { class: "filter-chips", id: "filter-chips" });
  const filterDefs = [
    { id: "all", label: "همه" },
    { id: "private", label: "خصوصی" },
    { id: "group", label: "گروه‌ها" },
    { id: "channel", label: "کانال‌ها" },
    { id: "unread", label: "خوانده‌نشده" },
    { id: "archived", label: "آرشیو" },
  ];
  state.listFilter = state.listFilter || "all";
  for (const f of filterDefs) {
    const b = el("button", {
      type: "button",
      text: f.label,
      class: state.listFilter === f.id ? "active" : "",
    });
    b.dataset.filter = f.id;
    b.onclick = async () => {
      state.listFilter = f.id;
      for (const x of filters.querySelectorAll("button")) {
        x.classList.toggle("active", x.dataset.filter === f.id);
      }
      if (f.id === "channel") await refreshChannelsDiscover();
      else await refreshConversations();
    };
    filters.append(b);
  }

  const list = el("div", { class: "list", id: "conv-list" });
  sidebar.append(header, searchBar, filters, list);

  const chat = el("section", { class: "chat", id: "chat-pane" });
  chat.append(el("div", { class: "empty chat-empty" }, [
    el("img", { src: assetUrl("assets/logo.svg"), alt: "", class: "empty-logo" }),
    el("strong", { text: "DarkKnight Messenger" }),
    el("span", { text: "گفتگویی را انتخاب کنید یا با جستجو گفتگوی جدید بسازید." }),
  ]));

  main.append(sidebar, chat);

  const bottomNav = el("nav", { class: "bottom-nav", id: "bottom-nav" });
  const navItems = [
    { id: "chats", label: "گفتگوها", ic: "chat", fn: () => { state.listFilter = "all"; refreshConversations(); } },
    { id: "contacts", label: "مخاطبان", ic: "users", fn: () => openContactsPanel() },
    { id: "search", label: "جستجو", ic: "search", fn: () => openSearchPanel() },
    { id: "settings", label: "منو", ic: "settings", fn: () => openSettingsPanel() },
  ];
  for (const n of navItems) {
    const b = el("button", {
      type: "button",
      class: n.id === "chats" ? "active" : "",
      onclick: () => {
        for (const x of bottomNav.querySelectorAll("button")) x.classList.remove("active");
        b.classList.add("active");
        n.fn();
      },
    });
    b.append(icon(n.ic), document.createTextNode(n.label));
    bottomNav.append(b);
  }

  shell.append(main, bottomNav);
  root.replaceChildren(shell);

  const searchInput = $("#sidebar-search");
  let searchTimer = null;
  if (searchInput) {
    searchInput.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyConversationSearch(searchInput.value), 180);
    };
  }

  try {
    await ensureSavedMessages();
  } catch (e) {
    console.error("saved messages", e);
  }
  await refreshConversations();
  try { await handleInviteDeepLink(); } catch (_) {}
}

function applyConversationSearch(q) {
  const list = $("#conv-list");
  if (!list) return;
  const query = (q || "").trim().toLowerCase();
  for (const item of list.querySelectorAll(".list-item")) {
    const title = (item.dataset.title || "").toLowerCase();
    const preview = (item.dataset.preview || "").toLowerCase();
    item.style.display = !query || title.includes(query) || preview.includes(query) ? "" : "none";
  }
}

async function refreshConversations() {
  const list = $("#conv-list");
  if (!list) return;
  list.replaceChildren();
  for (let i = 0; i < 5; i++) {
    list.append(el("div", { class: "skel-row" }, [
      el("div", { class: "skeleton skel-avatar" }),
      el("div", { class: "skel-lines" }, [
        el("div", { class: "skeleton skel-line" }),
        el("div", { class: "skeleton skel-line short" }),
      ]),
    ]));
  }
  try {
    state.conversations = await listConversations();
    const f = state.listFilter || "all";
    let rows = state.conversations || [];
    if (f === "archived") rows = rows.filter((c) => c.archived);
    else {
      rows = rows.filter((c) => !c.archived);
      if (f === "private") rows = rows.filter((c) => c.type === "private");
      else if (f === "group") rows = rows.filter((c) => c.type === "group");
      else if (f === "channel") rows = rows.filter((c) => c.type === "channel");
      else if (f === "unread") rows = rows.filter((c) => (c.unread || 0) > 0);
    }

    list.replaceChildren();
    if (!rows.length) {
      list.append(el("div", { class: "empty" }, [
        el("strong", { text: "گفتگویی نیست" }),
        el("span", { text: f === "unread" ? "پیام خوانده‌نشده‌ای ندارید." : "با جستجو یک گفتگوی جدید شروع کنید." }),
      ]));
      return;
    }
    for (const c of rows) list.append(renderConvItem(c));
    const q = $("#sidebar-search")?.value;
    if (q) applyConversationSearch(q);
  } catch (e) {
    list.replaceChildren(el("div", { class: "empty", text: e.message || "خطا در بارگذاری گفتگوها" }));
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
  const preview = c.last_preview || (
    c.type === "channel" ? "کانال" : c.type === "group" ? "گروه" : "خصوصی"
  );
  const item = el("button", {
    class: `list-item${state.activeId === c.id ? " active" : ""}${c.is_saved ? " saved" : ""}`,
    type: "button",
    onclick: () => openConversation(c.id),
  });
  item.dataset.title = title;
  item.dataset.preview = preview;
  const av = el("div", { class: "avatar" });
  if (c.is_saved) setText(av, "DM");
  else if (c.avatar_url) av.append(el("img", { src: c.avatar_url, alt: "" }));
  else setText(av, initials(title));
  const meta = el("div", { class: "list-meta" }, [
    el("div", { class: "title" }, [
      el("span", { text: title }),
      el("time", { text: formatTime(c.last_message_at) }),
    ]),
    el("div", { class: "preview" }, [
      el("span", { text: preview }),
      c.unread && !c.muted ? el("span", { class: "badge", text: String(c.unread) }) : null,
      c.unread && c.muted ? el("span", { class: "badge muted-badge", text: String(c.unread) }) : null,
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
  const replyBar = el("div", { class: "reply-bar hidden", id: "reply-bar" });
  const replyLabel = el("div", { class: "reply-bar-text" });
  const replyCancel = el("button", {
    class: "icon-btn", type: "button", title: "لغو",
    onclick: () => {
      state.replyTo = null;
      state.editingId = null;
      replyBar.classList.add("hidden");
      ta.placeholder = "پیام بنویسید...";
    },
  }, [icon("close")]);
  replyBar.append(replyLabel, replyCancel);

  const composer = el("div", { class: "composer" });
  const fileInput = el("input", { type: "file", class: "hidden", id: "file-input" });
  const attachBtn = el("button", {
    class: "icon-btn", type: "button", title: "پیوست",
    onclick: () => fileInput.click(),
  }, [icon("attach")]);
  const micBtn = el("button", {
    class: "icon-btn", type: "button", title: "پیام صوتی",
    onclick: () => startVoiceCapture(id, doSend),
  }, [icon("mic")]);
  const ta = el("textarea", { id: "composer-input", rows: 1, placeholder: "پیام بنویسید..." });
  const sendBtn = el("button", { class: "send", type: "button", title: "ارسال" }, [icon("send")]);
  composer.append(attachBtn, micBtn, fileInput, ta, sendBtn);

  header.append(el("button", {
    class: "icon-btn", type: "button", title: "جستجو در گفتگو",
    onclick: () => openChatSearch(id),
  }, [icon("search")]));
  header.append(el("button", {
    class: "icon-btn", type: "button", title: "منوی گفتگو",
    onclick: () => openChatMenu(id, conv),
  }, [icon("settings")]));

  // draft
  const draft = loadDraft(id);
  if (draft) ta.value = draft;
  ta.addEventListener("input", () => {
    saveDraft(id, ta.value);
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  });

  // pinned banner
  let pinBanner = null;
  if (conv?.pinned_message_id) {
    pinBanner = el("div", {
      class: "pin-banner",
      text: "پیام سنجاق‌شده",
      onclick: () => {
        const elMsg = messagesEl.querySelector(`.msg[data-id="${conv.pinned_message_id}"]`);
        if (elMsg) {
          elMsg.classList.add("msg-highlight");
          elMsg.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      },
    });
  }

  pane.replaceChildren(...[header, pinBanner, messagesEl, typingEl, replyBar, composer].filter(Boolean));

  window.__dkReplyBar = { bar: replyBar, label: replyLabel, input: ta };

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
    if (row.sender_id !== state.profile?.id) {
      await markRead(id);
    }
    // soft refresh list preview without full jump
    refreshConversations().catch(() => {});
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
    const body = ta.value;
    if (!body.trim() && !attachment) return;
    if (state.editingId) {
      const editId = state.editingId;
      sendBtn.disabled = true;
      try {
        const updated = await editMessage(editId, body);
        state.messages = state.messages.map((x) => (x.id === editId ? { ...x, ...updated, body: body.trim(), edited_at: updated.edited_at || new Date().toISOString() } : x));
        state.editingId = null;
        replyBar.classList.add("hidden");
        ta.value = "";
        renderMessages(messagesEl, state.messages, { conversationId: id });
      } catch (e) {
        toast(e.message || "ویرایش ناموفق");
      } finally {
        sendBtn.disabled = false;
        ta.focus();
      }
      return;
    }
    const replyTo = state.replyTo?.id || null;
    ta.value = "";
    state.replyTo = null;
    replyBar.classList.add("hidden");
    sendBtn.disabled = true;
    try {
      const msg = await sendMessage(id, body, attachment, { replyTo });
      saveDraft(id, "");
      const byId = new Map((state.messages || []).map((x) => [x.id, x]));
      byId.set(msg.id, msg);
      state.messages = [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      renderMessages(messagesEl, state.messages, { conversationId: id });
      await refreshConversations();
    } catch (e) {
      ta.value = body;
      toast(e.message || "ارسال ناموفق");
    } finally {
      sendBtn.disabled = false;
      ta.focus();
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

function appendMessageBody(container, body) {
  const text = String(body || "");
  const re = /@([a-z0-9_]{3,24})/gi;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      container.append(document.createTextNode(text.slice(last, match.index)));
    }
    const uname = match[1].toLowerCase();
    const link = el("span", { class: "mention", text: "@" + uname });
    link.onclick = (ev) => {
      ev.stopPropagation();
      openUsername(uname);
    };
    container.append(link);
    last = match.index + match[0].length;
  }
  if (last < text.length) container.append(document.createTextNode(text.slice(last)));
  if (!text) container.append(document.createTextNode(""));
}

async function openUsername(username) {
  try {
    toast("در حال باز کردن @" + username + "…");
    const user = await findUserByUsername(username);
    if (!user) {
      toast("کاربر @" + username + " پیدا نشد");
      return;
    }
    if (user.id === state.profile?.id) {
      openProfileView(user.id);
      return;
    }
    await openProfileView(user.id);
  } catch (e) {
    toast(e.message || "خطا");
  }
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

  let lastDay = "";
  for (const m of messages) {
    const day = (m.created_at || "").slice(0, 10);
    if (day && day !== lastDay) {
      lastDay = day;
      container.append(el("div", { class: "day-sep", text: formatDayLabel(day) }));
    }
    const mine = m.sender_id === state.profile?.id;
    const bubble = el("div", { class: `msg ${mine ? "mine" : "theirs"}` });
    bubble.dataset.id = m.id;

    if (m.forwarded_from_message_id) {
      bubble.append(el("div", { class: "msg-forward", text: "فوروارد شده" }));
    }
    if (m.reply_to_id) {
      const parent = messages.find((x) => x.id === m.reply_to_id);
      const replyPrev = el("div", { class: "msg-reply" });
      setText(replyPrev, parent ? (parent.body || "پیام").slice(0, 80) : "پاسخ به پیام");
      bubble.append(replyPrev);
    }

    if (!mine && m.profiles?.display_name && opts.showSender) {
      bubble.append(el("div", { class: "msg-sender", text: m.profiles.display_name }));
    }

    const textNode = el("div", { class: "msg-body" });
    appendMessageBody(textNode, m.body || "");
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

    const metaBits = [formatTime(m.created_at)];
    if (m.edited_at) metaBits.push("ویرایش‌شده");
    bubble.append(el("div", { class: "meta", text: metaBits.join(" · ") }));

    bubble.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      openMessageMenu(m, opts.conversationId, ev.clientX, ev.clientY);
    });
    bubble.addEventListener("dblclick", () => startReply(m));

    container.append(bubble);
  }
  container.scrollTop = container.scrollHeight;
  if (opts.conversationId && messages.length) {
    refreshMessageReactions(opts.conversationId, container).catch(() => {});
  }
}

async function refreshMessageReactions(conversationId, container) {
  const ids = (state.messages || []).map((m) => m.id).filter(Boolean);
  const map = await loadReactions(ids);
  for (const m of state.messages || []) {
    const bubble = container.querySelector(`.msg[data-id="${m.id}"]`);
    if (!bubble) continue;
    let row = bubble.querySelector(".reactions-row");
    if (row) row.remove();
    const reactions = map[m.id];
    if (!reactions || !Object.keys(reactions).length) continue;
    row = el("div", { class: "reactions-row" });
    const myId = state.profile?.id;
    for (const [emoji, info] of Object.entries(reactions)) {
      const mine = (info.users || []).includes(myId);
      const chip = el("button", {
        type: "button",
        class: "reaction-chip" + (mine ? " mine" : ""),
        text: `${emoji} ${info.count}`,
        onclick: async (ev) => {
          ev.stopPropagation();
          try {
            await toggleReaction(m.id, emoji);
            await refreshMessageReactions(conversationId, container);
          } catch (e) {
            toast(e.message || "خطا");
          }
        },
      });
      row.append(chip);
    }
    bubble.append(row);
  }
}

function formatDayLabel(isoDay) {
  try {
    const d = new Date(isoDay + "T12:00:00");
    return d.toLocaleDateString("fa-IR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch {
    return isoDay;
  }
}

function startReply(m) {
  state.replyTo = m;
  state.editingId = null;
  const rb = window.__dkReplyBar;
  if (!rb) return;
  rb.bar.classList.remove("hidden");
  setText(rb.label, "پاسخ: " + (m.body || "پیام").slice(0, 60));
  rb.input.placeholder = "پاسخ خود را بنویسید...";
  rb.input.focus();
}

function startEdit(m) {
  state.editingId = m.id;
  state.replyTo = null;
  const rb = window.__dkReplyBar;
  if (!rb) return;
  rb.bar.classList.remove("hidden");
  setText(rb.label, "ویرایش پیام");
  rb.input.value = m.body || "";
  rb.input.placeholder = "متن جدید...";
  rb.input.focus();
}

function openMessageMenu(m, conversationId, x, y) {
  document.querySelectorAll(".ctx-menu").forEach((n) => n.remove());
  const menu = el("div", { class: "ctx-menu" });
  const mine = m.sender_id === state.profile?.id;
  const add = (label, fn) => {
    const b = el("button", { type: "button", text: label, onclick: () => { menu.remove(); fn(); } });
    menu.append(b);
  };
  add("پاسخ", () => startReply(m));
  add("کپی متن", async () => {
    try {
      await navigator.clipboard.writeText(m.body || "");
      toast("کپی شد");
    } catch {
      toast("کپی ممکن نشد");
    }
  });
  if (mine) {
    add("ویرایش", () => startEdit(m));
    add("حذف", async () => {
      if (!confirm("این پیام حذف شود؟")) return;
      try {
        await deleteMessage(m.id);
        state.messages = state.messages.filter((x) => x.id !== m.id);
        const box = $("#messages");
        if (box) renderMessages(box, state.messages, { conversationId });
      } catch (e) {
        toast(e.message || "حذف ناموفق");
      }
    });
  }
  add("فوروارد", () => openForwardPicker(m));
  add("سنجاق پیام", async () => {
    try {
      await pinMessage(conversationId, m.id);
      toast("سنجاق شد");
      await refreshConversations();
      if (state.activeId === conversationId) openConversation(conversationId);
    } catch (e) {
      toast(e.message || "فقط مدیر می‌تواند سنجاق کند — sql/007");
    }
  });
  if (!mine) {
    add("گزارش پیام", () => openReportDialog("message", m.id));
  }
  for (const emoji of ["👍", "❤️", "😂", "🔥"]) {
    add(emoji, async () => {
      try {
        await toggleReaction(m.id, emoji);
        const box = document.getElementById("messages");
        if (box && conversationId) {
          await refreshMessageReactions(conversationId, box);
        }
        toast("واکنش به‌روز شد");
      } catch (e) {
        toast(e.message || "واکنش ممکن نشد (migration 005 را اجرا کنید)");
      }
    });
  }
  document.body.append(menu);
  const pad = 8;
  menu.style.left = Math.min(x, window.innerWidth - 180) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 200) + "px";
  const closer = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("click", closer);
    }
  };
  setTimeout(() => document.addEventListener("click", closer), 0);
}

async function openChatMenu(conversationId, conv) {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const c = (state.conversations || []).find((x) => x.id === conversationId) || conv || {};
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px" }, [
      el("h3", { text: "گزینه‌های گفتگو" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("button", {
      class: "btn btn-ghost", type: "button",
      text: c.muted ? "صدا دار کردن" : "بی‌صدا کردن",
      onclick: async () => {
        try {
          await setConversationMuted(conversationId, !c.muted);
          overlay.remove();
          await refreshConversations();
          toast(c.muted ? "صدا دار شد" : "بی‌صدا شد");
        } catch (e) {
          toast(e.message || "خطا — sql/005 را اجرا کنید");
        }
      },
    }),
    el("button", {
      class: "btn btn-ghost", type: "button", style: "margin-top:8px",
      text: c.archived ? "خارج از آرشیو" : "آرشیو",
      onclick: async () => {
        try {
          await setConversationArchived(conversationId, !c.archived);
          overlay.remove();
          state.activeId = null;
          $("#main")?.classList.remove("show-chat");
          await refreshConversations();
          toast(c.archived ? "از آرشیو خارج شد" : "آرشیو شد");
        } catch (e) {
          toast(e.message || "خطا — sql/005 را اجرا کنید");
        }
      },
    }),
  );
  if (c.type === "group" || c.type === "channel") {
    sheet.append(el("button", {
      class: "btn btn-ghost", type: "button", style: "margin-top:8px", text: "ویرایش اطلاعات",
      onclick: () => { overlay.remove(); openEditConversationPanel(conversationId, c); },
    }));
    sheet.append(el("button", {
      class: "btn btn-ghost", type: "button", style: "margin-top:8px", text: "اعضا",
      onclick: () => { overlay.remove(); openMembersPanel(conversationId, c); },
    }));
    sheet.append(el("button", {
      class: "btn btn-ghost", type: "button", style: "margin-top:8px", text: "لینک دعوت",
      onclick: async () => {
        try {
          const link = await createInviteLink(conversationId, { maxUses: 50, expiresHours: 72 });
          const url = `${location.origin}${location.pathname}?invite=${link.code}`;
          await navigator.clipboard.writeText(url).catch(() => {});
          toast("لینک کپی شد");
          alert("لینک دعوت:\n" + url);
        } catch (e) {
          toast(e.message || "ساخت لینک ممکن نشد — sql/006 را اجرا کنید");
        }
      },
    }));
  }
  if (c.type === "private" && c.peer?.id) {
    sheet.append(el("button", {
      class: "btn btn-danger", type: "button", style: "margin-top:8px", text: "مسدود کردن",
      onclick: async () => {
        if (!confirm("این کاربر مسدود شود؟")) return;
        try {
          await blockUser(c.peer.id);
          overlay.remove();
          toast("مسدود شد");
        } catch (e) {
          toast(e.message || "خطا");
        }
      },
    }));
  }
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}


function openSearchPanel() {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const results = el("div", { id: "user-results", class: "list" });
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
      el("h3", { text: "جستجوی کاربر" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("div", { class: "field" }, [
      el("input", { id: "user-q", placeholder: "@username یا نام نمایشی", autocomplete: "off" }),
    ]),
    el("p", {
      style: "color:var(--text-mute);font-size:0.8rem;margin:0 0 8px",
      text: "با زدن روی نتیجه، پروفایل باز می‌شود و می‌توانید پیام بدهید.",
    }),
    results,
  );
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  $("#user-q")?.focus();

  const run = async () => {
    const q = ($("#user-q")?.value || "").trim();
    if (!q) {
      results.replaceChildren(el("div", { class: "empty", text: "نام کاربری را بنویسید…" }));
      return;
    }
    setText(results, "در حال جستجو…");
    try {
      const users = await searchUsers(q);
      results.replaceChildren();
      for (const u of users) {
        if (u.id === state.profile?.id) continue;
        const item = el("button", {
          class: "list-item",
          type: "button",
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
            el("div", { class: "title" }, [el("span", { text: u.display_name || u.username || "کاربر" })]),
            el("div", { class: "preview" }, [el("span", { text: u.username ? "@" + u.username : "" })]),
          ]),
        );
        results.append(item);
      }
      if (!results.children.length) {
        results.append(el("div", { class: "empty", text: "کاربری پیدا نشد" }));
      }
    } catch (e) {
      results.replaceChildren(el("div", { class: "empty", text: e.message || "خطا در جستجو" }));
    }
  };
  $("#user-q").addEventListener("input", () => {
    clearTimeout(openSearchPanel._t);
    openSearchPanel._t = setTimeout(run, 280);
  });
  $("#user-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });
}

function openCreatePanel() {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px" }, [
      el("h3", { text: "ساخت جدید" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("button", {
      class: "btn btn-primary", type: "button", text: "گروه جدید",
      onclick: () => {
        overlay.remove();
        openCreateGroupForm();
      },
    }),
    el("button", {
      class: "btn btn-ghost", type: "button", text: "کانال جدید",
      style: "margin-top:8px",
      onclick: () => {
        overlay.remove();
        openCreateChannelForm();
      },
    }),
    el("button", {
      class: "btn btn-ghost", type: "button", text: "پیام‌های شخصی",
      style: "margin-top:8px",
      onclick: async () => {
        try {
          const id = await ensureSavedMessages();
          overlay.remove();
          await openConversation(id);
        } catch (e) {
          toast(e.message || "خطا");
        }
      },
    }),
  );
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

async function openMembersPanel(conversationId, conv) {
  const overlay = el("div", { class: "panel-overlay" });
  const inner = el("div", { class: "panel sheet" });
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
      const myRole = (state.conversations || []).find((x) => x.id === conversationId)?.role;
      if (myRole === "owner" && m.role !== "owner" && m.user_id !== state.profile?.id) {
        const actions = el("div", { style: "display:flex;flex-direction:column;gap:4px" });
        if (m.role !== "admin") {
          actions.append(el("button", {
            class: "btn btn-ghost", type: "button", text: "مدیر",
            style: "width:auto;padding:4px 8px;font-size:0.75rem;margin:0",
            onclick: async (ev) => {
              ev.stopPropagation();
              try {
                await setMemberRole(conversationId, m.user_id, "admin");
                toast("مدیر شد");
                overlay.remove();
                openMembersPanel(conversationId, conv);
              } catch (e) { toast(e.message || "خطا — sql/007"); }
            },
          }));
        } else {
          actions.append(el("button", {
            class: "btn btn-ghost", type: "button", text: "عزل",
            style: "width:auto;padding:4px 8px;font-size:0.75rem;margin:0",
            onclick: async (ev) => {
              ev.stopPropagation();
              try {
                await setMemberRole(conversationId, m.user_id, "member");
                toast("نقش تغییر کرد");
                overlay.remove();
                openMembersPanel(conversationId, conv);
              } catch (e) { toast(e.message || "خطا"); }
            },
          }));
        }
        actions.append(el("button", {
          class: "btn btn-danger", type: "button", text: "حذف",
          style: "width:auto;padding:4px 8px;font-size:0.75rem;margin:0",
          onclick: async (ev) => {
            ev.stopPropagation();
            if (!confirm("حذف عضو؟")) return;
            try {
              await removeMember(conversationId, m.user_id);
              toast("حذف شد");
              overlay.remove();
              openMembersPanel(conversationId, conv);
            } catch (e) { toast(e.message || "خطا"); }
          },
        }));
        row.append(actions);
      }
      list.append(row);
    }
    if (!list.children.length) setText(list, "عضوی نیست");
  } catch (e) {
    setText(list, e.message || "خطا");
  }
}

async function openProfileView(userId) {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  setText(sheet, "در حال بارگذاری…");
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);

  try {
    const p = await getPublicProfile(userId);
    if (!p) throw new Error("پروفایل پیدا نشد");
    const isMe = p.id === state.profile?.id;
    sheet.replaceChildren();
    const av = el("div", { class: "avatar", style: "width:72px;height:72px;font-size:1.4rem;margin:0 auto 12px" });
    if (p.avatar_url) av.append(el("img", { src: p.avatar_url, alt: "" }));
    else setText(av, initials(p.display_name || p.username || "?"));
    sheet.append(
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("h3", { text: isMe ? "پروفایل شما" : "پروفایل" }),
        el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
      ]),
      av,
      el("div", { style: "text-align:center;margin-bottom:12px" }, [
        el("div", { style: "font-weight:700;font-size:1.1rem", text: p.display_name || "کاربر" }),
        el("div", { style: "color:var(--accent-2);margin-top:4px", text: p.username ? "@" + p.username : "" }),
        p.bio ? el("p", { style: "color:var(--text-dim);font-size:0.9rem;margin-top:10px", text: p.bio }) : null,
      ]),
    );
    if (isMe) {
      sheet.append(el("button", {
        class: "btn btn-primary", type: "button", text: "ویرایش پروفایل",
        onclick: () => { overlay.remove(); openSettingsPanel(); },
      }));
      sheet.append(el("button", {
        class: "btn btn-ghost", type: "button", text: "پیام‌های شخصی",
        style: "margin-top:8px",
        onclick: async () => {
          overlay.remove();
          const id = await ensureSavedMessages();
          await openConversation(id);
        },
      }));
    } else {
      sheet.append(el("button", {
        class: "btn btn-primary", type: "button", text: "ارسال پیام",
        onclick: async () => {
          try {
            const cid = await openPrivateChat(p.id);
            overlay.remove();
            await openConversation(cid);
          } catch (e) {
            toast(e.message || "نتوانست گفتگو باز شود");
          }
        },
      }));
      sheet.append(el("button", {
        class: "btn btn-ghost", type: "button", text: "مسدود کردن", style: "margin-top:8px",
        onclick: async () => {
          if (!confirm("مسدود شود؟")) return;
          try {
            await blockUser(p.id);
            overlay.remove();
            toast("مسدود شد");
          } catch (e) {
            toast(e.message || "خطا");
          }
        },
      }));
      sheet.append(el("button", {
        class: "btn btn-danger", type: "button", text: "گزارش کاربر", style: "margin-top:8px",
        onclick: () => openReportDialog("user", p.id),
      }));
    }
  } catch (e) {
    sheet.replaceChildren(
      el("div", { class: "msg-error", text: e.message || "خطا" }),
      el("button", { class: "btn btn-ghost", type: "button", text: "بستن", onclick: () => overlay.remove() }),
    );
  }
}

function openSettingsPanel() {
  const overlay = el("div", { class: "panel-overlay" });
  const inner = el("div", { class: "panel sheet" });
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
      class: "btn btn-ghost", type: "button", text: "تم روشن / تاریک",
      style: "margin-bottom:8px",
      onclick: () => {
        const cur = document.documentElement.getAttribute("data-theme");
        const next = cur === "light" ? "dark" : "light";
        if (next === "light") document.documentElement.setAttribute("data-theme", "light");
        else document.documentElement.removeAttribute("data-theme");
        try { localStorage.setItem("dk-theme", next); } catch (_) {}
        toast(next === "light" ? "تم روشن" : "تم تاریک");
      },
    }),
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


function openForwardPicker(message) {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const list = el("div", { class: "list" });
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
      el("h3", { text: "فوروارد به…" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("p", { style: "color:var(--text-mute);font-size:0.85rem", text: (message.body || "رسانه").slice(0, 100) }),
    list,
  );
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  setText(list, "در حال بارگذاری…");
  (async () => {
    try {
      const convs = await listConversations();
      list.replaceChildren();
      for (const c of convs.filter((x) => !x.archived)) {
        const item = el("button", {
          class: "list-item", type: "button",
          onclick: async () => {
            try {
              await forwardMessage(message.id, c.id);
              overlay.remove();
              toast("فوروارد شد");
              if (state.activeId === c.id) {
                state.messages = await loadMessages(c.id);
                const box = $("#messages");
                if (box) renderMessages(box, state.messages, { conversationId: c.id });
              }
              await refreshConversations();
            } catch (e) {
              toast(e.message || "فوروارد ناموفق — sql/006 را اجرا کنید");
            }
          },
        });
        const av = el("div", { class: "avatar" });
        setText(av, initials(c.title || "?"));
        item.append(av, el("div", { class: "list-meta" }, [
          el("div", { class: "title" }, [el("span", { text: c.title || "گفتگو" })]),
          el("div", { class: "preview" }, [el("span", { text: c.type || "" })]),
        ]));
        list.append(item);
      }
      if (!list.children.length) setText(list, "مقصدی نیست");
    } catch (e) {
      setText(list, e.message || "خطا");
    }
  })();
}

function openChatSearch(conversationId) {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const results = el("div", { class: "list" });
  const input = el("input", { id: "chat-search-q", placeholder: "جستجو در این گفتگو…", autocomplete: "off" });
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
      el("h3", { text: "جستجوی پیام‌ها" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("div", { class: "field" }, [input]),
    results,
  );
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  input.focus();
  let t = null;
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 1) {
      results.replaceChildren();
      return;
    }
    setText(results, "جستجو…");
    try {
      const rows = await searchInConversation(conversationId, q);
      results.replaceChildren();
      for (const r of rows) {
        const item = el("button", {
          class: "list-item", type: "button",
          onclick: async () => {
            overlay.remove();
            // ensure message visible
            if (!state.messages.find((m) => m.id === r.id)) {
              state.messages = await loadMessages(conversationId, { limit: 100 });
            }
            const box = $("#messages");
            if (box) {
              renderMessages(box, state.messages, { conversationId });
              const elMsg = box.querySelector(`.msg[data-id="${r.id}"]`);
              if (elMsg) {
                elMsg.classList.add("msg-highlight");
                elMsg.scrollIntoView({ behavior: "smooth", block: "center" });
                setTimeout(() => elMsg.classList.remove("msg-highlight"), 2000);
              }
            }
          },
        });
        item.append(el("div", { class: "list-meta" }, [
          el("div", { class: "title" }, [
            el("span", { text: r.display_name || r.username || "کاربر" }),
            el("time", { text: formatTime(r.created_at) }),
          ]),
          el("div", { class: "preview" }, [el("span", { text: (r.body || "").slice(0, 100) })]),
        ]));
        results.append(item);
      }
      if (!results.children.length) setText(results, "نتیجه‌ای نیست");
    } catch (e) {
      setText(results, e.message || "خطا — sql/006 را اجرا کنید");
    }
  };
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(run, 320);
  });
}

function openReportDialog(targetType, targetId) {
  const reason = prompt("دلیل گزارش را بنویسید:");
  if (!reason || reason.trim().length < 2) return;
  submitReport(targetType, targetId, reason.trim())
    .then(() => toast("گزارش ثبت شد"))
    .catch((e) => toast(e.message || "ثبت گزارش ناموفق — sql/006"));
}

function openContactsPanel() {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const list = el("div", { class: "list" });
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
      el("h3", { text: "مخاطبان" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    el("button", {
      class: "btn btn-ghost", type: "button", text: "کاربران مسدودشده",
      style: "margin-bottom:8px",
      onclick: () => { overlay.remove(); openBlockedPanel(); },
    }),
    list,
  );
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  setText(list, "بارگذاری…");
  listContacts().then((peers) => {
    list.replaceChildren();
    for (const p of peers) {
      const item = el("button", {
        class: "list-item", type: "button",
        onclick: async () => {
          overlay.remove();
          await openProfileView(p.id);
        },
      });
      const av = el("div", { class: "avatar" });
      if (p.avatar_url) av.append(el("img", { src: p.avatar_url, alt: "" }));
      else setText(av, initials(p.display_name || p.username));
      item.append(av, el("div", { class: "list-meta" }, [
        el("div", { class: "title" }, [el("span", { text: p.display_name || p.username })]),
        el("div", { class: "preview" }, [el("span", { text: p.username ? "@" + p.username : "" })]),
      ]));
      list.append(item);
    }
    if (!list.children.length) setText(list, "هنوز مخاطبی از گفتگوهای خصوصی نیست");
  }).catch((e) => setText(list, e.message || "خطا"));
}

function openBlockedPanel() {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const list = el("div", { class: "list" });
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
      el("h3", { text: "مسدودشده‌ها" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    list,
  );
  overlay.append(sheet);
  document.body.append(overlay);
  listBlockedUsers().then((rows) => {
    list.replaceChildren();
    for (const p of rows) {
      const item = el("div", { class: "list-item" });
      item.append(
        el("div", { class: "list-meta", style: "flex:1" }, [
          el("div", { class: "title", text: p.display_name || p.username || p.id }),
          el("div", { class: "preview", text: p.username ? "@" + p.username : "" }),
        ]),
        el("button", {
          class: "btn btn-ghost", type: "button", text: "رفع مسدودیت",
          style: "width:auto;padding:8px 12px",
          onclick: async () => {
            try {
              await unblockUser(p.id);
              toast("رفع مسدودیت شد");
              overlay.remove();
              openBlockedPanel();
            } catch (e) {
              toast(e.message || "خطا");
            }
          },
        }),
      );
      list.append(item);
    }
    if (!list.children.length) setText(list, "لیست خالی است");
  }).catch((e) => setText(list, e.message || "خطا — sql/006"));
}

async function startVoiceCapture(conversationId, doSendFn) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    toast("مرورگر از ضبط صدا پشتیبانی نمی‌کند");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast("دسترسی میکروفون داده نشد");
    return;
  }
  const chunks = [];
  const rec = new MediaRecorder(stream);
  const started = Date.now();
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const timer = el("div", { style: "text-align:center;font-size:1.4rem;margin:12px 0", text: "0:00" });
  let tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    setText(timer, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  }, 250);
  const stopAll = () => {
    clearInterval(tick);
    try { rec.state(); } catch (_) {}
    stream.getTracks().forEach((t) => t.stop());
  };
  sheet.append(
    el("h3", { text: "ضبط پیام صوتی" }),
    timer,
    el("button", {
      class: "btn btn-primary", type: "button", text: "توقف و ارسال",
      onclick: () => {
        rec.onstop = async () => {
          stopAll();
          overlay.remove();
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          try {
            toast("در حال آپلود صدا…");
            const att = await uploadVoiceBlob(conversationId, blob, (Date.now() - started) / 1000);
            await doSendFn(att);
          } catch (e) {
            toast(e.message || "ارسال صدا ناموفق");
          }
        };
        rec.stop();
      },
    }),
    el("button", {
      class: "btn btn-ghost", type: "button", text: "لغو", style: "margin-top:8px",
      onclick: () => { stopAll(); overlay.remove(); },
    }),
  );
  overlay.append(sheet);
  document.body.append(overlay);
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.start(200);
}

// invite deep link on boot
async function handleInviteDeepLink() {
  const params = new URLSearchParams(location.search);
  const code = params.get("invite");
  if (!code) return;
  try {
    const cid = await joinByInvite(code);
    history.replaceState({}, "", location.pathname);
    toast("به گفتگو پیوستید");
    if (cid) await openConversation(cid);
  } catch (e) {
    toast(e.message || "پیوستن با لینک ناموفق");
  }
}


async function openEditConversationPanel(conversationId, conv) {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  let memberCount = null;
  try { memberCount = await getMemberCount(conversationId); } catch (_) {}
  sheet.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
      el("h3", { text: conv.type === "channel" ? "ویرایش کانال" : "ویرایش گروه" }),
      el("button", { class: "icon-btn", type: "button", onclick: () => overlay.remove() }, [icon("close")]),
    ]),
    memberCount != null
      ? el("p", { style: "color:var(--text-mute);font-size:0.85rem", text: `تعداد اعضا: ${memberCount}` })
      : null,
    el("div", { class: "field" }, [
      el("label", { text: "نام" }),
      el("input", { id: "ec-title", value: conv.title || "" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { text: "توضیحات" }),
      el("textarea", { id: "ec-desc", rows: "3" }),
    ]),
  );
  const isChannel = conv.type === "channel";
  if (isChannel) {
    const pub = el("div", { class: "field" });
    const sel = el("select", { id: "ec-public" });
    for (const [v, l] of [["true", "عمومی"], ["false", "خصوصی"]]) {
      const o = el("option", { value: v, text: l });
      if (String(!!conv.is_public) === v) o.selected = true;
      sel.append(o);
    }
    pub.append(el("label", { text: "نوع کانال" }), sel);
    sheet.append(pub);
  }
  sheet.append(
    el("div", { class: "field" }, [
      el("label", { text: "تصویر" }),
      el("input", { id: "ec-av", type: "file", accept: "image/*" }),
    ]),
    el("button", {
      class: "btn btn-primary", type: "button", text: "ذخیره",
      onclick: async () => {
        try {
          const file = $("#ec-av")?.files?.[0];
          if (file) await uploadConversationAvatar(conversationId, file);
          await updateConversationMeta(conversationId, {
            title: $("#ec-title").value.trim(),
            description: $("#ec-desc").value,
            is_public: isChannel ? $("#ec-public")?.value === "true" : undefined,
          });
          toast("ذخیره شد");
          overlay.remove();
          await refreshConversations();
          if (state.activeId === conversationId) openConversation(conversationId);
        } catch (e) {
          toast(e.message || "خطا — sql/007 و دسترسی مدیر را بررسی کنید");
        }
      },
    }),
  );
  $("#ec-desc").value = conv.description || "";
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}


function openCreateGroupForm() {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  sheet.append(
    el("h3", { text: "گروه جدید" }),
    el("div", { class: "field" }, [el("label", { text: "نام گروه" }), el("input", { id: "ng-title", placeholder: "مثلاً دوستان" })]),
    el("div", { class: "field" }, [el("label", { text: "توضیحات (اختیاری)" }), el("textarea", { id: "ng-desc", rows: "2" })]),
    el("button", {
      class: "btn btn-primary", type: "button", text: "ساخت",
      onclick: async () => {
        const title = $("#ng-title").value.trim();
        if (!title) return toast("نام لازم است");
        try {
          const id = await createGroup(title, []);
          if ($("#ng-desc").value.trim()) {
            try { await updateConversationMeta(id, { description: $("#ng-desc").value.trim() }); } catch (_) {}
          }
          overlay.remove();
          toast("گروه ساخته شد");
          await openConversation(id);
        } catch (e) {
          toast(e.message || "خطا در ساخت گروه");
        }
      },
    }),
    el("button", { class: "btn btn-ghost", type: "button", text: "انصراف", onclick: () => overlay.remove() }),
  );
  overlay.append(sheet);
  document.body.append(overlay);
  $("#ng-title")?.focus();
}

function openCreateChannelForm() {
  const overlay = el("div", { class: "panel-overlay" });
  const sheet = el("div", { class: "panel sheet" });
  const sel = el("select", { id: "nc-public" });
  sel.append(el("option", { value: "true", text: "عمومی" }), el("option", { value: "false", text: "خصوصی" }));
  sheet.append(
    el("h3", { text: "کانال جدید" }),
    el("div", { class: "field" }, [el("label", { text: "نام کانال" }), el("input", { id: "nc-title" })]),
    el("div", { class: "field" }, [el("label", { text: "توضیحات" }), el("textarea", { id: "nc-desc", rows: "2" })]),
    el("div", { class: "field" }, [el("label", { text: "نوع" }), sel]),
    el("button", {
      class: "btn btn-primary", type: "button", text: "ساخت کانال",
      onclick: async () => {
        const title = $("#nc-title").value.trim();
        if (!title) return toast("نام لازم است");
        try {
          const id = await createChannel(title, $("#nc-desc").value.trim(), $("#nc-public").value === "true");
          overlay.remove();
          toast("کانال ساخته شد");
          await openConversation(id);
        } catch (e) {
          toast(e.message || "خطا در ساخت کانال");
        }
      },
    }),
    el("button", { class: "btn btn-ghost", type: "button", text: "انصراف", onclick: () => overlay.remove() }),
  );
  overlay.append(sheet);
  document.body.append(overlay);
}
