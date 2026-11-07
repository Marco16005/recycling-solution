export const ROLES = ["admin", "despachador", "operador", "gerencia"] as const;
export type Rol = (typeof ROLES)[number];

export interface UsuarioSesion {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  /** Entró con una contraseña temporal: solo puede cambiarla (diseño del 2026-11-07). Si falta, vale false. */
  debeCambiarClave?: boolean;
}

/** Matriz de la especificación §10. admin puede todo; un rol que no aparece no puede. */
export const PERMISOS = {
  "clientes.ver": ["despachador", "gerencia"],
  "clientes.editar": ["despachador"],
  "clientes.importar": ["despachador"],
  /** Plan CRM: el archivo lleva teléfonos y correos; cada exportación queda en la bitácora. */
  "clientes.exportar": ["despachador"],
  "usuarios.gestionar": [],
  /** Cada quien cambia su propia contraseña; es lo único que se permite mientras tenga una temporal. */
  "cuenta.cambiarClave": ["despachador", "operador", "gerencia"],
  "flota.ver": ["despachador", "gerencia"],
  "flota.editar": ["despachador"],
  "jornada.gestionar": ["despachador"],
  "solicitudes.ver": ["despachador", "gerencia"],
  "solicitudes.registrar": ["despachador"],
  "solicitudes.cancelar": ["despachador"],
  "configuracion.editar": [],
  "planes.ver": ["despachador", "gerencia"],
  "planes.generar": ["despachador"],
  "planes.validar": ["despachador"],
  "ruta.operar": ["operador"],
  "operacion.ver": ["despachador", "gerencia"],
  "operacion.conciliar": ["despachador"],
  "incidentes.resolver": ["despachador"],
  "indicadores.ver": ["despachador", "gerencia"],
} as const satisfies Record<string, readonly Rol[]>;

export type Permiso = keyof typeof PERMISOS;

export class NoAutenticado extends Error {
  constructor() {
    super("No hay una sesión activa");
    this.name = "NoAutenticado";
  }
}

export class NoAutorizado extends Error {
  constructor() {
    super("Tu rol no permite esta acción");
    this.name = "NoAutorizado";
  }
}

export function puede(usuario: UsuarioSesion | null, permiso: Permiso): boolean {
  if (usuario === null || !usuario.activo) return false;
  if (usuario.debeCambiarClave === true && permiso !== "cuenta.cambiarClave") return false;
  if (usuario.rol === "admin") return true;
  return (PERMISOS[permiso] as readonly Rol[]).includes(usuario.rol);
}

/** Devuelve al usuario si puede actuar. Lanza NoAutenticado (sin sesión o inactivo) o NoAutorizado. */
export function autorizar(usuario: UsuarioSesion | null, permiso: Permiso): UsuarioSesion {
  if (usuario === null || !usuario.activo) throw new NoAutenticado();
  if (!puede(usuario, permiso)) throw new NoAutorizado();
  return usuario;
}
