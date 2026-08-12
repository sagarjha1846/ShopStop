-- Included boost credit on paid plans. (FTS drift stripped, as before.)

-- AlterTable
ALTER TABLE "boost_purchases" ADD COLUMN     "credit_days" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "boost_days_used" INTEGER NOT NULL DEFAULT 0;
