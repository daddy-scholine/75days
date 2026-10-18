# 75 Days — project notes for Claude

A public 75-day habit challenge app. Phone-first, installable (PWA), works fully offline.
Owner is a medical resident, not a developer: explain changes in plain words, never ask them to run commands.
Live site is served by GitHub Pages from the `main` branch, repository root. No build step.

## Files
- `index.html` — all screens: setup, Today, Calendar, Groups, Progress, Settings.
- `app.js` — offline app (plain script). Data: `localStorage["d75"]` = `{settings, days}`; photos as Blobs in IndexedDB `d75-photos`. Exposes `window.D75` bridge for cloud.js.
- `cloud.js` — optional accounts, cloud backup and groups (ES module, Firebase via gstatic CDN, loaded lazily). Off when `firebase-config.js` exports `null`.
- `firebase-config.js` — Firebase web config or `null`. Safe to be public.
- `firestore.rules` — security rules; the owner pastes them into the Firebase console (Claude cannot reach Firebase from its workspace).
- `sw.js` — offline cache. Only the app start page is served from cache on navigation; other pages load normally.
- `manifest.webmanifest`, icons, `screenshot-*.png` (Android install sheet), `privacy.html`, `SETUP-FIREBASE.md`.
- `personal/` — the owner's earlier single-page tracker. Leave it alone.

## Data model
- Day record: `{c: {habitId: true}, w: glasses, t: ""|"rest"|"busy", kg, e: 1-5, notes, p: hasPhoto}`. Photos never go to the cloud.
- Firestore: `users/{uid}` (name, start, habits, good, groups[]), `users/{uid}/days/{n}`, `codes/{CODE}` → `{gid, owner}`,
  `groups/{gid}` (name, code, owner), `groups/{gid}/members/{uid}` (name, start, n, good, scores, busy, u). Groups see scores only.

## Release checklist (every change)
1. Bump `VERSION` in both `app.js` and `sw.js` — otherwise installed phones never get the update.
2. Add any new file the app needs offline to `SHELL` in `sw.js`.
3. Test with Playwright at phone size (Pixel 7 and iPhone 13 profiles): setup, ticking, photo, reload offline, no page errors.
4. If Groups changed, run a two-user test with a fake Firebase (window.__D75_FAKE_FB adapter in cloud.js).
5. Commit with a plain-English message, push to `main`. Pages updates in 1-2 minutes; phones show "A new version is ready".

## Limits from Claude's workspace
- GitHub repository settings (Pages, rename, transfer, default branch) are blocked: ask the owner, give exact taps.
- Firebase/Google consoles and npm/gstatic are unreachable: test cloud logic with the fake adapter, real checks happen on the owner's phone.
