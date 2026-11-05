#!/bin/sh
# Plan de seguridad (§4): escaneos de seguridad, todos en contenedores y con imágenes fijadas por digest.
#
#   scripts/seguridad.sh            todo: secretos, dependencias, código, Dockerfiles, imágenes y ZAP (~15 min la 1.ª vez)
#   scripts/seguridad.sh --rapido   dependencias de producción e imagen de la aplicación (lo que corre verificar-todo.sh)
#
# Todo sale de una misma copia limpia del último commit (git archive HEAD): código, imágenes y la pila que revisa ZAP;
# lo que esté sin commit no entra. Falla con cualquier crítico o alto que
# tenga corrección publicada, con hallazgos de Semgrep (paquetes públicos y reglas propias), con avisos de Hadolint,
# Checkov o Trivy, y con fallas o avisos de ZAP que no estén aceptados. Las excepciones y su motivo están en
# infra/seguridad/. Reportes en reportes-seguridad/AAAAMMDD-HHMMSS/ (ignorada por git).
set -eu
cd "$(dirname "$0")/.."

# Trivy se fija por digest desde el ataque de marzo de 2026 (CVE-2026-33634: etiquetas 0.69.4 a 0.69.6 falsas); las
# demás también. Para actualizar una: docker pull <imagen>:<versión> y copiar el RepoDigest de docker image inspect.
GITLEAKS=zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
SEMGREP=semgrep/semgrep:1.183.0@sha256:2e45517a85e13a9cca14a2a00df6bb48affd66b8ebfae1b0991cd57578362fb0
OSV=ghcr.io/google/osv-scanner:v2.7.0@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0
TRIVY=aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
GRYPE=anchore/grype:v0.121.1@sha256:6b06708b036f74b2cd70e94b706b4586af96d1932e6ac46255940b2e39dd44a9
CHECKOV=bridgecrew/checkov:3.4.3@sha256:bfe9d70bb7f044aba49bd99675813445f106dee6072da583f51008cb667f3a63
HADOLINT=hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d
ZAP=zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af
# La misma imagen de Node que el Dockerfile.
NODE=node:24.22.2-trixie-slim
# Los mismos nombres que compose.yaml y compose.prod.yaml.
IMAGEN_DB=postgres:17.11-alpine
IMAGEN_PROXY=rs-caddy:2.11.8
IMAGEN_MAPA=rs-mapa:v26.9.0

RAPIDO=no
[ "${1:-}" = "--rapido" ] && RAPIDO=si

PROYECTO=rs-seguridad
REPORTES="$PWD/reportes-seguridad/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORTES"
COPIA=$(mktemp -d)
FALLAS=""

compose() {
  docker compose -p "$PROYECTO" --project-directory "$COPIA" -f "$COPIA/compose.yaml" -f "$COPIA/compose.test.yaml" "$@"
}
limpiar() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$COPIA"
}
trap limpiar EXIT

# Corre un paso, anota si falla y sigue con los demás para dar el panorama completo.
paso() {
  nombre=$1
  shift
  echo
  echo "== $nombre"
  if "$@"; then
    echo "   ok"
  else
    echo "   FALLA: $nombre"
    FALLAS="$FALLAS
  - $nombre"
  fi
}

if [ -n "$(git status --porcelain)" ]; then
  echo "Aviso: hay cambios sin commit; se escanea el último commit ($(git rev-parse --short HEAD))."
fi
git archive HEAD | tar -x -C "$COPIA"

# ---------- Pasos

secretos() {
  # Repositorio principal con todas sus ramas (desde un worktree, .git es un archivo que apunta fuera del montaje).
  principal=$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")
  docker run --rm -v "$principal:/repo:ro" -v "$REPORTES:/out" "$GITLEAKS" detect --source /repo --log-opts=--all \
    --no-banner --redact --report-format json --report-path /out/gitleaks.json
}

dependencias() {
  docker run --rm -e HOME=/tmp -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "$COPIA:/app:ro" -w /app "$NODE" \
    npm audit --package-lock-only --omit=dev --audit-level=high
}

dependencias_osv() {
  # Informativo: incluye las de desarrollo, que no llegan a la imagen de producción. Código 0: sin hallazgos; 1: con
  # hallazgos (quedan en osv.json); otro: el escaneo no corrió, y eso sí es falla.
  codigo=0
  docker run --rm -v "$COPIA:/src:ro" -v "$REPORTES:/out" "$OSV" scan source --lockfile /src/package-lock.json \
    --format json --output-file /out/osv.json >/dev/null 2>&1 || codigo=$?
  if [ "$codigo" -gt 1 ]; then
    echo "   OSV-Scanner no pudo correr (código $codigo)"
    return 1
  fi
  echo "   reporte en osv.json (informativo)"
}

reglas_propias() {
  docker run --rm -v "$COPIA/infra/seguridad/semgrep:/reglas:ro" -w /reglas "$SEMGREP" \
    semgrep --metrics=off --quiet --test --config reglas.yaml reglas.ts
}

codigo() {
  docker run --rm -v "$COPIA:/src:ro" -v "$REPORTES:/out" -w /src "$SEMGREP" semgrep scan --metrics=off --quiet --error \
    --config p/default --config p/typescript --config p/react --config p/nextjs --config p/owasp-top-ten \
    --config p/secrets --config p/dockerfile --config p/docker-compose --config /src/infra/seguridad/semgrep/reglas.yaml \
    --exclude e2e --exclude infra/seguridad/semgrep --json-output=/out/semgrep.json .
}

