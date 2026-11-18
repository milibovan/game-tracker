-- Avatari igrača. Pokreni jednom u Supabase -> SQL Editor na postojećoj bazi.
-- (Novi projekti ovo dobijaju kroz schema.sql.)

alter table public.players
  add column if not exists avatar text check (char_length(avatar) <= 16);

-- Igrač mijenja samo svoj avatar; provjerava se PIN.
create or replace function public.set_avatar(p_player uuid, p_pin text, p_avatar text)
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
  update public.players set avatar = nullif(trim(p_avatar), '') where id = p_player;
  return 'ok';
end;
$$;

revoke execute on function public.set_avatar(uuid, text, text) from public;
grant execute on function public.set_avatar(uuid, text, text) to anon, authenticated;

-- Da aplikacija odmah vidi novu kolonu i funkciju.
notify pgrst, 'reload schema';
