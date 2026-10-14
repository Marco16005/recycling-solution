# Catálogo de documentos

- **Fecha:** 2026-10-14.
- **Estado:** propuesta de Claude, a confirmar con la empresa o su gestor ambiental (especificación §14, decisión 6). El sistema lo carga como catálogo inicial (Plan 2) y se puede ajustar sin cambiar código.

## Para qué sirve

El sistema usa los documentos para una sola cosa: **no mandar una unidad ni un operador a una recolección que no puede hacer legalmente o a la que no la dejarán entrar**. Cada documento tiene:

- **a quién aplica:** cliente, unidad u operador;
- **origen:** ley, contrato con el cliente o política interna;
- **si vence:** se captura la fecha y el sistema lo marca vencido al pasar esa fecha;
- **si es obligatorio por omisión:** si falta o está vencido, bloquea.

Lo obligatorio por omisión es solo el punto de partida. Cada unidad y cada operador puede marcar en su ficha que un documento le aplica, aunque no sea obligatorio por omisión (por ejemplo, el permiso federal para la unidad que sale a carretera federal), o que no le aplica. En los clientes no hay obligatorios por omisión: cuentan solo los documentos que el despachador agrega a la ficha.

El sistema no guarda el contenido de los documentos ni copias escaneadas en el Plan 2; solo su estado y vigencia. La constancia de aptitud psicofísica de los operadores se dejó **fuera del catálogo**: aun registrando solo su vigencia, revela si una persona está apta de salud y podría considerarse un dato sensible (artículos 2 y 8 de la ley de datos personales). Si la empresa la necesita, se agrega después de la revisión legal, con consentimiento expreso.

## Unidades

| Documento | Origen | Obligatorio por omisión | Vence | Por qué |
|---|---|---|---|---|
| Tarjeta de circulación | Ley | Sí | Sí | Identifica la unidad y su registro vehicular |
| Póliza de seguro de responsabilidad civil | Ley | Sí | Sí | Necesaria para circular y para cubrir daños a terceros, en especial en carreteras federales |
| Verificación vehicular (emisiones) | Ley | Sí | Sí | Obligación ambiental estatal o federal según la placa |
| Unidad registrada en la autorización de recolección y transporte de residuos de manejo especial (SEDESU Querétaro) | Ley | Sí | Sí, refrendo anual (enero–febrero) | El registro en el padrón es de la recicladora como prestadora del servicio; se registra en cada unidad para comprobar que está incluida en la autorización vigente. Confirmar con SEDESU o el gestor ambiental |
| Permiso de autotransporte federal de carga (SICT) | Ley | No; se marca en la unidad que circula por carreteras federales | Según el permiso | Requerido para el autotransporte federal; la NOM-012 regula peso y dimensiones |

## Operadores

| Documento | Origen | Obligatorio por omisión | Vence | Por qué |
|---|---|---|---|---|
| Licencia de conducir del tipo que exige la unidad (estatal de chofer o federal tipo B/C) | Ley | Sí | Sí | Sin licencia vigente no puede conducir |
| Capacitación en manejo de residuos y seguridad (constancia DC-3 o equivalente) | Política interna o contrato | No | Sí | Muchos clientes la piden para entrar a planta |

La entrega del aviso de privacidad al operador no es un documento del catálogo: se registra en la ficha del operador (versión y fecha) y, si falta, el operador aparece no disponible.

## Clientes: requisitos de acceso y del servicio

Cada cliente exige cosas distintas; el despachador agrega en su ficha los que aplican. Si un documento marcado como obligatorio no está vigente, ese cliente no se puede programar ese día (especificación §7, regla 3).

| Documento | Origen | Vence | Por qué |
|---|---|---|---|
| Contrato o carta de condiciones del servicio | Contrato | Según el contrato | Acuerdo de frecuencia, horarios, precio y responsabilidades. No todos los clientes lo tienen por escrito |
| Opinión de cumplimiento IMSS / pago SUA vigente (de la recicladora) | Contrato (requisito del cliente) | Sí, mensual o bimestral | Muy común en parques industriales para dejar entrar a proveedores |
| Registro REPSE de la recicladora | Ley o contrato | Sí | Lo piden clientes que consideran la recolección un servicio especializado dentro de sus instalaciones |
| Inducción de seguridad del cliente | Contrato (requisito del cliente) | Sí | Requisito de acceso de muchas plantas. En rigor es de cada **operador** con cada cliente; en el piloto se registra en el cliente y, al validar el plan (Plan 4), el despachador confirma que el operador asignado la tiene |
| Plan de manejo de residuos de manejo especial del cliente (registro ante SEDESU) | Ley (del cliente) | No | Solo para generadores obligados por la NOM-161-SEMARNAT-2011; se registra para trazabilidad |
| Constancia de situación fiscal del cliente | Política interna | No | Para facturar o liquidar el material; no impide recolectar |

## Empresa (no por cliente ni por unidad)

Algunos documentos son de la recicladora y los piden los clientes o la autoridad: registro en el Padrón de Prestadores de Servicios Ambientales de SEDESU, REPSE y opiniones de cumplimiento del SAT, el IMSS y el INFONAVIT. En el Plan 2 se registran **en cada cliente que los exige**, como requisito de acceso. Un expediente único de la empresa, con alertas de vencimiento, queda para la Fase 2 (checklist y alertas, especificación §2).

## Fuera del Plan 2

- **Manifiestos de entrega, transporte y recepción por recolección:** Fase 2, junto con la trazabilidad del material.
- **Copias escaneadas de los documentos:** Fase 2.
- **Alertas automáticas de vencimiento:** Fase 2. En el Plan 2, las pantallas muestran lo vencido y lo que vence en los próximos 30 días.

## Fuentes

- SEDESU Querétaro, [residuos de manejo especial](https://queretaro.gob.mx/en/web/sedesu/residuos-especial) y [autorización de manejo integral](https://queretaro.gob.mx/en/web/sedesu/autorizaci%C3%B3n-de-manejo-integral): padrón de prestadores, refrendos por etapa, plan de manejo (NOM-161-SEMARNAT-2011).
- Ley para la Prevención, Gestión Integral y Economía Circular de los Residuos del Estado de Querétaro (2021), [texto en Justia](https://mexico.justia.com/estatales/queretaro/leyes/ley-para-la-prevencion-gestion-integral-y-economia-circular-de-los-residuos-del-estado-de-queretaro/).
- IMSS y STPS, [boletín sobre REPSE y opinión de cumplimiento](https://www.imss.gob.mx/sites/all/statics/i2f_news/Boletin%20Conjunto%20IMSS-STPS_REPSE.pdf).
