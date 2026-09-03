-- ProductAddCount: how often a product is added to a list. An aggregate, not a log.
--
-- Written by hand rather than taken from `prisma migrate diff`, which emitted
--   "productId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
-- for this table. AUTOINCREMENT tells SQLite to GENERATE the key, which is exactly wrong for a
-- column that is a foreign key to Product: every row's id is supplied, never invented. It would
-- have worked by accident, because we always pass productId, and then confused whoever read the
-- schema later.
CREATE TABLE IF NOT EXISTS "ProductAddCount" (
    "productId"   INTEGER  NOT NULL PRIMARY KEY,
    "adds"        INTEGER  NOT NULL DEFAULT 0,
    "lastAddedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductAddCount_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProductAddCount_adds_idx" ON "ProductAddCount"("adds");
