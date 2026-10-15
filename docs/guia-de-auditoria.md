# Guía de auditoría

Para quien revise el proyecto (una persona u otro modelo, por ejemplo Codex). El objetivo es encontrar casos concretos en que el software haga algo distinto de lo que dice la especificación.

## Qué leer, en orden

1. `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md` (revisión 2) — qué debe hacer el sistema.
2. `docs/superpowers/plans/2026-10-07-hoja-de-ruta.md` — qué hito se está revisando y su lista de aceptación.
3. El plan detallado del hito, en `docs/superpowers/plans/` (para el Plan 1, el v2 del 2026-10-13; para el Plan 4, el del 2026-10-15). Su sección "Review Focus" lista las entradas riesgosas que deben tener prueba.
4. `docs/operacion.md` — cómo se levanta, respalda y muda el sistema.

## Cómo ejecutar

Solo se necesita Docker; nada se instala en la máquina.

```bash
cp .env.example .env                 # y llenar las contraseñas (solo letras y números)
scripts/verificar-todo.sh            # tipos, lint, unidad, integración con Postgres, punta a punta y búsqueda de secretos
```

Cada etapa por separado está en la tabla de comandos del plan vigente (§6). Las pruebas usan bases desechables y usuarios sintéticos; no tocan los datos de operación.

## Invariantes

Cada una debe cumplirse siempre. Si alguna falla, es un hallazgo.

| # | Invariante | Cómo comprobarla |
|---|---|---|
| 1 | Toda función exportada de `src/acciones/*.nucleo.ts` y `src/consultas/*.nucleo.ts` llama a `autorizar` con un permiso de la matriz antes de leer o escribir datos | Lectura del archivo; cada función tiene pruebas sin sesión, con usuario inactivo y con cada rol sin permiso |
| 2 | Toda entrada externa pasa por un esquema Zod en el servidor antes de escribirse | Lectura de `src/acciones`; pruebas de entrada inválida |
| 3 | Toda escritura deja un renglón en la bitácora con usuario, entidad, acción y nombres de campos, dentro de la misma transacción; si la bitácora falla no se escribe nada | Pruebas de rollback con PGlite y con Postgres real |
| 4 | Ningún componente de navegador ni pantalla accede a `src/datos` | `grep -rn '@/datos' src/app src/components` no devuelve nada |
| 5 | `src/dominio`, `src/motor` y `src/indicadores` son puros | `grep -rnE "@/datos\|@/seguridad\|from \"next\|better-auth\|Date\.now\|Math\.random\|new Date\(\)" src/dominio src/motor src/indicadores` no devuelve nada fuera de archivos de prueba |
| 6 | El motor es determinista | Prueba "misma semilla, mismo plan" |
| 7 | El motor no rutea solicitudes bloqueadas ni excede capacidad, turno o ventanas | Pruebas de propiedades del motor (especificación §12) |
| 8 | Una solicitud pospuesta conserva su hora de registro | Prueba de orden FIFO tras posponer |
| 9 | Un operador solo ve y modifica sus propias rutas | Pruebas de acciones con otro operador |
| 10 | El repositorio no contiene secretos ni datos reales de clientes | gitleaks en `scripts/verificar-todo.sh`; `git ls-files \| grep -i env` solo muestra `.env.example`; los datos semilla son sintéticos (gitleaks no detecta datos personales: se revisa a mano) |
| 11 | Guardar con una versión vieja no escribe nada y responde `conflicto` | Prueba de concurrencia con Postgres real |
| 12 | `rs_app` no puede modificar ni borrar `bitacora` ni `aceptaciones_privacidad` | Prueba de integración de permisos |
| 13 | El registro público está cerrado; un usuario desactivado no conserva sesiones ni puede crear nuevas | Pruebas de autenticación y de punta a punta |
| 15 | Solo `src/seguridad/identidades.ts` escribe en las tablas de Better Auth, siempre dentro de la transacción de quien llama | `grep -rn 'esquema-auth\|from "@/datos/esquema"' src` y revisión de usos de `user`, `account` y `session` |
| 16 | Toda petición HTTP a Better Auth pasa por `manejar`; una baja, reactivación o restablecimiento a media entrada no deja sesión viva | `src/app/api/auth/[...all]/route.ts` solo llama a `manejarPeticionDeAuth`; pruebas con pausas en `auth.integracion.test.ts` |
| 17 | Una restauración falla completa o se aplica completa, y no corre con la aplicación activa | `scripts/probar-restauracion.sh` |
| 14 | Todo se ejecuta en contenedores con versiones fijas | Ningún `@latest` ni imagen sin versión exacta en `Dockerfile`, `compose*.yaml` ni scripts |
| 18 | Una solicitud tiene a lo sumo una parada vigente, y una fecha a lo sumo un plan validado y un propuesto | Índices únicos parciales `paradas_solicitud_vigente`, `planes_un_validado_por_fecha` y `planes_un_propuesto_por_fecha`; `src/datos/plan4.integracion.test.ts` y las pruebas de concurrencia de `src/acciones/plan4.integracion.test.ts` |
| 19 | Validar un plan es todo o nada y vuelve a comprobar, con todo bloqueado, versiones, habilitación de clientes (incluida la privacidad), disponibilidad, capacidades de la flota y la hora actual | `src/acciones/plan.nucleo.ts` (orden de bloqueos del Plan 4, §4); pruebas `datos_cambiaron`, `cliente_no_habilitado`, `capacidades_cambiaron` y `hora_vencida` |
| 20 | Toda corrida del motor queda en `ejecuciones_motor`, aunque falle, se agote el tiempo o no se pueda guardar el plan, sin datos personales en el mensaje; `rs_app` no puede cambiarla ni borrarla | Pruebas de generar en `src/acciones/plan.nucleo.test.ts` y de permisos en `src/datos/plan4.integracion.test.ts` |
| 21 | Un ajuste manual nunca deja un plan que rompa capacidad, ventanas, turno o tipo de unidad | `ajustarPlan` comprueba con `validarPlan(…, { ajustadoAMano: true })`, que reconstruye cada ruta sin usar la admisión; pruebas de propiedades en `src/motor/ajustes.test.ts` |

