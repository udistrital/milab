#!/bin/sh

set -eu

COMMAND="${1:-scan}"
CONTAINER_NAME="${SONARQUBE_CONTAINER_NAME:-milab-sonarqube}"
NETWORK_NAME="${SONARQUBE_NETWORK_NAME:-milab-sonar-net}"
HOST_PORT="${SONARQUBE_PORT:-9000}"
SONARQUBE_IMAGE="${SONARQUBE_IMAGE:-sonarqube:community}"
SCANNER_IMAGE="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:5.0}"
PROJECT_DIR="${PROJECT_DIR:-$PWD}"
LOCAL_PASSWORD="${SONARQUBE_LOCAL_PASSWORD:-admin_milab_local}"
TOKEN_NAME="${SONARQUBE_TOKEN_NAME:-milab-local-scan}"
SONAR_HOST_URL="http://localhost:${HOST_PORT}"
SONAR_INTERNAL_URL="http://${CONTAINER_NAME}:9000"
SONAR_SCANNER_OPTS_VALUE="${SONAR_SCANNER_OPTS:--Xmx512m}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Se requiere el comando '$1' para ejecutar el analisis local con SonarQube." >&2
    exit 1
  fi
}

ensure_docker_prerequisites() {
  require_command docker
  require_command curl
}

ensure_network() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME" >/dev/null
}

ensure_container_network() {
  if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "\"${NETWORK_NAME}\""; then
    docker network connect "$NETWORK_NAME" "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}

ensure_volumes() {
  docker volume inspect "${CONTAINER_NAME}-data" >/dev/null 2>&1 || docker volume create "${CONTAINER_NAME}-data" >/dev/null
  docker volume inspect "${CONTAINER_NAME}-logs" >/dev/null 2>&1 || docker volume create "${CONTAINER_NAME}-logs" >/dev/null
  docker volume inspect "${CONTAINER_NAME}-extensions" >/dev/null 2>&1 || docker volume create "${CONTAINER_NAME}-extensions" >/dev/null
}

container_exists() {
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)" = "true" ]
}

start_sonarqube() {
  ensure_network
  ensure_volumes

  if container_running; then
    ensure_container_network
    echo "SonarQube local ya esta en ejecucion en ${SONAR_HOST_URL}."
    return
  fi

  if container_exists; then
    echo "Iniciando contenedor existente de SonarQube local..."
    docker start "$CONTAINER_NAME" >/dev/null
    ensure_container_network
    return
  fi

  echo "Creando contenedor local de SonarQube en ${SONAR_HOST_URL}..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --network "$NETWORK_NAME" \
    -p "${HOST_PORT}:9000" \
    -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
    -v "${CONTAINER_NAME}-data:/opt/sonarqube/data" \
    -v "${CONTAINER_NAME}-logs:/opt/sonarqube/logs" \
    -v "${CONTAINER_NAME}-extensions:/opt/sonarqube/extensions" \
    "$SONARQUBE_IMAGE" >/dev/null

  ensure_container_network
}

wait_for_sonarqube() {
  echo "Esperando a que SonarQube quede disponible..."

  attempts=0
  while [ "$attempts" -lt 180 ]; do
    status_json="$(curl -fsS "$SONAR_HOST_URL/api/system/status" 2>/dev/null || true)"
    case "$status_json" in
      *'"status":"UP"'*)
        echo "SonarQube listo."
        return
        ;;
    esac

    attempts=$((attempts + 1))
    if [ $((attempts % 15)) -eq 0 ]; then
      echo "SonarQube aun iniciando... intento ${attempts}/180"
    fi
    sleep 2
  done

  echo "SonarQube no quedo listo a tiempo. Revisa los logs con: docker logs ${CONTAINER_NAME}" >&2
  exit 1
}

validate_credentials() {
  user_password="$1"
  curl -fsS -u "admin:${user_password}" "$SONAR_HOST_URL/api/authentication/validate" 2>/dev/null | grep -q '"valid":true'
}

bootstrap_admin_password() {
  if validate_credentials "$LOCAL_PASSWORD"; then
    ADMIN_PASSWORD="$LOCAL_PASSWORD"
    export ADMIN_PASSWORD
    return
  fi

  if validate_credentials admin; then
    echo "Actualizando la clave local del usuario admin..."
    curl -fsS -u admin:admin -X POST \
      "$SONAR_HOST_URL/api/users/change_password" \
      -d "login=admin" \
      -d "previousPassword=admin" \
      -d "password=${LOCAL_PASSWORD}" >/dev/null
    ADMIN_PASSWORD="$LOCAL_PASSWORD"
    export ADMIN_PASSWORD
    return
  fi

  echo "No fue posible autenticar con SonarQube usando admin/admin ni la clave local esperada." >&2
  echo "Si el contenedor ya existia con otra clave, exporta SONARQUBE_LOCAL_PASSWORD con esa clave y reintenta." >&2
  exit 1
}

generate_token() {
  curl -fsS -u "admin:${ADMIN_PASSWORD}" -X POST \
    "$SONAR_HOST_URL/api/user_tokens/revoke" \
    -d "name=${TOKEN_NAME}" >/dev/null 2>&1 || true

  token_json="$(curl -fsS -u "admin:${ADMIN_PASSWORD}" -X POST \
    "$SONAR_HOST_URL/api/user_tokens/generate" \
    -d "name=${TOKEN_NAME}")"

  token="$(printf '%s' "$token_json" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -z "$token" ]; then
    echo "No fue posible generar un token de SonarQube para el analisis local." >&2
    exit 1
  fi

  SONAR_TOKEN_VALUE="$token"
  export SONAR_TOKEN_VALUE
}

run_scanner() {
  echo "Ejecutando sonar-scanner sobre ${PROJECT_DIR}..."
  docker run --rm \
    --network "$NETWORK_NAME" \
    -e SONAR_HOST_URL="$SONAR_INTERNAL_URL" \
    -e SONAR_TOKEN="$SONAR_TOKEN_VALUE" \
    -e SONAR_SCANNER_OPTS="$SONAR_SCANNER_OPTS_VALUE" \
    -v "${PROJECT_DIR}:/usr/src" \
    -w /usr/src \
    "$SCANNER_IMAGE"

  echo "Analisis enviado. Revisa resultados en ${SONAR_HOST_URL}/dashboard?id=milab"
}

stop_sonarqube() {
  if container_exists; then
    echo "Deteniendo y eliminando contenedor local de SonarQube..."
    if container_running; then
      docker stop "$CONTAINER_NAME" >/dev/null
    fi
    docker rm "$CONTAINER_NAME" >/dev/null
  else
    echo "No existe un contenedor local de SonarQube con nombre ${CONTAINER_NAME}."
  fi
}

status_sonarqube() {
  if ! container_exists; then
    echo "SonarQube local no existe."
    return
  fi

  echo "Contenedor: ${CONTAINER_NAME}"
  docker inspect -f 'Estado: {{.State.Status}} | Puerto: {{(index (index .NetworkSettings.Ports "9000/tcp") 0).HostPort}}' "$CONTAINER_NAME"
}

scan() {
  ensure_docker_prerequisites
  start_sonarqube
  wait_for_sonarqube
  bootstrap_admin_password
  generate_token
  run_scanner
}

case "$COMMAND" in
  scan|start)
    scan
    ;;
  stop)
    ensure_docker_prerequisites
    stop_sonarqube
    ;;
  status)
    ensure_docker_prerequisites
    status_sonarqube
    ;;
  *)
    echo "Uso: sh scripts/run-local-sonar.sh [scan|start|stop|status]" >&2
    exit 1
    ;;
esac