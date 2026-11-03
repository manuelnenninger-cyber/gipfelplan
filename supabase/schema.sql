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

-- ---------------------------------------------------------------------------------
-- Geteilte Touren: öffentlich per Link (kurze ID), ohne Anmeldung.
-- Kein direkter Tabellenzugriff (RLS ohne Policies) – nur über create_share/get_share,
-- damit niemand alle geteilten Touren auflisten kann.
create table public.shares (
  id text primary key,
  created_by uuid default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  kind text check (kind is null or char_length(kind) <= 20),
  peak jsonb,
  stats jsonb,
  coords jsonb not null,
  waypoints jsonb,
  created_at timestamptz not null default now(),
  constraint shares_coords_array check (jsonb_typeof(coords) = 'array' and jsonb_array_length(coords) between 2 and 3000),
  constraint shares_size check (
    pg_column_size(coords) + coalesce(pg_column_size(stats), 0) + coalesce(pg_column_size(peak), 0) + coalesce(pg_column_size(waypoints), 0) < 250000
  )
);
alter table public.shares enable row level security;

create or replace function public.create_share(p_title text, p_kind text, p_peak jsonb, p_stats jsonb, p_coords jsonb, p_waypoints jsonb default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_id text;
begin
  loop
    new_id := '';
    for i in 1..8 loop
      new_id := new_id || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into public.shares (id, title, kind, peak, stats, coords, waypoints)
      values (new_id, p_title, p_kind, p_peak, p_stats, p_coords, p_waypoints);
      return new_id;
    exception when unique_violation then
      -- ID schon vergeben: neue würfeln
    end;
  end loop;
end
$$;

create or replace function public.get_share(p_id text)
returns table (id text, title text, kind text, peak jsonb, stats jsonb, coords jsonb, waypoints jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.kind, s.peak, s.stats, s.coords, s.waypoints, s.created_at
  from public.shares s where s.id = p_id
$$;

revoke all on function public.create_share(text, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.get_share(text) from public;
grant execute on function public.create_share(text, text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.get_share(text) to anon, authenticated;