## Qué intentar romper

- Horas alrededor de la medianoche y fechas en el cambio de día entre UTC y Ciudad de México.
- Clientes sin ubicación, sin ventanas el día pedido o con documentos que vencen justo hoy.
- Más solicitudes que capacidad: ¿se posponen las más recientes y solo esas?
- Zonas del motor con un solo cliente, todos los clientes en el mismo punto, una sola unidad disponible, ninguna unidad.
- Dos despachadores guardando el mismo cliente al mismo tiempo: el segundo debe recibir `conflicto`.
- Registrar el aviso de privacidad con una versión que ya cambió, o después de que otro despachador registró un movimiento: `conflicto`.
- Confirmar dos veces la misma importación, o confirmar después de que otro despachador agregó un cliente con el mismo nombre.
- Entrar con un usuario desactivado; reactivarlo y comprobar que no reviven sus sesiones anteriores.
- Identificadores mal formados en la URL y en las acciones.
- Archivos CSV con codificación distinta de UTF-8, columnas repetidas, campos multilínea, comillas sin cerrar, más de 2000 registros o más de 1 MB; reimportar la misma cartera (posibles duplicados).
- Borrar todos los contenedores y volver a levantarlos; restaurar un respaldo en una máquina limpia.
- Validar dos planes de fechas distintas que comparten solicitudes; validar mientras otro despachador cancela, reprograma, edita una unidad, asigna una jornada o el cliente retira su consentimiento.
- Validar el plan de hoy cuando la hora ya pasó la primera salida; ajustar a mano hasta dejar una ruta imposible.
- Generar dos veces la misma fecha a la vez, o generar mientras otro despachador ajusta la propuesta.

## Formato de un hallazgo

```
Archivo y línea:
Invariante o sección de la especificación:
Entrada o estado que lo provoca:
Qué hace el sistema:
Qué debería hacer:
Gravedad: bloquea el piloto | corrige antes del piloto | mejora
```

## Limitaciones conocidas (no son hallazgos)

- Los tiempos de traslado son estimados, no consultados a un servicio de mapas (especificación §4).
- El motor es una heurística explicable, no un optimizador (especificación §8).
- Sin tiempo real: las pantallas del despachador se refrescan por sondeo.
- Sin rastreo GPS continuo: solo se registran los eventos que marca el operador.
