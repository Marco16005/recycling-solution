# Documentos legales

| Archivo | Para qué |
|---|---|
| [aviso-de-privacidad-integral.md](aviso-de-privacidad-integral.md) | Aviso integral (artículo 15 de la LFPDPPP 2025). Lo publica el sistema en `/aviso-de-privacidad` |
| [aviso-de-privacidad-simplificado.md](aviso-de-privacidad-simplificado.md) | Versión simplificada para teléfono, WhatsApp, correo y sistema (artículo 16, fracción II) |
| [procedimiento-datos-personales.md](procedimiento-datos-personales.md) | Procedimiento interno: solicitudes ARCO, registro de limitaciones, vulneraciones, medidas de seguridad |
| [solicitud-derechos-arco.md](solicitud-derechos-arco.md) | Formato para que la persona titular presente su solicitud |

## Antes de usarlos

1. **Revisión legal.** Los redactó un asistente de IA a partir del texto vigente de la ley: DOF del 20 de marzo de 2025, última reforma del 14 de noviembre de 2025. Una persona abogada debe revisarlos. Cuando se publique el nuevo Reglamento, hay que revisar sus requisitos, sobre todo los de transferencias y medidas compensatorias.
2. **Datos de la empresa.** Llenar los campos `{{…}}`:
   - razón social y nombre comercial;
   - domicilio;
   - responsable de datos y su suplente;
   - correo y teléfono de privacidad;
   - horario de atención;
   - proveedores de hospedaje, respaldos y mapas;
   - las notas de seguimiento de clientes (Plan CRM) como registros de comunicación, su supresión con `scripts/suprimir-notas-cliente.mts` y la consulta a Google al seguir un enlace corto de ubicación;
   - la exportación de la cartera (solo despachador y administrador, con bitácora): cómo se guardan y destruyen los archivos exportados;
   - los botones de navegación del operador (Waze y Google Maps, Plan 7): el teléfono envía el destino de la parada a esa aplicación cuando el operador lo toca. Confirmar si basta con informarlo en el aviso o si conviene otra medida;
   - plazos de conservación (`PLAZO_*`, según la matriz de abajo);
   - URL del aviso.

   En el sistema se configuran con variables de entorno (Plan 2).
3. **Plazos de conservación** (decisión 10 de la especificación). Matriz propuesta para discutir con asesoría legal; no se publica sin confirmarla.

| Datos | Finalidad que justifica conservarlos | Inicio del cómputo | Bloqueo | Supresión, incluidos respaldos |
|---|---|---|---|---|
| Clientes y contactos | Relación comercial; aclaraciones y obligaciones fiscales de la operación | Última recolección o baja del cliente; si nunca tuvo recolecciones, su alta | Hasta 5 años (propuesta: plazo de conservación de la contabilidad del Código Fiscal de la Federación, artículo 30) | Al terminar el bloqueo; los respaldos que los contengan se dejan de conservar en el ciclo de rotación siguiente |
| Aceptaciones y revocaciones del aviso | Demostrar el consentimiento | Igual que el cliente | Igual que el cliente | Igual que el cliente |
| Usuarios del sistema | Control de acceso y bitácora | Baja de la cuenta | 1 año | Al terminar el bloqueo; la bitácora conserva solo el identificador interno |
| Operadores | Relación laboral, seguridad y documentos de operación | Fin de la relación laboral | El que exija la legislación laboral y de seguridad social (por definir con asesoría legal) | Al terminar el bloqueo |
| Bitácora | Seguridad y auditoría | Fecha del evento | 5 años (propuesta) | Al terminar |
| Rutas y ubicaciones de eventos | Operación e indicadores | Fecha de la ruta | 12 meses | Al terminar; quedan solo cifras agregadas que no identifican al operador |

## Versiones en el sistema

Cada versión publicada se guarda completa en la tabla `avisos_privacidad`, con su huella SHA-256 y su fecha, y **nunca se modifica**: cualquier cambio, aunque sea una errata, es una versión nueva. Así se puede demostrar qué decía el aviso que aceptó cada cliente.

Publicar una versión nueva:

- deja como faltante el aviso de todos los clientes que aceptaron la versión anterior (especificación §6), por lo que solo debe hacerse cuando el cambio lo requiera;
- corre como `rs_migrador`, en una sola transacción, con el actor y el motivo en la bitácora.

La versión inicial `2026-10` quedó sin texto: es solo un marcador del Plan 1 y la primera publicación crea una versión nueva.
