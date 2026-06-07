# Production stage (pre-built)
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy pre-built artifacts
COPY server/dist ./server/dist
COPY server/prisma ./server/prisma
COPY client/dist ./client/dist

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create data directory
RUN mkdir -p /app/server/data

WORKDIR /app/server

EXPOSE 3001

CMD ["/app/docker-entrypoint.sh"]
