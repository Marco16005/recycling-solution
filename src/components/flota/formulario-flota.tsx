"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { guardarOperadorAccion, guardarUnidadAccion } from "@/acciones/flota";
import type { FichaOperador, FichaUnidad } from "@/consultas/flota";
import { Campo, CLASE_SELECT } from "@/components/clientes/campos-formulario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ETIQUETA_UNIDAD } from "@/dominio/clientes/etiquetas";
import { TIPOS_UNIDAD, type TipoUnidad } from "@/dominio/clientes/tipos";
import type { OperadorEntrada, TipoDocumento, UnidadEntrada } from "@/dominio/flota/tipos";
import { unidadSchema, operadorSchema } from "@/dominio/flota/esquemas";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { DocumentosFlota, documentosIniciales } from "./documentos-flota";
import { MensajesOperacion, useOperacion } from "./operacion";

type Props =
  | { entidad: "unidad"; ficha?: FichaUnidad; catalogo: TipoDocumento[] }
  | { entidad: "operador"; ficha?: FichaOperador; catalogo: TipoDocumento[] };
type Entrada = UnidadEntrada | OperadorEntrada;

function entradaInicial(props: Props): Entrada {
  if (props.entidad === "unidad") {
    const u = props.ficha?.unidad;
    return {
      placa: u?.placa ?? "", numeroEconomico: u?.numeroEconomico ?? null, tipo: u?.tipo ?? "doble_rodada",
      capacidadKg: u?.capacidadKg ?? 1000, rendimientoKmL: u?.rendimientoKmL ?? 5,
      activo: u?.activo ?? true, notas: u?.notas ?? null,
      documentos: documentosIniciales(props.catalogo, u?.documentos ?? []),
    };
  }
  const o = props.ficha?.operador;
  return {
    nombre: o?.nombre ?? "", telefono: o?.telefono ?? null, activo: o?.activo ?? true,
    documentos: documentosIniciales(props.catalogo, o?.documentos ?? []),
  };
}

