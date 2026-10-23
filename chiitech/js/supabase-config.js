/* ChiiTech Supabase connection config.
   The publishable key below is safe to ship in client code — it's
   the same category as a website's public API key. It grants no
   access on its own; every table has Row Level Security, and the
   handful of actions that don't go through a signed-in session
   (auditor sign-in, company/worker sign-up) go through the specific
   SECURITY DEFINER functions in the database that do their own
   validation (see the 05–08 migrations). Nothing sensitive is
   protected by keeping this key secret. */
const SUPABASE_URL = 'https://qmypqghktxlscibgxgxo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TTO8Oaxa7Gwoa6lUDz8hZQ_RDCQmhc0';

// storage: sessionStorage (not the default localStorage) so a signed-in
// session ends when the tab closes — the same "each tab needs its own
// sign-in" behavior this app has always had, now backed by a real
// session token instead of a plain JSON blob.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true }
});
