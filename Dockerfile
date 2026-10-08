# CosIeftin — single image that serves the Next.js app AND can run the scrapers
# (including the Playwright/Chromium ones). Based on the Playwright image so
# Chromium + its system deps are already present.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Chromium (with browser deps) is preinstalled here by the base image:
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install ALL deps (build + scrapers need devDeps: tsx, prisma, playwright, typescript).
# `npm ci` runs the `postinstall: prisma generate` script, which needs prisma/schema.prisma
# to exist already — copy it before package*.json's `npm ci`, not with the rest of the source.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# App source + build. `next build` prerenders /_not-found, which reaches siteUrl() — and
# siteUrl() deliberately throws rather than guess an origin outside development (see
# src/lib/config/siteUrl.ts). SITE_URL must therefore be real at BUILD time too, not just at
# container start; pass the actual production origin as a build arg, never a placeholder.
ARG SITE_URL
ENV SITE_URL=$SITE_URL
COPY . .

# The homepage, /categorii and others query the database during static generation, and there
# are no Prisma migrations (schema is applied with `prisma db push`) — so a build with no
# DATABASE_URL at all fails outright, not just for the pages that can tolerate an empty catalog.
# Push the real schema to a throwaway SQLite file so those queries hit a real, empty, correctly
# shaped database — the same state a freshly deployed site is in before its first scrape — then
# build against it. The runtime DATABASE_URL below (the mounted volume) replaces this entirely;
# this file never leaves the build layer.
ENV DATABASE_URL=file:/tmp/build.db
RUN npx prisma generate && npx prisma db push --skip-generate && npm run build

# Runtime
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/cosmic.db
EXPOSE 3000
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
