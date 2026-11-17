# Bidyo — Supabase Setup, Step by Step (Taglish)

Kailangan: libreng account sa supabase.com at naka-install ang Node.js 18+ (nodejs.org).

## A. Gumawa ng Supabase project
1. Pumunta sa **https://supabase.com** → **Start your project** → mag-sign in (GitHub o email).
2. I-click ang **New project**.
3. **Name:** `bidyo` · **Database Password:** maglagay ng malakas na password at i-save mo · **Region:** pinakamalapit sa iyo (hal. Singapore) · **Plan:** Free.
4. I-click ang **Create new project**. Maghintay ng 1–2 minuto.

## B. I-run ang database setup
1. Kaliwang menu → **SQL Editor** → **New query**.
2. Buksan ang `supabase/schema.sql` (sa project folder), **kopyahin ang BUONG laman**, i-paste sa editor.
3. I-click ang **Run** (o Ctrl+Enter). Dapat lumabas ang **Success. No rows returned**.
   - Ito ang gumagawa ng: `videos` table, `profiles` table (username, birthday, age), security rules, view counter, at ang `videos` storage bucket.
   - Ligtas itong i-run ulit kahit ilang beses.

## C. I-OFF ang "Confirm email" (para walang OTP)
1. Kaliwang menu → **Authentication**.
2. **Sign In / Providers** (sa ibang version: **Providers**) → i-click ang **Email**.
3. Siguraduhing **ON** ang *Enable Email provider*, at **OFF** ang **Confirm email**.
4. I-click ang **Save**.

> Kapag naka-ON ang Confirm email, hindi makaka-login agad ang bagong user at lalabas ang error na "Email confirmation is still ON".

## D. Kunin ang URL at key
1. **Project Settings** (gear icon) → **API** (o **API Keys**).
2. Kopyahin ang **Project URL** (hal. `https://abcd1234.supabase.co`).
3. Kopyahin ang **anon / public** key (mahabang text na nagsisimula sa `eyJ...`).
4. **HUWAG** gamitin ang `service_role` key — sikreto iyon.

## E. Ilagay sa project
1. Sa `bidyo` folder, kopyahin ang `.env.example` at pangalanan itong `.env`.
2. Buksan ang `.env` at palitan:
   ```
   SUPABASE_URL=https://abcd1234.supabase.co
   SUPABASE_ANON_KEY=eyJ...ang-anon-key-mo
   ```
3. I-save.

## F. Patakbuhin
```
cd bidyo
node server.js
```
Buksan ang **http://localhost:3000**. (Walang `npm install` na kailangan.)

## G. Subukan
1. I-click ang **Sign up** → ilagay ang username, email, password → **Next** → birthday (kusang lalabas ang age) → tick ang Terms → **Create account**.
2. Dapat dadalhin ka agad sa Upload page (walang code).
3. Sa Supabase: **Authentication → Users** (nandoon ang user) at **Table Editor → profiles** (nandoon ang username, birthday, age).
4. Mag-upload ng video (max 50 MB sa Free plan).

## H. Ilagay online (opsyonal)
Gumamit ng Render, Railway o VPS. Start command: `node server.js`. Sa **Environment Variables** ilagay ang `SUPABASE_URL` at `SUPABASE_ANON_KEY` (at `AD_HOSTS` kung kailangan). Puwede rin ang `Dockerfile`.

## Mga karaniwang problema
| Error | Solusyon |
|---|---|
| "Supabase is not configured" | Mali o walang laman ang `.env`. I-restart ang `node server.js` pagkatapos baguhin. |
| "Email confirmation is still ON" | Ulitin ang **Step C** (i-OFF ang Confirm email). |
| "That username is already taken" agad kahit bago | Hindi na-run nang buo ang `schema.sql`. Ulitin ang **Step B**. |
| "Database error saving new user" | Hindi tama ang username/birthday o hindi na-run ang schema. Ulitin ang Step B. |
| "Email address is invalid" | Gumamit ng totoong email domain (hal. gmail.com), hindi `example.com`. |
| "Too many tries" | Maghintay ng 1 minuto at subukan ulit. |
| Hindi lumalabas ang video | Tiyaking na-run ang schema (gumagawa ito ng `videos` bucket) at `.mp4`/`.webm`/`.mov` ang file. |

## Tungkol sa ads
Naka-lagay ang ad scripts sa `public/index.html`. Ang mga domain na pinapayagan ng security policy ay nasa `AD_HOSTS` sa `.env`. Kung hindi lumalabas ang ads, buksan ang browser console (F12) at hanapin ang "Content Security Policy" error; idagdag ang domain na nakasaad doon sa `AD_HOSTS` (space-separated). Hindi lumalabas ang ads sa login, register at upload pages.
