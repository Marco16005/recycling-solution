import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leerCliente } from "@/datos/clientes";
import { bitacora, configuracion, solicitudes } from "@/datos/esquema";
import { clienteHabilitado, PATIO, ponerPatio } from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, filasDe, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import { faltantesDeCliente } from "@/dominio/clientes/completitud";
import { COLUMNAS_CSV } from "@/dominio/clientes/csv";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { csvDeCartera, plantillaCsv } from "@/consultas/cartera.nucleo";
import { crearConexion } from "@/datos/conexion-base";
import { insertarNota, notasDeCliente, suprimirNotasDeCliente } from "@/datos/notas";
import { agregarNota, ubicacionDesdeTexto } from "./cartera.nucleo";
import { registrarPrivacidad } from "./clientes.nucleo";
import { analizarImportacion, confirmarImportacion } from "./importacion.nucleo";
import { confirmarPropuestas, descartarPropuesta, posponerPropuesta } from "./propuestas.nucleo";
import { registrarSolicitud } from "./solicitudes.nucleo";
import type { Contexto, Resultado } from "./tipos";

// Plan CRM, PC-3, con Postgres y OSRM reales (mapa sintético). AHORA es 2026-10-21 (miércoles) 09:00 en Ciudad de México.

const AHORA = new Date("2026-10-21T15:00:00Z");
const MANANA = "2026-10-22";
function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}

