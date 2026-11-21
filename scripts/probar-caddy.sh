#!/bin/sh
# Configuración de Caddy y de Compose, sin compilar Caddy ni levantar nada (diseño del 2026-11-09, vecino feruga):
# - el Caddyfile es válido sin la carpeta de vecinos, con la carpeta vacía y con la del repositorio, y solo en el último
#   caso atiende gestion.feruga.tech;
# - sin compose.feruga.yaml, proxy no está en feruga-entrada ni monta los vecinos; con él, sí, y la red es externa;
# - los errores de cada sitio llevan HSTS y quitan Server, y cada servicio corre sin privilegios (2026-11-10);
# - cada nombre contesta cada método como dice la invariante 40 de la guía de auditoría (405 con Allow, 301 o 501 en
#   Caddy, antes que la aplicación), y ningún servidor anuncia HTTP/3 (prueba externa del 2026-11-11).
# Usa la imagen oficial de Caddy de la misma versión que la base de infra/caddy/Dockerfile: el binario propio solo
# cambia versiones de dependencias, no cómo se lee el Caddyfile.
set -eu
cd "$(dirname "$0")/.."

CADDY=$(sed -n 's/^FROM \(caddy:[0-9.]*-alpine\)$/\1/p' infra/caddy/Dockerfile)
NODE=node:24.22.3-trixie-slim
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

# Invariante 40 (prueba externa del 2026-11-11): simula el orden de las rutas de Caddy con cada método y varias rutas, en
# cada nombre, y exige exactamente:
# - DOMINIO: GET, HEAD y POST a la aplicación (web:3000); cualquier otro método, 405 con «Allow: GET, HEAD, POST»;
# - DOMINIO_ALTERNO: GET, HEAD y POST, 301 a https://DOMINIO con la misma ruta; los demás, el mismo 405 (redir va
#   antes que respond);
# - vecinos: TRACE y TRACK, 501; lo demás pasa a su proxy (gestion.feruga.tech, feruga-proxy:80), que decide sus métodos.
#   Un vecino nuevo hace fallar la prueba hasta que se agregue aquí con su destino.
# También falla si algún servidor no va solo con HTTP/1.1 y HTTP/2 (el 443 se publica solo por TCP). Revisar solo que
# «existiera» un 405 dio un falso verde (revisión de Codex). Recibe DOMINIO y DOMINIO_ALTERNO; imprime los nombres que
# cumplen, o «FALLA …» con el detalle.
METODOS='let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  const [principal, alterno] = process.argv.slice(1);
  const coincide = (conjunto, p) => Object.entries(conjunto).every(([tipo, valor]) => {
    if (tipo === "host") return valor.includes(p.host);
    if (tipo === "method") return valor.includes(p.metodo);
    if (tipo === "path") return valor.some((x) => (x.endsWith("*") ? p.ruta.startsWith(x.slice(0, -1)) : x === p.ruta));
    if (tipo === "not") return !valor.some((c) => coincide(c, p));
    throw new Error("la prueba no sabe simular el matcher de Caddy «" + tipo + "»");
  });
  // Quién contesta, en el orden de Caddy, con su destino: «405», «301 <Location>», «proxy <destino>» o «vacía». Los
  // «headers» no contestan, pero se anotan sus encabezados (Allow).
  const contesta = (rutas, p, encabezados) => {
    const grupos = new Set();
    for (const r of rutas ?? []) {
      if (r.group && grupos.has(r.group)) continue;
      if (r.match && !r.match.some((c) => coincide(c, p))) continue;
      if (r.group) grupos.add(r.group);
      for (const h of r.handle ?? []) {
        if (h.handler === "headers") Object.assign(encabezados, h.response?.set ?? {});
        else if (h.handler === "static_response") {
          const destino = h.headers?.Location;
          return String(h.status_code ?? 200) + (destino ? " " + [].concat(destino).join(", ") : "");
        }
        else if (h.handler === "reverse_proxy") return "proxy " + (h.upstreams ?? []).map((u) => u.dial).join(", ");
        else if (h.handler === "subroute") {
          const x = contesta(h.routes, p, encabezados);
          if (x) return x;
        }
      }
      if (r.terminal) return "vacía";
    }
    return null;
  };
  const USADOS = ["GET", "HEAD", "POST"], OTROS = ["TRACE", "TRACK", "PUT", "DELETE", "PATCH", "OPTIONS", "CONNECT"];
  const RUTAS = ["/", "/entrar", "/_next/static/chunks/a.js", "/favicon.ico", "/api/auth/sign-in/email"];
  const PROHIBIDO = "405 Allow=GET, HEAD, POST", VECINOS = { "gestion.feruga.tech": "feruga-proxy:80" };
  const esperado = (host, metodo) => {
    if (host === principal || host === alterno) {
      if (!USADOS.includes(metodo)) return PROHIBIDO;
      return host === principal ? "proxy web:3000" : "301 https://" + principal + "{http.request.uri}";
    }
    if (["TRACE", "TRACK"].includes(metodo)) return "501";
    return "proxy " + (VECINOS[host] ?? "(vecino sin destino en esta prueba)");
  };
  const problemas = [], nombres = new Set();
  for (const [id, s] of Object.entries(JSON.parse(t).apps.http.servers)) {
    if (JSON.stringify(s.protocols) !== JSON.stringify(["h1", "h2"])) problemas.push(id + " con protocolos " + JSON.stringify(s.protocols ?? "por omisión (h1 h2 h3)"));
    for (const r of s.routes ?? []) for (const m of r.match ?? []) for (const host of m.host ?? []) {
      let cumple = true;
      for (const metodo of [...USADOS, ...OTROS]) for (const ruta of RUTAS) {
        const encabezados = {}, x = contesta(s.routes, { host, metodo, ruta }, encabezados);
        const obtenido = x === "405" ? "405 Allow=" + [].concat(encabezados.Allow ?? "(sin Allow)").join(", ") : x;
        const debe = esperado(host, metodo);
        if (obtenido !== debe) {
          cumple = false;
          problemas.push(host + ": " + metodo + " " + ruta + " contestado con «" + obtenido + "», se esperaba «" + debe + "»");
        }
      }
      if (cumple) nombres.add(host);
    }
  }
  if (problemas.length) console.log("FALLA " + problemas.slice(0, 4).join("; ") + (problemas.length > 4 ? "; y " + (problemas.length - 4) + " más" : ""));
  else console.log([...nombres].sort().join(" "));
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
  metodos=$(docker run --rm -i "$NODE" node -e "$METODOS" "$DOMINIO" "$ALTERNO" < "$TEMP/adaptado.json")
  if [ "$nombres" != "$3" ]; then
    echo "   FALLA: $1: atiende «${nombres}», se esperaba «${3}»"
    fallas=1
  elif [ "$errores" != "$3" ]; then
    echo "   FALLA: $1: sus errores llevan HSTS y quitan Server solo en «${errores}», se esperaba «${3}»"
    fallas=1
  elif [ "$metodos" != "$3" ]; then
    case "$metodos" in
      FALLA*) echo "   FALLA: $1: ${metodos#FALLA }" ;;
      *) echo "   FALLA: $1: los métodos cumplen la invariante 40 solo en «${metodos}», se esperaba «${3}»" ;;
    esac
    fallas=1
  else
    echo "   ok: $1 ($nombres; errores con HSTS; métodos según la invariante 40; sin HTTP/3)"
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

