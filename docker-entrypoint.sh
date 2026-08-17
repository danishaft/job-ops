#!/bin/sh
# Job Ops container entrypoint.
#
# The Cloudflare challenge viewer is started lazily by the server only when a
# challenge needs human interaction. Keeping it out of startup avoids carrying
# idle Xvfb/x11vnc/noVNC processes on every normal pipeline run.

# Seed a fresh data volume from the image when no database exists yet.
if [ ! -f /app/data/jobs.db ] && [ -f /app/seed/jobs.db ]; then
  echo "Seeding /app/data/jobs.db from image..."
  mkdir -p /app/data
  cp /app/seed/jobs.db /app/data/jobs.db
fi

# Run the app
cd /app/orchestrator
exec sh -c "npx tsx src/server/db/migrate.ts && npm run start"
