FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc && npm prune --omit=dev

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    xvfb \
    dbus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV DATA_DIR=/data
ENV PORT=3000
ENV HOST=0.0.0.0

RUN mkdir -p /data/profiles && chown -R node:node /app /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

LABEL org.opencontainers.image.title="BrowseFleet" \
      org.opencontainers.image.description="Self-hosted cloud browser API for AI agents." \
      org.opencontainers.image.url="https://browsefleet.com" \
      org.opencontainers.image.source="https://github.com/theRJMurray/browsefleet" \
      org.opencontainers.image.documentation="https://github.com/theRJMurray/browsefleet/blob/master/README.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="RJ Murray and contributors"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
