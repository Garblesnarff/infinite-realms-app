# Proposed `campaign_bible.md` handouts section

This is the matching format for the content submodule at `../infinite-realms`. It is intentionally documented here only; that content is not modified by this change.

```md
## Handouts

### Balthazar's Recipe Card
Key: `balthazars-recipe`
Title: Balthazar's Recipe Card
Giver: Balthazar
Body:
Fold the saffron into the dough at dawn.

Keep the oven door shut.
```

Each `###` entry requires a stable `Key`, display `Title`, in-fiction `Giver`, and `Body`. Ingest stores these fields in the handout chunk metadata and embeds the body for RAG retrieval. Asset packages place authored art at `campaigns/{campaignId}/handouts/{key}.png`.
