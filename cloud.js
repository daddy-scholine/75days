/* 75 Days — optional accounts, cloud backup and groups (Firebase).
   The app works fully offline without this. When a Firebase config is present:
   - sign in with Google or email + password
   - your settings and daily ticks back up to your account (photos never leave the phone)
   - create or join groups with a 6-letter code; each group shows a live leaderboard of scores only */
import CONFIG from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SYNC_KEY = "d75-sync";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const $ = (id) => document.getElementById(id);

let fb = null;          // adapter around Firebase (or a test fake)
let user = null;        // {uid, email, name}
let loadErr = null;
let myGroups = [];      // [{id, name, code, owner}]
let openGid = null, stopWatch = null, members = [];
let pushT = null, pushing = false, pushAgain = false, lastPull = 0, lastSync = null;
let authMode = "signin", busy = false;

/* ---------- wait for app.js ---------- */
const ready = new Promise((res) => { if (window.D75) res(); else window.addEventListener("d75:ready", res, { once: true }); });
const D = () => window.D75;

/* ---------- Firebase adapter ---------- */
async function loadFB() {
  if (window.__D75_FAKE_FB) return window.__D75_FAKE_FB;
  const [AppM, A, F] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")]);
  const app = AppM.initializeApp(CONFIG);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const ref = (p) => F.doc(db, p);
  const toUser = (u) => (u ? { uid: u.uid, email: u.email || "", name: u.displayName || "" } : null);
  A.getRedirectResult(auth).catch(() => {});
  return {
    onAuth: (cb) => A.onAuthStateChanged(auth, (u) => cb(toUser(u))),
    async google() {
      const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
      try { await A.signInWithPopup(auth, p); }
      catch (e) { if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) await A.signInWithRedirect(auth, p); else throw e; }
    },
    signIn: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
    async signUp(e, p, name) { const c = await A.createUserWithEmailAndPassword(auth, e, p); if (name) await A.updateProfile(c.user, { displayName: name }); },
    reset: (e) => A.sendPasswordResetEmail(auth, e),
    signOut: () => A.signOut(auth),
    deleteMe: () => A.deleteUser(auth.currentUser),
    async get(p) { const s = await F.getDoc(ref(p)); return s.exists() ? s.data() : null; },
    set: (p, d, merge) => F.setDoc(ref(p), d, { merge: !!merge }),
    create: (p, d) => F.setDoc(ref(p), d),
    del: (p) => F.deleteDoc(ref(p)),
    async list(p) { const s = await F.getDocs(F.collection(db, p)); return s.docs.map((d) => Object.assign({ id: d.id }, d.data())); },
    watch: (p, cb, err) => F.onSnapshot(F.collection(db, p), (s) => cb(s.docs.map((d) => Object.assign({ id: d.id }, d.data()))), err),
    union: (v) => F.arrayUnion(v),
    remove: (v) => F.arrayRemove(v),
    now: () => F.serverTimestamp(),
  };
}