export function FormularioFlota(props: Props) {
  const router = useRouter();
  const prefijo = useId();
  const op = useOperacion();
  const guardado = props.entidad === "unidad" ? props.ficha?.unidad : props.ficha?.operador;
  const editable = props.ficha?.puedeEditar ?? true;
  const [datos, setDatos] = useState<Entrada>(() => entradaInicial(props));
  const [version, setVersion] = useState<number | null>(guardado?.version ?? null);
  const [respaldo, setRespaldo] = useState<Entrada | null>(null);
  const ruta = props.entidad === "unidad" ? "unidades" : "operadores";

  function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!editable || op.pendiente || op.conflicto) return;
    const validacion = "placa" in datos ? unidadSchema.safeParse(datos) : operadorSchema.safeParse(datos);
    if (!validacion.success) {
      op.setErrores(erroresPorCampo(validacion.error));
      return;
    }
    const errores: Record<string, string[]> = {};
    datos.documentos.forEach((d, i) => {
      const tipo = props.catalogo.find((t) => t.id === d.tipoDocumentoId);
      if (tipo?.requiereVencimiento && d.estado === "vigente" && d.venceEl === null) {
        errores[`documentos.${i}.venceEl`] = ["Indica el vencimiento de este documento vigente"];
      }
    });
    if (Object.keys(errores).length) { op.setErrores(errores); return; }
    op.ejecutar(
      () => "placa" in datos
        ? guardarUnidadAccion(guardado?.id ?? null, version, datos)
        : guardarOperadorAccion(guardado?.id ?? null, version, datos),
      (valor) => {
        setVersion(valor.version);
        op.setMensaje("Ficha guardada.");
        if (!guardado) router.replace(`/despacho/${ruta}/${valor.id}`);
        router.refresh();
      },
    );
  }

  function campo(nombre: string, titulo: string, valor: string | number, cambiar: (v: string) => void,
    tipo = "text") {
    return (
      <Campo nombre={nombre} titulo={titulo} prefijo={prefijo} errores={op.errores}>
        {(a) => (
          <Input
            {...a} type={tipo} value={typeof valor === "number" && !Number.isFinite(valor) ? "" : valor}
            step={tipo === "number" ? "any" : undefined} onChange={(e) => cambiar(e.target.value)}
          />
        )}
      </Campo>
    );
  }

  return (
    <form onSubmit={guardar} noValidate className="space-y-6" aria-label={`Ficha de ${props.entidad}`}>
      <MensajesOperacion
        operacion={op}
        textoRevision={guardado ? "Cargar ficha actual y conservar borrador" : "Revisé el listado; continuar captura"}
        alRevisar={() => {
          if (guardado) {
            setRespaldo(datos);
            setDatos(entradaInicial(props));
            setVersion(guardado.version);
            op.setMensaje("Versión actual cargada. Tu borrador anterior sigue disponible.");
          } else {
            op.setMensaje("Captura conservada. Confirma que el registro no existe antes de guardar de nuevo.");
          }
        }}
      />
      {op.conflicto && !guardado && (
        <p className="text-sm">
          Revisa el listado antes de repetir el alta. Si el registro ya existe, abre su ficha desde allí.
          {" "}<Link href={`/despacho/${ruta}`} target="_blank" className="underline">
            Abrir listado en otra pestaña
          </Link>
        </p>
      )}
      {respaldo && editable && (
        <Button
          type="button" variant="outline" disabled={op.pendiente || op.conflicto}
          onClick={() => {
            setDatos(respaldo);
            setRespaldo(null);
            op.setMensaje("Revisa tu borrador antes de guardar.");
          }}
        >
          Recuperar mi borrador
        </Button>
      )}
      {!editable && <p className="rounded-lg border p-4 text-sm">Consulta de gerencia · Solo lectura</p>}
      <fieldset disabled={!editable || op.pendiente} className="space-y-6">
        <section className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
          <h2 className="text-lg font-semibold">01 · Datos generales</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {"placa" in datos ? (
              <>
                {campo("placa", "Placa", datos.placa, (placa) => setDatos({ ...datos, placa }))}
                {campo("numeroEconomico", "Número económico (opcional)", datos.numeroEconomico ?? "",
                  (v) => setDatos({ ...datos, numeroEconomico: v || null }))}
                <Campo nombre="tipo" titulo="Tipo de unidad" prefijo={prefijo} errores={op.errores}>
                  {(a) => (
                    <select
                      {...a} className={CLASE_SELECT} value={datos.tipo}
                      onChange={(e) => setDatos({ ...datos, tipo: e.target.value as TipoUnidad })}
                    >
                      {TIPOS_UNIDAD.map((t) => <option key={t} value={t}>{ETIQUETA_UNIDAD[t]}</option>)}
                    </select>
                  )}
                </Campo>
                {campo("capacidadKg", "Capacidad (kg)", datos.capacidadKg,
                  (v) => setDatos({ ...datos, capacidadKg: v === "" ? NaN : Number(v) }), "number")}
                {campo("rendimientoKmL", "Rendimiento (km/L)", datos.rendimientoKmL,
                  (v) => setDatos({ ...datos, rendimientoKmL: v === "" ? NaN : Number(v) }), "number")}
                <Campo nombre="notas" titulo="Notas" prefijo={prefijo} errores={op.errores}>
                  {(a) => (
                    <Textarea
                      {...a} value={datos.notas ?? ""}
                      onChange={(e) => setDatos({ ...datos, notas: e.target.value || null })}
                    />
                  )}
                </Campo>
              </>
            ) : (
              <>
                {campo("nombre", "Nombre del operador", datos.nombre, (nombre) => setDatos({ ...datos, nombre }))}
                {campo("telefono", "Teléfono (opcional)", datos.telefono ?? "",
                  (v) => setDatos({ ...datos, telefono: v || null }), "tel")}
              </>
            )}
          </div>
          <Campo nombre="activo" titulo="Activo" prefijo={prefijo} errores={op.errores}>
            {(a) => (
              <input
                {...a} type="checkbox" checked={datos.activo} className="size-5 accent-primary"
                onChange={(e) => setDatos({ ...datos, activo: e.target.checked })}
              />
            )}
          </Campo>
        </section>
        <DocumentosFlota
          documentos={datos.documentos} catalogo={props.catalogo} entidad={props.entidad}
          cambiar={(documentos) => setDatos({ ...datos, documentos })} errores={op.errores} prefijo={prefijo}
        />
      </fieldset>
      {editable && (
        <Button type="submit" disabled={op.pendiente || op.conflicto}>
          {op.pendiente ? "Guardando…" : `Guardar ${props.entidad}`}
        </Button>
      )}
    </form>
  );
}
