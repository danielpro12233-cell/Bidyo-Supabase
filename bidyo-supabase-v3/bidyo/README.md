# Bidyo 🎬 — Upload. Share. Have fun! (Supabase edition)

Multi-user video site. **Panonood = libre, walang account.** Pag-upload = libre rin; gagawa lang ng account: **username, email (Gmail o kahit ano), password, age at birthday**. **Walang OTP / walang email verification.**

- **Users / videos / files** → Supabase (Auth + Postgres + Storage). Walang local database.
- **Pages** → `All videos` (default, Popular), `Latest`, `Old`, at sort bar (Popular · Latest · Old · Name) sa loob ng page, + search.
- Ang Node server (`server.js`) ay static server lang; walang `npm install`.

## Setup (10 minuto)

1. **supabase.com → New project** (Free plan okay).
2. **SQL Editor → New query** → i-paste ang laman ng `supabase/schema.sql` → **Run**. (Gumagawa ng `videos` table, security rules, view counter, at `videos` storage bucket.)
3. **Authentication → Providers → Email** → i-**OFF** ang **"Confirm email"** (importante! para makapag-log in agad ang bagong user, walang code na hihintayin).
4. **Project Settings → API** → kopyahin ang **Project URL** at **anon public key**.
5. `cp .env.example .env` → ilagay ang dalawa.
6. `node server.js` → http://localhost:3000

## Mga dapat malaman

| Paksa | Detalye |
|---|---|
| **Laki ng video** | Free plan: **max 50 MB bawat file**, 1 GB total storage, 5 GB bandwidth/buwan. Para sa mas malaki, mag-upgrade (Pro) at itaas ang `file_size_limit` sa SQL at `MAX_UPLOAD_MB` sa `.env`. |
| **Register** | 2 steps: (1) username, email, password; (2) birthday + age (kusang napupunan), min. 13 taong gulang. Ang username/birthday/age ay nasa `profiles` table (nilalagay ng trigger sa `schema.sql`). Log in gamit ang **email + password**. |
| **Lumang accounts** | Kung may users ka na galing sa OTP version, i-run ulit ang `schema.sql`; gagawan sila ng profile. |
| **Bilis** | Walang lag: naka-cache ang listahan ng videos, 36 tiles lang ang naka-render sa simula (infinite scroll), transform/opacity lang ang animations, at naka-gzip ang static files. |
| **Drafts** | Hindi lumalabas sa listahan, pero ang file ay nasa *public bucket* na may mahirap hulaang URL — hindi ito "tunay na private". |
| **Seguridad** | Ang anon key ay pampubliko by design; ang proteksyon ay nasa RLS policies sa `schema.sql`. **Huwag** gamitin ang `service_role` key sa browser/`.env`. |
| **Online** | I-host ang folder na ito sa kahit anong Node host (Render, Railway, VPS) o `docker build`; ilagay ang `SUPABASE_*` bilang environment variables. |
