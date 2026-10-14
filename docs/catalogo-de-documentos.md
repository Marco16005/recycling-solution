# Catálogo de documentos

- **Fecha:** 2026-10-14.
- **Estado:** propuesta de Claude, a confirmar con la empresa o su gestor ambiental (especificación §14, decisión 6). El sistema lo carga como catálogo inicial (Plan 2) y se puede ajustar sin cambiar código.

## Para qué sirve

El sistema usa los documentos para una sola cosa: **no mandar una unidad ni un operador a una recolección que no puede hacer legalmente o a la que no la dejarán entrar**. Cada documento tiene:

- **a quién aplica:** cliente, unidad u operador;
- **si es obligatorio:** si falta o está vencido, bloquea;
- **si vence:** se captura la fecha y el sistema lo marca vencido al pasar esa fecha.

El sistema no guarda el contenido de los documentos ni copias escaneadas en el Plan 2; solo su estado y vigencia. Así no guarda datos sensibles, como los resultados de un examen médico.

## Unidades

| Documento | Obligatorio | Vence | Por qué |
|---|---|---|---|
| Tarjeta de circulación | Sí | Sí | Identifica la unidad y su registro vehicular |
| Póliza de seguro de responsabilidad civil | Sí | Sí | Necesaria para circular y para cubrir daños a terceros, en especial en carreteras federales |
| Verificación vehicular (emisiones) | Sí | Sí | Obligación ambiental estatal o federal según la placa |
| Registro de la unidad como transporte de residuos de manejo especial (padrón de SEDESU Querétaro, etapa de recolección y transporte) | Sí | Sí, refrendo anual (enero–febrero) | El transporte de residuos de manejo especial debe hacerlo un prestador autorizado |
| Permiso de autotransporte federal de carga (SICT) | No (solo si la unidad circula por carreteras federales) | Según el permiso | Requerido para el autotransporte federal; la NOM-012 regula peso y dimensiones |

## Operadores

| Documento | Obligatorio | Vence | Por qué |
|---|---|---|---|
| Licencia de conducir del tipo que exige la unidad (estatal de chofer o federal tipo B/C) | Sí | Sí | Sin licencia vigente no puede conducir |
| Constancia de aptitud psicofísica (solo la fecha de vigencia) | No (sí si tiene licencia federal) | Sí | Requisito de la licencia federal |
| Capacitación en manejo de residuos y seguridad (constancia DC-3 o equivalente) | No | Sí | Muchos clientes la piden para entrar a planta |
| Aviso de privacidad entregado | Sí | No | El operador debe conocer cómo se tratan sus datos (aviso integral, grupo C) |

## Clientes: requisitos de acceso y del servicio

Cada cliente exige cosas distintas; el despachador agrega en su ficha los que aplican. Si un documento marcado como obligatorio no está vigente, ese cliente no se puede programar ese día (especificación §7, regla 3).

| Documento | Por omisión | Vence | Por qué |
|---|---|---|---|
| Contrato o carta de condiciones del servicio | Obligatorio | Según el contrato | Acuerdo de frecuencia, horarios, precio y responsabilidades |
| Opinión de cumplimiento IMSS / pago SUA vigente (de la recicladora) | Obligatorio si el cliente lo pide | Sí, mensual o bimestral | Muy común en parques industriales para dejar entrar a proveedores |
| Registro REPSE de la recicladora | Obligatorio si el cliente lo pide | Sí | Lo piden clientes que consideran la recolección un servicio especializado dentro de sus instalaciones |
| Inducción de seguridad del cliente para el operador | Obligatorio si el cliente lo pide | Sí | Requisito de acceso de muchas plantas |
| Plan de manejo de residuos de manejo especial del cliente (registro ante SEDESU) | No | No | Solo para generadores obligados por la NOM-161-SEMARNAT-2011; se registra para trazabilidad |
| Constancia de situación fiscal del cliente | No | No | Para facturar o liquidar el material; no impide recolectar |

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
