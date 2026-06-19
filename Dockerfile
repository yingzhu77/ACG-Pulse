# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci

# Install client dependencies
COPY client/package*.json ./client/
RUN cd client && npm ci

# Copy source code
COPY server/ ./server/
COPY client/ ./client/
COPY shared/ ./shared/

# Generate Prisma client
ENV DATABASE_URL=file:/app/server/data/prod.db
RUN cd server && npx prisma generate

# Build server
RUN cd server && npm run build

# Build client
RUN cd client && npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# sqlite3 is required for consistent online backups and FTS maintenance.
RUN apk add --no-cache sqlite

# Install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/prisma ./server/prisma

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

# Create data directory
RUN mkdir -p /app/server/data

WORKDIR /app/server

EXPOSE 3001

CMD ["/app/docker-entrypoint.sh"]
