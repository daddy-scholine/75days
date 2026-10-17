/* 75 Days — offline habit challenge. All data stays on the device:
   settings + daily ticks in localStorage, photos as Blobs in IndexedDB. */
(function () {
"use strict";
const VERSION = "1.2.0";
const TOTAL = 75;
const KEY = "d75";
const $ = (id) => document.getElementById(id);
const CHECK = '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

/* ---------- habit presets ---------- */
const P = (label, type, extra) => Object.assign({ id: "h" + Math.random().toString(36).slice(2, 8), label, type: type || "check" }, extra || {});
const PRESETS = {
  "Everyday": () => [
    P("Workout 45 min"), P("20 min walk outdoors"), P("Follow my diet, no junk"),
    P("Water 3 L", "water", { target: 6 }), P("Read 10 pages"), P("Sleep on time"),
    P("Progress photo", "photo"),
  ],
  "Fitness": () => [
    P("Workout 1"), P("Outdoor workout 2"), P("Diet, no cheat meal"), P("No alcohol"),
    P("Water 3.8 L", "water", { target: 8 }), P("Read 10 pages"), P("Progress photo", "photo"),
  ],
  "Student / resident": () => [
    P("Slept by 10:15 pm"), P("Workout"), P("20 min walk outdoors"), P("Diet followed, no junk"),
    P("Water 3 L", "water", { target: 6 }), P("Anki / flashcards done"), P("90 min deep study"),
    P("1 hour new skill"), P("10 pages non-fiction"), P("1 real conversation"), P("Progress photo", "photo"),
  ],
};

/* ---------- state ---------- */
let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.settings) return s; } catch (e) {}
  return { settings: null, days: {} };
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast("Couldn't save. Your phone's storage may be full."); return false; }
  // cloud.js (optional accounts + groups) listens for this to sync
  try { window.dispatchEvent(new Event("d75:changed")); } catch (e) {}
  return true;
}
const day = (n) => S.days[n] || (S.days[n] = { c: {}, w: 0, t: "", kg: "", e: 0, notes: "", p: false });
const habits = () => S.settings.habits;

/* ---------- dates ---------- */
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const isoD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startD = () => parseD(S.settings.start);
const dateOf = (n) => addD(startD(), n - 1);
function todayN() { const t = new Date(); const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()); return Math.round((t0 - startD()) / 864e5) + 1; }
const uptoN = () => Math.min(Math.max(todayN(), 0), TOTAL);
const fLong = (d) => d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const fShort = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

/* ---------- scoring ---------- */
function done(h, r) {
  if (h.type === "water") return r.w >= (h.target || 6);
  if (h.type === "photo") return !!(r.p || r.c[h.id]);
  return !!r.c[h.id];
}
const score = (r) => habits().reduce((s, h) => s + (done(h, r) ? 1 : 0), 0);
const isGood = (n) => { const r = S.days[n]; return !!r && (score(r) >= S.settings.good || r.t === "busy"); };
function level(r) { if (!r) return 0; const s = score(r), m = habits().length || 1; if (s >= m) return 4; if (s >= S.settings.good) return 3; if (s >= m / 2) return 2; return s > 0 ? 1 : 0; }
function summary() {
  const up = uptoN(); let good = 0, sum = 0, cnt = 0, streak = 0;
  for (let n = 1; n <= up; n++) { if (isGood(n)) good++; const s = S.days[n] ? score(S.days[n]) : 0; if (n < up || s > 0) { sum += s; cnt++; } }
  for (let n = up; n >= 1; n--) { if (isGood(n)) streak++; else if (n === up) continue; else break; }
  return { up, good, streak, avg: cnt ? sum / cnt : null };
}

