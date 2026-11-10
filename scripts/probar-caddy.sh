#!/bin/sh
# Configuración de Caddy y de Compose, sin compilar Caddy ni levantar nada (diseño del 2026-11-09, vecino feruga):
# - el Caddyfile es válido sin la carpeta de vecinos, con la carpeta vacía y con la del repositorio, y solo en el último
#   caso atiende gestion.feruga.tech;
# - sin compose.feruga.yaml, proxy no está en feruga-entrada ni monta los vecinos; con él, sí, y la red es externa;
# - los errores de cada sitio llevan HSTS y quitan Server, y cada servicio corre sin privilegios (2026-11-10).
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

# Nombres cuyos errores (handle_errors) ponen HSTS y quitan Server: el fragmento (errores) del Caddyfile (2026-11-10).
ERRORES='let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  // Caddy convierte cada «header» en un manejador aparte: se buscan los dos dentro de la misma ruta de errores.
  const todos = (manejadores) => (manejadores ?? []).flatMap((h) => [h, ...(h.routes ?? []).flatMap((r) => todos(r.handle))]);
  const busca = (manejadores) => {
    const encabezados = todos(manejadores).filter((h) => h.handler === "headers");
    return encabezados.some((h) => h.response?.set?.["Strict-Transport-Security"]) &&
      encabezados.some((h) => (h.response?.delete ?? []).includes("Server"));
  };
  const nombres = new Set();
  for (const s of Object.values(JSON.parse(t).apps.http.servers))
    for (const r of s.errors?.routes ?? []) if (busca(r.handle)) for (const m of r.match ?? []) for (const h of m.host ?? []) nombres.add(h);
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
  caddy_con "$2" adapt > "$TEMP/adaptado.json" 2>/dev/null
  nombres=$(docker run --rm -i "$NODE" node -e "$NOMBRES" < "$TEMP/adaptado.json")
  errores=$(docker run --rm -i "$NODE" node -e "$ERRORES" < "$TEMP/adaptado.json")
  if [ "$nombres" != "$3" ]; then
    echo "   FALLA: $1: atiende «${nombres}», se esperaba «${3}»"
    fallas=1
  elif [ "$errores" != "$3" ]; then
    echo "   FALLA: $1: sus errores llevan HSTS y quitan Server solo en «${errores}», se esperaba «${3}»"
    fallas=1
  else
    echo "   ok: $1 ($nombres; errores con HSTS)"
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

# Endurecimiento (2026-11-10): cada servicio sin privilegios nuevos y sin capacidades, salvo las de esta lista. Fuera:
# unit, integration y e2e de compose.test.yaml (herramientas de prueba; Chromium usa su propio aislamiento).
ENDURECIDO='let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  const permitidas = { db: ["CHOWN", "DAC_READ_SEARCH", "FOWNER", "SETGID", "SETUID"], respaldo: ["DAC_OVERRIDE"], "proxy-permisos": ["CHOWN", "DAC_READ_SEARCH"] };
  const fuera = new Set(["unit", "integration", "e2e"]);
  const problemas = [];
  for (const [nombre, s] of Object.entries(JSON.parse(t).services)) {
    if (fuera.has(nombre)) continue;
    if (!(s.security_opt ?? []).includes("no-new-privileges:true")) problemas.push(nombre + " sin no-new-privileges");
    if (JSON.stringify(s.cap_drop ?? []) !== JSON.stringify(["ALL"])) problemas.push(nombre + " sin cap_drop ALL");
    const extra = (s.cap_add ?? []).filter((c) => !(permitidas[nombre] ?? []).includes(c));
    if (extra.length) problemas.push(nombre + " con capacidades de más: " + extra.join(","));
  }
  console.log(problemas.length ? problemas.join("; ") : "ok");
});'
echo "   -- Endurecimiento (no-new-privileges, cap_drop ALL y solo las capacidades permitidas)"
for combinacion in "producción:compose.yaml compose.prod.yaml compose.feruga.yaml" "pruebas:compose.yaml compose.test.yaml"; do
  nombre=${combinacion%%:*}
  set --
  for archivo in ${combinacion#*:}; do set -- "$@" -f "$archivo"; done
  if ! json=$(docker compose --env-file "$TEMP/entorno" --profile "*" "$@" config --format json 2>"$TEMP/compose.log"); then
    echo "   FALLA: compose config de $nombre"; cat "$TEMP/compose.log"; fallas=1; continue
  fi
  resultado=$(printf '%s' "$json" | docker run --rm -i "$NODE" node -e "$ENDURECIDO")
  if [ "$resultado" = ok ]; then echo "   ok: $nombre, todos los servicios con todos los perfiles"; else echo "   FALLA: $nombre: $resultado"; fallas=1; fi
done

exit $fallas
