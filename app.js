// 다운로드 선생님 폰 보기: 확장이 구글 드라이브의 "DownloadTeacher 동기화" 폴더에 올린 서재·스크랩과,
// 구글 드라이브 PC 앱이 올린 DownloadTeacher 폴더의 그림을 읽기만 한다 (drive.readonly). 내 데이터는 드라이브에만 있고 이 페이지에는 코드뿐.
// 처음 열 때 주소 끝의 #client=<구글 클라이언트 ID>를 기억한다 (확장의 "폰에서 보기"에서 복사한 주소).

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const API = "https://www.googleapis.com/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const SYNC_FOLDER = "DownloadTeacher 동기화";

// ---------- 설정·로그인 ----------
const hashClient = new URLSearchParams(location.hash.slice(1)).get("client");
if (hashClient) {
  localStorage.setItem("clientId", hashClient);
  history.replaceState(null, "", location.pathname);
}
const clientId = localStorage.getItem("clientId");
let token = null;
try {
  const t = JSON.parse(sessionStorage.getItem("token") || "null");
  if (t && t.exp > Date.now() + 60000) token = t.token;
} catch {}

function showLogin(msg) {
  $("#login").hidden = false;
  $$(".view").forEach((v) => (v.hidden = true));
  $("#loginMsg").textContent = msg || "";
  $("#loginBtn").hidden = !clientId;
  if (!clientId) $("#loginMsg").textContent = "확장의 일반 탭 → 폰에서 보기에서 복사한 주소로 열어 주세요";
}
function login() {
  return new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error));
        token = r.access_token;
        sessionStorage.setItem("token", JSON.stringify({ token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 }));
        resolve(token);
      },
    });
    tc.requestAccessToken({ prompt: "" });
  });
}
async function api(url, asBlob = false) {
  if (!token) throw Object.assign(new Error("login"), { login: true });
  const res = await fetch(url.startsWith("http") ? url : API + url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = null;
    sessionStorage.removeItem("token");
    throw Object.assign(new Error("login"), { login: true });
  }
  if (!res.ok) throw new Error(`드라이브 오류 ${res.status}`);
  return asBlob ? res.blob() : res.json();
}
const fileJson = (id) => api(`/files/${id}?alt=media`);
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const q = (s) => encodeURIComponent(s);

// ---------- 데이터 ----------
let index = null;
const state = { view: localStorage.getItem("view") || "library", shelf: "", genre: "", search: "" };

