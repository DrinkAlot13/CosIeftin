# CosIeftin — single image that serves the Next.js app AND can run the scrapers
# (including the Playwright/Chromium ones). Based on the Playwright image so
# Chromium + its system deps are already present.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Chromium (with browser deps) is preinstalled here by the base image:
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install ALL deps (build + scrapers need devDeps: tsx, prisma, playwright, typescript)
COPY package*.json ./
RUN npm ci

# App source + build
COPY . .
RUN npx prisma generate && npm run build

# Runtime
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/cosmic.db
EXPOSE 3000
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