/* ---------- helpers ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (m) => D().toast(m);
function errMsg(e) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
    "auth/invalid-credential": "Email or password is wrong.",
    "auth/wrong-password": "Email or password is wrong.",
    "auth/user-not-found": "No account with this email. Create one instead.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection. Try again when you're online.",
    "auth/popup-closed-by-user": "Sign-in was closed before it finished.",
    "auth/unauthorized-domain": "Sign-in isn't enabled for this web address yet.",
    "auth/requires-recent-login": "For safety, sign in again and then repeat this.",
    "permission-denied": "You don't have access to that.",
    "unavailable": "Can't reach the server. Check your internet connection.",
  };
  return map[c] || "Something went wrong. Please try again.";
}
function syncMeta() { try { const m = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); if (m && user && m.uid === user.uid) return m; } catch (e) {} return { uid: user ? user.uid : null, settings: null, days: {}, member: null }; }
function saveMeta(m) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(m)); } catch (e) {} }
// what goes to the cloud for a day: everything except the local-only photo flag
function cloudDay(r) { const o = Object.assign({}, r); delete o.p; delete o.u; return o; }
const dayJSON = (r) => JSON.stringify(cloudDay(r || {}));
const setJSON = (s) => (s ? JSON.stringify({ name: s.name || "", start: s.start, habits: s.habits, good: s.good }) : null);
const myName = () => { const s = D().state.settings; return (s && s.name) || (user && user.name) || (user && user.email ? user.email.split("@")[0] : "") || "Member"; };

/* ---------- member summary (what a group sees) ---------- */
function memberDoc() {
  const S = D().state, s = S.settings, scores = {}, busyD = {};
  for (let n = 1; n <= D().TOTAL; n++) { const r = S.days[n]; if (!r) continue; const sc = D().score(r); if (sc) scores[n] = sc; if (r.t === "busy") busyD[n] = true; }
  return { name: myName().slice(0, 30), start: s.start, n: s.habits.length, good: s.good, scores, busy: busyD };
}
function stats(m) {
  const T = D().TOTAL;
  const [y, mo, d] = String(m.start || "").split("-").map(Number);
  const st = new Date(y, (mo || 1) - 1, d || 1), t = new Date(); const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const tn = Math.round((t0 - st) / 864e5) + 1, up = Math.min(Math.max(tn, 0), T);
  const sc = (n) => +((m.scores || {})[n] || 0), ok = (n) => sc(n) >= (m.good || 1) || !!(m.busy || {})[n];
  let good = 0, streak = 0;
  for (let n = 1; n <= up; n++) if (ok(n)) good++;
  for (let n = up; n >= 1; n--) { if (ok(n)) streak++; else if (n === up) continue; else break; }
  const lv = (n) => { const s = sc(n), mx = m.n || 1; return s >= mx ? 4 : s >= (m.good || mx) ? 3 : s >= mx / 2 ? 2 : s > 0 ? 1 : 0; };
  return { tn, up, good, streak, today: sc(up), max: m.n || 0, lv, busy: (n) => !!(m.busy || {})[n], done: tn > T };
}

/* ---------- sync ---------- */
function schedulePush(delay) { if (!user) return; clearTimeout(pushT); pushT = setTimeout(push, delay == null ? 1500 : delay); }
async function push() {
  if (!user || !D().state.settings) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  const meta = syncMeta(), S = D().state, uid = user.uid;
  try {
    const sj = setJSON(S.settings);
    if (sj !== meta.settings) { await fb.set("users/" + uid, Object.assign(JSON.parse(sj), { su: Date.now() }), true); meta.settings = sj; }
    const EMPTY = dayJSON({ c: {}, w: 0, t: "", kg: "", e: 0, notes: "" });
    for (const [n, r] of Object.entries(S.days)) {
      const j = dayJSON(r);
      if (meta.days[n] === j) continue;                       // unchanged since last backup
      if (meta.days[n] === undefined && j === EMPTY) continue;  // a day that was only looked at
      await fb.set("users/" + uid + "/days/" + n, Object.assign(cloudDay(r), { u: Date.now() }));
      meta.days[n] = j;
    }
    const md = memberDoc(), mj = JSON.stringify(md);
    if (myGroups.length && mj !== meta.member) {
      for (const g of myGroups) await fb.set("groups/" + g.id + "/members/" + uid, Object.assign({}, md, { u: Date.now() }));
      meta.member = mj;
    }
    saveMeta(meta); lastSync = new Date();
  } catch (e) { /* offline or rules: try again on next change */ }
  pushing = false;
  if (pushAgain) { pushAgain = false; schedulePush(300); }
  refreshSettingsCard();
}
async function pull() {
  if (!user) return false;
  lastPull = Date.now();
  const uid = user.uid, meta = syncMeta();
  const remote = await fb.get("users/" + uid);
  myGroups = await loadGroups(remote && Array.isArray(remote.groups) ? remote.groups : []);
  if (!remote || !remote.start) { schedulePush(10); return false; }       // brand-new account: upload this phone's data
  const local = D().state, merged = { settings: local.settings, days: Object.assign({}, local.days) };
  const remoteSet = { name: remote.name || "", start: remote.start, habits: remote.habits || [], good: remote.good || 1 };
  if (!local.settings || setJSON(local.settings) === meta.settings) { merged.settings = Object.assign({}, local.settings || { created: Date.now() }, remoteSet); meta.settings = setJSON(merged.settings); }
  const rdays = await fb.list("users/" + uid + "/days");
  for (const rd of rdays) {
    const n = rd.id, l = local.days[n];
    if (!l || dayJSON(l) === meta.days[n]) {
      const nd = cloudDay(rd); delete nd.id; nd.p = !!(l && l.p);
      merged.days[n] = nd; meta.days[n] = dayJSON(nd);
    }
  }
  saveMeta(meta);
  D().replace(merged);
  schedulePush(10);   // send anything this phone changed while offline
  return true;
}
async function loadGroups(ids) {
  const out = [];
  for (const id of ids) {
    try { const g = await fb.get("groups/" + id); if (g) out.push(Object.assign({ id }, g)); else fb.set("users/" + user.uid, { groups: fb.remove(id) }, true).catch(() => {}); } catch (e) {}
  }
  return out;
}