# Endurecimiento (2026-11-10): cada servicio sin privilegios nuevos y sin capacidades, salvo exactamente las de esta lista. Fuera:
# unit, integration y e2e de compose.test.yaml (herramientas de prueba; Chromium usa su propio aislamiento).
ENDURECIDO='let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  const permitidas = { db: ["CHOWN", "DAC_READ_SEARCH", "FOWNER", "SETGID", "SETUID"], respaldo: ["DAC_OVERRIDE"], "proxy-permisos": ["CHOWN", "DAC_READ_SEARCH"] };
  const fuera = new Set(["unit", "integration", "e2e"]);
  const problemas = [];
  for (const [nombre, s] of Object.entries(JSON.parse(t).services)) {
    if (fuera.has(nombre)) continue;
    if (!(s.security_opt ?? []).includes("no-new-privileges:true")) problemas.push(nombre + " sin no-new-privileges");
    if (JSON.stringify(s.cap_drop ?? []) !== JSON.stringify(["ALL"])) problemas.push(nombre + " sin cap_drop ALL");
    // Exactamente las de la lista: de más es un privilegio que sobra; de menos, un servicio que no arrancaría.
    const tiene = [...(s.cap_add ?? [])].sort().join(","), debe = [...(permitidas[nombre] ?? [])].sort().join(",");
    if (tiene !== debe) problemas.push(nombre + " con capacidades «" + tiene + "», se esperaban «" + debe + "»");
  }
  console.log(problemas.length ? problemas.join("; ") : "ok");
});'
echo "   -- Endurecimiento (no-new-privileges, cap_drop ALL y exactamente las capacidades permitidas)"
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
