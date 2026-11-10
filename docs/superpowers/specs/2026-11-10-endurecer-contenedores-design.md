# Contenedores sin privilegios y errores de Caddy con HSTS — diseño

- **Fecha:** 2026-11-10.
- **Pedido:** del Claude del servidor de producción:
  - los contenedores de Recycling no tienen `no-new-privileges` ni quitan las capacidades del sistema (`cap_drop`), y feruga sí;
  - `gestion.feruga.tech` responde 502 sin HSTS.
- **Base:** `main` en 760fd72.

## 1. Contenedores

Todos los servicios que corren en producción, y sus equivalentes de prueba, llevan:

- **`security_opt: ["no-new-privileges:true"]`:** ningún proceso gana privilegios al ejecutar otro programa (setuid ni capacidades de archivo).
- **`cap_drop: ["ALL"]`:** empiezan sin capacidades del sistema. Las que alguno necesita se devuelven una por una, con su motivo, y se comprobaron una por una el 2026-11-10.

| Servicio | Capacidades | Por qué (comprobado) |
|---|---|---|
| `db` | `CHOWN`, `DAC_READ_SEARCH`, `FOWNER`, `SETUID`, `SETGID` | El arranque oficial corre como root: recorre y ajusta el dueño de la carpeta de datos (de `postgres`, `0700`) y baja a `postgres` con su-exec. Sin `DAC_READ_SEARCH`: `find: Permission denied`. Probado con un volumen nuevo, uno existente, uno de otro dueño y el tmpfs de las pruebas. **Ya en marcha, Postgres no tiene ninguna capacidad** (`CapEff` en 0) |
| `respaldo` | `DAC_OVERRIDE` | Corre como root y escribe en `./respaldos`, que en el servidor es de otro usuario. Sin ella: `Permission denied` |
| `proxy-permisos` | `CHOWN`, `DAC_READ_SEARCH` | Cambia el dueño de los volúmenes de Caddy, cuyas carpetas son `0700`. Solo con `CHOWN` falla |
| `web`, `proxy`, `migrate`, `bootstrap`, `osrm`, `mapa-preparar`; en pruebas, `semilla`, `mapa-prueba-osm` y `mapa-prueba` | Ninguna | |

**Caddy.** El binario traía la capacidad de archivo `cap_net_bind_service=ep`, que la imagen oficial pone para usar los puertos 80 y 443 sin ser root. Con `cap_drop: ALL`, Linux no ejecuta un programa que pide una capacidad que ya no existe (`exec: operation not permitted`). Esa capacidad sobra: Docker ya deja a cualquier usuario del contenedor usar esos puertos. `infra/caddy/Dockerfile` se la quita (`setcap -r`), y Caddy corre como `caddy` sin ninguna capacidad, en 80 y 443 (comprobado).

**Fuera del alcance:**

- `compose.dev.yaml`: el servidor de desarrollo, en la computadora de quien programa.
- `unit`, `integration` y `e2e` de `compose.test.yaml`: herramientas de prueba; Chromium de Playwright usa su propio aislamiento.

En cada archivo, el bloque común es un ancla de YAML (`x-endurecido`).

## 2. Errores de Caddy con HSTS

Cuando el destino no responde, Caddy genera el error él mismo, y ahí no se aplican `header ?Strict-Transport-Security` ni `header -Server`. Comprobado el 2026-11-10: `502`, sin HSTS y con `server: Caddy`. Pasa en `gestion.feruga.tech` y también en Recycling, si `web` está caído.

Un fragmento `(errores)` del `Caddyfile`, con `handle_errors`, pone HSTS y quita `Server` en los errores. Lo importan el sitio de Recycling y `vecinos/feruga.caddy`. Comprobado: el 502 sale con `strict-transport-security` y sin `server`.

## 3. Pruebas

- **`scripts/probar-caddy.sh`**, paso 7 de `verificar-todo.sh`, agrega:
  - que cada nombre atendido tenga su ruta de errores con HSTS y sin `Server` (`caddy adapt`);
  - un 502 real, con Caddy sin capacidades y sin destino: `strict-transport-security` sí y `server` no;
  - en la combinación de Compose de producción con todos los perfiles, y en la de pruebas: cada servicio con `no-new-privileges` y `cap_drop: ALL`, y solo las capacidades de la tabla de §1.
- **`scripts/probar-produccion.sh` (nuevo)**, paso 8 de `verificar-todo.sh`:
  - levanta la combinación de producción con Caddy, con valores sintéticos y puertos altos;
  - comprueba que `db`, `web` y `proxy` corren con `NoNewPrivs: 1` y `CapEff` en 0;
  - comprueba que la entrada por HTTPS responde 200 con HSTS.

  Hasta ahora, ninguna prueba levantaba `compose.prod.yaml`.
- Además, integración, e2e, restauración y el ZAP de `seguridad.sh` corren ya con `db`, `migrate`, `semilla`, `osrm` y `web` endurecidos.

## 4. Al desplegar

Cambia la configuración de todos los contenedores, así que `docker compose up -d --build` los recrea todos: unos segundos sin servicio. La base conserva su volumen.

## 5. Reparto

- **Claude:** todo (Compose, `infra/`, `scripts/` y documentación).
- **Codex:** revisar.
