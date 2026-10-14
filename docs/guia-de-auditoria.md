# Guía de auditoría

Para quien revise el proyecto (una persona u otro modelo, por ejemplo Codex). El objetivo es encontrar casos concretos en que el software haga algo distinto de lo que dice la especificación.

## Qué leer, en orden

1. `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md` — qué debe hacer el sistema.
2. `docs/superpowers/plans/2026-10-07-hoja-de-ruta.md` — qué hito se está revisando y su lista de aceptación.
3. El plan detallado del hito, en `docs/superpowers/plans/`. Su sección "Review Focus" lista las entradas riesgosas que deben tener prueba.

## Cómo ejecutar

```bash
npm ci
npm run verificar        # tsc + eslint + pruebas unitarias y de integración (no requieren red ni cuentas)
npx playwright test      # pruebas de punta a punta; requieren .env.local con las llaves y el usuario de prueba
```

## Invariantes

Cada una debe cumplirse siempre. Si alguna falla, es un hallazgo.

| # | Invariante | Cómo comprobarla |
|---|---|---|
| 1 | Toda función exportada de `src/acciones/*.nucleo.ts` llama a `autorizar` antes de leer o escribir datos | Lectura del archivo; cada función tiene pruebas con rol equivocado y sin sesión |
| 2 | Toda entrada externa pasa por un esquema Zod en el servidor antes de escribirse | Lectura de `src/acciones`; pruebas de entrada inválida |
| 3 | Toda escritura deja un renglón en la bitácora con usuario, entidad y acción | Pruebas que consultan la tabla `bitacora` |
| 4 | Ningún componente de navegador accede a la base de datos | `grep -rl '"use client"' src \| xargs grep -n '@/datos'` no devuelve nada |
| 5 | `src/dominio`, `src/motor` y `src/indicadores` son puros | `grep -rnE "@/datos\|from \"next\|@clerk\|Date\.now\|Math\.random\|new Date\(\)" src/dominio src/motor src/indicadores` no devuelve nada fuera de archivos de prueba |
| 6 | El motor es determinista | Prueba "misma semilla, mismo plan" |
| 7 | El motor no rutea solicitudes bloqueadas ni excede capacidad, turno o ventanas | Pruebas de propiedades del motor (especificación §12) |
| 8 | Una solicitud pospuesta conserva su hora de registro | Prueba de orden FIFO tras posponer |
| 9 | Un operador solo ve y modifica sus propias rutas | Pruebas de acciones con otro operador |
| 10 | El repositorio no contiene secretos ni datos reales de clientes | `git ls-files \| grep -i env` solo muestra ejemplos; los datos semilla son sintéticos |

## Qué intentar romper

- Horas alrededor de la medianoche y fechas en el cambio de día entre UTC y Ciudad de México.
- Clientes sin ubicación, sin ventanas el día pedido o con documentos que vencen justo hoy.
- Más solicitudes que capacidad: ¿se posponen las más recientes y solo esas?
- Zonas del motor con un solo cliente, todos los clientes en el mismo punto, una sola unidad disponible, ninguna unidad.
- Dos despachadores guardando el mismo cliente al mismo tiempo. Limitación conocida: gana el último; no hay control de versiones.
- Identificadores mal formados en la URL y en las acciones.
- Archivos CSV con codificación distinta de UTF-8, columnas repetidas o más de mil renglones.

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