/* ---------- photos (IndexedDB) ---------- */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open("d75-photos", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("photos");
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
async function pOp(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction("photos", mode); const st = tx.objectStore("photos"); const rq = fn(st); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); }); }
const pGet = (n) => pOp("readonly", (s) => s.get(String(n)));
const pPut = (n, b) => pOp("readwrite", (s) => s.put(b, String(n)));
const pDel = (n) => pOp("readwrite", (s) => s.delete(String(n)));
const pClear = () => pOp("readwrite", (s) => s.clear());
const urlCache = {};
async function photoURL(n) {
  if (!S.days[n] || !S.days[n].p) return null;
  if (urlCache[n]) return urlCache[n];
  try { const b = await pGet(n); if (!b) return null; urlCache[n] = URL.createObjectURL(b); return urlCache[n]; } catch (e) { return null; }
}
function dropURL(n) { if (urlCache[n]) { URL.revokeObjectURL(urlCache[n]); delete urlCache[n]; } }
async function shrink(file, max, q) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((r) => cv.toBlob(r, "image/jpeg", q));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- ui helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2400); }
function arm(btn, label, armedLabel, fn) {
  btn.addEventListener("click", () => {
    if (!btn.dataset.armed) { btn.dataset.armed = "1"; btn.textContent = armedLabel; setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; } }, 3500); return; }
    delete btn.dataset.armed; btn.textContent = label; fn();
  });
}
let view = "vToday";
function show(v, fromBack) {
  // Android back button: other tabs sit one step above Today in history, so Back returns to Today instead of closing the app
  if (!fromBack && v !== "vSetup") {
    if (v !== "vToday" && view === "vToday") history.pushState({ v }, "");
    else if (v !== "vToday") history.replaceState({ v }, "");
    else if (view !== "vToday" && view !== "vSetup" && history.state && history.state.v) { history.back(); return; }
  }
  view = v;
  for (const id of ["vSetup", "vToday", "vCal", "vGroups", "vProg", "vSet"]) $(id).hidden = id !== v;
  $("tabs").hidden = v === "vSetup";
  document.querySelectorAll("#tabs button").forEach((b) => b.toggleAttribute("aria-current", b.dataset.v === v));
  if (b(v)) render();
  window.scrollTo(0, 0);
}
const b = (v) => v !== "vSetup";
document.querySelectorAll("#tabs button").forEach((btn) => btn.addEventListener("click", () => show(btn.dataset.v)));
window.addEventListener("popstate", () => { if (S.settings) show((history.state && history.state.v) || "vToday", true); });
const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

