-- Bidyo x Supabase  —  paste this whole file in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to run more than once.
-- Sign-up is plain username + email + password (+ age & birthday). NO email code / OTP.
-- IMPORTANT: Authentication -> Providers -> Email -> turn OFF "Confirm email", or new users can't log in right away.

-- 0) Profiles: username, birthday and age live here (filled automatically when someone signs up)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null check (username ~ '^[A-Za-z0-9_.]{3,20}$'),
  birthday   date,
  age        int,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
-- (no insert/update policy on purpose: only the trigger below writes profiles)

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text := trim(coalesce(new.raw_user_meta_data->>'username', ''));
  bday  date;
  yrs   int;
begin
  if uname !~ '^[A-Za-z0-9_.]{3,20}$' then raise exception 'Invalid username'; end if;
  begin bday := (new.raw_user_meta_data->>'birthday')::date; exception when others then bday := null; end;
  if bday is null or bday > current_date or bday < date '1900-01-01' then raise exception 'Invalid birthday'; end if;
  yrs := extract(year from age(current_date, bday))::int;          -- age is always computed on the server
  if yrs < 13 then raise exception 'You must be at least 13 years old'; end if;
  insert into public.profiles (id, username, birthday, age) values (new.id, uname, bday, yrs);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form say "username taken" before creating anything
create or replace function public.username_available(uname text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(uname));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Accounts made with the old email-code version get a profile too (safe to re-run)
insert into public.profiles (id, username)
select u.id, left(regexp_replace(split_part(coalesce(u.email, 'user'), '@', 1), '[^A-Za-z0-9_.]', '', 'g'), 12) || '_' || substr(u.id::text, 1, 5)
from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);

-- 1) Videos table ------------------------------------------------------------
create table if not exists public.videos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  creator_name text not null,
  title        text not null check (char_length(title) between 1 and 100),
  description  text not null default '' check (char_length(description) <= 2000),
  status       text not null default 'published' check (status in ('published','draft')),
  file_path    text not null,
  thumb_path   text,
  mime         text not null default 'video/mp4',
  size         bigint not null default 0,
  duration     real   not null default 0,
  views        bigint not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists videos_feed_idx on public.videos (status, created_at desc);
create index if not exists videos_user_idx on public.videos (user_id, created_at desc);

-- 2) Row Level Security: everyone watches, only owners change their own rows --
alter table public.videos enable row level security;

drop policy if exists "watch published (or own drafts)" on public.videos;
create policy "watch published (or own drafts)" on public.videos
  for select using (status = 'published' or auth.uid() = user_id);

drop policy if exists "upload as yourself" on public.videos;
create policy "upload as yourself" on public.videos
  for insert to authenticated with check (auth.uid() = user_id and views = 0);

drop policy if exists "edit own videos" on public.videos;
create policy "edit own videos" on public.videos
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own videos" on public.videos;
create policy "delete own videos" on public.videos
  for delete to authenticated using (auth.uid() = user_id);

-- Users may only edit these columns (so nobody can fake view counts):
revoke update on public.videos from authenticated, anon;
grant  update (title, description, status) on public.videos to authenticated;

-- 3) View counter (anyone can +1, nobody can set it to anything else) --------
create or replace function public.increment_views(vid uuid)
returns void language sql security definer set search_path = public as $$
  update public.videos set views = views + 1 where id = vid and status = 'published';
$$;
grant execute on function public.increment_views(uuid) to anon, authenticated;

-- 4) Storage bucket for videos + thumbnails (public read) --------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800,
        array['video/mp4','video/webm','video/quicktime','image/jpeg'])
on conflict (id) do update set public = true;
-- 52428800 = 50 MB, the max allowed on Supabase's Free plan. Raise it on a paid plan.

drop policy if exists "upload into own folder" on storage.objects;
create policy "upload into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete from own folder" on storage.objects;
create policy "delete from own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
