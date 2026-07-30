-- Indexes for the browse feed.
--
-- Every browse query was a full sequential scan plus a sort. Measured on a 300k-row
-- catalogue, the default feed read 15,870 buffers and took 78ms to return 21 rows;
-- the boosted-listings query scanned all 300k rows to return none, and it runs on
-- every page-1 load, so one homepage request cost two full scans.
--
-- These are *partial* indexes matching the browse predicate exactly
-- (`deleted_at IS NULL AND status = 'ACTIVE'`). Partial rather than full because the
-- feed only ever reads live listings: the index stays proportional to what is
-- actually for sale rather than to everything ever listed, which matters when sold
-- and archived rows accumulate. A btree scans in both directions, so one index per
-- column serves both ascending and descending sorts.
--
-- After: 0.36ms / 0.31ms / 0.04ms respectively, all index scans.
--
-- Hand-written (not `migrate diff`) for two reasons: Prisma's DSL cannot express a
-- partial index, and diffing against the generated `search_vector` column would drop
-- the FTS indexes.

-- Default feed: newest live listings first.
CREATE INDEX IF NOT EXISTS "listings_browse_recent_idx"
  ON "listings" ("created_at" DESC)
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';

-- Price sorts, both directions.
CREATE INDEX IF NOT EXISTS "listings_browse_price_idx"
  ON "listings" ("price_minor")
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';

-- Sponsored placement. Also excludes rows that were never boosted, which is the vast
-- majority, so this index stays tiny.
CREATE INDEX IF NOT EXISTS "listings_browse_boosted_idx"
  ON "listings" ("boosted_until" DESC)
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE' AND "boosted_until" IS NOT NULL;

-- Category-filtered browse, newest first.
CREATE INDEX IF NOT EXISTS "listings_browse_category_recent_idx"
  ON "listings" ("category_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';
