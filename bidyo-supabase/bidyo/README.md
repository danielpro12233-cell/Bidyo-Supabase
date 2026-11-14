# Bidyo 🎬 — Upload. Share. Have fun! (Supabase edition)

Multi-user video site. **Panonood = libre, walang account.** Pag-upload = libre rin; kailangan lang ng **email + 6-digit OTP** (Supabase Auth).

- **Users / videos / files** → Supabase (Auth + Postgres + Storage). Walang local database.
- **Pages** → `All videos` (default, Popular), `Latest`, `Old`, at sort bar (Popular · Latest · Old · Name) sa loob ng page, + search.
- Ang Node server (`server.js`) ay static server lang; walang `npm install`.

## Setup (10 minuto)

1. **supabase.com → New project** (Free plan okay).
2. **SQL Editor → New query** → i-paste ang laman ng `supabase/schema.sql` → **Run**. (Gumagawa ng `videos` table, security rules, view counter, at `videos` storage bucket.)
3. **Authentication → Emails → Templates → "Magic Link"** (at "Confirm signup"): siguraduhing may `{{ .Token }}` sa laman para 6-digit code ang ipapadala, hal.
   `<h2>Your Bidyo code</h2><p>{{ .Token }}</p>`
   Pagkatapos: **Authentication → Providers → Email** → naka-on ang *Enable Email provider* at *Confirm email*.
4. **Project Settings → API** → kopyahin ang **Project URL** at **anon public key**.
5. `cp .env.example .env` → ilagay ang dalawa.
6. `node server.js` → http://localhost:3000

## Mga dapat malaman

| Paksa | Detalye |
|---|---|
| **Laki ng video** | Free plan: **max 50 MB bawat file**, 1 GB total storage, 5 GB bandwidth/buwan. Para sa mas malaki, mag-upgrade (Pro) at itaas ang `file_size_limit` sa SQL at `MAX_UPLOAD_MB` sa `.env`. |
| **OTP emails** | Ang built-in na email ng Supabase ay **napakalimitado (≈2–4 emails/oras)** — pang-test lang. Para sa totoong users: **Authentication → SMTP Settings** → ilagay ang custom SMTP (hal. Gmail App Password, Resend, Brevo). |
| **Drafts** | Hindi lumalabas sa listahan, pero ang file ay nasa *public bucket* na may mahirap hulaang URL — hindi ito "tunay na private". |
| **Seguridad** | Ang anon key ay pampubliko by design; ang proteksyon ay nasa RLS policies sa `schema.sql`. **Huwag** gamitin ang `service_role` key sa browser/`.env`. |
| **Online** | I-host ang folder na ito sa kahit anong Node host (Render, Railway, VPS) o `docker build`; ilagay ang `SUPABASE_*` bilang environment variables. |
