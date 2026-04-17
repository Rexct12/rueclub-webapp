# RueClub Finance

Private finance workspace for RueClub operations. The app is built with Next.js,
Firebase/Firestore, and a Google AI Quick Entry experiment for Indonesian
natural-language transaction drafts.

## Features

- PIN login for internal admins.
- Server-side Firestore access through Firebase Admin SDK.
- Local development fallback store with `DATA_BACKEND=local`.
- Manual input for participant payments, expenses, and capital deposits.
- Master data for accounts and sessions.
- Dashboard for cash in, expense, balance, profit/loss, account balances, and
  profit per session.
- CSV export for raw data and reports.
- AI Quick Entry draft flow using `GOOGLE_AI_API_KEY` when available, with a
  local rule-based parser fallback.
- CSV import scripts for the old Google Sheets tabs.

## Local Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Copy `.env.example` to `.env.local` and keep `DATA_BACKEND=local` if you want
   to try the app before Firebase is configured.

3. Seed two local users:

   ```powershell
   npm.cmd run seed:users
   ```

   Default users are `Naufal:123456` and `Kolega:123456`. Override with:

   ```powershell
   $env:SEED_USERS='Naufal:111111,Kolega:222222'
   npm.cmd run seed:users
   ```

4. Start the app:

   ```powershell
   npm.cmd run dev
   ```

5. Open `http://localhost:3000`.

## Firebase Setup

For production, create a Firebase project, enable Cloud Firestore, create a
service account key, then set these environment variables locally and in Vercel:

```text
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
SESSION_PASSWORD=
GOOGLE_AI_API_KEY=
```

Do not expose Firebase Admin credentials to the browser. This app only reads
Firestore from server routes.

## Google AI Quick Entry

With `GOOGLE_AI_API_KEY` set, `/api/ai/draft` uses Gemini to convert Indonesian
input into a transaction draft. Without the key, the app uses a limited local
rule parser so you can still test the flow.

The AI flow never saves automatically. The user must review and click
`Simpan Draft`.

## Import CSV From Google Sheets

Export these tabs as CSV:

- `Log_Peserta`
- `Log Expense`
- `Log Modal Titipan`

Then run any combination:

```powershell
npm.cmd run import:csv -- --participants .\data\Log_Peserta.csv
npm.cmd run import:csv -- --expenses ".\data\Log Expense.csv"
npm.cmd run import:csv -- --capital ".\data\Log Modal Titipan.csv"
```

Import uses the current accounts and sessions to resolve references. Unknown
account/session names are converted into deterministic IDs so the row is not
lost.

## Checks

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

## Deploy To Vercel

After Firebase env variables are configured in Vercel:

```powershell
npx.cmd vercel login
npx.cmd vercel link
npx.cmd vercel --prod
```

