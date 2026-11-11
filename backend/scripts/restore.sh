#!/usr/bin/env bash
# Restaura um backup. ATENÇÃO: substitui os dados atuais.
# Uso: DATABASE_URL="postgres://..." ./scripts/restore.sh backups/arquivo.dump
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"
: "${1:?Informe o arquivo .dump}"
read -r -p "Isso vai SUBSTITUIR os dados atuais. Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "$1"
echo "Restauração concluída"