/* ---------- groups ---------- */
function newCode() { let s = ""; const a = new Uint32Array(6); crypto.getRandomValues(a); for (const v of a) s += CODE_CHARS[v % CODE_CHARS.length]; return s; }
function newId() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); }
async function createGroup(name) {
  const gid = newId(); let code = null;
  for (let i = 0; i < 5 && !code; i++) { const c = newCode(); try { if (!(await fb.get("codes/" + c))) { await fb.create("codes/" + c, { gid, owner: user.uid }); code = c; } } catch (e) { if (i === 4) throw e; } }
  if (!code) throw new Error("code");
  await fb.create("groups/" + gid, { name, code, owner: user.uid, created: fb.now() });
  await joinById(gid);
  return gid;
}
async function joinById(gid) {
  await fb.set("groups/" + gid + "/members/" + user.uid, Object.assign(memberDoc(), { u: Date.now() }));
  await fb.set("users/" + user.uid, { groups: fb.union(gid) }, true);
  const g = await fb.get("groups/" + gid);
  if (g && !myGroups.some((x) => x.id === gid)) myGroups.push(Object.assign({ id: gid }, g));
  const meta = syncMeta(); meta.member = null; saveMeta(meta);
}
async function joinByCode(code) {
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) throw { code: "x-code" };
  const c = await fb.get("codes/" + code);
  if (!c) throw { code: "x-code" };
  if (myGroups.some((g) => g.id === c.gid)) return c.gid;
  await joinById(c.gid);
  return c.gid;
}
async function leaveGroup(gid) {
  await fb.del("groups/" + gid + "/members/" + user.uid);
  await fb.set("users/" + user.uid, { groups: fb.remove(gid) }, true);
  myGroups = myGroups.filter((g) => g.id !== gid);
}
async function deleteGroup(g) {
  const ms = await fb.list("groups/" + g.id + "/members");
  for (const m of ms) await fb.del("groups/" + g.id + "/members/" + m.id);
  await fb.del("codes/" + g.code).catch(() => {});
  await fb.del("groups/" + g.id);
  await fb.set("users/" + user.uid, { groups: fb.remove(g.id) }, true);
  myGroups = myGroups.filter((x) => x.id !== g.id);
}
const inviteLink = (code) => location.origin + location.pathname.replace(/index\.html$/, "") + "?join=" + code;
async function shareInvite(g) {
  const link = inviteLink(g.code);
  const text = "Join my 75 Days group \"" + g.name + "\" 💪\nWe're doing a 75-day habit challenge together. Code: " + g.code + "\n" + link;
  try { if (navigator.share) { await navigator.share({ title: "75 Days group", text }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Invite copied. Paste it in WhatsApp."); } catch (e) { toast("Code: " + g.code); }
}

/* ---------- UI: groups tab ---------- */
function pendingJoin() { try { return sessionStorage.getItem("d75-join") || ""; } catch (e) { return ""; } }
function clearPending() { try { sessionStorage.removeItem("d75-join"); } catch (e) {} }

function authForm(prefix) {
  const up = authMode === "signup";
  return '<div class="card auth">' +
    '<div class="label">' + (up ? "Create your account" : "Sign in") + '</div>' +
    '<p class="small muted">Your ticks back up to your account, so a new phone gets them back. Photos always stay on your phone.</p>' +
    '<button class="btn big gbtn" data-a="google"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9z"/></svg>Continue with Google</button>' +
    '<div class="or"><span>or use email</span></div>' +
    (up ? '<label class="label" for="' + prefix + 'Name">Your name</label><input id="' + prefix + 'Name" maxlength="30" autocomplete="name" placeholder="Shown to your groups">' : "") +
    '<label class="label" for="' + prefix + 'Email">Email</label><input id="' + prefix + 'Email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com">' +
    '<label class="label" for="' + prefix + 'Pw">Password</label><input id="' + prefix + 'Pw" type="password" autocomplete="' + (up ? "new-password" : "current-password") + '" placeholder="' + (up ? "At least 6 characters" : "") + '">' +
    '<button class="btn primary big" data-a="' + (up ? "signup" : "signin") + '">' + (up ? "Create account" : "Sign in") + "</button>" +
    '<div class="row-actions" style="justify-content:space-between"><button class="linkbtn" data-a="mode">' + (up ? "I already have an account" : "New here? Create an account") + "</button>" + (up ? "" : '<button class="linkbtn" data-a="reset">Forgot password?</button>') + "</div>" +
    '<p class="small" data-msg></p></div>';
}
async function handleAuth(root, a, prefix) {
  const msg = root.querySelector("[data-msg]"), say = (t, err) => { if (msg) { msg.textContent = t; msg.style.color = err ? "var(--maroon)" : "var(--muted)"; } };
  if (a === "mode") { authMode = authMode === "signup" ? "signin" : "signup"; return "redraw"; }
  const email = ($(prefix + "Email") || {}).value, pw = ($(prefix + "Pw") || {}).value;
  try {
    busy = true;
    if (a === "google") { say("Opening Google…"); await fb.google(); }
    else if (a === "signin") { say("Signing in…"); await fb.signIn((email || "").trim(), pw || ""); }
    else if (a === "signup") { say("Creating account…"); await fb.signUp((email || "").trim(), pw || "", (($(prefix + "Name") || {}).value || "").trim()); }
    else if (a === "reset") { if (!email) { say("Enter your email above first.", true); return; } await fb.reset(email.trim()); say("Check your email for a link to reset your password."); }
  } catch (e) { say(errMsg(e), true); }
  finally { busy = false; }
}

function renderGroups() {
  const root = $("gRoot"); if (!root) return;
  if (!CONFIG) { root.innerHTML = '<div class="card"><div class="label">Coming soon</div><p class="small">Groups with friends are on the way. Until then, use <b>Progress → Share my progress</b> to post your streak.</p></div>'; return; }
  if (loadErr) { root.innerHTML = '<div class="card"><div class="label">You\'re offline</div><p class="small">Groups need an internet connection. Your own tracking still works offline.</p><button class="btn" data-a="retry">Try again</button></div>'; root.onclick = (e) => { if (e.target.closest('[data-a="retry"]')) { loadErr = null; init(); } }; return; }
  if (!fb) { root.innerHTML = '<div class="card"><p class="small muted">Loading…</p></div>'; return; }
  if (!user) {
    const pj = pendingJoin();
    root.innerHTML = (pj ? '<div class="card hl"><div class="label">You were invited</div><p class="small">Sign in to join the group with code <b class="mono">' + esc(pj) + "</b>.</p></div>" : "") + authForm("ga");
    root.onclick = async (e) => { const b = e.target.closest("[data-a]"); if (!b || busy) return; const r = await handleAuth(root, b.dataset.a, "ga"); if (r === "redraw") renderGroups(); };
    return;
  }
  if (openGid) return renderGroup();
  const pj = pendingJoin();
  let h = "";
  if (pj && !myGroups.some((g) => g.code === pj)) h += '<div class="card hl"><div class="label">You were invited</div><p class="small">Join the group with code <b class="mono">' + esc(pj) + '</b>?</p><div class="row-actions"><button class="btn primary" data-a="joinp">Join group</button><button class="btn" data-a="nojoin">Not now</button></div></div>';
  h += '<div class="label" style="margin:4px 2px 0">My groups</div>';
  if (!myGroups.length) h += '<div class="card"><p class="small muted">You\'re not in a group yet. Create one and invite friends, or join with a code.</p></div>';
  else h += '<div class="glist">' + myGroups.map((g) => '<button class="gitem" data-open="' + esc(g.id) + '"><span class="gname">' + esc(g.name) + '</span><span class="muted small">Code ' + esc(g.code) + (g.owner === user.uid ? " · you created it" : "") + '</span><span class="chev">›</span></button>').join("") + "</div>";
  h += '<div class="card"><div class="label">Join a group</div><div class="addrow"><input id="gCode" maxlength="7" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="6-letter code" class="mono"><button class="btn primary" data-a="join">Join</button></div></div>';
  h += '<div class="card"><div class="label">Create a group</div><div class="addrow"><input id="gName" maxlength="40" placeholder="e.g. New Year Sprint"><button class="btn" data-a="create">Create</button></div><p class="small muted">You\'ll get a code and an invite link to share.</p></div>';
  h += '<p class="small" id="gMsg"></p>';
  root.innerHTML = h;
  root.onclick = async (e) => {
    const o = e.target.closest("[data-open]"); if (o) { openGid = o.dataset.open; renderGroups(); window.scrollTo(0, 0); return; }
    const b = e.target.closest("[data-a]"); if (!b || busy) return;
    const say = (t, err) => { const m = $("gMsg"); if (m) { m.textContent = t; m.style.color = err ? "var(--maroon)" : "var(--muted)"; } };
    busy = true;
    try {
      if (b.dataset.a === "create") { const n = $("gName").value.trim(); if (!n) { say("Give your group a name.", true); return; } say("Creating…"); const gid = await createGroup(n); openGid = gid; renderGroups(); }
      else if (b.dataset.a === "join" || b.dataset.a === "joinp") { const code = b.dataset.a === "joinp" ? pendingJoin() : $("gCode").value; say("Joining…"); const gid = await joinByCode(code); clearPending(); openGid = gid; renderGroups(); toast("You joined the group"); }
      else if (b.dataset.a === "nojoin") { clearPending(); renderGroups(); }
    } catch (err) { say(err && err.code === "x-code" ? "No group has that code. Check it and try again." : errMsg(err), true); }
    finally { busy = false; }
  };
}
function stopWatching() { if (stopWatch) { try { stopWatch(); } catch (e) {} stopWatch = null; } }
function renderGroup() {
  const root = $("gRoot"), g = myGroups.find((x) => x.id === openGid);
  if (!g) { openGid = null; stopWatching(); return renderGroups(); }
  if (!stopWatch) {
    members = [];
    stopWatch = fb.watch("groups/" + g.id + "/members", (list) => { members = list; if (openGid === g.id && D().view() === "vGroups") drawBoard(g); }, () => { const m = $("gMsg"); if (m) m.textContent = "Can't load the group right now."; });
  }
  const owner = g.owner === user.uid;
  root.innerHTML =
    '<button class="linkbtn" data-a="back" style="align-self:flex-start">‹ All groups</button>' +
    '<div class="card"><div class="gtitle">' + esc(g.name) + '</div><div class="invite"><div><div class="label">Invite code</div><div class="code mono">' + esc(g.code) + '</div></div><button class="btn primary" data-a="share">Invite friends</button></div></div>' +
    '<div class="card"><div class="label">Leaderboard</div><div class="lb" id="gBoard"><p class="small muted">Loading members…</p></div><p class="small muted">Ranked by current streak, then good days. Each person counts their own days from their start date.</p></div>' +
    '<div class="row-actions">' + (owner ? '<button class="btn danger" data-a="delete">Delete group</button>' : '<button class="btn danger" data-a="leave">Leave group</button>') + "</div>" +
    '<p class="small" id="gMsg"></p>';
  drawBoard(g);
  root.onclick = async (e) => {
    const b = e.target.closest("[data-a]"); if (!b || busy) return;
    const a = b.dataset.a;
    if (a === "back") { openGid = null; stopWatching(); renderGroups(); return; }
    if (a === "share") { shareInvite(g); return; }
    if (a === "leave" || a === "delete") {
      if (!b.dataset.armed) { b.dataset.armed = "1"; const t = b.textContent; b.textContent = a === "leave" ? "Tap again to leave" : "Tap again to delete for everyone"; setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = t; } }, 3500); return; }
      busy = true;
      try { stopWatching(); if (a === "leave") await leaveGroup(g.id); else await deleteGroup(g); openGid = null; renderGroups(); toast(a === "leave" ? "You left the group" : "Group deleted"); }
      catch (err) { const m = $("gMsg"); if (m) { m.textContent = errMsg(err); m.style.color = "var(--maroon)"; } }
      finally { busy = false; }
    }
  };
}
function drawBoard(g) {
  const el = $("gBoard"); if (!el) return;
  if (!members.length) { el.innerHTML = '<p class="small muted">No members yet.</p>'; return; }
  const rows = members.map((m) => ({ m, s: stats(m) })).sort((a, b) => b.s.streak - a.s.streak || b.s.good - a.s.good || b.s.today - a.s.today || String(a.m.name).localeCompare(String(b.m.name)));
  el.innerHTML = rows.map((r, i) => {
    const s = r.s, me = r.m.id === user.uid;
    let strip = ""; const hi = Math.max(s.up, 1);
    for (let n = Math.max(1, hi - 6); n <= hi; n++) strip += '<i class="l' + s.lv(n) + (s.busy(n) ? " busy" : "") + '"></i>';
    const status = s.tn < 1 ? "Starts " + esc(r.m.start) : s.done ? "Finished all 75 days" : "Day " + s.up;
    return '<div class="lbrow' + (me ? " me" : "") + '"><span class="rk">' + (i + 1) + '</span><div class="who"><div class="nm">' + esc(r.m.name || "Member") + (me ? '<span class="you">you</span>' : "") + '</div><div class="sub">' + status + " · " + s.streak + "-day streak · " + s.good + " good</div></div>" +
      '<div class="rt"><div class="td">' + s.today + "<small>/" + s.max + '</small></div><div class="strip" aria-label="Last 7 days">' + strip + "</div></div></div>";
  }).join("");
}

