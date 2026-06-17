#!/bin/sh

set -eu

REMOTE_HOST="${REMOTE_HOST:-labs-ec2}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/milab}"
REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-/home/ubuntu/prod}"
REMOTE_DB_CONTAINER="${REMOTE_DB_CONTAINER:-milabud_db_pruebas}"
REMOTE_APP_CONTAINER="${REMOTE_APP_CONTAINER:-milabud_pruebas}"

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh no esta disponible en este equipo." >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar no esta disponible en este equipo." >&2
  exit 1
fi

echo "[1/6] Copiando codigo actual a ${REMOTE_HOST}:${REMOTE_APP_DIR}"
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='logs' \
  --exclude='coverage' \
  --exclude='.nyc_output' \
  --exclude='Docker/.env' \
  -czf - . | ssh "$REMOTE_HOST" \
  "set -eu
   rm -rf '/tmp/milab.incoming' '/tmp/milab.previous'
   mkdir -p '/tmp/milab.incoming'
   tar -xzf - -C '/tmp/milab.incoming'
   if [ -f '${REMOTE_APP_DIR}/Docker/.env' ]; then
     mkdir -p '/tmp/milab.incoming/Docker'
     sudo cp '${REMOTE_APP_DIR}/Docker/.env' '/tmp/milab.incoming/Docker/.env'
     sudo chown ubuntu:ubuntu '/tmp/milab.incoming/Docker/.env'
   fi
   sudo rm -rf '${REMOTE_APP_DIR}.previous'
   if [ -d '${REMOTE_APP_DIR}' ]; then
     sudo mv '${REMOTE_APP_DIR}' '${REMOTE_APP_DIR}.previous'
   fi
   sudo mv '/tmp/milab.incoming' '${REMOTE_APP_DIR}'
   sudo chown -R ubuntu:ubuntu '${REMOTE_APP_DIR}'
   sudo rm -rf '${REMOTE_APP_DIR}.previous'"

echo "[2/6] Reseteando base de datos remota con la estructura nueva"
ssh "$REMOTE_HOST" \
  APP_DIR="$REMOTE_APP_DIR" \
  COMPOSE_DIR="$REMOTE_COMPOSE_DIR" \
  DB_CONTAINER="$REMOTE_DB_CONTAINER" \
  APP_CONTAINER="$REMOTE_APP_CONTAINER" \
  'sh -s' <<'REMOTE_RESET'
set -eu

ENV_FILE="$APP_DIR/Docker/.env"
SQL_DIR="$APP_DIR/sql-scripts"
SQL_RUN_DIR="$APP_DIR/sql-scripts.apply"
PROJECT_NAME="$(basename "$COMPOSE_DIR")"
DB_VOLUME="$(sudo docker inspect "$DB_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"

if [ -z "$DB_VOLUME" ]; then
  DB_VOLUME="${PROJECT_NAME}_milab_db_data"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo 'No existe Docker/.env remoto.' >&2
  exit 1
fi

if grep -q '^DB_SCHEMA=' "$ENV_FILE"; then
  sed -i.bak 's/^DB_SCHEMA=.*/DB_SCHEMA=milab/' "$ENV_FILE"
else
  printf '\nDB_SCHEMA=milab\n' >> "$ENV_FILE"
fi

rm -rf "$SQL_RUN_DIR"
mv "$SQL_DIR" "$SQL_RUN_DIR"
mkdir -p "$SQL_DIR"

cleanup() {
  rm -rf "$SQL_DIR"
  if [ -d "$SQL_RUN_DIR" ]; then
    mv "$SQL_RUN_DIR" "$SQL_DIR"
  fi
}
trap cleanup EXIT

cd "$COMPOSE_DIR"
sudo docker compose stop milabud dbseed dbpostgres >/dev/null 2>&1 || true
sudo docker compose rm -sf milabud dbseed dbpostgres >/dev/null 2>&1 || true
sudo docker volume rm "$DB_VOLUME" >/dev/null 2>&1 || true
sudo docker compose up -d dbpostgres

DB_USER="$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)"
DB_NAME="$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)"

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  if sudo docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo 'La base remota no quedo lista a tiempo.' >&2
  exit 1
fi

sudo docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$SQL_RUN_DIR/db_structure.sql"
sudo docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$SQL_RUN_DIR/db_seed_system.sql"
sudo docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$SQL_RUN_DIR/db_structure_prestamos.sql"
sudo docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$SQL_RUN_DIR/db_seed_prestamos.sql"

sudo docker compose up -d --build milabud

echo '[remote] base recreada y aplicacion reconstruida.'
sudo docker compose ps dbpostgres milabud
sudo docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -P pager=off -c 'SHOW search_path;'
sudo docker exec -i "$APP_CONTAINER" node -e "const config=require('./src/config/config'); console.log('DB_SCHEMA=' + process.env.DB_SCHEMA); console.log('search_path=' + config.config.options);"
REMOTE_RESET

echo "[3/6] Verificando que prestamos ya no quede sin montar"
curl -sS -L -D - -o /dev/null https://labs.udistrital.edu.co/milab/prestamos/inventario | egrep 'HTTP/|content-type:|location:' || true

echo "[4/6] Script completado"
echo "Siguiente paso recomendado: valida las rutas autenticadas con una sesion real en el ambiente de pruebas."