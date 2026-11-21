#!/bin/sh
# La combinación de producción en esta máquina (diseño del 2026-11-10): compose.yaml + compose.prod.yaml con Caddy, con
# valores sintéticos y sin publicar puertos (las peticiones entran por la red interna del proyecto). Ninguna otra prueba
# levanta compose.prod.yaml. Comprueba que:
# - db, web y proxy corren sin poder ganar privilegios (NoNewPrivs 1) y sin capacidades (CapEff en 0);
# - la entrada por HTTPS responde 200, con HSTS, sin Server y sin anunciar HTTP/3 (Alt-Svc);
# - GET, HEAD y POST llegan a la aplicación, y TRACE o PUT reciben 405 de Caddy, también en el nombre alterno, que
#   redirige GET al principal (prueba externa del 2026-11-11);
# - con web detenido, el 502 de Caddy también lleva HSTS y no lleva Server;
# - el volumen de Caddy se muda con los dos comandos de docs/operacion.md §6, tal cual, y Caddy vuelve con la misma
#   autoridad (la de los teléfonos en la red local).
set -eu
cd "$(dirname "$0")/.."

PROYECTO="rs-prod-local-$(date +%s)"
NODE=node:24.22.3-trixie-slim
TEMP=$(mktemp -d)
fallas=0

compose() {
  docker compose -p "$PROYECTO" --env-file "$TEMP/entorno" -f compose.yaml -f compose.prod.yaml -f "$TEMP/sin-puertos.yaml" \
    --profile caddy "$@"
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
DOMINIO_ALTERNO=www.localhost
ADMIN_CORREO=admin@prod-local.test
ADMIN_NOMBRE=Administrador de prueba
ADMIN_CLAVE=clave-sintetica-de-prueba-123
FIN
# Sin puertos en la máquina: una prueba no debe fallar porque 80, 443 o 3001 estén ocupados.
cat > "$TEMP/sin-puertos.yaml" <<'FIN'
services:
  web:
    ports: !reset []
  proxy:
    ports: !reset []
FIN

echo "   -- Construir y levantar (db, migrate, bootstrap, web, proxy-permisos, proxy)"
if ! compose build >"$TEMP/build.log" 2>&1; then
  echo "   FALLA: no se construyeron las imágenes"
  tail -20 "$TEMP/build.log"
  exit 1
fi
levantar() {
  if ! compose up -d --wait proxy >"$TEMP/up.log" 2>&1; then
    echo "   FALLA: no arrancó"
    tail -20 "$TEMP/up.log"
    compose logs --no-color --tail 30 2>&1 | tail -40
    exit 1
  fi
}
levantar

echo "   -- Privilegios de lo que queda corriendo"
for servicio in db web proxy; do
  estado=$(compose exec -T "$servicio" cat /proc/1/status | grep -E '^(NoNewPrivs|CapEff):' | tr -s '\t ' ' ' | tr '\n' ' ')
  case "$estado" in
    *"NoNewPrivs: 1"*"CapEff: 0000000000000000"* | *"CapEff: 0000000000000000"*"NoNewPrivs: 1"*) echo "   ok: $servicio ($estado)" ;;
    *) echo "   FALLA: $servicio: $estado"; fallas=1 ;;
  esac
done