describe("acciones del Plan CRM", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let gerencia: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion = despachador, ahora = AHORA): Contexto => ({ bd: base.bd, usuario, ahora, reloj: () => ahora });

  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    gerencia = await usuarioDePrueba(base.bd, "gerencia");
    await ponerPatio(base.bd);
  });
  afterEach(async () => base.cerrar());

  const encabezado = "nombre,contacto,telefono,correo,puesto,direccion,ubicacion,residuo,material,servicio_min,carga_kg,horarios,tipos_unidad,notas_acceso";
  async function importar(csv: string) {
    const resumen = valor(await analizarImportacion(ctx(), csv));
    return confirmarImportacion(ctx(), csv, { operacionId: randomUUID(), huella: resumen.huella, aceptarDuplicados: true });
  }

  it("importar con todas las columnas deja la ficha operativa completa y solo falta el aviso; registrado, queda completa", async () => {
    valor(await importar(`${encabezado}\nCartonera Importada,Ana,4421234567,ana@ejemplo.test,Almacén,Calle 1,"20.62, -100.3",RME,Cartón,30,800,"lun-sab 08:00-14:00",doble_rodada,Caseta\n`));
    const [fila] = filasDe<{ id: string }>(await base.bd.execute(sql`SELECT id FROM clientes WHERE nombre = 'Cartonera Importada'`));
    const cliente = (await leerCliente(base.bd, fila.id))!;
    const [conf] = await base.bd.select({ v: configuracion.versionAvisoPrivacidad }).from(configuracion);
    expect(faltantesDeCliente(cliente, conf.v)).toEqual(["aviso_privacidad"]);
    expect(cliente).toMatchObject({ contactoCorreo: "ana@ejemplo.test", contactoPuesto: "Almacén", notasAcceso: "Caseta", tiposUnidadAdmitidos: ["doble_rodada"] });
    valor(await registrarPrivacidad(ctx(), fila.id, { accion: "aceptado", medio: "papel", versionAviso: conf.v, movimientoAnteriorId: cliente.privacidad?.id ?? null }));
    expect(faltantesDeCliente((await leerCliente(base.bd, fila.id))!, conf.v)).toEqual([]);
  });

  it("exportar → importar conserva las columnas de la plantilla como alta nueva; la columna id se ignora con aviso", async () => {
    valor(await importar(`${encabezado}\nCartonera Ida,Ana,4421234567,,,Calle 1,"20.62, -100.3",RME,,30,800,"lun-vie 08:00-14:00; sab 09:00-12:00",doble_rodada|rabon,\n`));
    const [fila] = filasDe<{ id: string }>(await base.bd.execute(sql`SELECT id FROM clientes WHERE nombre = 'Cartonera Ida'`));
    const original = (await leerCliente(base.bd, fila.id))!;
    // La exportación real (con fórmulas neutralizadas y las columnas id, completa y habilitada_hoy), renombrada para darla de alta.
    await base.bd.execute(sql`UPDATE clientes SET nombre = 'Cartonera Vuelta' WHERE id = ${original.id}`);
    const { contenido } = valor(await csvDeCartera(ctx(), { texto: "Cartonera Vuelta" }));
    await base.bd.execute(sql`UPDATE clientes SET nombre = 'Cartonera Ida' WHERE id = ${original.id}`);
    const csv = contenido;
    const resumen = valor(await analizarImportacion(ctx(), csv));
    expect(resumen.avisos.join(" ")).toContain("id");
    valor(await confirmarImportacion(ctx(), csv, { operacionId: randomUUID(), huella: resumen.huella, aceptarDuplicados: true }));
    const [vuelta] = filasDe<{ id: string }>(await base.bd.execute(sql`SELECT id FROM clientes WHERE nombre = 'Cartonera Vuelta'`));
    expect(vuelta.id).not.toBe(original.id);
    const nueva = (await leerCliente(base.bd, vuelta.id))!;
    for (const campo of ["ventanas", "tiposUnidadAdmitidos", "lat", "lng", "tipoResiduo", "tiempoServicioMin", "cargaEstimadaKg", "contactoTelefono"] as const)
      expect(nueva[campo]).toEqual(original[campo]);
  });

  it("ubicacionDesdeTexto da coordenadas y la distancia a la calle con OSRM; un pin en la zona sin calles queda lejos", async () => {
    const cerca = valor(await ubicacionDesdeTexto(ctx(), "https://maps.google.com/?q=20.62,-100.3"));
    expect(cerca).toMatchObject({ lat: 20.62, lng: -100.3 });
    expect(cerca.distanciaCalleM).toBeLessThan(50);
    const lejos = valor(await ubicacionDesdeTexto(ctx(), "20.725, -100.28"));
    expect(lejos.distanciaCalleM).toBeGreaterThan(300);
    expect(await ubicacionDesdeTexto(ctx(), "no es una ubicación")).toMatchObject({ ok: false, error: "invalido" });
    expect(await ubicacionDesdeTexto(ctx(gerencia), "20.62,-100.3")).toEqual({ ok: false, error: "no_autorizado" });
  });

  describe("propuestas", () => {
    let clienteId: string;
    beforeEach(async () => {
      // Lunes a sábado de 08:00 a 14:00 (escenario-plan) y aviso aceptado: habilitado para mañana jueves.
      // Recurrencia los jueves: mañana (2026-10-22) se le propone.
      clienteId = (await clienteHabilitado(base.bd, "Cartonera Propuesta", 0.01, { recurrencia: { tipo: "dias_semana", dias: [4] } })).id;
    });

    it("confirmar crea la solicitud con canal propuesta y la hora de confirmar; dos a la vez dejan una sola", async () => {
      const [a, b] = await Promise.all([1, 2].map(() => confirmarPropuestas(ctx(), MANANA, [clienteId])));
      const resultados = [valor(a), valor(b)];
      expect(resultados.flatMap((r) => r.creadas)).toHaveLength(1);
      expect(resultados.flatMap((r) => r.yaConfirmadas)).toEqual([clienteId]);
      const [s] = await base.bd.select().from(solicitudes).where(eq(solicitudes.clienteId, clienteId));
      expect(s).toMatchObject({ canal: "propuesta", fechaSolicitada: MANANA, estado: "pendiente" });
      expect(s.registradaEn).toEqual(AHORA);
      expect(s.capturaInicioEn).toEqual(AHORA);
    });

    it("confirmación y captura manual a la vez: sin errores y la confirmación nunca crea una segunda solicitud abierta", async () => {
      // Las dos bloquean al cliente. La captura manual puede crear otra solicitud a propósito (regla de siempre);
      // lo que no puede pasar es que la confirmación cree una cuando la manual ya existía.
      const manual = () => registrarSolicitud(ctx(), { clienteId, fechaSolicitada: MANANA, canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: AHORA });
      const [r1, r2] = await Promise.all([confirmarPropuestas(ctx(), MANANA, [clienteId]), manual()]);
      const confirmacion = valor(r1);
      valor(r2);
      const filas = await base.bd.select().from(solicitudes).where(eq(solicitudes.clienteId, clienteId));
      const propuesta = filas.filter((s) => s.canal === "propuesta");
      if (confirmacion.creadas.length === 1) {
        // La confirmación ganó el candado: la manual se registró después.
        expect(propuesta).toHaveLength(1);
        expect(propuesta[0].registradaEn.getTime()).toBeLessThanOrEqual(Math.min(...filas.filter((s) => s.canal !== "propuesta").map((s) => s.registradaEn.getTime())));
      } else {
        expect(confirmacion.noElegibles).toEqual([{ clienteId, motivo: "solicitud_abierta" }]);
        expect(propuesta).toHaveLength(0);
      }
    });

    it("no confirma si ya tiene solicitud abierta o dejó de estar habilitado para la fecha", async () => {
      valor(await registrarSolicitud(ctx(), { clienteId, fechaSolicitada: MANANA, canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: AHORA }));
      expect(valor(await confirmarPropuestas(ctx(), MANANA, [clienteId])).noElegibles).toEqual([{ clienteId, motivo: "solicitud_abierta" }]);
      const otro = (await clienteHabilitado(base.bd, "Cartonera Sin Horario", 0.02)).id;
      await base.bd.execute(sql`DELETE FROM ventanas_cliente WHERE cliente_id = ${otro}`);
      expect(valor(await confirmarPropuestas(ctx(), MANANA, [otro])).noElegibles).toEqual([{ clienteId: otro, motivo: "no_habilitado" }]);
    });

    it("no confirma lo que no se propone para esa fecha: sin ritmo ni recurrencia, o con una posposición vigente", async () => {
      const sinMotivo = (await clienteHabilitado(base.bd, "Cartonera Sin Motivo", 0.02)).id;
      expect(valor(await confirmarPropuestas(ctx(), MANANA, [sinMotivo])).noElegibles).toEqual([{ clienteId: sinMotivo, motivo: "no_propuesta" }]);
      valor(await posponerPropuesta(ctx(), "2026-10-29", clienteId, 7));   // jueves siguiente, pospuesta hasta el 5 de noviembre
      // El 22 todavía se propone (la posposición es de otra fecha); el jueves 29 ya tiene decisión.
      expect(valor(await confirmarPropuestas(ctx(), "2026-10-29", [clienteId])).noElegibles).toEqual([{ clienteId, motivo: "ya_decidida" }]);
      const conRecurrencia = (await clienteHabilitado(base.bd, "Cartonera Pospuesta", 0.03, { recurrencia: { tipo: "dias_semana", dias: [4, 5] } })).id;
      valor(await posponerPropuesta(ctx(), MANANA, conRecurrencia, 3));    // hasta el domingo 25
      expect(valor(await confirmarPropuestas(ctx(), "2026-10-23", [conRecurrencia])).noElegibles).toEqual([{ clienteId: conRecurrencia, motivo: "no_propuesta" }]);
    });

    it("posponer y descartar guardan su decisión; gerencia no puede", async () => {
      valor(await posponerPropuesta(ctx(), MANANA, clienteId, 7));
      const otro = (await clienteHabilitado(base.bd, "Cartonera Descarte", 0.02)).id;
      valor(await descartarPropuesta(ctx(), MANANA, otro, "Ya no tiene material"));
      const filas = filasDe<{ cliente_id: string; estado: string; pospuesta_hasta: string | null }>(await base.bd.execute(sql`
        SELECT cliente_id, estado, pospuesta_hasta::text FROM propuestas_recoleccion ORDER BY estado`));
      expect(filas).toEqual([{ cliente_id: otro, estado: "descartada", pospuesta_hasta: null }, { cliente_id: clienteId, estado: "pospuesta", pospuesta_hasta: "2026-10-29" }]);
      expect(await posponerPropuesta(ctx(), MANANA, clienteId, 31)).toMatchObject({ ok: false, error: "invalido" });
      expect(await descartarPropuesta(ctx(gerencia), MANANA, clienteId, null)).toEqual({ ok: false, error: "no_autorizado" });
    });
  });

  it("notas: tipo y largo, corregir agrega otra, gerencia no anota y la bitácora no guarda el texto", async () => {
    const clienteId = (await clienteHabilitado(base.bd, "Cartonera Notas", 0.01)).id;
    const { id } = valor(await agregarNota(ctx(), clienteId, { tipo: "queja", texto: "Llegaron tarde el martes" }));
    valor(await agregarNota(ctx(), clienteId, { tipo: "queja", texto: "Llegaron tarde el miércoles", corrigeA: id }));
    expect(await agregarNota(ctx(), clienteId, { tipo: "chisme", texto: "x" })).toMatchObject({ ok: false, error: "invalido" });
    expect(await agregarNota(ctx(), clienteId, { tipo: "otro", texto: "x".repeat(1001) })).toMatchObject({ ok: false, error: "invalido" });
    const ajena = (await clienteHabilitado(base.bd, "Cartonera Ajena", 0.02)).id;
    expect(await agregarNota(ctx(), ajena, { tipo: "otro", texto: "corrige otra", corrigeA: id })).toMatchObject({ ok: false, error: "invalido" });
    expect(await agregarNota(ctx(gerencia), clienteId, { tipo: "otro", texto: "x" })).toEqual({ ok: false, error: "no_autorizado" });
    const renglones = await base.bd.select().from(bitacora).where(and(eq(bitacora.entidad, "nota_cliente")));
    expect(renglones).toHaveLength(2);
    expect(renglones.every((r) => JSON.stringify(r.campos) === JSON.stringify(["tipo", "texto"]))).toBe(true);
    expect(JSON.stringify(renglones)).not.toContain("Llegaron tarde");
    void inArray; void PATIO;
  });

  it("la plantilla trae BOM, las columnas de la importación y una fila sintética que se vuelve a importar; gerencia no la descarga", async () => {
    const { contenido } = valor(await plantillaCsv(ctx()));
    expect(contenido.startsWith("\uFEFF" + COLUMNAS_CSV.join(","))).toBe(true);
    expect(contenido.endsWith("\r\n")).toBe(true);
    expect(valor(await analizarImportacion(ctx(), contenido))).toMatchObject({ validas: 1, errores: [] });
    expect(await plantillaCsv(ctx(gerencia))).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("la supresión ARCO borra las notas del cliente solo con la conexión del migrador", async () => {
    const clienteId = (await clienteHabilitado(base.bd, "Cartonera ARCO", 0.01)).id;
    await base.bd.transaction((tx) => insertarNota(tx, { clienteId, tipo: "otro", texto: "Dato a suprimir", autor: despachador.id, corrigeA: null }, AHORA));
    await expect(base.bd.transaction((tx) => suprimirNotasDeCliente(tx, clienteId))).rejects.toThrow();
    const migrador = crearConexion(base.urlMigrador, 1);
    try {
      expect(await migrador.bd.transaction((tx) => suprimirNotasDeCliente(tx, clienteId))).toBe(1);
    } finally {
      await migrador.cerrar();
    }
    expect(await notasDeCliente(base.bd, clienteId)).toEqual([]);
  });
});