/* ---------- setup ---------- */
let tmp = [];
function renderHabitEditor(listEl, arr, onChange) {
  listEl.innerHTML = arr.map((h, i) =>
    '<li><span class="tag">' + (h.type === "water" ? "water" : h.type === "photo" ? "photo" : "") + '</span>' +
    '<input data-i="' + i + '" value="' + esc(h.label) + '" maxlength="40" aria-label="Habit ' + (i + 1) + '">' +
    '<button class="x" data-x="' + i + '" aria-label="Remove ' + esc(h.label) + '">×</button></li>').join("");
  listEl.oninput = (e) => { const i = e.target.dataset.i; if (i != null) { arr[i].label = e.target.value; onChange(false); } };
  listEl.onclick = (e) => { const i = e.target.dataset.x; if (i != null) { if (arr.length <= 1) { toast("Keep at least one habit."); return; } arr.splice(+i, 1); onChange(true); } };
}
function setupInit() {
  $("suStart").value = isoD(new Date());
  const names = Object.keys(PRESETS);
  $("suPresets").innerHTML = names.map((n, i) => '<button class="chip" data-p="' + esc(n) + '" aria-pressed="' + (i === 0) + '">' + esc(n) + "</button>").join("");
  tmp = PRESETS[names[0]]();
  const redraw = (full) => { if (full) renderHabitEditor($("suHabits"), tmp, redraw); };
  redraw(true);
  $("suPresets").onclick = (e) => { const c = e.target.closest(".chip"); if (!c) return; document.querySelectorAll("#suPresets .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c))); tmp = PRESETS[c.dataset.p](); redraw(true); };
  const add = () => { const v = $("suNew").value.trim(); if (!v) return; tmp.push(P(v)); $("suNew").value = ""; redraw(true); };
  $("suAdd").onclick = add; $("suNew").onkeydown = (e) => { if (e.key === "Enter") add(); };
  const endTxt = () => { const v = $("suStart").value; if (!v) { $("suEnd").textContent = ""; return; } $("suEnd").textContent = "Day 75 will be " + fLong(addD(parseD(v), TOTAL - 1)) + "."; };
  $("suStart").oninput = endTxt; endTxt();
  $("suGo").onclick = () => {
    const hs = tmp.filter((h) => h.label.trim()); if (!hs.length) { toast("Add at least one habit."); return; }
    const start = $("suStart").value || isoD(new Date());
    S = { settings: { name: $("suName").value.trim(), start, habits: hs, good: Math.max(1, Math.round(hs.length * 0.73)), created: Date.now() }, days: {} };
    if (persist()) { sel = clampN(todayN()); show("vToday"); toast("Day 1 starts " + fShort(parseD(start)) + ". Good luck!"); }
  };
}

/* ---------- today ---------- */
const clampN = (n) => Math.min(Math.max(n, 1), TOTAL);
let sel = 1;
async function renderToday() {
  const n = sel, r = day(n), d = dateOf(n), tn = todayN();
  $("tN").textContent = "Day " + n;
  $("tDate").textContent = fLong(d) + (n === tn ? " · today" : n > tn ? " · upcoming" : "");
  $("tPrev").disabled = n <= 1; $("tNext").disabled = n >= TOTAL;
  $("tBar").style.width = (uptoN() / TOTAL) * 100 + "%";
  $("tToday").hidden = n === clampN(tn);
  $("tMax").textContent = habits().length; $("tScore").textContent = score(r);
  document.querySelectorAll("#tType .chip").forEach((c) => c.setAttribute("aria-pressed", String(r.t === c.dataset.type)));
  $("tTypeHint").hidden = r.t !== "busy";
  $("tTypeHint").textContent = "A busy day counts as a good day if you still did the minimum you set for yourself.";
  $("tChecks").innerHTML = habits().map((h) => {
    const on = done(h, r);
    let extra = "";
    if (h.type === "water") { const t = h.target || 6; extra = '<div class="glasses">' + Array.from({ length: t }, (_, i) => '<button class="glass' + (r.w > i ? " f" : "") + '" data-g="' + (i + 1) + '" aria-label="Glass ' + (i + 1) + ' of ' + t + '"></button>').join("") + "</div>"; }
    return '<div class="hrow' + (on ? " on" : "") + '" data-h="' + h.id + '" role="checkbox" aria-checked="' + on + '" tabindex="0"><span class="box">' + CHECK + '</span><span class="t"><span>' + esc(h.label) + "</span>" + extra + "</span></div>";
  }).join("");
  $("tPhotoCard").hidden = !habits().some((h) => h.type === "photo") && !r.p;
  const u = await photoURL(n);
  if (n !== sel) return;
  $("tPhoto").innerHTML = u ? '<img alt="Progress photo, day ' + n + '" src="' + u + '">' : '<div class="muted small" style="padding:16px"><b style="color:var(--accent);display:block;font-size:16px">Day ' + n + "</b>Same place, same light every day.</div>";
  $("tRm").hidden = !u;
  if (document.activeElement !== $("tWeight")) $("tWeight").value = r.kg || "";
  if (document.activeElement !== $("tNotes")) $("tNotes").value = r.notes || "";
  $("tEnergy").innerHTML = [1, 2, 3, 4, 5].map((i) => '<button class="dot" data-e="' + i + '" aria-pressed="' + (r.e === i) + '" aria-label="Energy ' + i + '">' + i + "</button>").join("");
  // never miss twice
  const up = uptoN(); let msg = "";
  if (n === clampN(tn) && up >= 3 && !isGood(up - 1) && !isGood(up - 2)) msg = "You missed two days in a row. Make today count.";
  $("tAlert").textContent = msg; $("tAlert").hidden = !msg;
}
function toggle(id) {
  const r = day(sel), h = habits().find((x) => x.id === id); if (!h) return;
  if (h.type === "water") r.w = r.w >= (h.target || 6) ? 0 : h.target || 6;
  else r.c[id] = !done(h, r) ? true : false;
  if (h.type === "photo" && !r.c[id] && r.p) toast("Remove the photo to untick this.");
  buzz(done(h, r) ? 12 : 6);
  persist(); renderToday();
}
$("tChecks").addEventListener("click", (e) => {
  const g = e.target.closest(".glass"); const r = day(sel);
  if (g) { e.stopPropagation(); const i = +g.dataset.g; r.w = r.w === i ? i - 1 : i; persist(); renderToday(); return; }
  const row = e.target.closest(".hrow"); if (row) toggle(row.dataset.h);
});
$("tChecks").addEventListener("keydown", (e) => { const row = e.target.closest(".hrow"); if (row && (e.key === " " || e.key === "Enter")) { e.preventDefault(); const id = row.dataset.h; toggle(id); setTimeout(() => { const el = document.querySelector('.hrow[data-h="' + id + '"]'); el && el.focus(); }); } });
$("tType").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; const r = day(sel); r.t = r.t === c.dataset.type ? "" : c.dataset.type; persist(); renderToday(); });
$("tEnergy").addEventListener("click", (e) => { const d = e.target.closest(".dot"); if (!d) return; const r = day(sel), v = +d.dataset.e; r.e = r.e === v ? 0 : v; persist(); renderToday(); });
let typT;
for (const [id, f] of [["tWeight", "kg"], ["tNotes", "notes"]]) $(id).addEventListener("input", (e) => { day(sel)[f] = e.target.value; clearTimeout(typT); typT = setTimeout(persist, 400); });
$("tPrev").onclick = () => { if (sel > 1) { sel--; renderToday(); } };
$("tNext").onclick = () => { if (sel < TOTAL) { sel++; renderToday(); } };
$("tToday").onclick = () => { sel = clampN(todayN()); renderToday(); };
$("tFile").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  const n = sel;
  try {
    const blob = await shrink(f, 1400, 0.85);
    await pPut(n, blob); dropURL(n);
    const r = day(n); r.p = true; const ph = habits().find((h) => h.type === "photo"); if (ph) r.c[ph.id] = true;
    persist(); toast("Photo saved"); if (n === sel) renderToday();
  } catch (err) { toast("Couldn't save the photo. Try another one."); }
});
arm($("tRm"), "Remove", "Tap again to remove", async () => {
  const n = sel; try { await pDel(n); } catch (e) {}
  dropURL(n); const r = day(n); r.p = false; const ph = habits().find((h) => h.type === "photo"); if (ph) r.c[ph.id] = false;
  persist(); renderToday();
});