# Una petición HTTPS a Caddy desde la red del proyecto, como la haría un navegador que pide ese nombre («localhost» o el
# alterno). Alt-Svc, Allow y Location solo aparecen en el resultado si vienen: Alt-Svc nunca debe venir (sin HTTP/3);
# Allow, en los 405 de Caddy; Location, en la redirección del alterno.
PEDIR='const https = require("node:https");
const [ruta, metodo, nombre] = process.argv.slice(1);
https.request({ host: "proxy", port: 443, path: ruta, method: metodo, servername: nombre, headers: { host: nombre }, rejectUnauthorized: false }, (r) => {
  const partes = [r.statusCode, r.headers["strict-transport-security"] ? "hsts" : "sin-hsts", r.headers.server ? "con-server" : "sin-server"];
  if (r.headers["alt-svc"]) partes.push("alt-svc=" + r.headers["alt-svc"]);
  if (r.headers.allow) partes.push("allow=" + r.headers.allow);
  if (r.headers.location) partes.push("location=" + r.headers.location);
  console.log(partes.join(" "));
  r.resume();
}).on("error", (e) => { console.log("error " + e.message); }).end();'
pedir() { docker run --rm --network "${PROYECTO}_default" "$NODE" node -e "$PEDIR" "$1" "$2" "$3"; }
revisar() { # $1: descripción; $2: ruta; $3: resultado esperado; $4: método (GET si falta); $5: nombre (localhost si falta)
  resultado=$(pedir "$2" "${4:-GET}" "${5:-localhost}")
  if [ "$resultado" = "$3" ]; then echo "   ok: $1 ($resultado)"; else echo "   FALLA: $1: «$resultado», se esperaba «$3»"; fallas=1; fi
}
# Huella del certificado raíz de la autoridad de Caddy (público): debe ser la misma después de mudar el volumen.
raiz() { compose exec -T proxy sha256sum /data/caddy/pki/authorities/local/root.crt | cut -d' ' -f1; }

echo "   -- HTTPS por Caddy"
revisar "la entrada" /entrar "200 hsts sin-server"
# Métodos (prueba externa del 2026-11-11): GET, HEAD y POST llegan a la aplicación; los demás se quedan en Caddy. POST a
# una ruta de Better Auth que no se usa: el 404 lo da la aplicación, no Caddy.
revisar "HEAD a la entrada" /entrar "200 hsts sin-server" HEAD
revisar "POST llega a la aplicación" /api/auth/get-session "404 hsts sin-server" POST
revisar "TRACE se queda en Caddy" /entrar "405 hsts sin-server allow=GET, HEAD, POST" TRACE
revisar "PUT se queda en Caddy" /entrar "405 hsts sin-server allow=GET, HEAD, POST" PUT
# El nombre alterno redirige GET al principal, pero a TRACE le contesta el mismo 405: «redir» va antes que «respond».
revisar "GET al nombre alterno" /entrar "301 hsts sin-server location=https://localhost/entrar" GET www.localhost
revisar "TRACE al nombre alterno" /entrar "405 hsts sin-server allow=GET, HEAD, POST" TRACE www.localhost
huella=$(raiz)
compose stop web >/dev/null 2>&1
revisar "502 con web detenido" /entrar "502 hsts sin-server"

echo "   -- Mudar el volumen de Caddy con los comandos de docs/operacion.md §6"
mkdir -p "$TEMP/respaldos"
compose stop proxy >/dev/null 2>&1
if compose run --rm --no-deps --user root --cap-add DAC_OVERRIDE --entrypoint tar -v "$TEMP/respaldos:/salida" proxy \
  czf /salida/caddy-datos.tgz -C /data . >"$TEMP/mudar.log" 2>&1; then
  echo "   ok: copiar el volumen"
else
  echo "   FALLA: copiar el volumen"; tail -5 "$TEMP/mudar.log"; fallas=1
fi
# Como en la máquina nueva: sin el volumen anterior.
compose rm -f -s proxy proxy-permisos >/dev/null 2>&1
docker volume rm "${PROYECTO}_caddy_datos" >/dev/null
if compose run --rm --no-deps --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint sh -v "$TEMP/respaldos:/entrada" proxy \
  -c 'tar xzf /entrada/caddy-datos.tgz -C /data && chown -R caddy:caddy /data' >"$TEMP/mudar.log" 2>&1; then
  echo "   ok: restaurarlo en un volumen nuevo"
else
  echo "   FALLA: restaurar el volumen"; tail -5 "$TEMP/mudar.log"; fallas=1
fi
levantar
revisar "la entrada, con el volumen restaurado" /entrar "200 hsts sin-server"
if [ "$(raiz)" = "$huella" ]; then echo "   ok: la misma autoridad de Caddy"; else echo "   FALLA: la autoridad de Caddy cambió al mudar el volumen"; fallas=1; fi

exit $fallas
