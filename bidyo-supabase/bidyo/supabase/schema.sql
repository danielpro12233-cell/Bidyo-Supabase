-- Bidyo x Supabase  —  paste this whole file in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to run more than once.

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
