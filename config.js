/* ===========================================================================
   Supabase connection details
   ---------------------------------------------------------------------------
   Paste your own two values below. Both come from your Supabase dashboard:

     Settings (gear icon) → API

   The anon key is meant to be public — it appears in every request the browser
   makes, and it is safe to commit. What actually protects your data is the Row
   Level Security policy on the entries table, which the database enforces
   regardless of what this file says.

   Never put the service_role key here. That one bypasses RLS entirely and
   belongs only on a server.

   Leave these blank and the diary still works — it just stays on this device
   with no account and no sync, exactly as before.
   =========================================================================== */

const SUPABASE_URL = 'https://nhczlvwyrqaplzyxcpbu.supabase.co';

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oY3psdnd5cnFhcGx6eXhjcGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MDM1MDMsImV4cCI6MjEwMTQ3OTUwM30.SReoa9_cioUzTxKSNf0gH3Hi1sRe4yfl7sNfo0zvZgQ';
