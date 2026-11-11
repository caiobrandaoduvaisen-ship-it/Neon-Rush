#!/usr/bin/env bash
# Backup completo do banco. Uso: DATABASE_URL="postgres://..." ./scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL (use a External Database URL do Render)}"
mkdir -p backups
file="backups/neonrush3d-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" -f "$file"
echo "Backup salvo em $file"