async function loadIndex() {
  $("#status").textContent = "불러오는 중…";
  const found = await api(`/files?q=${q(`name='${SYNC_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)`);
  const folder = found.files?.[0]?.id;
  if (!folder) throw new Error("드라이브에 동기화 폴더가 없어요. PC 확장에서 먼저 '구글 계정 연결'을 해 주세요");
  const idx = await api(`/files?q=${q(`name='index.json' and '${folder}' in parents and trashed=false`)}&fields=files(id)`);
  if (!idx.files?.[0]) throw new Error("아직 동기화된 내용이 없어요");
  index = await fileJson(idx.files[0].id);
  $("#status").textContent = `동기화 ${new Date(index.syncedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}`;
}

// ---------- 서재 ----------
function renderLibrary() {
  const shelves = index.shelves || [];
  $("#shelves").replaceChildren(
    ...[{ id: "", name: "전체" }, { id: "fav", name: "★ 즐겨찾기" }, ...shelves].map((s) => chip(s.name, state.shelf === s.id, () => ((state.shelf = s.id), renderLibrary())))
  );
  const s = state.search.toLowerCase();
  const list = index.library
    .filter((w) => !state.shelf || (state.shelf === "fav" ? w.fav : w.shelves.includes(state.shelf)))
    .filter((w) => !s || [w.title, w.titleTr, ...w.authors, ...w.fandoms, ...w.relationships].join(" ").toLowerCase().includes(s))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  $("#libList").replaceChildren(
    ...list.map((w) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="t">${w.fav ? "★ " : ""}${esc(w.titleTr || w.title)}</div>
        ${w.titleTr ? `<div class="sub">${esc(w.title)}</div>` : ""}
        <div class="meta">${esc([w.authors.join(", "), w.fandoms.slice(0, 2).join(", "), w.words && `${w.words} words`, w.chapterStat && `${w.chapterStat}장`].filter(Boolean).join(" · "))}</div>`;
      li.addEventListener("click", () => openWork(w));
      return li;
    })
  );
  if (!list.length) $("#libList").innerHTML = `<li class="muted">작품이 없어요</li>`;
}

let reading = null;
async function openWork(w) {
  if (!w.fileId) return toast("이 작품은 아직 동기화되지 않았어요");
  $("#rTitle").textContent = w.titleTr || w.title;
  openSheet("#reader");
  $("#rText").innerHTML = `<p class="muted">불러오는 중…</p>`;
  const data = await fileJson(w.fileId);
  reading = { w, data };
  const chs = data.work.chapters || [];
  $("#rChapter").replaceChildren(...chs.map((c, i) => new Option(data.mt?.titles?.[i] || c.title || `${i + 1}장`, i)));
  const saved = Number(localStorage.getItem(`pos:${w.id}`) || 0);
  $("#rChapter").value = String(Math.min(saved, chs.length - 1));
  $("#rMeta").textContent = [w.authors.join(", "), w.chapterStat && `${w.chapterStat}장`].filter(Boolean).join(" · ");
  renderChapter();
}
function renderChapter() {
  if (!reading) return;
  const { w, data } = reading;
  const ch = Number($("#rChapter").value) || 0;
  localStorage.setItem(`pos:${w.id}`, ch);
  const mode = $("#rMode").value;
  localStorage.setItem("rMode", mode);
  const blocks = data.work.chapters?.[ch]?.blocks || [];
  const trOf = (i) => data.hand?.[ch]?.[i] || (data.mt?.[ch]?.[i] != null ? esc(data.mt[ch][i]) : null);
  $("#rText").innerHTML = blocks
    .map((b, i) => {
      if (b.t === "hr") return "<hr>";
      const tag = /^(h\d|blockquote)$/.test(b.t) ? b.t : "p";
      const tr = trOf(i);
      if (mode === "orig" || !tr) return `<${tag}>${b.h}</${tag}>`;
      if (mode === "tr") return `<${tag}>${tr}</${tag}>`;
      return `<div class="pair"><${tag} class="o">${b.h}</${tag}><${tag}>${tr}</${tag}></div>`;
    })
    .join("");
  $("#reader .sheet-body").scrollTop = 0;
  $("#rPrev").disabled = ch <= 0;
  $("#rNext").disabled = ch >= (data.work.chapters?.length || 1) - 1;
}
$("#rChapter").addEventListener("change", renderChapter);
$("#rMode").value = localStorage.getItem("rMode") || "tr";
$("#rMode").addEventListener("change", renderChapter);
$("#rPrev").addEventListener("click", () => (($("#rChapter").value = String(Number($("#rChapter").value) - 1)), renderChapter()));
$("#rNext").addEventListener("click", () => (($("#rChapter").value = String(Number($("#rChapter").value) + 1)), renderChapter()));

// ---------- 스크랩 ----------
function renderScraps() {
  const used = new Map();
  for (const p of index.scraps) for (const g of p.genres || []) used.set(g, (used.get(g) || 0) + 1);
  $("#scrapGenres").replaceChildren(
    chip("전체", !state.genre, () => ((state.genre = ""), renderScraps())),
    ...[...used].sort((a, b) => b[1] - a[1]).map(([g, n]) => chip(`${g} ${n}`, state.genre === g, () => ((state.genre = g), renderScraps())))
  );
  const s = state.search.toLowerCase();
  const list = index.scraps
    .filter((p) => !state.genre || p.genres?.includes(state.genre))
    .filter((p) => !s || [p.title, p.board, p.category, ...(p.genres || [])].join(" ").toLowerCase().includes(s))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  $("#scrapList").replaceChildren(
    ...list.map((p) => {
      const li = document.createElement("li");
      li.className = "scrap";
      li.innerHTML = `${p.thumb && p.thumbType !== "video" ? `<img loading="lazy" src="${esc(p.thumb)}" alt="">` : `<span class="noimg"></span>`}
        <div><div class="t">${p.category ? `<span class="cat">${esc(p.category)}</span>` : ""}${esc(p.title)}</div>
        <div class="meta">${esc([p.site === "hygall" ? "해연갤" : "투디갤", p.board, p.date, `추천 ${p.votes || 0}`, `댓글 ${p.comments || 0}`].filter(Boolean).join(" · "))}</div>
        ${(p.genres || []).length ? `<div class="genres">${p.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}</div>`;
      li.addEventListener("click", () => openScrap(p));
      return li;
    })
  );
  if (!list.length) $("#scrapList").innerHTML = `<li class="muted">스크랩이 없어요</li>`;
}
async function openScrap(p) {
  if (!p.fileId) return toast("이 글은 아직 동기화되지 않았어요");
  $("#sTitle").textContent = p.title;
  openSheet("#scrapView");
  $("#sFrame").srcdoc = `<p style="font:14px sans-serif;color:#888;padding:20px">불러오는 중…</p>`;
  const blob = await api(`/files/${p.fileId}?alt=media`, true);
  $("#sFrame").srcdoc = await blob.text();
}

// ---------- 그림 (구글 드라이브 PC 앱이 올린 DownloadTeacher 폴더) ----------
const gal = { stack: [], next: null, loading: false };
async function galRoot() {
  const name = (index.rootFolder || "DownloadTeacher").split("/").pop();
  const r = await api(`/files?q=${q(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`);
  if (!r.files?.length) throw new Error(`드라이브에 "${name}" 폴더가 없어요. 구글 드라이브 PC 앱으로 다운로드 폴더의 ${name}을 올려 주세요`);
  return { id: r.files[0].id, name: r.files[0].name };
}
async function renderGallery(reset) {
  if (reset || !gal.stack.length) {
    gal.stack = [await galRoot()];
  }
  gal.next = null;
  $("#galGrid").replaceChildren();
  renderGalPath();
  await galMore();
}
function renderGalPath() {
  $("#galPath").replaceChildren(
    ...gal.stack.map((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.name;
      b.addEventListener("click", () => {
        gal.stack = gal.stack.slice(0, i + 1);
        renderGallery();
      });
      return b;
    })
  );
}
async function galMore() {
  if (gal.loading) return;
  gal.loading = true;
  $("#galMore").hidden = false;
  try {
    const folder = gal.stack.at(-1).id;
    const s = state.search.replace(/'/g, "\\'");
    const query = `'${folder}' in parents and trashed=false and (mimeType='application/vnd.google-apps.folder' or mimeType contains 'image/' or mimeType contains 'video/')${s ? ` and name contains '${s}'` : ""}`;
    const r = await api(`/files?q=${q(query)}&fields=nextPageToken,files(id,name,mimeType,thumbnailLink)&orderBy=folder,modifiedTime desc&pageSize=60${gal.next ? `&pageToken=${gal.next}` : ""}`);
    gal.next = r.nextPageToken || null;
    for (const f of r.files || []) $("#galGrid").appendChild(galTile(f));
    if (!$("#galGrid").children.length) $("#galGrid").innerHTML = `<p class="muted center">비어 있어요</p>`;
  } finally {
    gal.loading = false;
    $("#galMore").hidden = !gal.next;
  }
}
function galTile(f) {
  const d = document.createElement("button");
  d.type = "button";
  if (f.mimeType === "application/vnd.google-apps.folder") {
    d.className = "tile folder";
    d.innerHTML = `<span>📁</span><b>${esc(f.name)}</b>`;
    d.addEventListener("click", () => {
      gal.stack.push({ id: f.id, name: f.name });
      renderGallery();
    });
    return d;
  }
  d.className = "tile";
  if (f.thumbnailLink) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = f.thumbnailLink.replace(/=s\d+$/, "=s400");
    img.alt = "";
    d.appendChild(img);
  } else d.innerHTML = `<span>${f.mimeType.startsWith("video") ? "🎬" : "🖼"}</span>`;
  if (f.mimeType.startsWith("video")) d.insertAdjacentHTML("beforeend", `<i class="play">▶</i>`);
  d.addEventListener("click", () => openPhoto(f));
  return d;
}
let photoUrl = null;
async function openPhoto(f) {
  $("#pName").textContent = f.name;
  openSheet("#photo");
  $("#pBox").innerHTML = `<p class="muted">불러오는 중…</p>`;
  const blob = await api(`/files/${f.id}?alt=media`, true);
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(blob);
  $("#pBox").innerHTML = f.mimeType.startsWith("video") ? `<video src="${photoUrl}" controls autoplay loop playsinline></video>` : `<img src="${photoUrl}" alt="">`;
}
$("#main").addEventListener("scroll", () => {
  const m = $("#main");
  if (state.view === "gallery" && gal.next && m.scrollTop + m.clientHeight > m.scrollHeight - 600) galMore().catch(fail);
});

// ---------- 화면 ----------
function chip(label, on, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip" + (on ? " on" : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
function toast(t) {
  $("#status").textContent = t;
}
function openSheet(sel) {
  $(sel).hidden = false;
  history.pushState({ sheet: sel }, "");
}
function closeSheets() {
  $$(".sheet").forEach((s) => (s.hidden = true));
}
$$(".sheet .back").forEach((b) => b.addEventListener("click", () => history.back()));
window.addEventListener("popstate", closeSheets);

async function show(view) {
  state.view = view;
  localStorage.setItem("view", view);
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $("#topTitle").textContent = { library: "서재", scraps: "스크랩", gallery: "그림" }[view];
  if (view === "library") renderLibrary();
  if (view === "scraps") renderScraps();
  if (view === "gallery") await renderGallery(false);
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view).catch(fail)));
let searchTimer = null;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = $("#search").value.trim();
    show(state.view).catch(fail);
  }, 300);
});
$("#refreshBtn").addEventListener("click", () => start().catch(fail));

function fail(err) {
  if (err?.login) return showLogin("다시 로그인해 주세요");
  $("#status").textContent = String(err?.message || err);
}
async function start() {
  if (!clientId) return showLogin();
  if (!token) return showLogin();
  $("#login").hidden = true;
  await loadIndex();
  await show(state.view);
}
$("#loginBtn").addEventListener("click", () =>
  login()
    .then(start)
    .catch(fail)
);
start().catch(fail);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
