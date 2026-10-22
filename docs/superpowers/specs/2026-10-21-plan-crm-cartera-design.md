# Plan CRM — Cartera lista para operar y con plus (diseño)

- **Fecha:** 2026-10-21.
- **Revisión:** 1.1. Incorpora los 7 hallazgos de Codex del 2026-10-21 (§10); el usuario ya había aprobado la 1.
- **Base:** `main` en f89983c (Planes 1 a 7 validados). Este plan va **antes** del Plan 8; el Plan 8 queda escrito y en espera.
- **Lo que pidió el usuario (2026-10-21):**
  - Revisar el CRM antes de seguir y hacer un plan con los diez puntos propuestos, porque "todos pueden hacer una diferencia".
  - Las solicitudes recurrentes se **proponen y se confirman**, nunca se crean solas.
  - Hoy los clientes piden por llamada o mensaje "cuando llenan sus contenedores": el ritmo es irregular, no un día fijo (lo dijo sin certeza total).
- **Decisiones de Claude (corregibles):** están marcadas "decisión de Claude" en cada punto.

## 1. Para qué

El CRM del Plan 1 cumple el alcance del piloto, pero le faltan tres cosas para cargar la cartera real y operar con ella: importar fichas completas, ubicar clientes sin coordenadas y ver su historial. Además, puede dar un plus en el día a día del despachador:
- proponer las recolecciones que se vienen, lo que baja el tiempo de captura (K2, objetivo de 30 % de la tesis);
- mostrar números por cliente;
- un mapa de la cartera;
- varios contactos, notas de seguimiento, exportación y filtros.

**Éxito:**
- La cartera real de la recicladora se carga desde un Excel sin completar a mano cliente por cliente.
- El despachador ve en su pantalla de solicitudes a quién probablemente le toca recolección y la confirma con un clic.

## 2. Metas, no metas y antimetas

**Metas** (los 10 puntos):
1. Importación completa con plantilla descargable.
2. Ubicar con el enlace o el texto que manda el cliente.
3. Historial del cliente.
4. Propuestas de recolección.
5. Números por cliente.
6. Mapa de la cartera.
7. Varios contactos.
8. Notas de seguimiento.
9. Exportar.
10. Filtros.

**No metas:**
- Integración con WhatsApp: se pega el enlace, no hay conexión.
- Geocodificar direcciones escritas: requeriría un servicio externo; queda para después del piloto.
- Fusionar duplicados.
- Notificaciones automáticas.
- Portal para clientes.

**Antimetas:**
- Crear solicitudes sin que el despachador las confirme.
- Que una exportación saque datos sin dejar rastro.
- Que el ritmo aprendido proponga clientes que ya tienen una solicitud abierta, que no están habilitados o que están inactivos.
- Romper la importación de hoy: los CSV con las columnas actuales siguen funcionando.

## 3. Restricciones

Rigen las de siempre (AGENTS.md):
- Docker y versiones exactas.
- Cada acción y consulta autoriza con un permiso.
- Toda escritura va en una transacción con su renglón de bitácora, que guarda nombres de campos y nunca valores.
- Solo datos sintéticos en el repositorio.
- Textos en español.
- Lo que se lee de la base va dentro de `<Suspense>`.

Datos personales (contactos y notas): solo los ve quien hoy ve clientes (`clientes.ver`); el abogado revisa los textos del aviso (§5).

## 4. Lo que se decidió de cada punto

### 4.1 Importación completa (punto 1)

- **Columnas nuevas del CSV** (todas opcionales, en minúsculas; las actuales siguen igual):
  - `horarios`, por ejemplo `lun-vie 08:00-14:00; sab 09:00-12:00`. Días `lun mar mie jue vie sab dom` (con o sin acento), rangos con guion y varias franjas separadas por `;`.
  - `tipos_unidad`: `doble_rodada|rabon|camioneta`, separados por `|`.
  - `notas_acceso`.
  - `ubicacion`: un enlace o texto del §4.2, como alternativa a `lat` y `lng`. Si vienen las dos y no coinciden, la fila marca error.
    - *Decisión de Claude:* en el CSV no se aceptan enlaces cortos, para no consultar a Google por cada fila al analizar. La fila marca "Enlace corto: pégalo en la ficha o copia el enlace largo".
  - `correo` y `puesto` del contacto principal.
