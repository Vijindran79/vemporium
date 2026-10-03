-- Promotional codes, and the record of which code each order used.
--
-- additive, so this is safe to apply to a live database: no existing column
-- changes type or meaning.

CREATE TABLE "PromoCode" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "percentOff" DECIMAL(5,4),
    "amountOffUsd" DECIMAL(10,2),
    "minSubtotalUsd" DECIMAL(10,2),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "perCustomerLimit" INTEGER,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "appliesToCategories" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- code is stored normalised (uppercased, trimmed) by the writer, so lookup is
-- a single equality rather than a case-insensitive scan.
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- Supports the admin list: active codes within their window.
CREATE INDEX "PromoCode_active_startsAt_endsAt_idx" ON "PromoCode"("active", "startsAt", "endsAt");

-- --- Order side -------------------------------------------------------------
--
-- promoCodeId is ON DELETE SET NULL, not CASCADE: deleting a promo must never
-- delete the orders that used it. promoCodeApplied survives even that, so an
-- order always records what discount was actually granted.

ALTER TABLE "Order" ADD COLUMN "promoCodeId" UUID;
ALTER TABLE "Order" ADD COLUMN "promoCodeApplied" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountLocal" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE INDEX "Order_promoCodeId_idx" ON "Order"("promoCodeId");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_promoCodeId_fkey"
  FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
