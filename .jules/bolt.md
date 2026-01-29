# Bolt's Journal

## 2025-05-15 - Vector Embedding Over-fetching
**Learning:** Selecting `*` on tables with vector embeddings (like `campaign_chunks.embedding`) can lead to massive unnecessary data transfer (~3KB per row for 768-dim vectors).
**Action:** Always use explicit column lists when querying lore tables to exclude the `embedding` column unless specifically needed for similarity calculations.