- **Plantilla:** descargable desde la pantalla de importación, con BOM, CRLF y una fila de ejemplo sintética. Tiene la misma forma que la exportación (§4.9).
- **Ida y vuelta, acotada:** exportar e importar conserva las **columnas de la plantilla**. La importación solo **da de alta** clientes; ignora `id` con un aviso y no actualiza los existentes. Contactos adicionales, recurrencia, documentos, estado activo y privacidad no viajan por CSV: se capturan en la ficha.
- **Archivo como bytes:** la pantalla envía el archivo en `FormData` y la acción lee sus bytes. Así Windows-1252 se decodifica en el servidor, y los límites y la huella se calculan sobre los bytes.
- **Privacidad:** el CSV no trae la aceptación del aviso. Un cliente importado con todos sus datos operativos queda con el faltante `aviso_privacidad` hasta que se registra la aceptación en su ficha.
- **Errores:** la vista previa y los errores por fila siguen como hoy, con mensajes claros, por ejemplo "Horario no reconocido: 'lunes a viernes 8-2'; usa lun-vie 08:00-14:00".

### 4.2 Ubicación pegada (punto 2)

- **Formatos que se reconocen** (función pura):
  - texto `20.62, -100.30`;
  - enlaces de Google Maps con `@lat,lng`, `?q=lat,lng`, `query=lat,lng` o `!3dlat!4dlng`;
  - el enlace que manda WhatsApp al compartir ubicación (`maps.google.com/?q=…`);
  - Apple Maps (`ll=lat,lng`);
  - `geo:lat,lng`.
  
  Todo se valida dentro de la caja de México.
- **Enlaces cortos** (`maps.app.goo.gl/…`, `goo.gl/maps/…`): la acción del servidor sigue la redirección. Hasta 3 saltos, 3 s, solo dominios de Google y sin enviar nada más que el enlace mismo. Luego aplica la función pura. *Decisión de Claude:* el aviso lo menciona.
- **En la ficha:** el campo "Pegar ubicación" coloca el pin y muestra la distancia a la calle más cercana según OSRM (Plan 7): "Pin a 420 m de una calle: revísalo".

### 4.3 Historial (punto 3)

En la ficha, "Historial" muestra lo más reciente primero, de 20 en 20:
- **Solicitudes:** folio, fecha solicitada, canal, estado y motivo de cancelación o posposición.
- **Recolecciones** (paradas operadas): fecha, unidad, llegada real, si fue dentro de su horario y si se completó o no se atendió, con motivo.

### 4.4 Propuestas de recolección (punto 4)

- **Dos orígenes:**
  - **Recurrencia fija**, opcional por cliente, para quien tenga día fijo: `{ tipo: "dias_semana", dias: number[] }` o `{ tipo: "cada_n_dias", cadaDias: number, desde: "AAAA-MM-DD" }`. Se edita en la ficha.
  - **Ritmo aprendido:** con al menos 3 solicitudes atendidas en los últimos 180 días, el ritmo es la mediana de días entre las fechas solicitadas consecutivas. La próxima fecha esperada es la última solicitud atendida más ese ritmo.
- **Quién se propone para una fecha D.** El despachador elige D; por omisión, el siguiente día de operación. Entra un cliente que cumpla todo esto:
  - activo y habilitado para D;
  - sin solicitud abierta (pendiente, programada o en ruta);
  - su recurrencia toca en D, o su fecha esperada cae entre D − 3 y D (no se proponen atrasos de semanas);
  - sin una decisión ya tomada para esa D (§ siguiente).
- **Qué puede hacer el despachador con cada propuesta:**
  - **confirmar:** crea la solicitud con canal nuevo `"propuesta"` y la fecha D, con la captura registrada para K2;
  - **posponer** N días;
  - **descartar** para esa fecha, con nota opcional.
  
  Las decisiones se guardan en `propuestas_recoleccion`.
- **Reglas de la lista** (decisión de Claude):
  - una sola propuesta por cliente y fecha, aunque tenga recurrencia y ritmo, con los dos motivos;
  - posponer N días guarda `pospuesta_hasta = D + N`, y el cliente no se vuelve a proponer antes de esa fecha;
  - una posposición vencida es un motivo propio (`pospuesta`): el cliente se propone en el primer día de operación ≥ `pospuesta_hasta` con horario y habilitación, aunque ya no caiga en la ventana del ritmo ni toque su recurrencia, hasta que se confirme o se descarte;
  - confirmar y la captura manual comparten candado: las dos bloquean al cliente (`bloquearCliente`) antes de revisar o insertar. Dentro de la transacción, la confirmación vuelve a comprobar toda la elegibilidad para D: activo, habilitado, sin solicitud abierta y sin decisión;
  - descartar vale solo para esa D;
  - la solicitud confirmada usa la hora de confirmar como `registrada_en` (llave FIFO) y como inicio y fin de captura;
  - el panel muestra K2 de las de canal `propuesta` por separado, para no mezclar captura asistida con captura manual en la comparación de la tesis;
  - la lista y la confirmación usan la fecha D y no proponen clientes sin horario ese día.
