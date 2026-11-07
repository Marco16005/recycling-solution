# Cambio de contraseña — diseño

- **Fecha:** 2026-11-07.
- **Pedido del usuario (2026-11-07):** arreglar lo que encontró el despliegue en el servidor. El administrador restableció su propia contraseña con el botón de la tabla, la sesión se le cerró antes de ver la temporal y se quedó fuera. Además, nadie puede cambiar su propia contraseña: "nunca lo tuvimos en cuenta pero es muy importante".
- **Base:** `main` en 954692d.

## 1. Problemas

1. **El administrador se deja fuera.** `restablecerClaveDeUsuario` acepta que el administrador se restablezca a sí mismo. `restablecerClave` borra todas las sesiones del usuario, incluida la del administrador, así que la respuesta con la contraseña temporal llega a una pantalla sin sesión. En la tabla, el botón aparece en su propia fila y no pide confirmación en ninguna fila: un clic equivocado deja a otro usuario sin acceso hasta que le entreguen la temporal.
2. **No existe "Cambiar mi contraseña".** Para cambiar la suya, cada usuario depende del administrador, que conoce todas las contraseñas temporales y puede seguir usándolas, porque nada obliga a cambiarlas.
3. **Better Auth expone más rutas de las que usamos.** `manejar` entrega a Better Auth cualquier ruta bajo `/api/auth`. Con sesión se puede llamar `/change-password`, `/update-user` o `/revoke-sessions`, que escriben en las tablas de autenticación sin bitácora y sin subir `usuarios.generacion`. Así se rompen dos reglas de la especificación (§10 y la guía de auditoría): solo `identidades.ts` escribe esas tablas y toda escritura lleva su bitácora.

## 2. Cambios

### 2.1 Restablecer a otro usuario (Claude)

- `restablecerClaveDeUsuario` rechaza al propio usuario con `invalido({ _: ["Tu propia contraseña se cambia en «Mi contraseña»"] })`, igual que ya se hace con el rol y la baja.
- En `tabla-usuarios.tsx`, el botón se desactiva en la fila propia (como "Desactivar") y lleva el mismo aviso.
- En las demás filas pide confirmación en la misma fila, sin diálogos del navegador: "¿Restablecer la contraseña de X? Se cerrarán sus sesiones." y dos botones, "Sí, restablecer" y "Cancelar".
- El recuadro de la temporal agrega: "Al entrar, el sistema le pedirá elegir una nueva."

### 2.2 Mi contraseña (Claude)

- **Pantalla `/cuenta/contrasena`** con layout propio y mínimo: nombre del sistema, nombre del usuario, "Volver" (a `/`) y Salir. Sirve a los cuatro roles y funciona en el teléfono del operador. Para el operador, Salir es `<SalirOperador />` (de Codex, solo se importa), que avisa si quedan eventos sin enviar antes de borrar lo guardado en el teléfono. Tiene tres campos:
  - "Contraseña actual" (`autocomplete="current-password"`);
  - "Nueva contraseña" (`new-password`), con el aviso "Entre 10 y 128 caracteres";
  - "Confirma la nueva" (`new-password`).

  Lleva además un campo oculto con el correo (`autocomplete="username"`) para que los gestores de contraseñas guarden la nueva.
- **Acción `cambiarMiClave(ctx, sesionId, entrada)`** en `src/acciones/cuenta.nucleo.ts`, con un envoltorio `"use server"` en `cuenta.ts`.
  1. Permiso nuevo `cuenta.cambiarClave` para todos los roles (§10).
  2. Zod:
     - la actual, no vacía y de 128 caracteres como máximo;
     - la nueva, entre 10 y 128;
     - la confirmación, igual a la nueva;
     - la nueva, distinta de la actual.
  3. Límite de frecuencia `clave`: 5 por minuto por usuario. Con una sesión robada no se puede adivinar la contraseña a ritmo libre, y el cálculo de scrypt no satura el proceso.
  4. En una transacción, `cambiarClavePropia` (en `identidades.ts`, el único módulo que escribe en las tablas de Better Auth):
     - toma la credencial con `FOR UPDATE` y verifica la actual con `verifyPassword` de `better-auth/crypto`; si no coincide, la acción responde `invalido({ actual: ["La contraseña actual no es correcta"] })` y no escribe nada;
     - guarda el hash nuevo, sube `generacion` y pone `debe_cambiar_clave = false`;
     - borra las demás sesiones del usuario y conserva la actual;
     - escribe la bitácora `cambiar_clave` con los campos `["clave"]`.
  5. No sube `usuarios.version`: no cambia nada de lo que muestra la tabla de administración, y subirla haría fallar por conflicto una acción del administrador sin motivo visible.
- **`sesionId`.** `src/seguridad/sesion.ts` agrega `contextoConSesion()`, que devuelve el contexto y el id de la sesión de Better Auth de la petición.
- **Respuesta.** Tras un cambio obligatorio, la pantalla va a `/`, que redirige al inicio de cada rol. Si no era obligatorio, muestra "Listo. Tu contraseña cambió y cerramos tus otras sesiones."

### 2.3 Cambio obligatorio después de una contraseña temporal (Claude)

- **Columna `usuarios.debe_cambiar_clave`** (`boolean not null default false`), en la migración `0012`.
- **Regla:** una contraseña que pone otra persona desde la aplicación es temporal.
  - `crearIdentidad` y `restablecerClave` ponen `debe_cambiar_clave = (por !== null)`.
  - Los scripts (`bootstrap`, `alta-usuario`, `restablecer-clave` y la semilla de e2e) pasan `por = null`. Los ejecuta el dueño del servidor y no obligan el cambio. Quien reciba una contraseña así la cambia en "Mi contraseña".
