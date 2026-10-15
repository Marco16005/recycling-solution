"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  cambiarRolAccion, crearUsuarioAccion, darDeBajaAccion, reactivarAccion, restablecerClaveAccion,
} from "@/acciones/usuarios";
import type { Resultado } from "@/acciones/tipos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FilaUsuario, ListadoUsuarios } from "@/consultas/usuarios";
import { ROLES, type Rol } from "@/seguridad/permisos";
import { useHidratado } from "./hidratado";

const ETIQUETA_ROL: Record<Rol, string> = {
  admin: "Administrador",
  despachador: "Despachador",
  operador: "Operador",
  gerencia: "Gerencia",
};

const CLASE_SELECT = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";

type Fallo = Extract<Resultado<never>, { ok: false }>;

/** Mensajes legibles de un fallo; sin sesión, a /entrar. */
function mensajes(r: Fallo, irAEntrar: () => void): string[] {
  if (r.error === "no_autenticado") {
    irAEntrar();
    return [];
  }
  if (r.error === "no_autorizado") return ["Tu cuenta ya no puede administrar usuarios."];
  if (r.error === "no_encontrado") return ["El usuario ya no existe. Recarga la página."];
  if (r.error === "invalido") return Object.values(r.campos).flat();
  return ["Alguien más cambió este usuario. Recarga la página y vuelve a intentarlo."];
}

export function TablaUsuarios({ usuarios, operadoresSinUsuario, usuarioActualId }: ListadoUsuarios) {
  const router = useRouter();
  const hidratado = useHidratado();
  const [enCurso, iniciar] = useTransition();
  const pendiente = enCurso || !hidratado;
  const [errores, setErrores] = useState<string[]>([]);
  const [clave, setClave] = useState<{ correo: string; clave: string } | null>(null);
  const [nuevo, setNuevo] = useState<{ correo: string; nombre: string; rol: Rol; operadorId: string }>({
    correo: "", nombre: "", rol: "despachador", operadorId: "",
  });

  function ejecutar<T>(accion: () => Promise<Resultado<T>>, alTerminar?: (valor: T) => void) {
    setErrores([]);
    iniciar(async () => {
      const r = await accion();
      if (!r.ok) {
        setErrores(mensajes(r, () => router.replace("/entrar")));
        return;
      }
      alTerminar?.(r.valor);
      router.refresh();
    });
  }

  function crear(evento: FormEvent) {
    evento.preventDefault();
    const entrada = { ...nuevo, operadorId: nuevo.rol === "operador" ? nuevo.operadorId || null : null };
    ejecutar(
      () => crearUsuarioAccion(entrada),
      (v) => {
        setClave({ correo: nuevo.correo.trim().toLowerCase(), clave: v.claveTemporal });
        setNuevo({ correo: "", nombre: "", rol: "despachador", operadorId: "" });
      },
    );
  }

  return (
    <div className="space-y-6">
      {errores.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-background p-4 text-sm">
          <ul className="list-inside list-disc">{errores.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {clave && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-600/40 bg-background p-4 text-sm">
          <p>
            Contraseña temporal de <strong>{clave.correo}</strong>. Cópiala y entrégala en persona; no se volverá a mostrar:
          </p>
          <p className="font-mono text-lg tracking-wider">{clave.clave}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setClave(null)}>Ya la entregué</Button>
        </div>
      )}

      <form onSubmit={crear} className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-5" aria-label="Nuevo usuario">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="nuevo-correo">Correo</Label>
          <Input id="nuevo-correo" type="email" required value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nuevo-nombre">Nombre</Label>
          <Input id="nuevo-nombre" required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nuevo-rol">Rol</Label>
          <select id="nuevo-rol" className={CLASE_SELECT} value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })}>
            {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
          </select>
        </div>
        {nuevo.rol === "operador" ? (
          <div className="space-y-2">
            <Label htmlFor="nuevo-operador">Ficha de operador</Label>
            <select id="nuevo-operador" className={CLASE_SELECT} value={nuevo.operadorId} onChange={(e) => setNuevo({ ...nuevo, operadorId: e.target.value })}>
              <option value="">Elige…</option>
              {operadoresSinUsuario.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        ) : <div />}
        <div className="sm:col-span-5">
          <Button type="submit" disabled={pendiente}>{enCurso ? "Guardando…" : "Crear usuario"}</Button>
        </div>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuario</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((u) => (
            <FilaDeUsuario
              key={`${u.id}-${u.version}`}
              usuario={u}
              esActual={u.id === usuarioActualId}
              operadoresSinUsuario={operadoresSinUsuario}
              pendiente={pendiente}
              alCambiarRol={(rol, operadorId) => ejecutar(() => cambiarRolAccion(u.id, u.version, { rol, operadorId }))}
              alDesactivar={() => ejecutar(() => darDeBajaAccion(u.id, u.version))}
              alReactivar={() => ejecutar(() => reactivarAccion(u.id, u.version))}
              alRestablecer={() => ejecutar(() => restablecerClaveAccion(u.id, u.version), (v) => setClave({ correo: u.correo, clave: v.claveTemporal }))}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FilaDeUsuario(props: {
  usuario: FilaUsuario;
  esActual: boolean;
  operadoresSinUsuario: ListadoUsuarios["operadoresSinUsuario"];
  pendiente: boolean;
  alCambiarRol: (rol: Rol, operadorId: string | null) => void;
  alDesactivar: () => void;
  alReactivar: () => void;
  alRestablecer: () => void;
}) {
  const { usuario: u, esActual, pendiente } = props;
  const [rol, setRol] = useState<Rol>(u.rol);
  const [operadorId, setOperadorId] = useState(u.operadorId ?? "");
  const cambio = rol !== u.rol || (rol === "operador" && operadorId !== (u.operadorId ?? ""));

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <p className="font-medium">{u.nombre}{esActual && " (tú)"}</p>
        <p className="text-xs text-muted-foreground">{u.correo}</p>
      </TableCell>
      <TableCell className="min-w-56 space-y-2">
        <select aria-label={`Rol de ${u.nombre}`} className={CLASE_SELECT} value={rol} disabled={esActual || pendiente} onChange={(e) => setRol(e.target.value as Rol)}>
          {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
        </select>
        {rol === "operador" && (
          <select aria-label={`Ficha de operador de ${u.nombre}`} className={CLASE_SELECT} value={operadorId} disabled={esActual || pendiente} onChange={(e) => setOperadorId(e.target.value)}>
            <option value="">Elige la ficha…</option>
            {u.operadorId && <option value={u.operadorId}>Ficha actual</option>}
            {props.operadoresSinUsuario.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        )}
        {cambio && (
          <Button type="button" size="sm" disabled={pendiente} onClick={() => props.alCambiarRol(rol, rol === "operador" ? operadorId || null : null)}>
            Guardar rol (cierra sus sesiones)
          </Button>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={u.activo ? "secondary" : "outline"}>{u.activo ? "Activo" : "Desactivado"}</Badge>
      </TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        {u.activo ? (
          <Button type="button" variant="outline" size="sm" disabled={esActual || pendiente} onClick={props.alDesactivar}>Desactivar</Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pendiente} onClick={props.alReactivar}>Reactivar</Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={pendiente} onClick={props.alRestablecer}>Restablecer contraseña</Button>
      </TableCell>
    </TableRow>
  );
}
