#!/bin/sh

set -eu

IMAGE="node:20-slim"
VOLUME="milab_node_modules_ci"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no esta disponible en el entorno local." >&2
  exit 1
fi

docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null

echo "[1/4] Instalando dependencias con Node 20"
docker run --rm \
  -v "$PWD":/workspace \
  -v "$VOLUME":/workspace/node_modules \
  -w /workspace \
  "$IMAGE" sh -lc "npm ci"

echo "[2/4] Verificando formato"
docker run --rm \
  -v "$PWD":/workspace \
  -v "$VOLUME":/workspace/node_modules \
  -w /workspace \
  "$IMAGE" sh -lc "npm run format:check"

echo "[3/4] Ejecutando ESLint"
docker run --rm \
  -v "$PWD":/workspace \
  -v "$VOLUME":/workspace/node_modules \
  -w /workspace \
  "$IMAGE" sh -lc "npm run lint"

echo "[4/4] Ejecutando auditoria"
docker run --rm \
  -v "$PWD":/workspace \
  -w /workspace \
  "$IMAGE" sh -lc "rm -rf /tmp/milab_audit && mkdir -p /tmp/milab_audit && cp package.json package-lock.json /tmp/milab_audit/ && cd /tmp/milab_audit && npm audit"

echo "Analisis local completado."