- **Cumplimiento en el servidor, no solo en pantalla:**
  - `UsuarioSesion` agrega `debeCambiarClave?: boolean`. Es opcional para no tocar los datos de prueba existentes; si falta, vale `false`.
  - `puede()` niega todo permiso salvo `cuenta.cambiarClave` mientras sea `true`, también al administrador. Toda acción y consulta queda cerrada hasta el cambio, aunque se llame directo.
  - `usuarioDeLaSesion()`, que usan todos los layouts y `/`, redirige a `/cuenta/contrasena`. La pantalla de cuenta usa otra consulta, `cuentaDeLaSesion()`, que no redirige.
  - **Operador sin conexión:** si una acción se niega, `mi-ruta.tsx` ya conserva la cola ("No se pudo autorizar el envío. Conservamos la cola"). Al cambiar la contraseña, la cola se envía sola.
- **`proxy.ts`** agrega `/cuenta` y `/admin` a las rutas que exigen cookie. Hoy `/admin` solo se protege en el layout; el resultado es el mismo, pero llega antes.

### 2.4 Solo las rutas de Better Auth que usamos (Claude)

`manejar` deja pasar solo tres rutas y responde 404 a las demás:

| Método | Ruta | Quién la usa |
|---|---|---|
| `POST` | `/sign-in/email` | `formulario-entrar.tsx` |
| `POST` | `/sign-out` | `boton-salir.tsx` y `salida-pendiente.ts` |
| `GET` | `/get-session` | el cliente de Better Auth |

`getSession` del servidor no pasa por HTTP. Las pruebas del registro público cerrado (`auth.integracion.test.ts` y `e2e/autenticacion.spec.ts`) pasan de esperar 400 a esperar 404. La especificación §10 se actualiza.

### 2.5 Enlace "Mi contraseña" (Claude y Codex)

- Claude crea `src/components/sesion/enlace-cuenta.tsx` (`<EnlaceCuenta />`, un `Link` a `/cuenta/contrasena`) y lo pone en los layouts de `admin` y `gerencia`.
- **Codex** lo pone junto a Salir en `src/app/despacho/layout.tsx` (`SesionDespacho`) y en `src/app/operador/layout.tsx` (encabezado).
- `AGENTS.md` asigna `src/app/cuenta` a Claude.

## 3. Qué no cambia

- **Lo que hace restablecer a otro usuario:** contraseña aleatoria de 20 caracteres, mostrada una vez, sesiones del usuario borradas y bitácora `restablecer_clave`.
- **El modelo de generación:** cada cambio de credencial la sube, y una entrada en curso con la contraseña anterior no crea sesión.
- **La recuperación sin correo:** sigue siendo el administrador o el script `restablecer-clave`. No hay "olvidé mi contraseña" por correo porque el piloto no envía correos.

## 4. Pruebas

- **Unidad:**
  - `puede()` con `debeCambiarClave` niega todo menos `cuenta.cambiarClave`, también a admin;
  - el esquema rechaza una nueva corta, una larga, una igual a la actual o una confirmación distinta;
  - las rutas permitidas de `manejar`.
- **Integración** con Postgres:
  1. El administrador no puede restablecerse; a otro sí, y ese usuario queda con `debe_cambiar_clave`.
  2. `cambiarMiClave`:
     - con la actual equivocada, no escribe nada;
     - con la correcta, la contraseña vieja ya no entra y la nueva sí;
     - la sesión actual sigue y las otras se borran;
     - sube la generación, deja la bitácora `cambiar_clave` con el campo `clave` y limpia `debe_cambiar_clave`.
  3. El sexto intento en un minuto se rechaza (con el límite encendido).
  4. `/change-password`, `/update-user`, `/revoke-sessions` y `/sign-up/email` responden 404 y no escriben.
  5. La migración 0012 aplica sobre una base con datos.
- **e2e** (`admin.spec.ts` y `autenticacion.spec.ts`):
  1. El administrador crea un usuario. Con la temporal, ese usuario cae en `/cuenta/contrasena`; si intenta ir a `/despacho/clientes`, vuelve ahí. Cambia la contraseña y llega a su inicio. La temporal ya no entra y la nueva sí.
  2. En la fila propia, el botón de restablecer está desactivado.
  3. En otra fila, pide confirmación y Cancelar no hace nada.
  4. Un usuario cambia su contraseña desde el enlace "Mi contraseña", sin ser obligatorio.
- **Cierre:** `verificar-todo.sh` y `scripts/seguridad.sh` en verde (ZAP con sesión recorre la pantalla nueva). Codex y Claude validan el mismo commit.

## 5. Reparto

- **Claude:**
  - `src/seguridad` (`permisos.ts`, `identidades.ts`, `sesion.ts`, `auth-base.ts` y `limites.ts`);
  - `src/datos/esquema.ts` y `drizzle/0012_…`;
  - `src/acciones` (`usuarios.nucleo.ts`, `cuenta.nucleo.ts` y `cuenta.ts`);
  - `src/consultas/sesion.ts`;
  - `src/app/cuenta`, `src/components/sesion` y `src/components/admin/tabla-usuarios.tsx`;
  - los layouts de `admin` y `gerencia` y `src/proxy.ts`;
  - las pruebas y las e2e de autenticación y administración;
  - la especificación §10, la guía de auditoría y `AGENTS.md`.
- **Codex:**
  - `<EnlaceCuenta />` en los layouts de `despacho` y `operador`;
  - revisar este diseño y el commit final.
