"use client";

import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import { DIAS_SEMANA } from "@/dominio/clientes/etiquetas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo, CLASE_SELECT, type Errores } from "./campos-formulario";

export function ContactosRecurrencia({ datos, cambiar, prefijo, errores, editable }: {
  datos: ClienteEntrada;
  cambiar: <K extends keyof ClienteEntrada>(campo: K, valor: ClienteEntrada[K]) => void;
  prefijo: string;
  errores: Errores;
  editable: boolean;
}) {
  const contactos = datos.contactosAdicionales ?? [];
  const recurrencia = datos.recurrencia;
  return <>
    <section aria-label="Contactos" className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Contactos</h2>
      <h3 className="text-sm font-medium">Contacto principal</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {([["contactoNombre", "Nombre del contacto", "text"], ["contactoTelefono", "Teléfono", "tel"], ["contactoCorreo", "Correo electrónico", "email"], ["contactoPuesto", "Puesto", "text"]] as const).map(([nombre, titulo, tipo]) =>
          <Campo key={nombre} nombre={nombre} titulo={titulo} prefijo={prefijo} errores={errores}>{(a) =>
            <Input {...a} type={tipo} value={datos[nombre] ?? ""} onChange={(e) => cambiar(nombre, e.target.value || null)} />
          }</Campo>)}
      </div>
      {contactos.map((contacto, i) => <div key={i} className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Contacto adicional {i + 1}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {([["nombre", "Nombre", "text"], ["puesto", "Puesto", "text"], ["telefono", "Teléfono", "tel"], ["correo", "Correo electrónico", "email"]] as const).map(([nombre, titulo, tipo]) =>
            <Campo key={nombre} nombre={`contactosAdicionales.${i}.${nombre}`} titulo={`${titulo} · contacto ${i + 1}`} prefijo={prefijo} errores={errores}>{(a) =>
              <Input {...a} type={tipo} value={contacto[nombre] ?? ""} onChange={(e) => cambiar("contactosAdicionales", contactos.map((c, j) => j === i ? { ...c, [nombre]: e.target.value || (nombre === "nombre" ? "" : null) } : c))} />
            }</Campo>)}
        </div>
        {editable && <Button type="button" variant="ghost" aria-label={`Quitar contacto ${i + 1}`} onClick={() => cambiar("contactosAdicionales", contactos.filter((_, j) => j !== i))}>Quitar contacto</Button>}
      </div>)}
      {editable && <Button type="button" variant="outline" disabled={contactos.length >= 10} onClick={() => cambiar("contactosAdicionales", [...contactos, { nombre: "", puesto: null, telefono: null, correo: null }])}>Agregar contacto</Button>}
      <p className="text-xs text-muted-foreground">Hasta 10 contactos adicionales. Se guardan con la ficha.</p>
    </section>
    <section aria-label="Recurrencia" className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Recurrencia</h2>
      <p className="text-sm text-muted-foreground">Días fijos opcionales. Las recolecciones se proponen y requieren confirmación.</p>
      <Campo nombre="recurrencia" titulo="Frecuencia de recolección" prefijo={prefijo} errores={errores}>{(a) =>
        <select {...a} className={CLASE_SELECT} value={recurrencia?.tipo ?? ""} onChange={(e) => cambiar("recurrencia", e.target.value === "dias_semana" ? { tipo: "dias_semana", dias: [] } : e.target.value === "cada_n_dias" ? { tipo: "cada_n_dias", cadaDias: 7, desde: "" } : null)}>
          <option value="">Sin recurrencia fija</option><option value="dias_semana">Días de la semana</option><option value="cada_n_dias">Cada N días</option>
        </select>
      }</Campo>
      {recurrencia?.tipo === "dias_semana" && <Campo nombre="recurrencia.dias" titulo="Días de recolección" prefijo={prefijo} errores={errores}>{(a) =>
        <div {...a} role="group" tabIndex={-1} className="flex flex-wrap gap-4">{[1, 2, 3, 4, 5, 6, 0].map((dia) => <label key={dia} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recurrencia.dias.includes(dia)} onChange={(e) => cambiar("recurrencia", { ...recurrencia, dias: e.target.checked ? [...recurrencia.dias, dia] : recurrencia.dias.filter((d) => d !== dia) })} />{DIAS_SEMANA[dia]}</label>)}</div>
      }</Campo>}
      {recurrencia?.tipo === "cada_n_dias" && <div className="grid gap-4 sm:grid-cols-2">
        <Campo nombre="recurrencia.cadaDias" titulo="Cada cuántos días" prefijo={prefijo} errores={errores}>{(a) => <Input {...a} type="number" min={2} max={90} value={recurrencia.cadaDias} onChange={(e) => cambiar("recurrencia", { ...recurrencia, cadaDias: Number(e.target.value) })} />}</Campo>
        <Campo nombre="recurrencia.desde" titulo="A partir de" prefijo={prefijo} errores={errores}>{(a) => <Input {...a} type="date" value={recurrencia.desde} onChange={(e) => cambiar("recurrencia", { ...recurrencia, desde: e.target.value })} />}</Campo>
      </div>}
    </section>
  </>;
}