/* ---------- calendar ---------- */
function renderCal() {
  const s = startD(), e = dateOf(TOTAL), tn = todayN();
  $("cRange").textContent = fShort(s) + " – " + fShort(e) + " " + e.getFullYear();
  const off = (s.getDay() + 6) % 7; // Monday-first
  let h = "<div></div>" + ["M", "T", "W", "T", "F", "S", "S"].map((x) => '<div class="h">' + x + "</div>").join("");
  const rows = Math.ceil((off + TOTAL) / 7);
  for (let w = 0; w < rows; w++) {
    h += '<div class="w">W' + (w + 1) + "</div>";
    for (let c = 0; c < 7; c++) {
      const n = w * 7 + c - off + 1;
      if (n < 1 || n > TOTAL) { h += "<div></div>"; continue; }
      const r = S.days[n]; const cls = ["cell", "l" + level(r)];
      if (r && r.t === "busy") cls.push("busy"); if (n > tn) cls.push("future"); if (n === tn) cls.push("today");
      h += '<button class="' + cls.join(" ") + '" data-n="' + n + '" aria-label="Day ' + n + ", " + fShort(dateOf(n)) + (r ? ", " + score(r) + " of " + habits().length : "") + '">' + n + "<small>" + dateOf(n).getDate() + "</small></button>";
    }
  }
  $("cGrid").innerHTML = h;
}
$("cGrid").addEventListener("click", (e) => { const c = e.target.closest(".cell"); if (!c) return; sel = +c.dataset.n; show("vToday"); });

