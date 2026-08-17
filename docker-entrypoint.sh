#!/bin/sh
# Job Ops container entrypoint.
#
# The Cloudflare challenge viewer is started lazily by the server only when a
# challenge needs human interaction. Keeping it out of startup avoids carrying
# idle Xvfb/x11vnc/noVNC processes on every normal pipeline run.

# Seed a fresh data volume from the image when no database exists yet.
if [ -f /app/seed/jobs.db ]; then
  if [ ! -f /app/data/jobs.db ]; then
    echo "Seeding /app/data/jobs.db from image..."
    mkdir -p /app/data
    cp /app/seed/jobs.db /app/data/jobs.db
  else
    USER_COUNT=$(node -e "const Database = require('/app/orchestrator/node_modules/better-sqlite3'); const db = new Database('/app/data/jobs.db', { readonly: true }); try { console.log(db.prepare('select count(*) as n from users').get().n) } catch { console.log(0) }" 2>/dev/null || echo 0)
    if [ "$USER_COUNT" = "0" ]; then
      echo "Seeding /app/data/jobs.db (empty database) from image..."
      cp /app/seed/jobs.db /app/data/jobs.db
    fi
  fi
fi

# Run the app
cd /app/orchestrator
exec sh -c "npx tsx src/server/db/migrate.ts && npm run start"
