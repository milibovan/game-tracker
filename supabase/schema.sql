-- Leaderboard tracker: šema baze.
-- Pokreni cijeli fajl jednom u Supabase -> SQL Editor.
--
-- Model zaštite: svi mogu ČITATI igrače, igrice i rezultate. PISANJE ide
-- isključivo kroz funkcije ispod, koje provjeravaju PIN igrača na serveru,
-- pa niko ne može mijenjati tuđe rezultate.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabele ----------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index players_name_key on public.players (lower(trim(name)));

-- PIN hash je u odvojenoj tabeli kojoj klijent nema nikakav pristup.
create table public.player_secrets (
  player_id uuid primary key references public.players (id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  default_max numeric check (default_max > 0),
  created_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index games_name_key on public.games (lower(trim(name)));

create table public.scores (
  player_id uuid not null references public.players (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  day date not null,
  score numeric not null check (score >= 0),
  max_score numeric not null check (max_score > 0),
  raw_text text check (char_length(raw_text) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id, day),
  check (score <= max_score)
);
create index scores_day_idx on public.scores (day);

-- ---------- Row Level Security: samo čitanje ----------

alter table public.players enable row level security;
alter table public.player_secrets enable row level security;
alter table public.games enable row level security;
alter table public.scores enable row level security;

create policy "read players" on public.players for select to anon, authenticated using (true);
create policy "read games" on public.games for select to anon, authenticated using (true);
create policy "read scores" on public.scores for select to anon, authenticated using (true);
-- player_secrets namjerno nema nijednu policy: nedostupna je klijentu.

-- Noviji Supabase projekti ne daju automatski pristup tabelama, pa se čitanje daje izričito.
grant usage on schema public to anon, authenticated;
grant select on public.players, public.games, public.scores to anon, authenticated;
revoke insert, update, delete on public.players, public.games, public.scores from anon, authenticated;
revoke all on public.player_secrets from anon, authenticated;

-- ---------- Funkcije (jedini način pisanja) ----------

-- Provjera PIN-a. Vraća: 'ok' | 'bad_pin' | 'locked' | 'unknown_player'.
-- Poslije 5 pogrešnih pokušaja igrač je zaključan 5 minuta.
create or replace function public.check_pin(p_player uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.player_secrets;
begin
  select * into s from public.player_secrets where player_id = p_player for update;
  if not found then
    return 'unknown_player';
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    return 'locked';
  end if;
  if s.pin_hash = crypt(coalesce(p_pin, ''), s.pin_hash) then
    update public.player_secrets
      set failed_attempts = 0, locked_until = null
      where player_id = p_player;
    return 'ok';
  end if;
  if s.failed_attempts + 1 >= 5 then
    update public.player_secrets
      set failed_attempts = 0, locked_until = now() + interval '5 minutes'
      where player_id = p_player;
  else
    update public.player_secrets
      set failed_attempts = s.failed_attempts + 1
      where player_id = p_player;
  end if;
  return 'bad_pin';
end;
$$;

-- Novi igrač. PIN: 4 do 8 cifara.
create or replace function public.register_player(p_name text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN mora imati 4 do 8 cifara';
  end if;
  insert into public.players (name) values (trim(p_name)) returning id into new_id;
  insert into public.player_secrets (player_id, pin_hash)
    values (new_id, crypt(p_pin, gen_salt('bf')));
  return new_id;
end;
$$;

-- Unos ili izmjena sopstvenog rezultata.
create or replace function public.save_score(
  p_player uuid, p_pin text, p_game uuid, p_day date,
  p_score numeric, p_max numeric, p_raw text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  status text;
begin
  status := public.check_pin(p_player, p_pin);
  if status <> 'ok' then
    return status;
  end if;
  insert into public.scores (player_id, game_id, day, score, max_score, raw_text)
    values (p_player, p_game, p_day, p_score, p_max, nullif(trim(p_raw), ''))
  on conflict (player_id, game_id, day) do update
    set score = excluded.score,
        max_score = excluded.max_score,
        raw_text = excluded.raw_text,
        updated_at = now();
  return 'ok';
end;
$$;

-- Brisanje sopstvenog rezultata.
create or replace function public.delete_score(
  p_player uuid, p_pin text, p_game uuid, p_day date
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  status text;
begin
  status := public.check_pin(p_player, p_pin);
  if status <> 'ok' then
    return status;
  end if;
  delete from public.scores
    where player_id = p_player and game_id = p_game and day = p_day;
  return 'ok';
end;
$$;

-- Nova igrica (može je dodati bilo koji prijavljeni igrač).
create or replace function public.add_game(
  p_player uuid, p_pin text, p_name text, p_default_max numeric
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  status text;
begin
  status := public.check_pin(p_player, p_pin);
  if status <> 'ok' then
    return status;
  end if;
  insert into public.games (name, default_max, created_by)
    values (trim(p_name), p_default_max, p_player);
  return 'ok';
end;
$$;

revoke execute on function
  public.check_pin(uuid, text),
  public.register_player(text, text),
  public.save_score(uuid, text, uuid, date, numeric, numeric, text),
  public.delete_score(uuid, text, uuid, date),
  public.add_game(uuid, text, text, numeric)
from public;

grant execute on function
  public.check_pin(uuid, text),
  public.register_player(text, text),
  public.save_score(uuid, text, uuid, date, numeric, numeric, text),
  public.delete_score(uuid, text, uuid, date),
  public.add_game(uuid, text, text, numeric)
to anon, authenticated;

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.scores, public.games, public.players;

-- ---------- Početne igrice (maksimum je samo podrazumijevana vrijednost za ručni unos) ----------

insert into public.games (name, default_max) values
  ('Eraly', 700),
  ('Georiddle', null),
  ('SizeItUp', null),
  ('Dnevni kviz', 10);
