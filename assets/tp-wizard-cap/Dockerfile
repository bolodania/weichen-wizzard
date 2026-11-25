FROM node:22-alpine AS base
WORKDIR /app

# Install CAP backend dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy CDS source
COPY db/ ./db/
COPY srv/ ./srv/
COPY server.js ./

# Build React UI (if sources present)
COPY app-field/package.json app-field/package-lock.json ./app-field/
RUN cd app-field && npm ci
COPY app/ ./app/
COPY app-field/ ./app-field/
RUN cd app-field && npm run build

ENV NODE_ENV=production
ENV FL_MOCK=true
ENV PORT=4004
EXPOSE 4004

CMD ["node", "node_modules/.bin/cds-serve", "--production"]
