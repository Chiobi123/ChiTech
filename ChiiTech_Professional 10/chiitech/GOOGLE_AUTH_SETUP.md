# Google sign-in setup (Supabase Auth OAuth — required dashboard config)

The code side is already in the app (`loginWithGoogle()` in `js/auth.js`,
unlinked-account notice, no auto-privileges). Until the provider below is
configured, the button shows Supabase's "provider not enabled" error. No
Google secrets ever go in frontend code.

## Steps (Supabase dashboard → project `ChiTech b`)

1. Google Cloud Console (`console.cloud.google.com`), any project:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Type: Web application
   - Authorized redirect URI: `https://qmypqghktxlscibgxgxo.supabase.co/auth/v1/callback`
2. Supabase dashboard → Authentication → Providers → Google → Enable:
   - Paste Client ID + Client Secret → Save.
3. Authentication → URL Configuration → Site URL:
   - Production: `https://effulgent-tapioca-b0e22e.netlify.app`
   - Add `http://localhost:8080` to Additional Redirect URLs for local testing.

## Behavior after enabling

- Existing email/password login keeps working unchanged.
- A Google identity with no `profiles` row sees only the unlinked-account
  notice (never a dashboard, never a role).
- Linking happens only via worker invitation token (`Join as Worker`) whose
  email matches the Google address, or company registration by an owner.
- Super Admin stays restricted to `igbanichiobiebere@gmail.com`: even a
  Google login with that address only gains the role through the
  `ensure_super_admin()` RPC + matching profiles row, never from OAuth alone.
- Email-already-exists: Supabase links by verified email automatically; if
  confirmation is required, the user confirms via inbox first.