- **Permiso:** `solicitudes.registrar` (el mismo de capturar una solicitud).
- **Pantalla (Codex):** sección "Propuestas para <fecha>" en Solicitudes, con el motivo de cada una ("pide cada ~7 días; última hace 8" o "recurrencia: martes y viernes") y "Confirmar seleccionadas".

### 4.5 Números por cliente (punto 5)

- **En la ficha, últimos 90 días:**
  - recolecciones completadas;
  - no atendidas;
  - última visita;
  - ritmo aprendido;
  - veces que se pospuso;
  - porcentaje de inicios de servicio dentro de su horario, con su muestra. Es la misma regla y el mismo denominador que K3: llegar antes y esperar cuenta como cumplimiento.
- Funciones puras en `src/indicadores/cliente.ts` (Claude), con valores calculados a mano en las pruebas.

### 4.6 Mapa de la cartera (punto 6)

- **Página:** `/despacho/clientes/mapa`, con MapLibre como el resto.
- **Colores:** completo y habilitado hoy; incompleto; no habilitado (con motivo); sin ubicación, que se cuenta en un aviso porque no tiene pin.
- **Leyenda y navegación:** al tocar un cliente, nombre y enlace a su ficha. Respeta los filtros del punto 10.

### 4.7 Varios contactos (punto 7)

- Se conserva el contacto actual como **principal** y se le suman `contacto_correo` y `contacto_puesto`.
- `contactos_adicionales` es un arreglo jsonb en `clientes` de `{ nombre, puesto, telefono, correo }`, hasta 10. Se edita en la ficha y versiona con el cliente, como los documentos.
- *Decisión de Claude:* jsonb y no tabla, porque se edita siempre junto con la ficha.

### 4.8 Notas de seguimiento (punto 8)

- **Tabla `notas_cliente`:**
  - `id`, `cliente_id`, `tipo` (`llamada | queja | acuerdo | otro`), `texto` (hasta 1000 caracteres), `autor`, `en`;
  - `corrige_a`, que apunta a otra nota y es opcional.
- **Solo se agregan:** `rs_app` no tiene UPDATE ni DELETE. Corregir es una nota nueva que apunta a la anterior, y la pantalla muestra la última versión con "corregida".
- **Bitácora:** `crear_nota` con `["tipo", "texto"]`.
- **Supresión (ARCO):** la hace el administrador con un script auditado (`scripts/suprimir-notas-cliente.mts`) conforme al procedimiento interno, porque la aplicación no borra.

### 4.9 Exportar (punto 9)

- **Formato:** CSV que abre en Excel (BOM, CRLF y fórmulas neutralizadas, como el CSV del Plan 6), con las columnas de la plantilla (§4.1) más `id`, `completa` y `habilitada_hoy`, y respetando los filtros.
- **Permiso nuevo `clientes.exportar`:** despachador y administrador; este último tiene todos los permisos, como en el resto del sistema. Gerencia no exporta, porque el archivo lleva teléfonos. *Corrección de Claude (2026-10-21):* la revisión 1 decía que el administrador no ve clientes, y era incorrecto.
- **Bitácora:** `exportar_clientes` con `["filtros"]` y la cantidad de filas como dato no personal.

### 4.10 Filtros (punto 10)

- **En la lista y en el mapa,** por parámetros de la URL:
  - residuo;
  - estado: completo, incompleto, habilitado hoy o no habilitado;
  - sin ubicación;
  - documentos por vencer (30 días o menos) o vencidos;
  - activos, inactivos o todos.
- La búsqueda de texto se combina con los filtros. K5 sigue siendo de toda la cartera.
- La lista muestra una insignia "documento por vencer" en el cliente.

## 5. Datos y privacidad

- **Migración `0009`:**
  - en `clientes`: `contacto_correo`, `contacto_puesto`, `contactos_adicionales` y `recurrencia`;
  - tablas `notas_cliente` y `propuestas_recoleccion`;
  - canal `propuesta`;
  - permisos.

  El Plan 8 pasa a la migración `0010`.
