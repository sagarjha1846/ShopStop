-- Sponsored-placement purchases (paid boosts).
--
-- NOTE: prisma migrate dev also wanted to DROP the hand-written FTS objects from
-- 20260714173543_listings_fts (listings_search_idx, listings_tags_idx,
-- listings_title_trgm_idx and the search_vector GENERATED expression). Those are
-- raw-SQL objects Prisma cannot model, so it re-proposes deleting them on every
-- migration; that part is intentionally removed.

-- CreateEnum
CREATE TYPE "BoostStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'FAILED');

-- CreateTable
CREATE TABLE "boost_purchases" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "BoostStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boost_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boost_purchases_provider_order_id_key" ON "boost_purchases"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "boost_purchases_provider_payment_id_key" ON "boost_purchases"("provider_payment_id");

-- CreateIndex
CREATE INDEX "boost_purchases_seller_id_status_idx" ON "boost_purchases"("seller_id", "status");

-- AddForeignKey
ALTER TABLE "boost_purchases" ADD CONSTRAINT "boost_purchases_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boost_purchases" ADD CONSTRAINT "boost_purchases_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