/* ---------- UI: settings account card + setup sign-in ---------- */
function refreshSettingsCard() {
  const c = $("sAccount"); if (!c) return;
  if (!CONFIG) { c.hidden = true; return; }
  c.hidden = false;
  if (!user) { c.innerHTML = '<div class="label">Account</div><p class="small muted">Sign in to back up your days and join groups. Optional.</p><button class="btn" data-a="go">Sign in or create account</button>'; c.onclick = (e) => { if (e.target.closest('[data-a="go"]')) D().show("vGroups"); }; return; }
  c.innerHTML = '<div class="label">Account</div><p class="small">Signed in as <b>' + esc(user.email || user.name) + "</b></p>" +
    '<p class="small muted">' + (lastSync ? "Backed up at " + lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Backup turns on when you're online.") + "</p>" +
    '<div class="row-actions"><button class="btn" data-a="out">Sign out</button><button class="btn danger" data-a="del">Delete account</button></div><p class="small" data-msg></p>';
  c.onclick = async (e) => {
    const b = e.target.closest("[data-a]"); if (!b || busy) return;
    if (b.dataset.a === "out") { await push(); await fb.signOut(); toast("Signed out. Your days stay on this phone."); return; }
    if (b.dataset.a === "del") {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete your account"; setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = "Delete account"; } }, 3500); return; }
      busy = true; const msg = c.querySelector("[data-msg]");
      try { msg.textContent = "Deleting…"; await deleteAccount(); toast("Account deleted. Your days stay on this phone."); }
      catch (err) { msg.textContent = errMsg(err); msg.style.color = "var(--maroon)"; if (err && err.code === "auth/requires-recent-login") { await fb.signOut(); } }
      finally { busy = false; }
    }
  };
}
async function deleteAccount() {
  const uid = user.uid;
  for (const g of [...myGroups]) { if (g.owner === uid) await deleteGroup(g); else await leaveGroup(g.id); }
  for (const d of await fb.list("users/" + uid + "/days")) await fb.del("users/" + uid + "/days/" + d.id);
  await fb.del("users/" + uid);
  await fb.deleteMe();
  try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
}
function setupSignin() {
  const b = $("suSignin"); if (!b) return;
  b.hidden = !CONFIG || !!user;
  b.onclick = () => {
    let box = $("suAuth");
    if (!box) { box = document.createElement("div"); box.id = "suAuth"; b.after(box); }
    authMode = "signin"; box.innerHTML = authForm("sa");
    box.onclick = async (e) => { const x = e.target.closest("[data-a]"); if (!x || busy) return; const r = await handleAuth(box, x.dataset.a, "sa"); if (r === "redraw") { box.innerHTML = authForm("sa"); } };
    b.hidden = true; box.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

/* ---------- boot ---------- */
async function init() {
  await ready;
  try { const j = new URLSearchParams(location.search).get("join"); if (j) { sessionStorage.setItem("d75-join", j.toUpperCase().slice(0, 6)); history.replaceState(history.state, "", location.pathname); } } catch (e) {}
  window.addEventListener("d75:groups", renderGroups);
  window.addEventListener("d75:settings", refreshSettingsCard);
  let invitedShown = false;
  window.addEventListener("d75:changed", () => {
    schedulePush();
    // someone who opened an invite link lands on Groups right after finishing setup
    if (!invitedShown && pendingJoin() && D().state.settings && ["vSetup", "vToday"].includes(D().view())) { invitedShown = true; setTimeout(() => { if (D().view() === "vToday") D().show("vGroups"); }, 400); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && user && Date.now() - lastPull > 60000) pull().catch(() => {}); });
  if (!CONFIG) { setupSignin(); if (D().view() === "vGroups") renderGroups(); return; }
  try { fb = await loadFB(); } catch (e) { loadErr = e; if (D().view() === "vGroups") renderGroups(); return; }
  setupSignin();
  fb.onAuth(async (u) => {
    const was = user && user.uid; user = u;
    if (!u) { myGroups = []; openGid = null; stopWatching(); setupSignin(); refreshSettingsCard(); if (D().view() === "vGroups") renderGroups(); return; }
    setupSignin();
    const box = $("suAuth"); if (box) box.remove();
    try {
      const had = await pull();
      if (!D().state.settings && !had) toast("No saved challenge on this account yet. Set yours up below.");
      else if (u.uid !== was && had && D().view() !== "vGroups") toast("Welcome back. Your days are restored.");
    } catch (e) { /* offline: local data still works */ }
    if (pendingJoin() && D().state.settings) D().show("vGroups");
    else if (D().view() === "vGroups") renderGroups();
    refreshSettingsCard();
  });
  if (pendingJoin() && D().state.settings) D().show("vGroups");
}
init();
