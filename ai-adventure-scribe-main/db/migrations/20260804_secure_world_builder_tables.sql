-- World-builder NPC and location data is now written through authenticated
-- server-bun routes. Browser roles must not retain direct table access.

ALTER TABLE public.npcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.npcs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.locations FROM anon, authenticated;
