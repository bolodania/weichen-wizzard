FROM node:20-alpine AS base
WORKDIR /app

# Install CAP backend dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy CDS source
COPY db/ ./db/
COPY srv/ ./srv/
COPY server.js ./

# Build React UI (if sources present)
COPY app/package.json ./app/package.json
COPY app/package-lock.json* ./app/package-lock.json* 2>/dev/null || true
RUN cd app && npm ci 2>/dev/null || true
COPY app/ ./app/
RUN cd app && npm run build 2>/dev/null || echo "UI build skipped"

ENV NODE_ENV=production
ENV FL_MOCK=true
ENV PORT=4004
EXPOSE 4004

CMD ["node", "node_modules/.bin/cds-serve", "--production"]
