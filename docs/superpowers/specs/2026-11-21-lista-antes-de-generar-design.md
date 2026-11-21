# Lista "Antes de generar" en el plan del día — diseño

- **Fecha:** 2026-11-21.
- **Pedido del usuario:** quien opera el sistema registró operadores, unidades, solicitudes y jornadas, y el plan del día "no muestra nada". Pidió hacer el proceso más simple y amigable para alguien que no hizo el sistema, que siga siendo seguro y verificable, y lo antes posible.
- **Base:** `main` en 2bd0c6e.

## 1. Qué pasa hoy

El plan solo toma las solicitudes **listas** de esa fecha y las jornadas con unidad y operador **disponibles**. Si falta algo, el motor no tiene con qué trabajar y la pantalla queda vacía o con un mensaje suelto. La razón está repartida en otras pantallas (los contadores de Solicitudes, los "No disponibles" de Jornada, la Configuración), y quien opera no sabe dónde buscar.

## 2. Qué se agrega

Una lista **"Antes de generar"** en `/despacho/plan`, visible mientras la fecha no tenga plan o su propuesta no tenga rutas. Revisa la fecha elegida con las **mismas funciones** que usa el motor al generar, así que no hay reglas nuevas ni copias. Cada punto dice en lenguaje simple si está bien o qué falta, y enlaza a la pantalla donde se corrige.

| Punto | Bien | Falta o aviso |
|---|---|---|
| Patio | Está marcado | **Falta:** sin patio no se puede generar; lo marca el administrador en Configuración |
| Día | Es día de operación y no es pasado | **Falta:** ese día no se opera, o la fecha ya pasó; propone el siguiente día de operación |
| Camiones del día | Al menos una jornada con unidad y operador disponibles | **Falta:** no hay jornadas, o ninguna está disponible. **Aviso:** alguna jornada no está disponible. Lista la unidad u operador con su motivo y su ficha |
| Solicitudes | Al menos una lista para planear | **Falta:** ninguna lista. Lista los clientes con solicitudes bloqueadas, su motivo y su ficha; cuenta las que son para otra fecha |
| Camión y horario | Cada solicitud lista tiene un camión del día de un tipo que el cliente admite, con cupo para su carga y disponible antes de que cierre el horario del cliente | **Aviso:** algunas no; saldrán pospuestas. **Falta:** ninguna; el plan saldría sin rutas. Dice el motivo por cliente |
| Turno (solo hoy) | Quedan 3 horas o más | **Aviso:** quedan menos de 3 horas. **Falta:** el turno ya terminó. Propone el siguiente día de operación |

También revisa el tope de entrada del motor (300 solicitudes y 40 camiones): si se pasa, el plan se rechaza antes de correr el motor.

**Qué significa cada estado:**

- **Falta:** sin resolverlo, el plan no se puede generar o saldría sin rutas.
- **Aviso:** se puede generar, pero algo quedará fuera.

Arriba, un resumen: "Nada impide generar el plan" (no promete rutas: los traslados, el servicio y el regreso los calcula el motor, que pospone con su motivo lo que no alcance), "Se puede generar el plan. Revisa N avisos" o "Antes de generar, resuelve N puntos". El botón "Generar plan" no cambia: la lista orienta, no bloquea. El motor y la validación siguen siendo los que deciden.

**Cuándo se muestra:** sin plan, o con una propuesta sin rutas. Con rutas o con el plan validado no hace falta, y así la página no repite la lectura de la cartera que ya hizo la propuesta.

**Patio:** el enlace a Configuración solo aparece para quien puede abrirla (el administrador). A los demás, la lista les dice que se lo pidan.

## 3. Seguridad y privacidad

- Permiso `planes.ver`, el mismo de la pantalla del plan (administrador, despachador y gerencia).
- Solo muestra datos que esos roles ya ven: nombres de clientes, placas y nombres de operadores, y los motivos, nunca valores de documentos.
- Solo lectura: no escribe ni deja bitácora.

## 4. Archivos

- `src/consultas/preparacion.nucleo.ts`: la evaluación pura y la lectura con permiso. `src/consultas/preparacion.ts`: la consulta para la pantalla. Responsable: Claude.
- `src/components/preparacion/lista-preparacion.tsx` (carpeta nueva): la lista. Responsable: Claude.
- `src/app/despacho/plan/page.tsx` y `src/components/plan/plan-del-dia.tsx` (de Codex): un espacio para la lista debajo del encabezado. **Reasignado a Claude por la urgencia del usuario (2026-11-21); Codex lo revisa.**

## 5. Revisión de Codex del c0a26f9 (no aprobada)

1. "Todo listo" podía terminar en un plan vacío: no revisaba la capacidad ni el horario. Ahora lo hace el punto "Camión y horario", con la misma condición mínima que necesita el motor para insertar una solicitud.
2. No revisaba el tope de entrada del motor (300 y 40). Ahora sí.
3. "Falta" no siempre impedía generar. Ahora significa "no se puede generar o saldría sin rutas", y así lo dice el resumen.
4. La página repetía la lectura de la cartera en una propuesta con rutas. Ahora la lista solo se calcula sin plan o con una propuesta sin rutas.
5. El enlace a Configuración no servía al despachador. Ahora solo aparece para el administrador.
6. Las pruebas no ligaban "listo" con el resultado real. Ahora generan el plan y comprueban las rutas: una con "todo listo", ninguna con una carga que no cabe o un horario cerrado. El e2e revisa los estados de una fecha vacía.

Además, Claude corrigió el tiempo de turno de hoy antes de que empiece el turno: se cuenta desde el inicio del turno, como el motor.

**Revisión de Codex del 0ef176f** (no aprobada; confirmó los 6 anteriores atendidos):

1. "Todo listo" prometía rutas, pero la lista no calcula traslado, servicio ni regreso. El resumen ahora dice "Nada impide generar el plan" y que el motor pospone, con su motivo, lo que no alcance.
2. Una carga mayor que todo camión activo de sus tipos queda **bloqueada** en el motor, no pospuesta. Cada motivo dice ahora si saldrá pospuesta o quedará bloqueada.
3. Los enlaces llevan el nombre del cliente, la placa o el operador, para distinguirlos con lector de pantalla.

**Revisión de Codex del dc69afc** (no aprobada; confirmó atendidos el resumen y los enlaces): si el tipo no sale ese día y la carga supera todo camión activo de ese tipo, la lista decía "pospuesta" y el motor la bloquea. Ahora se revisa primero la capacidad de la flota completa, como el motor. Si no hay ningún camión activo de los tipos que admite, también queda bloqueada, salvo una carga de 0 kg (revisión del cd52909): el motor solo bloquea si la carga supera la capacidad, así que esa sale pospuesta.

## 6. Pruebas

- **De unidad, con datos hechos a mano:** cada punto, bien y mal, incluidas las fechas pasadas, el domingo, el turno terminado, el turno que todavía no empieza y el patio sin permiso para Configuración.
- **De integración, con base PGlite y el escenario del plan:**
  - sin patio;
  - todo listo;
  - cliente sin aviso;
  - solicitud para otra fecha;
  - carga que no cabe en la flota (bloqueada) o solo en los camiones de ese día (pospuesta), horario cerrado y tipo de camión (falta y aviso), generando el plan de verdad para comprobar que coincide;
  - más de 300 solicitudes listas;
  - el operador sin permiso.
- **De punta a punta:** una fecha vacía muestra qué falta, con sus estados y enlaces; con el plan validado, la lista no aparece.
