#!/bin/sh
# La combinación de producción en esta máquina (diseño del 2026-11-10): compose.yaml + compose.prod.yaml con Caddy, con
# valores sintéticos y puertos altos. Ninguna otra prueba levanta compose.prod.yaml. Comprueba que:
# - db, web y proxy corren sin poder ganar privilegios (NoNewPrivs 1) y sin capacidades (CapEff en 0);
# - la entrada por HTTPS responde 200, con HSTS y sin Server;
# - con web detenido, el 502 de Caddy también lleva HSTS y no lleva Server.
set -eu
cd "$(dirname "$0")/.."

PROYECTO="rs-prod-local-$(date +%s)"
NODE=node:24.22.2-trixie-slim
TEMP=$(mktemp -d)
fallas=0

compose() {
  docker compose -p "$PROYECTO" --env-file "$TEMP/entorno" -f compose.yaml -f compose.prod.yaml --profile caddy "$@"
}
limpiar() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap limpiar EXIT

# Valores sintéticos de esta prueba: la base y los volúmenes se borran al terminar. Contraseñas solo con letras y números.
cat > "$TEMP/entorno" <<'FIN'
POSTGRES_PASSWORD=sinteticaprodlocal1
RS_MIGRADOR_PASSWORD=sinteticaprodlocal2
RS_APP_PASSWORD=sinteticaprodlocal3
BETTER_AUTH_SECRET=valor-sintetico-de-la-prueba-de-produccion-local
BETTER_AUTH_URL=https://localhost
DOMINIO=localhost
ADMIN_CORREO=admin@prod-local.test
ADMIN_NOMBRE=Administrador de prueba
ADMIN_CLAVE=clave-sintetica-de-prueba-123
PUERTO_HTTP=18080
PUERTO_HTTPS=18443
PUERTO_WEB_LOCAL=13001
FIN

echo "   -- Construir y levantar (db, migrate, bootstrap, web, proxy-permisos, proxy)"
if ! compose build >"$TEMP/build.log" 2>&1; then
  echo "   FALLA: no se construyeron las imágenes"
  tail -20 "$TEMP/build.log"
  exit 1
fi
if ! compose up -d --wait proxy >"$TEMP/up.log" 2>&1; then
  echo "   FALLA: no arrancó"
  tail -20 "$TEMP/up.log"
  compose logs --no-color --tail 30 2>&1 | tail -40
  exit 1
fi

echo "   -- Privilegios de lo que queda corriendo"
for servicio in db web proxy; do
  estado=$(compose exec -T "$servicio" cat /proc/1/status | grep -E '^(NoNewPrivs|CapEff):' | tr -s '\t ' ' ' | tr '\n' ' ')
  case "$estado" in
    *"NoNewPrivs: 1"*"CapEff: 0000000000000000"* | *"CapEff: 0000000000000000"*"NoNewPrivs: 1"*) echo "   ok: $servicio ($estado)" ;;
    *) echo "   FALLA: $servicio: $estado"; fallas=1 ;;
  esac
done

# Una petición HTTPS a Caddy desde la red del proyecto, como la haría un navegador que pide «localhost».
PEDIR='const https = require("node:https");
https.get({ host: "proxy", port: 443, path: process.argv[1], servername: "localhost", headers: { host: "localhost" }, rejectUnauthorized: false }, (r) => {
  console.log([r.statusCode, r.headers["strict-transport-security"] ? "hsts" : "sin-hsts", r.headers.server ? "con-server" : "sin-server"].join(" "));
  r.resume();
}).on("error", (e) => { console.log("error " + e.message); });'
pedir() { docker run --rm --network "${PROYECTO}_default" "$NODE" node -e "$PEDIR" "$1"; }
revisar() { # $1: descripción; $2: ruta; $3: resultado esperado
  resultado=$(pedir "$2")
  if [ "$resultado" = "$3" ]; then echo "   ok: $1 ($resultado)"; else echo "   FALLA: $1: «$resultado», se esperaba «$3»"; fallas=1; fi
}

echo "   -- HTTPS por Caddy"
revisar "la entrada" /entrar "200 hsts sin-server"
compose stop web >/dev/null 2>&1
revisar "502 con web detenido" /entrar "502 hsts sin-server"

exit $fallas
