#!/bin/sh
# Job Ops container entrypoint.
#
# The Cloudflare challenge viewer is started lazily by the server only when a
# challenge needs human interaction. Keeping it out of startup avoids carrying
# idle Xvfb/x11vnc/noVNC processes on every normal pipeline run.

# Seed a fresh data volume from the image when no database exists yet.
NODE_MODULES=/app/node_modules/better-sqlite3
if [ ! -d "$NODE_MODULES" ]; then
  NODE_MODULES=/app/orchestrator/node_modules/better-sqlite3
fi
if [ -f /app/seed/jobs.db ]; then
  SEED_SALT=$(node -e "const Database = require('$NODE_MODULES'); const db = new Database('/app/seed/jobs.db', { readonly: true }); try { console.log(db.prepare('select password_salt from users limit 1').get().password_salt || '') } catch { console.log('') }" 2>/dev/null)
  if [ ! -f /app/data/jobs.db ]; then
    echo "Seeding /app/data/jobs.db from image..."
    mkdir -p /app/data
    cp /app/seed/jobs.db /app/data/jobs.db
  else
    VOLUME_SALT=$(node -e "const Database = require('$NODE_MODULES'); const db = new Database('/app/data/jobs.db', { readonly: true }); try { console.log(db.prepare('select password_salt from users limit 1').get().password_salt || '') } catch { console.log('') }" 2>/dev/null)
    if [ -n "$SEED_SALT" ] && [ "$SEED_SALT" != "$VOLUME_SALT" ]; then
      echo "Seeding /app/data/jobs.db (account credentials changed) from image..."
      cp /app/seed/jobs.db /app/data/jobs.db
    fi
  fi
fi

# Run the app
cd /app/orchestrator
exec sh -c "npx tsx src/server/db/migrate.ts && npm run start"
