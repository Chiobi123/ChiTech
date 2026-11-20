-- Harden the invite token helper against mutable-schema search_path resolution.
-- This function only uses pg_catalog built-ins, so keep its path there.
CREATE OR REPLACE FUNCTION public.make_invite_token()
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  token text := '';
  i integer;
BEGIN
  FOR i IN 1..12 LOOP
    token := token || pg_catalog.substr(
      alphabet,
      1 + pg_catalog.floor(pg_catalog.random() * pg_catalog.length(alphabet))::integer,
      1
    );
  END LOOP;
  RETURN token;
END;
$function$;
