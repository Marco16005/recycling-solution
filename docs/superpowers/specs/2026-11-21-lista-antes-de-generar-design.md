# Lista "Antes de generar" en el plan del día — diseño

- **Fecha:** 2026-11-21.
- **Pedido del usuario:** quien opera el sistema registró operadores, unidades, solicitudes y jornadas, y el plan del día "no muestra nada". Pidió hacer el proceso más simple y amigable para alguien que no hizo el sistema, que siga siendo seguro y verificable, y lo antes posible.
- **Base:** `main` en 2bd0c6e.

## 1. Qué pasa hoy

El plan solo toma las solicitudes **listas** de esa fecha y las jornadas con unidad y operador **disponibles**. Si falta algo, el motor no tiene con qué trabajar y la pantalla queda vacía o con un mensaje suelto. La razón está repartida en otras pantallas (los contadores de Solicitudes, los "No disponibles" de Jornada, la Configuración), y quien opera no sabe dónde buscar.

## 2. Qué se agrega

Una lista **"Antes de generar"** en `/despacho/plan`, visible mientras la fecha no tenga un plan validado. Revisa la fecha elegida con las **mismas funciones** que usa el motor al generar, así que no hay reglas nuevas ni copias. Cada punto dice en lenguaje simple si está bien o qué falta, y enlaza a la pantalla donde se corrige.

| Punto | Bien | Falta o aviso |
|---|---|---|
| Patio | Está marcado | **Falta:** sin patio no se puede generar; lo marca el administrador en Configuración |
| Día | Es día de operación y no es pasado | **Falta:** ese día no se opera, o la fecha ya pasó; propone el siguiente día de operación |
| Camiones del día | Al menos una jornada con unidad y operador disponibles | **Falta:** no hay jornadas, o ninguna está disponible. **Aviso:** alguna jornada no está disponible. Lista la unidad u operador con su motivo y su ficha |
| Solicitudes | Al menos una lista para planear | **Falta:** ninguna lista. Lista los clientes con solicitudes bloqueadas, su motivo y su ficha; cuenta las que son para otra fecha |
| Tipo de camión | Cada cliente con solicitud lista admite algún tipo de los camiones del día | **Aviso:** el cliente y los tipos que admite |
| Turno (solo hoy) | Quedan 3 horas o más | **Aviso:** quedan menos de 3 horas. **Falta:** el turno ya terminó. Propone el siguiente día de operación |

Arriba, un resumen: "Listo para generar" o "Antes de generar, revisa N puntos". El botón "Generar plan" no cambia: la lista orienta, no bloquea. El motor y la validación siguen siendo los que deciden.

## 3. Seguridad y privacidad

- Permiso `planes.ver`, el mismo de la pantalla del plan (administrador, despachador y gerencia).
- Solo muestra datos que esos roles ya ven: nombres de clientes, placas y nombres de operadores, y los motivos, nunca valores de documentos.
- Solo lectura: no escribe ni deja bitácora.

## 4. Archivos

- `src/consultas/preparacion.nucleo.ts`: la evaluación pura y la lectura con permiso. `src/consultas/preparacion.ts`: la consulta para la pantalla. Responsable: Claude.
- `src/components/preparacion/lista-preparacion.tsx` (carpeta nueva): la lista. Responsable: Claude.
- `src/app/despacho/plan/page.tsx` y `src/components/plan/plan-del-dia.tsx` (de Codex): un espacio para la lista debajo del encabezado. **Reasignado a Claude por la urgencia del usuario (2026-11-21); Codex lo revisa.**

## 5. Pruebas

- **De unidad, con datos hechos a mano:** cada punto, bien y mal, incluidas las fechas pasadas, el domingo, el turno terminado y la incompatibilidad de tipos.
- **De integración, con base PGlite y el escenario del plan:**
  - sin patio;
  - todo listo;
  - cliente sin aviso;
  - solicitud para otra fecha;
  - el operador sin permiso.
- **De punta a punta:** la pantalla muestra la lista y el punto que falta.
