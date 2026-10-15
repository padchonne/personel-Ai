const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = "personal-ai-preview-v1";
const API_BASE_URL = (document.querySelector('meta[name="api-base-url"]')?.content || "").replace(/\/+$/, "");
const STATIC_ONLY = location.hostname.endsWith(".github.io") && !API_BASE_URL;
const ACCESS_TOKEN_KEY = "personal-ai-access-token";
const initialState = { chats: [], memories: [], settings: { language: "both", mode: "auto", speakReplies: false, memoryEnabled: true }, activeChatId: null };
let state = loadState();
let activePage = "chat";
let listening = false;
let recognition = null;
let taskTab = "pending";
let confirmAction = null;
let accessTokenPrompt = null;
let backendStatus = { available: false, geminiConfigured: false };

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed) return structuredClone(initialState);
    return { ...structuredClone(initialState), ...parsed, settings: { ...initialState.settings, ...(parsed.settings || {}) }, chats: [], memories: [], activeChatId: null };
  } catch (error) {
    console.error("Could not load preview data from browser storage.", error);
    return structuredClone(initialState);
  }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { console.error("Could not save preview data.", error); toast("Could not save this change in browser storage."); }
}
async function apiRequest(path, options = {}) {
  if (STATIC_ONLY) throw new Error("This GitHub Pages site has no backend connected. AI chat and saved data are unavailable.");
  let response;
  const request = (token = "") => fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  try {
    response = await request(sessionStorage.getItem(ACCESS_TOKEN_KEY) || "");
    if (response.status === 401 && API_BASE_URL) {
      const token = await requestAccessToken();
      response = await request(token);
      if (response.status === 401) sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Access code entry was cancelled.") throw error;
    throw new Error("Could not reach the backend. Start it with `python3 -m backend.main` and reload.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Backend request failed (${response.status}).`);
  return payload;
}
function requestAccessToken() {
  if (!accessTokenPrompt) {
    accessTokenPrompt = new Promise((resolve, reject) => {
      const dialog = $("#accessDialog");
      const form = $("#accessForm");
      const input = $("#accessTokenInput");
      const finish = (token) => {
        dialog.removeEventListener("close", onClose);
        form.removeEventListener("submit", onSubmit);
        accessTokenPrompt = null;
        if (token) {
          const value = token.trim();
          sessionStorage.setItem(ACCESS_TOKEN_KEY, value);
          resolve(value);
        } else {
          reject(new Error("Access code entry was cancelled."));
        }
      };
      const onClose = () => finish("");
      const onSubmit = (event) => {
        event.preventDefault();
        const token = input.value.trim();
        if (!token) { input.focus(); return; }
        input.value = "";
        dialog.close();
        finish(token);
      };
      dialog.addEventListener("close", onClose, { once: true });
      form.addEventListener("submit", onSubmit);
      dialog.showModal();
      input.focus();
    });
  }
  return accessTokenPrompt;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 3600);
}
function activeChat() { return state.chats.find((chat) => chat.id === state.activeChatId) || null; }
function renderChats(filter = "") {
  const chats = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt).filter((chat) => chat.title.toLowerCase().includes(filter.toLowerCase()));
  $("#recentChats").innerHTML = chats.length ? chats.map((chat) => `<button class="recent-chat ${chat.id === state.activeChatId ? "selected" : ""}" data-chat-id="${escapeHtml(chat.id)}"><span>${escapeHtml(chat.title)}</span></button>`).join("") : `<div class="recent-empty">${filter ? "No matching chats" : "Your chats will appear here"}</div>`;
  $$(".recent-chat").forEach((button) => button.addEventListener("click", () => setActiveChat(button.dataset.chatId)));
}
async function newChat() {
  if (STATIC_ONLY) return;
  try {
    const { chat } = await apiRequest("/api/chats", { method: "POST", body: JSON.stringify({}) });
    state.chats.unshift({ ...chat, updatedAt: Date.parse(chat.updatedAt), messages: [] });
    state.activeChatId = chat.id;
    renderChats(); renderChat(); navigate("chat"); $("#messageInput").focus();
  } catch (error) {
    console.error("Could not create a conversation.", error);
    toast(error.message);
  }
}
async function setActiveChat(id) {
  try {
    const { chat, messages } = await apiRequest(`/api/chats/${encodeURIComponent(id)}`);
    const index = state.chats.findIndex((item) => item.id === id);
    const updated = { ...chat, updatedAt: Date.parse(chat.updatedAt), messages };
    if (index === -1) state.chats.push(updated);
    else state.chats[index] = updated;
    state.activeChatId = id;
    renderChats(); renderChat(); navigate("chat");
  } catch (error) {
    console.error("Could not load the conversation.", error);
    toast(error.message);
  }
}
function renderChat() {
  const chat = activeChat();
  $("#chatTitle").textContent = chat?.title || "New conversation";
  $("#welcomeBlock").classList.toggle("hidden", Boolean(chat?.messages.length));
  $("#chatNotice").classList.toggle("hidden", Boolean(chat?.messages.length));
  const messages = $("#messages");
  messages.innerHTML = "";
  if (!chat) return;
  chat.messages.forEach((message, index) => {
    const user = message.role === "user";
    const row = document.createElement("article");
    row.className = `message ${user ? "user" : "assistant"}`;
    const actions = user ? "" : `<div class="message-actions"><button data-copy="${index}">Copy</button><button data-read="${index}">Read aloud</button></div>`;
    row.innerHTML = `<div class="message-avatar">${user ? "P" : "✳"}</div><div class="message-body"><div class="message-name">${user ? "You" : "Assistant"}</div><div class="message-bubble">${escapeHtml(message.text)}</div>${actions}</div>`;
    messages.append(row);
  });
  $$("[data-copy]", messages).forEach((button) => button.addEventListener("click", () => copyText(chat.messages[Number(button.dataset.copy)].text)));
  $$("[data-read]", messages).forEach((button) => button.addEventListener("click", () => speakText(chat.messages[Number(button.dataset.read)].text)));
  messages.scrollTop = messages.scrollHeight;
}
async function sendMessage(value) {
  const text = value.trim();
  if (!text) return;
  if (STATIC_ONLY) {
    toast("AI chat is unavailable until a backend is connected to this website.");
    return;
  }
  if (state.settings.mode === "offline") {
    toast("Offline mode is not configured. Choose Auto or Online to use Gemini.");
    return;
  }
  let chat = activeChat();
  const input = $("#messageInput");
  const sendButton = $('.send-button');
  if (sendButton.disabled) return;
  sendButton.disabled = true;
  input.value = ""; input.style.height = "auto";
  try {
    if (!chat) {
      const created = await apiRequest("/api/chats", { method: "POST", body: JSON.stringify({}) });
      chat = { ...created.chat, updatedAt: Date.parse(created.chat.updatedAt), messages: [] };
      state.chats.unshift(chat);
      state.activeChatId = chat.id;
    }
    const response = await apiRequest(`/api/chats/${encodeURIComponent(chat.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        text,
        memoryEnabled: state.settings.memoryEnabled,
        language: state.settings.language,
      }),
    });
    chat.title = response.title;
    chat.messages.push(...response.messages);
    chat.updatedAt = Date.now();
    renderChats(); renderChat();
    if (state.settings.speakReplies) speakText(response.messages[1].text);
  } catch (error) {
    console.error("Could not send the message.", error);
    input.value = text;
    renderChats(); renderChat();
    toast(error.message);
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard."); }
  catch (error) { console.error("Clipboard access was unavailable.", error); toast("Clipboard access is unavailable in this browser."); }
}
function speakText(text) {
  if (!("speechSynthesis" in window)) { toast("Speech output is not available in this browser."); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = state.settings.language === "ml" ? "ml-IN" : "en-US";
  utterance.rate = Number($("#voiceSpeed")?.value || 1);
  speechSynthesis.speak(utterance);
}
function navigate(page) {
  activePage = page;
  const labels = { chat: "Chat", memory: "Memory", voice: "Voice Studio", tasks: "Computer Tasks", settings: "Settings", help: "Help & Status" };
  $("#pageTitle").textContent = labels[page] || "Chat";
  $$(".page-view").forEach((item) => item.classList.toggle("hidden", item.id !== `page-${page}`));
  $$(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  $("#detailsToggle").classList.toggle("hidden", page !== "chat");
  if (page === "memory") renderMemory();
  if (page === "voice") renderVoice();
  if (page === "tasks") renderTasks();
  if (page === "settings") renderSettings();
  if (page === "help") renderHelp();
  closeMobileMenu();
}

function renderMemory(filter = "") {
  const page = $("#page-memory");
  const memories = state.memories.filter((item) => item.text.toLowerCase().includes(filter.toLowerCase()));
  page.innerHTML = `<div class="page-container">
    <div class="page-header"><div><div class="eyebrow">YOUR PERSONAL SPACE</div><h1>Memory</h1><p>${STATIC_ONLY ? "Connect a backend to save memories. Browser preferences remain on this device." : "Choose what your assistant should remember. Saved memories are stored in your backend."}</p></div><button class="button primary" id="addMemory" ${STATIC_ONLY ? "disabled" : ""}>＋ Add memory</button></div>
    <div class="surface-card"><h2>Memory permission</h2><p>Memory is ${state.settings.memoryEnabled ? "enabled" : "paused"}. Add only information you are comfortable storing in this browser.</p><div class="setting-row" style="margin-top:10px"><div class="setting-copy"><strong>Allow saved memories</strong><small>Pause to stop using memory in this preview.</small></div><button class="toggle ${state.settings.memoryEnabled ? "on" : ""}" id="memoryToggle" role="switch" aria-checked="${state.settings.memoryEnabled}" aria-label="Allow saved memories"></button></div></div>
    <div class="memory-toolbar"><input class="search-field" id="memorySearch" value="${escapeHtml(filter)}" placeholder="⌕  Search saved memories…" aria-label="Search saved memories">${state.memories.length ? `<button class="button secondary" id="clearMemories" ${STATIC_ONLY ? "disabled" : ""}>Clear all memories</button>` : ""}</div>
    <div class="memory-list">${memories.length ? memories.map((item) => `<article class="memory-item"><div class="memory-item-icon">◇</div><div class="memory-item-content"><p>${escapeHtml(item.text)}</p><div class="memory-meta">Saved ${new Date(item.createdAt).toLocaleDateString()} · Added by you</div></div><div class="memory-actions"><button data-edit-memory="${escapeHtml(item.id)}">Edit</button><button data-delete-memory="${escapeHtml(item.id)}">Delete</button></div></article>`).join("") : `    <div class="empty-state"><strong>${filter ? "No matching memories" : "No saved memories yet"}</strong>${filter ? "Try a different search." : STATIC_ONLY ? "Saved memories will be available after a backend is connected." : "Add a memory to keep a helpful detail in this browser."}</div>`}</div><div id="memoryEditor"></div></div>`;
  $("#memoryCount").textContent = state.memories.length;
  $("#detailsMemory").textContent = state.memories.length ? `${state.memories.length} saved ${state.memories.length === 1 ? "memory" : "memories"}` : "No memories saved";
  $("#addMemory").addEventListener("click", () => showMemoryEditor());
  $("#memoryToggle").addEventListener("click", () => { state.settings.memoryEnabled = !state.settings.memoryEnabled; saveState(); renderMemory(filter); });
  $("#memorySearch").addEventListener("input", (event) => renderMemory(event.target.value));
  $("#clearMemories")?.addEventListener("click", () => confirm("Clear all memories?", "This permanently removes all saved memories.", "Clear memories", async () => {
    try {
      await apiRequest("/api/memories", { method: "DELETE" });
      state.memories = []; renderMemory(); toast("All memories cleared.");
    } catch (error) { console.error("Could not clear memories.", error); toast(error.message); }
  }));
  $$("[data-edit-memory]", page).forEach((button) => { button.disabled = STATIC_ONLY; button.addEventListener("click", () => showMemoryEditor(button.dataset.editMemory)); });
  $$("[data-delete-memory]", page).forEach((button) => { button.disabled = STATIC_ONLY; button.addEventListener("click", () => confirm("Delete this memory?", "This memory will be removed from saved memory.", "Delete", async () => {
    try {
      await apiRequest(`/api/memories/${encodeURIComponent(button.dataset.deleteMemory)}`, { method: "DELETE" });
      state.memories = state.memories.filter((item) => item.id !== button.dataset.deleteMemory);
      renderMemory(filter); toast("Memory deleted.");
    } catch (error) { console.error("Could not delete memory.", error); toast(error.message); }
  })); });
}
function showMemoryEditor(id = "") {
  if (STATIC_ONLY) return;
  const memory = state.memories.find((item) => item.id === id);
  const editor = $("#memoryEditor");
  editor.innerHTML = `<form class="surface-card memory-form" id="memoryForm"><h2>${memory ? "Edit memory" : "Add a memory"}</h2><p>Stored only in this browser. Do not enter passwords, API keys, or other secrets.</p><textarea id="memoryText" maxlength="500" required placeholder="For example: I prefer explanations in Malayalam.">${escapeHtml(memory?.text || "")}</textarea><div class="form-actions"><button type="button" class="button secondary" id="cancelMemory">Cancel</button><button class="button primary" type="submit">Save memory</button></div></form>`;
  $("#cancelMemory").addEventListener("click", () => editor.replaceChildren());
  $("#memoryForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const text = $("#memoryText").value.trim(); if (!text) return;
    const submit = $("#memoryForm button[type='submit']");
    submit.disabled = true;
    try {
      if (memory) {
        await apiRequest(`/api/memories/${encodeURIComponent(memory.id)}`, { method: "PUT", body: JSON.stringify({ text }) });
        memory.text = text; memory.updatedAt = new Date().toISOString();
      } else {
        const { memory: created } = await apiRequest("/api/memories", { method: "POST", body: JSON.stringify({ text }) });
        state.memories.unshift(created);
      }
      renderMemory(); toast(memory ? "Memory updated." : "Memory saved.");
    } catch (error) {
      console.error("Could not save memory.", error);
      submit.disabled = false;
      toast(error.message);
    }
  });
  $("#memoryText").focus();
}
function renderVoice() {
  const page = $("#page-voice");
  page.innerHTML = `<div class="page-container"><div class="page-header"><div><div class="eyebrow">SPEAK &amp; LISTEN</div><h1>Voice Studio</h1><p>Uses browser speech features when available.</p></div></div>
    <div class="surface-card voice-card"><div class="mic-orb ${listening ? "listening" : ""}">◖</div><h2>${listening ? "Listening…" : "Ready when you are"}</h2><p class="voice-description">${listening ? "Speak now. Your words will appear in the chat composer." : "Start voice input or try speech output. Microphone permission is requested only when you start listening."}</p><button class="button ${listening ? "danger" : "primary"}" id="listenButton">${listening ? "■ Stop listening" : "◖ Start listening"}</button><div class="permission-line"><i class="dot"></i>Microphone permission is requested on use · Browser availability varies</div></div>
    <div class="voice-settings"><div class="voice-setting"><label for="speechLanguage">Speech language</label><select id="speechLanguage"><option value="ml-IN" ${state.settings.language === "ml" ? "selected" : ""}>Malayalam</option><option value="en-US" ${state.settings.language !== "ml" ? "selected" : ""}>English</option></select></div><div class="voice-setting"><label>Speak replies automatically</label><button class="toggle ${state.settings.speakReplies ? "on" : ""}" id="speakToggle" role="switch" aria-checked="${state.settings.speakReplies}" aria-label="Speak replies automatically"></button></div><div class="voice-setting"><label for="voiceSpeed">Voice speed · <span id="speedValue">${Number($("#voiceSpeed")?.value || 1).toFixed(1)}×</span></label><input id="voiceSpeed" type="range" min=".7" max="1.3" step=".1" value="${$("#voiceSpeed")?.value || 1}"></div><div class="voice-setting"><label>Test speech output</label><button class="button secondary" id="testVoice">▶ Test voice</button></div></div></div>`;
  $("#listenButton").addEventListener("click", toggleListening);
  $("#speechLanguage").addEventListener("change", (event) => { state.settings.language = event.target.value === "ml-IN" ? "ml" : "en"; saveState(); });
  $("#speakToggle").addEventListener("click", () => { state.settings.speakReplies = !state.settings.speakReplies; saveState(); renderVoice(); });
  $("#voiceSpeed").addEventListener("input", (event) => { $("#speedValue").textContent = `${Number(event.target.value).toFixed(1)}×`; });
  $("#testVoice").addEventListener("click", () => speakText("നമസ്കാരം! Hello, this is a voice preview."));
}
function toggleListening() {
  if (listening) { recognition?.stop(); listening = false; renderVoice(); return; }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { toast("Speech recognition is not supported by this browser. You can still type in Chat."); return; }
  recognition = new Recognition(); recognition.lang = state.settings.language === "ml" ? "ml-IN" : "en-US"; recognition.interimResults = true;
  recognition.onresult = (event) => { $("#messageInput").value = [...event.results].map((result) => result[0].transcript).join(""); $("#messageInput").dispatchEvent(new Event("input")); };
  recognition.onerror = (event) => { listening = false; renderVoice(); toast(`Speech recognition error: ${event.error}`); };
  recognition.onend = () => { listening = false; if (activePage === "voice") renderVoice(); };
  try { recognition.start(); listening = true; renderVoice(); }
  catch (error) { console.error("Could not start speech recognition.", error); toast("Could not start microphone input. Check browser permissions."); }
}
function renderTasks() {
  const content = taskTab === "pending" ? '<div class="empty-state"><strong>No pending approvals</strong>Actions requiring approval would appear here before they start.</div>' : taskTab === "allowed" ? '<div class="surface-card"><h2>No actions allowed</h2><p>Nothing can access or control your computer from this UI preview.</p></div>' : '<div class="empty-state"><strong>No task history</strong>Tasks appear here after a real task service is connected.</div>';
  $("#page-tasks").innerHTML = `<div class="page-container"><div class="page-header"><div><div class="eyebrow">SAFE PREVIEW</div><h1>Computer Tasks</h1><p>Review permissions and history. This preview does not execute commands or change files.</p></div></div><div class="task-tabs"><button class="task-tab ${taskTab === "pending" ? "active" : ""}" data-task-tab="pending">Pending approvals</button><button class="task-tab ${taskTab === "allowed" ? "active" : ""}" data-task-tab="allowed">Allowed tasks</button><button class="task-tab ${taskTab === "history" ? "active" : ""}" data-task-tab="history">Task history</button></div>${content}<div class="task-note">Safety preview: no shell commands, file deletion, or software installation will run from this page.</div></div>`;
  $$("[data-task-tab]").forEach((button) => button.addEventListener("click", () => { taskTab = button.dataset.taskTab; renderTasks(); }));
}
function renderSettings() {
  $("#page-settings").innerHTML = `<div class="page-container"><div class="page-header"><div><div class="eyebrow">MAKE IT YOURS</div><h1>Settings</h1><p>Personalize your assistant. Preferences are stored in this browser.</p></div></div>
    <section class="setting-group"><h2>Appearance</h2><div class="setting-row"><div class="setting-copy"><strong>Theme</strong><small>Light theme for a calm, readable workspace.</small></div><span class="inline-status">☼ Light</span></div></section>
    <section class="setting-group"><h2>Language</h2><div class="setting-row"><div class="setting-copy"><strong>Interface language</strong><small>Preferred language for assistant previews.</small></div><select id="languageSetting"><option value="both">Malayalam + English</option><option value="ml">Malayalam</option><option value="en">English</option></select></div></section>
    <section class="setting-group"><h2>AI &amp; Models</h2><div class="setting-row"><div class="setting-copy"><strong>Preferred AI mode</strong><small>Auto and Online use the configured Gemini backend.</small></div><select id="settingsMode"><option value="auto">Auto</option><option value="online">Online</option><option value="offline">Offline</option></select></div><div class="setting-row"><div class="setting-copy"><strong>Gemini service</strong><small>API credentials stay on the backend.</small></div><span class="inline-status"><i class="dot ${backendStatus.geminiConfigured ? "good" : ""}"></i> ${backendStatus.geminiConfigured ? "Configured" : STATIC_ONLY ? "Backend not connected" : "API key required"}</span></div></section>
    <section class="setting-group"><h2>Voice</h2><div class="setting-row"><div class="setting-copy"><strong>Speak replies automatically</strong><small>Use browser speech output when available.</small></div><button class="toggle ${state.settings.speakReplies ? "on" : ""}" id="settingsSpeak" role="switch" aria-checked="${state.settings.speakReplies}" aria-label="Speak replies automatically"></button></div></section>
    <section class="setting-group"><h2>Memory &amp; Privacy</h2><div class="setting-row"><div class="setting-copy"><strong>Use saved memories</strong><small>When enabled, your saved memories may be included as context for Gemini.</small></div><button class="toggle ${state.settings.memoryEnabled ? "on" : ""}" id="settingsMemory" role="switch" aria-checked="${state.settings.memoryEnabled}" aria-label="Use saved memories"></button></div><div class="setting-row"><div class="setting-copy"><strong>Conversation history</strong><small>${STATIC_ONLY ? "Conversation history is unavailable until a backend is connected." : `${state.chats.length} ${state.chats.length === 1 ? "conversation" : "conversations"} saved in the backend database.`}</small></div><button class="button secondary" id="clearHistory" ${state.chats.length ? "" : "disabled"}>Clear history</button></div><div class="setting-row"><div class="setting-copy"><strong>Credentials</strong><small>API keys are held by the backend and never sent to this browser.</small></div><span class="inline-status">Backend only</span></div></section>
    <section class="setting-group"><h2>About</h2><div class="setting-row"><div class="setting-copy"><strong>Personal AI UI</strong><small>Version 1 · Gemini + SQLite backend</small></div><span class="inline-status">${STATIC_ONLY ? "Static site" : "Connected app"}</span></div></section></div>`;
  $("#languageSetting").value = state.settings.language; $("#settingsMode").value = state.settings.mode;
  $("#languageSetting").addEventListener("change", (event) => { state.settings.language = event.target.value; saveState(); toast("Language preference saved."); });
  $("#settingsMode").addEventListener("change", (event) => { state.settings.mode = event.target.value; $("#modeSelect").value = event.target.value; updateMode(); saveState(); });
  $("#settingsSpeak").addEventListener("click", () => { state.settings.speakReplies = !state.settings.speakReplies; saveState(); renderSettings(); });
  $("#settingsMemory").addEventListener("click", () => { state.settings.memoryEnabled = !state.settings.memoryEnabled; saveState(); renderSettings(); });
  $("#clearHistory").addEventListener("click", () => confirm("Clear conversation history?", "All conversations and their messages will be permanently deleted.", "Clear history", async () => {
    try {
      await apiRequest("/api/chats", { method: "DELETE" });
      state.chats = []; state.activeChatId = null;
      renderChats(); renderChat(); renderSettings(); toast("Conversation history cleared.");
    } catch (error) { console.error("Could not clear conversation history.", error); toast(error.message); }
  }));
}
function storageAvailable() { try { localStorage.setItem("__preview_test__", "1"); localStorage.removeItem("__preview_test__"); return true; } catch { return false; } }
function renderHelp() {
  const backendText = backendStatus.available ? "Connected" : STATIC_ONLY ? "Not connected" : "Unavailable";
  const aiText = backendStatus.available
    ? backendStatus.geminiConfigured ? "Gemini configured" : "Gemini key required"
    : STATIC_ONLY ? "Backend required" : "Backend unavailable";
  $("#page-help").innerHTML = `<div class="page-container"><div class="page-header"><div><div class="eyebrow">TRANSPARENCY FIRST</div><h1>Help &amp; System Status</h1><p>${STATIC_ONLY ? "This GitHub Pages site hosts the interface only; it does not run the Python backend." : "Backend status is checked from this browser."}</p></div><button class="button secondary" id="refreshStatus">↻ Refresh status</button></div>
    <div class="status-grid"><article class="status-card"><i class="status-icon">⌘</i><div><strong>Backend</strong><span><i class="dot ${backendStatus.available ? "good" : ""}"></i> ${backendText}</span></div></article><article class="status-card"><i class="status-icon">✦</i><div><strong>Online AI</strong><span><i class="dot ${backendStatus.geminiConfigured ? "good" : ""}"></i> ${aiText}</span></div></article><article class="status-card"><i class="status-icon">◈</i><div><strong>Local model</strong><span><i class="dot"></i> Not configured</span></div></article><article class="status-card"><i class="status-icon">◖</i><div><strong>Microphone</strong><span><i class="dot"></i> Permission checked on use</span></div></article><article class="status-card"><i class="status-icon">◇</i><div><strong>Memory storage</strong><span><i class="dot ${backendStatus.available ? "good" : ""}"></i> ${backendStatus.available ? "SQLite backend" : STATIC_ONLY ? "Backend required" : "Backend unavailable"}</span></div></article><article class="status-card"><i class="status-icon">◷</i><div><strong>Last checked</strong><span>${new Date().toLocaleTimeString()}</span></div></article></div>
    <section class="surface-card troubleshoot"><h2>Getting started</h2><p>${STATIC_ONLY ? "To enable chat, AI, and saved conversations, deploy the Python backend separately, set GEMINI_API_KEY on that server, and configure this site to use its HTTPS API URL. Never put the key in this website." : "Chats and saved memories are stored in the backend's SQLite database. Gemini credentials stay on the backend."}</p><ul><li>Set GEMINI_API_KEY in the backend environment to enable AI replies.</li><li>Unavailable AI modes are not silently substituted.</li><li>Browser speech features vary. If recognition is unavailable, type in Chat.</li><li>Computer Tasks is a safe preview and does not execute actions.</li></ul></section></div>`;
  $("#refreshStatus").addEventListener("click", async () => {
    await checkBackend();
    renderHelp();
  });
}
async function checkBackend() {
  if (STATIC_ONLY) {
    backendStatus = { available: false, geminiConfigured: false };
    return;
  }
  try {
    const status = await apiRequest("/api/health");
    backendStatus = { available: true, geminiConfigured: status.geminiConfigured === true };
  } catch (error) {
    backendStatus = { available: false, geminiConfigured: false };
  }
}
async function loadBackendData() {
  if (STATIC_ONLY) return;
  try {
    const [{ chats }, { memories }] = await Promise.all([
      apiRequest("/api/chats"),
      apiRequest("/api/memories"),
    ]);
    state.chats = chats.map((chat) => ({ ...chat, updatedAt: Date.parse(chat.updatedAt), messages: [] }));
    state.memories = memories;
    renderChats();
    renderMemory();
    const firstChat = state.chats[0];
    if (firstChat) await setActiveChat(firstChat.id);
  } catch (error) {
    console.error("Could not load saved backend data.", error);
    toast(error.message);
  }
}
function updateMode() {
  const labels = { auto: "Auto mode", online: "Online", offline: "Offline" };
  $("#modeAvailability").textContent = state.settings.mode === "offline"
    ? "Offline model unavailable"
    : backendStatus.geminiConfigured ? "Gemini ready" : backendStatus.available ? "Gemini key required" : STATIC_ONLY ? "Backend not connected" : "Backend unavailable";
  $("#detailsMode").textContent = labels[$("#modeSelect").value];
  $("#detailsService").textContent = backendStatus.geminiConfigured
    ? "Gemini configured"
    : backendStatus.available ? "API key required" : STATIC_ONLY ? "Backend not connected" : "Backend unavailable";
}
function configureDeploymentUI() {
  if (!STATIC_ONLY) return;
  $("#backendLabel").textContent = "Static site";
  $("#backendFootnote").innerHTML = '<span class="dot"></span> AI and saved chats need a backend';
  $("#backendIndicator").setAttribute("aria-label", "Backend not connected");
  $("#chatNotice").innerHTML = '<span class="dot"></span> This website is online; connect a backend to enable AI chat and saved conversations.';
  $("#backendDetailTip").textContent = "GitHub Pages hosts this interface only. Chat and memory storage require a separate backend.";
  $("#messageInput").disabled = true;
  $("#messageInput").placeholder = "Connect a backend to start chatting";
  $(".send-button").disabled = true;
  $("#newChat").disabled = true;
  $$(".suggestion").forEach((button) => { button.disabled = true; });
}
function confirm(title, message, label, action) {
  $("#dialogTitle").textContent = title; $("#dialogMessage").textContent = message; $("#dialogConfirm").textContent = label;
  $("#dialogConfirm").className = `button ${/delete|clear/i.test(label) ? "danger" : "primary"}`;
  confirmAction = action; $("#confirmDialog").showModal();
}
function closeMobileMenu() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("visible"); }

$$("[data-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
$("#newChat").addEventListener("click", newChat);
$("#composer").addEventListener("submit", (event) => { event.preventDefault(); sendMessage($("#messageInput").value); });
$("#messageInput").addEventListener("input", (event) => { event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 150)}px`; });
$("#messageInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); } });
$$(".suggestion").forEach((button) => button.addEventListener("click", () => { $("#messageInput").value = button.dataset.prompt; $("#composer").requestSubmit(); }));
$("#modeSelect").value = state.settings.mode; $("#modeSelect").addEventListener("change", (event) => { state.settings.mode = event.target.value; updateMode(); saveState(); });
$("#detailsToggle").addEventListener("click", () => $("#detailsPanel").classList.toggle("collapsed"));
$("#closeDetails").addEventListener("click", () => $("#detailsPanel").classList.add("collapsed"));
$("#voiceShortcut").addEventListener("click", () => navigate("voice"));
$("#attachButton").addEventListener("click", () => toast("File attachments are not configured in this preview."));
$("#chatMore").addEventListener("click", () => {
  const chat = activeChat(); if (!chat) { toast("Start a conversation first."); return; }
  confirm("Delete this conversation?", "This conversation will be permanently removed.", "Delete conversation", async () => {
    try {
      await apiRequest(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "DELETE" });
      state.chats = state.chats.filter((item) => item.id !== chat.id);
      state.activeChatId = null;
      renderChats(); renderChat(); toast("Conversation deleted.");
    } catch (error) { console.error("Could not delete conversation.", error); toast(error.message); }
  });
});
$("#recentSearch").addEventListener("click", () => { const input = $("#recentSearchInput"); input.classList.toggle("hidden"); if (!input.classList.contains("hidden")) input.focus(); else { input.value = ""; renderChats(); } });
$("#recentSearchInput").addEventListener("input", (event) => renderChats(event.target.value));
$("#menuToggle").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("visible"); });
$(".close-menu").addEventListener("click", closeMobileMenu);
$("#scrim").addEventListener("click", closeMobileMenu);
$("#confirmForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "confirm") { event.preventDefault(); const action = confirmAction; confirmAction = null; $("#confirmDialog").close(); action?.(); }
  else confirmAction = null;
});
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); newChat(); } });
renderChats(); renderChat(); updateMode();
configureDeploymentUI();
Promise.all([checkBackend(), loadBackendData()]).then(updateMode);