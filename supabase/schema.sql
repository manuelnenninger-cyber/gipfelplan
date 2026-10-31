-- Gipfelplan: gespeicherte Touren je Nutzer
-- Einmal im Supabase-SQL-Editor ausführen (oder per Migration).

create table if not exists public.tours (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  kind        text not null default 'direct',
  peak        jsonb,                -- { name, lat, lng, ele, region }
  stats       jsonb not null,       -- Länge, Höhenmeter, Zeiten, SAC …
  coords      jsonb not null,       -- [[lng, lat, ele], …]
  waypoints   jsonb,                -- bei eigenen Routen: Punkte zum Weiterbearbeiten
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tours_user_created on public.tours (user_id, created_at desc);

-- Jede Person sieht und ändert nur ihre eigenen Touren
alter table public.tours enable row level security;

drop policy if exists "Touren lesen" on public.tours;
drop policy if exists "Touren anlegen" on public.tours;
drop policy if exists "Touren ändern" on public.tours;
drop policy if exists "Touren löschen" on public.tours;
create policy "Touren lesen"   on public.tours for select to authenticated using ((select auth.uid()) = user_id);
create policy "Touren anlegen" on public.tours for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Touren ändern"  on public.tours for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Touren löschen" on public.tours for delete to authenticated using ((select auth.uid()) = user_id);

-- Schutz vor riesigen Einträgen (eine Tour hat höchstens ein paar tausend Punkte)
alter table public.tours drop constraint if exists tours_coords_size;
alter table public.tours add constraint tours_coords_size check (pg_column_size(coords) < 400000);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists tours_touch on public.tours;
create trigger tours_touch before update on public.tours
  for each row execute function public.touch_updated_at();
