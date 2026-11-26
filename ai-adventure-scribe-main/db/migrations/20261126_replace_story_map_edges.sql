-- #1752 follow-up (strategist PASS at 47301ed2): replace one starter campaign's story map
-- routes in one transaction. The ingest tool writes through the Supabase client, which has
-- no transactions; a function call is one statement, so the delete and the insert commit
-- together or not at all. Before this, a failed insert left the campaign with no routes.
--
-- p_edges is a JSON array of {"from_key", "to_key", "label", "hidden"}.
-- SECURITY INVOKER: it runs with the caller's rights (the ingest's service role). Only the
-- service role may call it; the public API roles get nothing, as for the table itself (0038).

CREATE OR REPLACE FUNCTION public.replace_story_map_edges(p_campaign_id text, p_edges jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  inserted integer;
BEGIN
  DELETE FROM public.story_map_edges WHERE campaign_id = p_campaign_id;
  INSERT INTO public.story_map_edges (campaign_id, from_key, to_key, label, hidden)
  SELECT
    p_campaign_id,
    edge ->> 'from_key',
    edge ->> 'to_key',
    edge ->> 'label',
    COALESCE((edge ->> 'hidden')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_edges, '[]'::jsonb)) AS edge;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_story_map_edges(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_story_map_edges(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_story_map_edges(text, jsonb) TO service_role;
