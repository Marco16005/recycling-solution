# Procedimiento interno de datos personales

Documento interno de **{{RAZON_SOCIAL}}**. Describe cómo cumple la empresa lo que promete el aviso de privacidad integral. Lo debe revisar una persona abogada.

## 1. Departamento de Datos Personales (artículo 29 de la Ley)

- **Responsable:** {{NOMBRE_RESPONSABLE_DATOS}}.
- **Suplente:** {{NOMBRE_SUPLENTE}}.
- **Funciones:**
  - Recibir y responder solicitudes ARCO, de revocación y de limitación.
  - Llevar el registro de limitaciones.
  - Coordinar la respuesta a vulneraciones.
  - Mantener vigente el aviso de privacidad.
  - Capacitar al personal.

## 2. Solicitudes ARCO, revocación y limitación

| Paso | Qué se hace | Plazo |
|---|---|---|
| 1 | Registrar la solicitud el día que llega (correo o escrito) con folio, fecha de recepción y medio | Mismo día |
| 2 | Revisar que tenga los requisitos del artículo 28. Si falta algo, pedirlo una vez por el mismo medio | Dentro de los primeros 5 días hábiles |
| 3 | Verificar la identidad del titular o de su representante | Antes de entregar o cambiar datos |
| 4 | Localizar los datos: en el sistema (ficha del cliente, usuarios, operadores y rutas), en respaldos y en archivos en papel o en hojas de cálculo | — |
| 5 | Decidir si procede. Las causas para negar están en el artículo 33; las excepciones a la cancelación, en el artículo 25 | — |
| 6 | Comunicar la respuesta por el mismo medio de la solicitud, con el motivo si se niega | Máximo 20 días hábiles desde la recepción (ampliable una vez, justificándolo) |
| 7 | Si procede, hacerla efectiva | Máximo 15 días hábiles después de la respuesta |
| 8 | Archivar la solicitud, la respuesta y la evidencia | Durante el plazo de conservación del aviso |

### Cómo se atiende cada derecho en el sistema

- **Acceso:** exportar la ficha del cliente o los datos del operador y entregar una copia simple.
- **Rectificación:** corregir la ficha. La bitácora registra qué campos cambiaron.
- **Cancelación:** desactivar al cliente y bloquear sus datos durante el plazo de conservación; al terminar ese plazo, suprimirlos. Si hay obligaciones legales pendientes, aplicar el artículo 25.
- **Oposición o limitación:** anotar la limitación en el registro de limitaciones (por ejemplo, contactar solo por llamada). Si es un contacto de cliente que se opone al tratamiento, se procede como en la revocación.
- **Revocación de un contacto de cliente:** registrar el retiro en la sección "Aviso de privacidad" de la ficha. El historial se conserva. Pedir al cliente que designe otro contacto y darle a conocer el aviso. Mientras no lo haya, el cliente queda bloqueado para programar recolecciones.

## 3. Registro de limitaciones

Lista de personas que pidieron limitar el uso de sus datos; por ejemplo, ser contactadas solo por llamada. Contiene nombre, fecha y limitación. El despachador la consulta antes de contactar.

En el piloto no hay finalidades secundarias (encuestas ni promociones). Si se agregan, requieren una versión nueva del aviso y el consentimiento de cada persona.

## 4. Vulneraciones de seguridad (artículo 19)

1. **Detectar y contener:**
   - cambiar contraseñas;
   - desactivar los usuarios comprometidos (el script `desactivar-usuario` cierra sus sesiones);
   - aislar el servidor si hace falta.
2. **Evaluar:**
   - qué datos se vieron afectados y de cuántas personas;
   - si afecta de forma significativa sus derechos patrimoniales o morales.
3. **Avisar de inmediato** a las personas afectadas, cuando corresponda. El aviso incluye:
   - la naturaleza del incidente;
   - los datos comprometidos;
   - las recomendaciones para protegerse;
   - las acciones correctivas;
   - el medio para obtener más información.
4. **Corregir y documentar:**
   - registrar el incidente, la causa, las acciones y las fechas;
   - revisar las medidas de seguridad.

## 5. Medidas de seguridad (artículo 18)

| Tipo | Medidas |
|---|---|
| Administrativas | Confidencialidad firmada por todo el personal con acceso. Registro de entrega del aviso a operadores y usuarios. Acuerdos con los proveedores que alojan datos (hospedaje y respaldos). Altas y bajas de usuarios el mismo día en que alguien entra o sale. Capacitación anual. |
| Técnicas | Las que describe la especificación del sistema (§10):<br>• roles y permisos;<br>• hash de contraseñas;<br>• límite de intentos de acceso;<br>• HTTPS;<br>• bitácora;<br>• base de datos con usuarios de privilegios mínimos;<br>• respaldos diarios y prueba de restauración. |
| Físicas | Equipo de despacho con bloqueo de pantalla. Documentos en papel bajo llave. Respaldos fuera del servidor y protegidos. |

## 6. Confidencialidad (artículo 20)

Todo el personal que trata datos firma una carta de confidencialidad que sigue vigente después de terminar la relación laboral.

## 7. Revisión

El Departamento de Datos Personales revisa este procedimiento y el aviso cada año, y siempre que cambien la ley, los procesos o el sistema.
