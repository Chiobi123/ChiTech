-- ChiiTech migration: short human-safe invitation tokens.
-- 48-hex tokens cannot be dictated or typed reliably. New invitations get
-- 12 characters from an unambiguous alphabet (no 0/O, 1/I/L). Old tokens
-- keep working (exact-match lookup). Uniqueness still enforced.
-- NOTE: pgcrypto gen_random_bytes stays for anything needing full entropy;
-- these tokens are single-use, expiring, email-bound, so 12 chars suffice.

create or replace function public.make_invite_token()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  token text := '';
  i int;
begin
  for i in 1..12 loop
    token := token || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return token;
end;
$$;

alter table public.worker_invitations alter column token set default public.make_invite_token();
alter table public.auditor_invites alter column token set default public.make_invite_token();
