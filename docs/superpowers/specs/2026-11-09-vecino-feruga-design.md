# Feruga detrás del Caddy de Recycling — diseño

- **Fecha:** 2026-11-09.
- **Pedido:** del Claude del servidor de producción, que lo ensayó con un simulacro de feruga (`ensayo.sh` y `ensayo-publicacion.sh --detras-de-otro-proxy`: 45 de 45 y 130 de 130 comprobaciones, con Recycling respondiendo en 0.04 s promedio).
- **Base:** `main` en f10d904.

## 1. Qué se quiere

En el servidor de producción vivirá también feruga, el sistema de gestión de la recicladora, en `gestion.feruga.tech`. El Caddy de Recycling sigue siendo la única puerta en 80 y 443:

- obtiene el certificado de `gestion.feruga.tech`;
- pasa ese tráfico al proxy de feruga (`feruga-proxy:80`) por una red de Docker interna, `feruga-entrada`, que solo comparten los dos proxies.

El cambio es **opcional**: solo se activa en ese servidor. En las máquinas de desarrollo y en las pruebas, la red no existe y ese certificado no debe pedirse.

## 2. Cambios

1. **`compose.feruga.yaml` (nuevo):**
   - el servicio `proxy` queda en las redes `default` y `feruga-entrada`;
   - monta `./infra/caddy/vecinos` en `/etc/caddy/vecinos`, solo de lectura;
   - declara `feruga-entrada` como `external: true`.

   Se monta la carpeta y no el archivo: `git pull` cambia los archivos dentro de la carpeta montada, y basta `caddy reload`, sin recrear el contenedor (puede cerrar conexiones largas, como WebSockets). Con un archivo suelto, el montaje seguiría apuntando al archivo viejo.
2. **`infra/caddy/Caddyfile`:** una última línea `import /etc/caddy/vecinos/*.caddy`. Si la carpeta no está montada o está vacía, Caddy solo avisa («No files matching import glob pattern») y la configuración es válida (comprobado con 2.11.9).
3. **`infra/caddy/vecinos/feruga.caddy`:**

   ```caddyfile
   gestion.feruga.tech {
       header -Server
       header ?Strict-Transport-Security "max-age=31536000"
       reverse_proxy feruga-proxy:80
   }
   ```

   Respecto al pedido, se agregan dos líneas, por la misma política que Recycling (plan de seguridad §7):
   - **`header -Server`:** no anuncia el servidor;
   - **HSTS:** solo si feruga no lo manda.

   No se comprime nada; la decisión de BREACH es de feruga. El resto de los encabezados (CSP, marcos y demás) también lo pone feruga.
4. **`docs/operacion.md` §9:** cómo activarlo, comprobarlo y volver atrás. Detalles en §3.
5. **`scripts/probar-caddy.sh` (nuevo), paso 7 de `verificar-todo.sh`:**
   - **Caddyfile:** lo valida con la imagen oficial de la misma versión que `infra/caddy/Dockerfile` (su base), sin compilar Go:
     - con `DOMINIO=localhost`, y con `feruga.tech` más el alterno `www`;
     - sin carpeta de vecinos, con la carpeta vacía y con la del repositorio.

     La ruta de `gestion.feruga.tech` solo debe aparecer en el último caso.
   - **Compose:** combina `compose.yaml`, `compose.prod.yaml` y el perfil `caddy`, con valores sintéticos, con y sin `compose.feruga.yaml`. Sin él, `proxy` no está en `feruga-entrada` ni monta los vecinos; con él, sí, y la red es externa.

## 3. Riesgos y cómo se evitan

| Riesgo | Qué se hace |
|---|---|
| Se agrega `compose.feruga.yaml` antes de crear la red: `proxy` no arranca y Recycling queda sin entrada | El procedimiento crea la red y la comprueba (`docker network inspect`) antes de tocar `COMPOSE_FILE`. Para volver atrás, se quita de `COMPOSE_FILE` y se recrea el proxy |
| Recrear el proxy reinicia también `web` | `docker compose up -d --force-recreate --no-deps proxy` |
| `gestion.feruga.tech` sin DNS hacia el servidor | Caddy no obtiene ese certificado y lo reintenta en el log; `feruga.tech` sigue igual. El DNS se configura antes |
| Feruga confía en cualquier `X-Forwarded-For` | Caddy reemplaza el de los clientes con la IP real. El proxy de feruga debe confiar en ese encabezado solo si viene del Caddy de Recycling por `feruga-entrada` |
| Feruga llega a Recycling por la red compartida | `feruga-entrada` solo tiene a los dos proxies. Desde ahí, feruga llega al Caddy de Recycling como cualquier cliente de internet; `web` y `db` siguen solo en la red `default` |
| Hasta que feruga se publique | `gestion.feruga.tech` responde 502, con certificado válido. Es lo esperado |

## 4. Reparto

- **Claude:** todo lo de §2; son archivos raíz, `infra/`, `scripts/` y `docs/`.
- **Codex:** revisar el diseño y el commit.
