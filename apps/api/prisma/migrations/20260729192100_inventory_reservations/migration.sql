-- Inventory reservations: hold stock at checkout, not at payment.
--
-- Hand-written because `prisma migrate diff` sees the generated `search_vector`
-- tsvector column as drift and tries to drop the FTS/trigram/tag indexes with it.
-- Only the intended changes are applied here.

-- Does this order currently hold units against the listing? Exactly one transition
-- may flip this true -> false, which is what makes stock release idempotent.
ALTER TABLE "orders" ADD COLUMN "stock_held" BOOLEAN NOT NULL DEFAULT false;

-- When an unpaid order's hold lapses. The sweeper cancels + restocks past this.
ALTER TABLE "orders" ADD COLUMN "reservation_expires_at" TIMESTAMP(3);

-- Lets the sweeper find expired holds without scanning the whole order table.
CREATE INDEX "orders_status_reservation_expires_at_idx"
  ON "orders" ("status", "reservation_expires_at");

-- Backfill: orders that already consumed stock under the old (decrement-on-accept)
-- behaviour still hold their units, so a later cancel/refund must return them.
UPDATE "orders" SET "stock_held" = true
  WHERE "status" IN ('ACCEPTED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED');

-- Repair any oversold rows before the constraint below can reject them.
UPDATE "listings" SET "quantity" = 0 WHERE "quantity" < 0;

-- Defence in depth: even if application logic regresses, the database itself
-- refuses to sell stock that does not exist.
ALTER TABLE "listings" ADD CONSTRAINT "listings_quantity_non_negative"
  CHECK ("quantity" >= 0);
