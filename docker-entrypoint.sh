#!/bin/sh
set -e

cd /app/server

# Run database migrations
echo "Running database migrations..."
npx prisma generate
npx prisma db push --skip-generate

# Start the server
echo "Starting Game Pulse server..."
exec node dist/index.js
