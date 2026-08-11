-- Per-user notification delivery preferences (the preference center).
-- Rows are sparse: a missing (user, category) row means "use the category default".
--
-- NOTE: prisma migrate dev also wanted to DROP the hand-written FTS objects from
-- 20260714173543_listings_fts (listings_search_idx, listings_tags_idx,
-- listings_title_trgm_idx and the search_vector GENERATED expression). Those are
-- raw-SQL objects Prisma cannot model, so that part is intentionally removed —
-- keeping it would silently delete the search indexes.

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_key" ON "notification_preferences"("user_id", "category");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