dockerfiles() {
  ok=0
  for archivo in Dockerfile infra/mapa/Dockerfile infra/caddy/Dockerfile; do
    docker run --rm -i "$HADOLINT" hadolint --failure-threshold warning - < "$COPIA/$archivo" || ok=1
  done
  docker run --rm -v "$COPIA:/src:ro" -v trivy-cache-seguridad:/root/.cache "$TRIVY" config --quiet --exit-code 1 \
    --severity HIGH,CRITICAL --ignorefile /src/infra/seguridad/trivyignore.yaml /src || ok=1
  docker run --rm -v "$COPIA:/src:ro" -w /src "$CHECKOV" --config-file infra/seguridad/checkov.yaml -d . || ok=1
  return $ok
}

construir() {
  if [ "$RAPIDO" = si ]; then
    compose build web >/dev/null
    return
  fi
  compose build web mapa-prueba >/dev/null
  docker build -q -t "$IMAGEN_PROXY" "$COPIA/infra/caddy" >/dev/null
  docker pull -q "$IMAGEN_DB" >/dev/null
}

# Falla con críticos o altos que tengan corrección y no estén en infra/seguridad/grype.yaml.
imagen() {
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v grype-db-seguridad:/cache -e GRYPE_DB_CACHE_DIR=/cache \
    -v "$COPIA/infra/seguridad:/cfg:ro" "$GRYPE" "$1" -q -c /cfg/grype.yaml --only-fixed --fail-on high
}

# Usuarios sintéticos de la semilla de pruebas (compose.test.yaml); nunca existen fuera de la base de pruebas.
CLAVE_PRUEBAS=clave-e2e-sintetica

# Cookie de sesión de un usuario de la semilla, para que ZAP recorra lo que ve ese rol.
cookie_de() {
  docker run --rm --network "${PROYECTO}_default" "$NODE" node -e '
    fetch("http://web:3000/api/auth/sign-in/email", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://web:3000" },
      body: JSON.stringify({ email: process.argv[1], password: process.argv[2] }) })
      .then((r) => { if (!r.ok) process.exit(1); console.log(r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")); })
      .catch(() => process.exit(1));' "$1" "$CLAVE_PRUEBAS"
}

# Una corrida de ZAP baseline (solo pasiva: no envía ataques ni cambia datos). 0: sin fallas ni avisos fuera de los
# aceptados. 1: fallas. 2: avisos.
zap_corrida() {
  carpeta="$REPORTES/zap-$1"
  mkdir -p "$carpeta"
  cp "$COPIA/infra/seguridad/zap-reglas.tsv" "$carpeta/reglas.tsv"
  chmod 777 "$carpeta"
  if [ -z "${3:-}" ]; then
    docker run --rm --network "${PROYECTO}_default" -v "$carpeta:/zap/wrk:rw" "$ZAP" \
      zap-baseline.py -t "$2" -c reglas.tsv -r zap.html -J zap.json -l WARN
  else
    docker run --rm --network "${PROYECTO}_default" -v "$carpeta:/zap/wrk:rw" -e ZAP_AUTH_HEADER=Cookie \
      -e "ZAP_AUTH_HEADER_VALUE=$3" -e ZAP_AUTH_HEADER_SITE=web:3000 "$ZAP" \
      zap-baseline.py -t "$2" -c reglas.tsv -r zap.html -J zap.json -l WARN
  fi
}

zap() {
  compose up -d --wait web >/dev/null
  ok=0
  echo "   -- sin sesión"
  zap_corrida anonimo http://web:3000 || ok=1
  for rol in despachador operador; do
    cookie=$(cookie_de "$rol@e2e.local") || { echo "   no se pudo entrar como $rol"; ok=1; continue; }
    if [ "$rol" = despachador ]; then inicio=/despacho/clientes; else inicio=/operador; fi
    echo "   -- con sesión de $rol"
    zap_corrida "$rol" "http://web:3000$inicio" "$cookie" || ok=1
  done
  return $ok
}

# ---------- Orden

if [ "$RAPIDO" = no ]; then
  paso "1. Secretos en el historial (gitleaks)" secretos
fi
paso "2. Dependencias de producción (npm audit, alto o crítico)" dependencias
if [ "$RAPIDO" = no ]; then
  paso "3. Dependencias contra osv.dev (OSV-Scanner)" dependencias_osv
  paso "4. Reglas propias de Semgrep: sus casos de prueba" reglas_propias
  paso "5. Código (Semgrep: paquetes públicos y reglas propias)" codigo
  paso "6. Dockerfiles (Hadolint, Trivy y Checkov)" dockerfiles
fi
paso "7. Construir las imágenes" construir
paso "8. Imagen de la aplicación (Grype)" imagen "${PROYECTO}-web"
if [ "$RAPIDO" = no ]; then
  paso "9. Imagen de Caddy (Grype)" imagen "$IMAGEN_PROXY"
  paso "10. Imagen de Postgres (Grype)" imagen "$IMAGEN_DB"
  paso "11. Imagen del mapa (Grype)" imagen "$IMAGEN_MAPA"
  paso "12. Aplicación en marcha (ZAP baseline sin sesión, como despachador y como operador)" zap
fi

echo
echo "Reportes en ${REPORTES#"$PWD"/}"
if [ -n "$FALLAS" ]; then
  echo "Escaneo de seguridad con fallas:$FALLAS"
  exit 1
fi
echo "Escaneo de seguridad: todo en verde."
