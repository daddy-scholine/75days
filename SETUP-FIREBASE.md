# Turning on accounts and groups (one-time, ~10 minutes)

The app runs fully offline without this. These steps switch on sign-in, cloud backup and groups.
Everything here is free on Firebase's Spark plan.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Tap **Create a project** (or **Add project**). Name it `75days`. Google Analytics: turn it **off**. Create.

## 2. Add the web app and copy its config
1. On the project home, tap the **Web** icon `</>` ("Add app").
2. Nickname: `75 Days web`. Do **not** tick Firebase Hosting. Tap **Register app**.
3. You'll see a block of code with `const firebaseConfig = { apiKey: "...", authDomain: "...", ... }`.
   Copy everything between the `{ }` and send it to Claude. (These values are safe to be public; the security rules protect the data.)

## 3. Turn on sign-in
1. Left menu **Build → Authentication → Get started**.
2. **Sign-in method** tab:
   - **Email/Password** → Enable (first switch only) → Save.
   - **Google** → Enable → choose your support email → Save.
3. **Settings** tab → **Authorized domains** → **Add domain** → `daddy-scholine.github.io` → Add.

## 4. Create the database
1. Left menu **Build → Firestore Database → Create database**.
2. Location: **asia-south1 (Mumbai)** (can't be changed later). Start in **production mode**. Create.
3. Open the **Rules** tab, delete everything, paste the contents of `firestore.rules` from this repository, tap **Publish**.

## 5. Send Claude the config from step 2
Claude puts it in `firebase-config.js`, publishes, and the Groups tab switches on for everyone.
