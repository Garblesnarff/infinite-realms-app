-- Final frontend RLS lockdown. Apply only after the server-route deployment is
-- live and the secured-table smoke pass confirms there are no browser callers.
-- service_role is intentionally not named here, so its existing grants remain intact.

REVOKE ALL PRIVILEGES ON TABLE public.game_sessions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.quests FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.campaign_characters FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.campaigns FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.characters FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.character_stats FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.starter_character_templates FROM anon, authenticated;