/* ---------- progress ---------- */
async function renderProg() {
  const sm = summary(), tn = todayN();
  $("pHello").textContent = (S.settings.name ? S.settings.name + " · " : "") + fShort(startD()) + " – " + fShort(dateOf(TOTAL));
  $("pDay").innerHTML = tn < 1 ? '0<small> starts ' + fShort(startD()) + "</small>" : sm.up + "<small> / 75</small>";
  $("pStreak").innerHTML = sm.streak + "<small> days</small>";
  $("pGood").innerHTML = sm.good + "<small> of " + sm.up + "</small>";
  $("pAvg").innerHTML = sm.avg != null ? sm.avg.toFixed(1) + "<small> / " + habits().length + "</small>" : "–";
  const up = Math.max(sm.up, 1);
  $("pRates").innerHTML = habits().map((h) => { let k = 0; for (let n = 1; n <= up; n++) if (S.days[n] && done(h, S.days[n])) k++; const pc = Math.round((k / up) * 100); return '<div class="hr"><span class="nm">' + esc(h.label) + '</span><span class="pc">' + pc + '%</span><span class="tr"><b style="width:' + pc + '%"></b></span></div>'; }).join("");
  // weight
  const pts = []; for (let n = 1; n <= TOTAL; n++) { const v = parseFloat(String((S.days[n] || {}).kg || "").replace(",", ".")); if (!isNaN(v) && v > 0) pts.push([n, v]); }
  if (pts.length >= 2) {
    const W = 320, H = 120, pl = 34, pr = 10, pt = 10, pb = 22;
    const ys = pts.map((p) => p[1]); let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const x = (n) => pl + ((n - 1) / (TOTAL - 1)) * (W - pl - pr), y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const path = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(" ");
    const last = pts[pts.length - 1];
    $("pWeight").className = "wchart";
    $("pWeight").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Weight from ' + pts[0][1] + " to " + last[1] + ' kg">' +
      '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(hi) + '" y2="' + y(hi) + '" stroke="var(--line)"/><line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(lo) + '" y2="' + y(lo) + '" stroke="var(--line)"/>' +
      '<text x="' + (pl - 6) + '" y="' + (y(hi) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + hi.toFixed(1) + '</text><text x="' + (pl - 6) + '" y="' + (y(lo) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + lo.toFixed(1) + "</text>" +
      '<text x="' + pl + '" y="' + (H - 6) + '" font-size="10" fill="var(--muted)">Day 1</text><text x="' + (W - pr) + '" y="' + (H - 6) + '" font-size="10" text-anchor="end" fill="var(--muted)">Day 75</text>' +
      '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(last[0]) + '" cy="' + y(last[1]) + '" r="4" fill="var(--accent)"/></svg>' +
      '<p class="small muted">Day ' + pts[0][0] + ": " + pts[0][1] + " kg → Day " + last[0] + ": " + last[1] + " kg</p>";
  } else { $("pWeight").className = "muted small"; $("pWeight").textContent = "Log your weight on at least two days to see a chart."; }
  // photos
  let first = null, lastP = null; for (let n = 1; n <= TOTAL; n++) if (S.days[n] && S.days[n].p) { if (!first) first = n; lastP = n; }
  const fig = async (n, lab) => { const u = n ? await photoURL(n) : null; return '<figure><div class="fr">' + (u ? '<img alt="Day ' + n + ' photo" src="' + u + '">' : "No photo yet") + "</div><figcaption>" + lab + (u ? " · Day " + n : "") + "</figcaption></figure>"; };
  $("pCompare").innerHTML = (await fig(first, "First")) + (await fig(lastP && lastP !== first ? lastP : null, "Latest"));
  $("pShareNote").textContent = "Shares an image with your day, score and streak. No photos are included.";
}

/* ---------- share card ---------- */
async function shareCard() {
  const sm = summary(), n = Math.max(sm.up, 1), r = S.days[n];
  const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1350; const g = cv.getContext("2d");
  const F = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  g.fillStyle = "#2e7d32"; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = "#ffffff"; g.font = "800 64px " + F; g.fillText("75 DAYS", 80, 140);
  g.font = "500 36px " + F; g.globalAlpha = 0.85; g.fillText(S.settings.name ? S.settings.name + "'s challenge" : "My challenge", 80, 195); g.globalAlpha = 1;
  g.font = "800 240px " + F; g.fillText(String(sm.up), 80, 470);
  const nw = g.measureText(String(sm.up)).width;
  g.font = "600 56px " + F; g.globalAlpha = 0.85; g.fillText("/ 75 days", 80 + nw + 24, 470); g.globalAlpha = 1;
  const tiles = [["Today", (r ? score(r) : 0) + "/" + habits().length], ["Streak", sm.streak + " d"], ["Good days", String(sm.good)]];
  tiles.forEach((t, i) => { const x = 80 + i * 320; g.fillStyle = "rgba(255,255,255,.14)"; roundRect(g, x, 600, 290, 170, 24); g.fill(); g.fillStyle = "#fff"; g.font = "500 30px " + F; g.fillText(t[0], x + 28, 655); g.font = "800 64px " + F; g.fillText(t[1], x + 28, 735); });
  // 75-day grid
  const cols = 15, sz = 52, gap = 12, gx = 80, gy = 830;
  for (let i = 1; i <= TOTAL; i++) { const c = (i - 1) % cols, rr = Math.floor((i - 1) / cols); const lv = level(S.days[i]); g.fillStyle = ["rgba(255,255,255,.14)", "rgba(255,255,255,.35)", "rgba(255,255,255,.55)", "rgba(255,255,255,.8)", "#ffffff"][lv]; roundRect(g, gx + c * (sz + gap), gy + rr * (sz + gap), sz, sz, 10); g.fill(); }
  g.fillStyle = "#ffffff"; g.globalAlpha = 0.8; g.font = "500 30px " + F; g.fillText("Never miss twice.", 80, 1290); g.globalAlpha = 1;
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  const file = new File([blob], "75-days-day-" + sm.up + ".png", { type: "image/png" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "75 Days", text: "Day " + sm.up + " of 75" }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Image saved");
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
$("pShare").onclick = () => shareCard().catch(() => toast("Couldn't make the image."));

/* ---------- settings ---------- */
function renderSet() {
  $("sName").value = S.settings.name || ""; $("sStart").value = S.settings.start;
  $("sGoodN").value = S.settings.good; $("sGoodN").max = habits().length; $("sMax").textContent = habits().length;
  renderHabitEditor($("sHabits"), habits(), (full) => { if (S.settings.good > habits().length) S.settings.good = habits().length; persist(); if (full) renderSet(); });
  $("sVer").textContent = VERSION;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  $("sInstall").textContent = standalone ? "Installed. Open it from your home screen." : ios ? "In Safari, tap the Share button, then \"Add to Home Screen\"." : deferredInstall ? "Install it to open it like an app, even offline." : "In your browser menu, choose \"Install app\" or \"Add to Home screen\".";
  $("sInstallBtn").hidden = standalone || !deferredInstall;
}
$("sName").addEventListener("input", (e) => { S.settings.name = e.target.value.trim(); persist(); });
$("sStart").addEventListener("change", (e) => { if (!e.target.value) return; S.settings.start = e.target.value; persist(); sel = clampN(todayN()); toast("Start date changed. Day 75 is " + fShort(dateOf(TOTAL)) + "."); });
$("sGoodN").addEventListener("change", (e) => { const v = Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), habits().length); S.settings.good = v; e.target.value = v; persist(); });
const addHabit = () => { const v = $("sNew").value.trim(); if (!v) return; habits().push(P(v)); $("sNew").value = ""; persist(); renderSet(); };
$("sAdd").onclick = addHabit; $("sNew").onkeydown = (e) => { if (e.key === "Enter") addHabit(); };

const blobToData = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
$("sExport").onclick = async () => {
  try {
    const photos = {}; for (let n = 1; n <= TOTAL; n++) if (S.days[n] && S.days[n].p) { const b = await pGet(n); if (b) photos[n] = await blobToData(b); }
    const data = JSON.stringify({ app: "75days", v: 1, exported: new Date().toISOString(), settings: S.settings, days: S.days, photos });
    const blob = new Blob([data], { type: "application/json" });
    const name = "75days-backup-" + isoD(new Date()) + ".json";
    const file = new File([blob], name, { type: "application/json" });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "75 Days backup" }); $("sBackupMsg").textContent = "Backup ready."; return; } } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $("sBackupMsg").textContent = "Saved " + name + ". Keep it in Files, Drive or WhatsApp to yourself.";
  } catch (e) { $("sBackupMsg").textContent = "Couldn't create the backup. Try again."; }
};
$("sImport").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.app !== "75days" || !d.settings || !Array.isArray(d.settings.habits)) throw new Error("bad");
    await pClear(); Object.keys(urlCache).forEach(dropURL);
    for (const [n, du] of Object.entries(d.photos || {})) { const b = await (await fetch(du)).blob(); await pPut(n, b); }
    S = { settings: d.settings, days: d.days || {} }; persist(); sel = clampN(todayN());
    $("sBackupMsg").textContent = "Backup restored."; renderSet();
  } catch (err) { $("sBackupMsg").textContent = "That file isn't a 75 Days backup."; }
});
arm($("sReset"), "Delete everything", "Tap again to delete everything", async () => {
  try { await pClear(); } catch (e) {}
  Object.keys(urlCache).forEach(dropURL);
  S = { settings: null, days: {} }; try { localStorage.removeItem(KEY); } catch (e) {}
  setupInit(); show("vSetup");
});

