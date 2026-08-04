#!/bin/sh
set -e

# The SQLite DB + downloaded images live on mounted volumes so they survive updates.
mkdir -p /data /app/public/product-images

# Ensure the schema exists on the volume DB, then seed the (idempotent) catalog + admin.
echo "[entrypoint] prisma db push..."
npx prisma db push --skip-generate
echo "[entrypoint] seeding catalog + admin..."
npx tsx scripts/seed-catalog.ts
npx tsx scripts/seed-admin.ts

echo "[entrypoint] starting: $*"
exec "$@"
