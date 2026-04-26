-- Hybrid retrieval: add tsvector column + GIN index + auto-update trigger to DocumentChunk.
-- Idempotent so it is safe to apply against databases that were brought up via `prisma db push`.

-- 1. Column. Prisma maps it as `Unsupported("tsvector")?` in schema.prisma.
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

-- 2. Backfill existing rows. NULL filter keeps re-runs cheap.
UPDATE "DocumentChunk"
SET "searchVector" = to_tsvector('english', content)
WHERE "searchVector" IS NULL;

-- 3. GIN index for ts_rank / @@ queries.
CREATE INDEX IF NOT EXISTS "DocumentChunk_searchVector_idx"
  ON "DocumentChunk"
  USING GIN ("searchVector");

-- 4. Trigger keeps the column in sync on INSERT/UPDATE so ingestion scripts
--    do not need to compute it explicitly.
DROP TRIGGER IF EXISTS "DocumentChunk_searchVector_update" ON "DocumentChunk";
CREATE TRIGGER "DocumentChunk_searchVector_update"
  BEFORE INSERT OR UPDATE ON "DocumentChunk"
  FOR EACH ROW
  EXECUTE FUNCTION tsvector_update_trigger("searchVector", 'pg_catalog.english', content);
