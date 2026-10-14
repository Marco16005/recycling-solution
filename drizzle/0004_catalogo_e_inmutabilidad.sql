-- Catálogo inicial de documentos (docs/catalogo-de-documentos.md). Ajustable sin cambiar código.
-- En clientes ningún tipo es obligatorio por omisión: cuentan solo los que el despachador agrega a la ficha.
INSERT INTO "tipos_documento" ("id", "nombre", "aplica_a", "origen", "obligatorio_por_omision", "requiere_vencimiento", "descripcion") VALUES
  ('tarjeta_circulacion', 'Tarjeta de circulación', 'unidad', 'ley', true, true, 'Identifica la unidad y su registro vehicular'),
  ('poliza_responsabilidad_civil', 'Póliza de seguro de responsabilidad civil', 'unidad', 'ley', true, true, 'Cubre daños a terceros; necesaria para circular'),
  ('verificacion_vehicular', 'Verificación vehicular (emisiones)', 'unidad', 'ley', true, true, 'Obligación ambiental estatal o federal según la placa'),
  ('registro_transporte_rme', 'Unidad en la autorización de recolección y transporte de RME (SEDESU)', 'unidad', 'ley', true, true, 'Comprueba que la unidad está incluida en la autorización vigente de la recicladora; refrendo anual'),
  ('permiso_sict_carga', 'Permiso de autotransporte federal de carga (SICT)', 'unidad', 'ley', false, true, 'Se marca en la unidad que circula por carreteras federales'),
  ('licencia_conducir', 'Licencia de conducir del tipo que exige la unidad', 'operador', 'ley', true, true, 'Estatal de chofer o federal tipo B/C'),
  ('capacitacion_residuos_seguridad', 'Capacitación en manejo de residuos y seguridad (DC-3 o equivalente)', 'operador', 'politica', false, true, 'La piden muchos clientes para entrar a planta'),
  ('contrato_servicio', 'Contrato o carta de condiciones del servicio', 'cliente', 'contrato', false, false, 'Frecuencia, horarios, precio y responsabilidades'),
  ('opinion_cumplimiento_imss_sua', 'Opinión de cumplimiento IMSS / pago SUA vigente', 'cliente', 'contrato', false, true, 'Requisito de acceso común en parques industriales'),
  ('registro_repse', 'Registro REPSE de la recicladora', 'cliente', 'contrato', false, true, 'Lo piden clientes que consideran el servicio especializado'),
  ('induccion_seguridad_cliente', 'Inducción de seguridad del cliente', 'cliente', 'contrato', false, true, 'Requisito de acceso de muchas plantas; al validar el plan se confirma el operador'),
  ('plan_manejo_rme_cliente', 'Plan de manejo de RME del cliente (registro SEDESU)', 'cliente', 'ley', false, false, 'Solo generadores obligados por la NOM-161-SEMARNAT-2011'),
  ('constancia_situacion_fiscal_cliente', 'Constancia de situación fiscal del cliente', 'cliente', 'politica', false, false, 'Para facturar o liquidar el material')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- La hora de registro, el folio, quién registró y el cliente de una solicitud no cambian nunca (especificación §7, regla 2).
CREATE FUNCTION solicitudes_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registrada_en IS DISTINCT FROM OLD.registrada_en
     OR NEW.folio IS DISTINCT FROM OLD.folio
     OR NEW.registrada_por IS DISTINCT FROM OLD.registrada_por
     OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
    RAISE EXCEPTION 'registrada_en, folio, registrada_por y cliente_id de una solicitud no se pueden cambiar'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER solicitudes_inmutables BEFORE UPDATE ON "solicitudes"
  FOR EACH ROW EXECUTE FUNCTION solicitudes_inmutables();