- **Aviso de privacidad:** el aviso integral ya lista nombre, teléfono, correo y puesto de los contactos. Se agregan dos cosas, marcadas para el abogado:
  - las notas de seguimiento como "registros de comunicación con el cliente";
  - que un enlace corto de ubicación se resuelve con Google.
- **Exportación:** queda en la bitácora; el procedimiento interno dice quién puede exportar y cómo se cuidan los archivos.

## 6. Pruebas que deben existir

- **Unidad** (valores a mano):
  - lectura de horarios (rangos, acentos, varias franjas, errores con su mensaje);
  - tipos de unidad;
  - cada formato de ubicación, incluidos los inválidos y los fuera de México;
  - ritmo aprendido (con 2 solicitudes no hay ritmo; con 3, la mediana);
  - quién se propone para D (cada regla de exclusión);
  - números por cliente.
- **Integración:**
  - importar con todas las columnas y la ida y vuelta exportar → importar;
  - el enlace corto contra un servidor falso, con redirección, plazo y dominio no permitido;
  - confirmar una propuesta crea la solicitud con canal `propuesta`, y dos confirmaciones a la vez no la duplican;
  - posponer y descartar;
  - las notas sin UPDATE ni DELETE para `rs_app`;
  - permisos de exportar;
  - bitácora sin valores.
- **e2e:**
  - descargar la plantilla e importar una fila completa;
  - pegar un enlace de WhatsApp y ver el pin;
  - confirmar una propuesta;
  - agregar una nota;
  - filtrar y exportar;
  - abrir el mapa de la cartera.

## 7. Reparto (AGENTS.md)

| Quién | Qué |
|---|---|
| Codex | `src/dominio/clientes`: lectura de horarios y tipos, lectura de ubicación, esquemas de contactos, notas y recurrencia, y completitud si cambia. `src/dominio/solicitudes`: ritmo y propuestas, como funciones puras. Pantallas de clientes (ficha, historial, contactos, notas, filtros e insignias, mapa), propuestas en Solicitudes, y e2e |
| Claude | Migración `0009`, `src/datos`, permisos, acciones (importar, ubicación con enlace corto, confirmar, posponer y descartar propuestas, notas, exportar), consultas (historial, números, propuestas, mapa, filtros), `src/indicadores/cliente.ts`, rutas de API (plantilla y exportación), script de supresión de notas, `docs/legal`, pruebas de integración y ayudas e2e |
| Ambos | Contratos que compilan primero, revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

Si Codex no tiene cuota, Claude puede tomar las funciones puras de `src/dominio`, nunca las pantallas, documentándolo en el plan, y Codex las revisa.

## 8. Lo que se deja al constructor

- Diseño visual de las secciones nuevas, dentro de lo descrito.
- Paginación del historial.
- Cómo se ve el ritmo en la ficha.
- Estructura de las consultas, siempre que lean en una sola instantánea.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| El ritmo aprendido no sirve al inicio (sin historial) | La recurrencia fija cubre a los regulares; el ritmo aparece solo con 3 o más atendidas |
| Los formatos de enlace de Google cambian | Varios patrones y el enlace corto resuelto. Si no se reconoce, mensaje claro y se puede hacer clic en el mapa |
| Exportar datos personales | Permiso propio, bitácora y procedimiento interno |
| Notas con datos sensibles | Aviso en la pantalla ("no escribas datos sensibles"), límite de 1000 caracteres y revisión del abogado |

## 10. Respuesta a la revisión de Codex (2026-10-21)

| # | Hallazgo | Resolución |
|---|---|---|
| 1 | Una pospuesta podía desaparecer | Motivo `pospuesta` y regla de §4.4 |
| 2 | "Dentro del horario" no era K3 | §4.5: inicio de servicio, la definición y el denominador de K3; el contrato recibe `inicioServicioEn` |
| 3 | La ida y vuelta prometía más | §4.1: acotada a las columnas de la plantilla; la importación da altas e ignora `id` |
| 4 | Confirmación contra captura manual | §4.4: candado común por cliente y elegibilidad revalidada, con pruebas en los dos órdenes y contra un cambio de habilitación |
| 5 | Windows-1252 de punta a punta | §4.1: el archivo viaja como bytes en `FormData` |
| 6 | K5 contra privacidad | §4.1: importado queda con `aviso_privacidad` faltante hasta registrarla |
| 7 | Contratos del plan contra PC-0 | Plan §2 sincronizado con el código: `src/acciones/cartera.nucleo.ts` y `fichaCartera` |
