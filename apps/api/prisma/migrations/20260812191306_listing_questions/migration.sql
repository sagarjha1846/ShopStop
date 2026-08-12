-- Public Q&A on listings. (FTS drift stripped, as before.)

-- AlterEnum
ALTER TYPE "ReportSubject" ADD VALUE 'QUESTION';

-- CreateTable
CREATE TABLE "listing_questions" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "asker_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answer_body" TEXT,
    "answered_by_id" TEXT,
    "answered_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_questions_listing_id_created_at_idx" ON "listing_questions"("listing_id", "created_at");

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_asker_id_fkey" FOREIGN KEY ("asker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_answered_by_id_fkey" FOREIGN KEY ("answered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