/* ---------- install + offline ---------- */
let deferredInstall = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function ibDismissed() { try { return +(localStorage.getItem("d75-ib") || 0) > Date.now(); } catch (e) { return false; } }
function updateInstallBar() { $("installBar").hidden = !deferredInstall || isStandalone() || ibDismissed(); }
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; updateInstallBar(); if (view === "vSet") renderSet(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; updateInstallBar(); toast("Installed. Open 75 Days from your home screen."); if (view === "vSet") renderSet(); });
async function doInstall() { if (!deferredInstall) return; const ev = deferredInstall; deferredInstall = null; ev.prompt(); try { await ev.userChoice; } catch (e) {} updateInstallBar(); if (view === "vSet") renderSet(); }
$("sInstallBtn").onclick = doInstall;
$("ibGo").onclick = doInstall;
$("ibX").onclick = () => { try { localStorage.setItem("d75-ib", String(Date.now() + 7 * 864e5)); } catch (e) {} updateInstallBar(); };
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const offer = (w) => { $("update").hidden = false; $("updBtn").onclick = () => w.postMessage("skipWaiting"); };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); }); });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- render + boot ---------- */
function render() {
  if (!S.settings) return;
  if (view === "vToday") renderToday(); else if (view === "vCal") renderCal(); else if (view === "vProg") renderProg(); else if (view === "vSet") renderSet();
  else if (view === "vGroups") window.dispatchEvent(new Event("d75:groups"));
  if (view === "vSet") window.dispatchEvent(new Event("d75:settings"));
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.settings) render(); });

/* ---------- bridge for cloud.js ---------- */
window.D75 = {
  TOTAL,
  get state() { return S; },
  // replace local data with a merged copy from the cloud, then redraw
  replace(next) { S = next; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} if (S.settings) { sel = clampN(todayN()); if (view === "vSetup") show("vToday"); else render(); } },
  score: (r) => (S.settings ? score(r) : 0),
  summary: () => summary(),
  todayN: () => todayN(),
  toast, esc, arm, show,
  view: () => view,
};
window.dispatchEvent(new Event("d75:ready"));
if (S.settings) { sel = clampN(todayN()); show("vToday"); } else { setupInit(); show("vSetup"); }
})();
