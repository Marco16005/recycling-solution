#!/bin/sh
# Configuración de Caddy y de Compose, sin compilar Caddy ni levantar nada (diseño del 2026-11-09, vecino feruga):
# - el Caddyfile es válido sin la carpeta de vecinos, con la carpeta vacía y con la del repositorio, y solo en el último
#   caso atiende gestion.feruga.tech;
# - sin compose.feruga.yaml, proxy no está en feruga-entrada ni monta los vecinos; con él, sí, y la red es externa.
# Usa la imagen oficial de Caddy de la misma versión que la base de infra/caddy/Dockerfile: el binario propio solo
# cambia versiones de dependencias, no cómo se lee el Caddyfile.
set -eu
cd "$(dirname "$0")/.."

CADDY=$(sed -n 's/^FROM \(caddy:[0-9.]*-alpine\)$/\1/p' infra/caddy/Dockerfile)
NODE=node:24.22.2-trixie-slim
if [ -z "$CADDY" ]; then
  echo "   FALLA: no se encontró la imagen base de Caddy en infra/caddy/Dockerfile"
  exit 1
fi
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/vacia"
fallas=0

# caddy <subcomando> con DOMINIO, DOMINIO_ALTERNO y, si $1 no está vacío, esa carpeta montada como vecinos.
caddy_con() {
  carpeta=$1
  shift
  if [ -n "$carpeta" ]; then
    docker run --rm -e "DOMINIO=$DOMINIO" -e "DOMINIO_ALTERNO=$ALTERNO" -v "$PWD/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
      -v "$carpeta:/etc/caddy/vecinos:ro" "$CADDY" caddy "$@" --config /etc/caddy/Caddyfile
  else
    docker run --rm -e "DOMINIO=$DOMINIO" -e "DOMINIO_ALTERNO=$ALTERNO" -v "$PWD/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
      "$CADDY" caddy "$@" --config /etc/caddy/Caddyfile
  fi
}

# Nombres que atiende la configuración, ordenados y separados por espacios.
NOMBRES='let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  const nombres = new Set();
  for (const s of Object.values(JSON.parse(t).apps.http.servers))
    for (const r of s.routes ?? []) for (const m of r.match ?? []) for (const h of m.host ?? []) nombres.add(h);
  console.log([...nombres].sort().join(" "));
});'

# $1: descripción; $2: carpeta de vecinos ("" = sin montar); $3: nombres esperados.
caso() {
  if ! caddy_con "$2" validate > "$TEMP/validar.log" 2>&1; then
    echo "   FALLA: $1: caddy validate"
    tail -3 "$TEMP/validar.log"
    fallas=1
    return
  fi
  nombres=$(caddy_con "$2" adapt 2>/dev/null | docker run --rm -i "$NODE" node -e "$NOMBRES")
  if [ "$nombres" = "$3" ]; then
    echo "   ok: $1 ($nombres)"
  else
    echo "   FALLA: $1: atiende «${nombres}», se esperaba «${3}»"
    fallas=1
  fi
}

echo "   -- Caddyfile ($CADDY)"
DOMINIO=localhost ALTERNO=""
caso "desarrollo, sin carpeta de vecinos" "" "localhost"
DOMINIO=feruga.tech ALTERNO=www.feruga.tech
caso "producción con alterno, sin carpeta de vecinos" "" "feruga.tech www.feruga.tech"
ALTERNO=""
caso "producción, carpeta de vecinos vacía" "$TEMP/vacia" "feruga.tech"
ALTERNO=www.feruga.tech
caso "producción con los vecinos del repositorio" "$PWD/infra/caddy/vecinos" "feruga.tech gestion.feruga.tech www.feruga.tech"

# Valores sintéticos: solo para que Compose combine los archivos; no protegen nada.
cat > "$TEMP/entorno" <<'FIN'
POSTGRES_PASSWORD=sintetica
RS_MIGRADOR_PASSWORD=sintetica
RS_APP_PASSWORD=sintetica
BETTER_AUTH_SECRET=valor-sintetico-solo-para-combinar-compose
BETTER_AUTH_URL=https://feruga.tech
DOMINIO=feruga.tech
FIN

REVISAR='let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  const c = JSON.parse(t), conFeruga = process.argv[1] === "si";
  const proxy = c.services.proxy, redes = Object.keys(proxy.networks ?? { default: null });
  const vecinos = (proxy.volumes ?? []).find((v) => v.target === "/etc/caddy/vecinos");
  const problemas = [];
  if (!redes.includes("default")) problemas.push("proxy sin la red default");
  if (redes.includes("feruga-entrada") !== conFeruga) problemas.push("feruga-entrada " + (conFeruga ? "falta" : "sobra"));
  if (Boolean(vecinos) !== conFeruga) problemas.push("montaje de vecinos " + (conFeruga ? "falta" : "sobra"));
  if (conFeruga && vecinos && vecinos.read_only !== true) problemas.push("vecinos no es de solo lectura");
  if (conFeruga && c.networks?.["feruga-entrada"]?.external !== true) problemas.push("feruga-entrada no es externa");
  console.log(problemas.length ? problemas.join("; ") : "ok");
});'

combinar() {
  docker compose --env-file "$TEMP/entorno" --profile caddy "$@" config --format json 2>"$TEMP/compose.log"
}
echo "   -- Compose"
for feruga in no si; do
  if [ "$feruga" = si ]; then
    json=$(combinar -f compose.yaml -f compose.prod.yaml -f compose.feruga.yaml) || { echo "   FALLA: compose config con feruga"; cat "$TEMP/compose.log"; fallas=1; continue; }
  else
    json=$(combinar -f compose.yaml -f compose.prod.yaml) || { echo "   FALLA: compose config sin feruga"; cat "$TEMP/compose.log"; fallas=1; continue; }
  fi
  resultado=$(printf '%s' "$json" | docker run --rm -i "$NODE" node -e "$REVISAR" "$feruga")
  if [ "$resultado" = ok ]; then
    echo "   ok: producción $([ "$feruga" = si ] && echo con || echo sin) compose.feruga.yaml"
  else
    echo "   FALLA: producción $([ "$feruga" = si ] && echo con || echo sin) compose.feruga.yaml: $resultado"
    fallas=1
  fi
done

exit $fallas
