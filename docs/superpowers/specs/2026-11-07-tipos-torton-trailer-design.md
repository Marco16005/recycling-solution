# Tipos de unidad torton y tráiler — diseño

- **Fecha:** 2026-11-07.
- **Pedido del usuario (2026-11-07):** "manejas camionetas, doble rodadas y rabones, pero también debes manejar torton y tráiler".
- **Base:** `main` en 063c864.

## 1. Cambio

`TIPOS_UNIDAD` pasa de 3 a 5 tipos. Los nuevos van al final, para no mover el orden de los existentes en listas, CSV y pruebas.

| Clave | Etiqueta |
|---|---|
| `doble_rodada` | Doble rodada |
| `rabon` | Rabón |
| `camioneta` | Camioneta |
| `torton` | Torton |
| `trailer` | Tráiler |

## 2. Qué no cambia (y por qué es seguro)

- **Asignación.** El motor solo asigna a un cliente unidades de los tipos que el cliente admite explícitamente (`tiposUnidadAdmitidos`), y un cliente sin tipos queda bloqueado (`sin_tipos_unidad`). Ningún cliente existente recibe un torton o un tráiler hasta que alguien lo marque en su ficha. Esto importa por las calles angostas y los accesos donde no entra un tractocamión.
- **Capacidad.** Es de cada unidad, entre 1 y 60 000 kg (esquema y Zod), y alcanza para un tráiler. No hay capacidades por omisión por tipo.
- **Documentos.** El catálogo no depende del tipo de unidad. Lo que pida un tráiler, como un permiso federal, se agrega como documento de la unidad, igual que hoy.

## 3. Detalles

1. **Base de datos (Claude).** La migración `0011` agrega `torton` y `trailer` al tipo `tipo_unidad` con `ALTER TYPE … ADD VALUE`. En Postgres 17 puede ir dentro de la transacción del migrador, porque los valores nuevos no se usan en ella. Se actualiza el esquema de Drizzle.
2. **Planes guardados (Claude).** Las propuestas generadas antes traen `capacidadMaximaPorTipoKg` con 3 tipos. Al validar se comparan las capacidades en la unión de los tipos guardados y los actuales, con 0 cuando falta uno. Así, agregar el primer torton después de generar la propuesta sí cuenta como cambio de capacidades.
3. **Dominio y motor (Codex).**
   - `capacidadMaximaPorTipo` arma su registro a partir de `TIPOS_UNIDAD`, no de un literal.
   - Las etiquetas incluyen los tipos nuevos.
   - `scripts/simular.mts` y los datos de prueba listan los 5 tipos.
4. **CSV (Codex).** La columna `tipos_unidad` acepta, además de las claves, la etiqueta sin importar acentos, mayúsculas ni espacios (`Tráiler`, `Rabón`, `Doble rodada`), porque así la escriben en Excel. Exportar sigue escribiendo las claves.

## 4. Pruebas

- **Dominio:** los esquemas aceptan los tipos nuevos; las etiquetas están completas; el CSV lee las etiquetas con acentos y rechaza un tipo desconocido.
- **Motor:** una solicitud cuyo cliente admite solo `trailer` va a la unidad tráiler y nunca a otra; un cliente sin `trailer` nunca recibe el tráiler.
- **Integración (Claude):** la migración aplica sobre una base con datos; se guardan unidades `torton` y `trailer` y un cliente que las admite; validar una propuesta con capacidades de 3 tipos detecta que se agregó un torton.
- `verificar-todo.sh` y `scripts/seguridad.sh` en verde. Codex y Claude validan el mismo commit.

## 5. Reparto

- **Claude:**
  - `src/datos/esquema.ts` y `drizzle/0011_…`;
  - `src/acciones/plan-comun.ts`;
  - `e2e/ayudas/calles.ts` y `src/acciones/limite-motor.integracion.test.ts` (sus literales);
  - integración y documentación.
- **Codex:**
  - `src/dominio/clientes/tipos.ts`, `etiquetas.ts` y `csv.ts`;
  - `src/dominio/plan/entrada.ts`;
  - `src/motor` (pruebas y datos de prueba);
  - `scripts/simular.mts` y sus pruebas.
