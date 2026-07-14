-- Full-text search for listings (Postgres FTS v1). Prisma's DSL can't express a
-- generated tsvector column, so it's added here. Swap for OpenSearch at scale
-- (docs/17-scaling-roadmap.md) behind the search adapter interface.

-- Generated, always-in-sync search vector over the real search fields:
-- title (weight A) > description (weight B). (array_to_string over tags is not
-- IMMUTABLE, so tags are indexed separately as an array — see below — which is
-- the right tool for tag filtering anyway.)
ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;

-- GIN index for ranked full-text queries.
CREATE INDEX IF NOT EXISTS "listings_search_idx" ON "listings" USING GIN ("search_vector");

-- Trigram index on title for fuzzy autocomplete / typo tolerance.
CREATE INDEX IF NOT EXISTS "listings_title_trgm_idx" ON "listings" USING GIN ("title" gin_trgm_ops);

-- Array containment index for tag filtering (tags @> ARRAY['...']).
CREATE INDEX IF NOT EXISTS "listings_tags_idx" ON "listings" USING GIN ("tags");