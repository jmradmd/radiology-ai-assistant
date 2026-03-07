# Archived Ingestion Scripts

These scripts were replaced by `ingest-institution.ts` on 2026-01-30.

They are preserved for reference and rollback purposes.

## Why Archived

The old scripts:
- Only supported a single institution (INSTITUTION_B)
- Deleted ALL documents before re-ingesting
- Had hardcoded paths

## If You Need to Rollback

1. Copy the .bak file back to scripts/
2. Remove the .bak extension
3. Run as before

## New Script

Use `scripts/ingest-institution.ts` instead:
- Supports multiple institutions
- Incremental by default (no delete)
- Use `--clean` flag if you really need to wipe
