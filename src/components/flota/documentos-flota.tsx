"use client";

import { Campo, CLASE_SELECT, type Errores } from "@/components/clientes/campos-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ETIQUETA_ESTADO_DOCUMENTO } from "@/dominio/clientes/etiquetas";
import { ESTADOS_DOCUMENTO, type EstadoDocumento } from "@/dominio/clientes/tipos";
import type { DocumentoRegistrado, TipoDocumento } from "@/dominio/flota/tipos";

export function documentosIniciales(catalogo: TipoDocumento[], documentos: DocumentoRegistrado[]) {
  return [
    ...documentos.map((d) => ({ ...d })),
    ...catalogo.filter((t) => !documentos.some((d) => d.tipoDocumentoId === t.id)).map((t) => ({
      tipoDocumentoId: t.id,
      obligatorio: t.obligatorioPorOmision,
      estado: "pendiente" as const,
      venceEl: null,
      notas: null,
    })),
  ];
}

export function DocumentosFlota({ documentos, catalogo, entidad, cambiar, errores, prefijo }: {
  documentos: DocumentoRegistrado[];
  catalogo: TipoDocumento[];
  entidad: "unidad" | "operador";
  cambiar: (documentos: DocumentoRegistrado[]) => void;
  errores: Errores;
  prefijo: string;
}) {
  function editar(indice: number, cambio: Partial<DocumentoRegistrado>) {
    cambiar(documentos.map((d, i) => i === indice ? { ...d, ...cambio } : d));
  }
  return (
    <section className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold">02 · Documentos</h2>
      <p className="text-sm text-muted-foreground">
        Ajusta qué documentos aplican. Un documento obligatorio pendiente o vencido impide salir.
      </p>
      <Campo nombre="documentos" titulo="Documentos del catálogo" prefijo={prefijo} errores={errores}>
        {(a) => (
          <div {...a} tabIndex={-1} className="space-y-5">
            {documentos.length === 0 && <p className="text-sm">No hay documentos en el catálogo.</p>}
            {documentos.map((d, i) => {
              const tipo = catalogo.find((t) => t.id === d.tipoDocumentoId);
              return (
                <fieldset key={d.tipoDocumentoId} className="space-y-4 rounded-lg border p-4">
                  <legend className="max-w-full px-1 text-sm font-medium break-words">
                    {tipo?.nombre ?? d.tipoDocumentoId}
                  </legend>
                  {tipo?.descripcion && <p className="text-sm text-muted-foreground">{tipo.descripcion}</p>}
                  <Campo
                    nombre={`documentos.${i}.obligatorio`}
                    titulo={`Obligatorio para ${entidad === "unidad" ? "esta unidad" : "este operador"}`}
                    prefijo={prefijo} errores={errores}
                  >
                    {(atributos) => (
                      <input
                        {...atributos} type="checkbox" role="switch" className="size-5 accent-primary"
                        checked={d.obligatorio} onChange={(e) => editar(i, { obligatorio: e.target.checked })}
                      />
                    )}
                  </Campo>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo nombre={`documentos.${i}.estado`} titulo="Estado" prefijo={prefijo} errores={errores}>
                      {(atributos) => (
                        <select
                          {...atributos} className={CLASE_SELECT} value={d.estado}
                          onChange={(e) => editar(i, { estado: e.target.value as EstadoDocumento })}
                        >
                          {ESTADOS_DOCUMENTO.map((v) => (
                            <option key={v} value={v}>{ETIQUETA_ESTADO_DOCUMENTO[v]}</option>
                          ))}
                        </select>
                      )}
                    </Campo>
                    <Campo
                      nombre={`documentos.${i}.venceEl`} titulo="Fecha de vencimiento"
                      prefijo={prefijo} errores={errores}
                    >
                      {(atributos) => (
                        <Input
                          {...atributos} type="date" value={d.venceEl ?? ""}
                          onChange={(e) => editar(i, { venceEl: e.target.value || null })}
                        />
                      )}
                    </Campo>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tipo?.requiereVencimiento
                      ? "Este tipo de documento requiere fecha de vencimiento cuando está vigente."
                      : "Deja la fecha vacía si el documento no vence."}
                  </p>
                  <Campo nombre={`documentos.${i}.notas`} titulo="Notas" prefijo={prefijo} errores={errores}>
                    {(atributos) => (
                      <Textarea
                        {...atributos} value={d.notas ?? ""}
                        onChange={(e) => editar(i, { notas: e.target.value || null })}
                      />
                    )}
                  </Campo>
                </fieldset>
              );
            })}
          </div>
        )}
      </Campo>
    </section>
  );
}
