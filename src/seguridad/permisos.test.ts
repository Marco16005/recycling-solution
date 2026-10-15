import { describe, expect, it } from "vitest";
import { autorizar, NoAutenticado, NoAutorizado, PERMISOS, puede, ROLES, type Permiso, type Rol, type UsuarioSesion } from "./permisos";

const usuario = (rol: Rol, activo = true): UsuarioSesion => ({ id: "u1", nombre: "Prueba", rol, activo });

/** La matriz esperada, escrita a mano a partir de la especificación §10. */
const ESPERADO: Record<Permiso, Rol[]> = {
  "clientes.ver": ["admin", "despachador", "gerencia"],
  "clientes.editar": ["admin", "despachador"],
  "clientes.importar": ["admin", "despachador"],
  "usuarios.gestionar": ["admin"],
  "flota.ver": ["admin", "despachador", "gerencia"],
  "flota.editar": ["admin", "despachador"],
  "jornada.gestionar": ["admin", "despachador"],
  "solicitudes.ver": ["admin", "despachador", "gerencia"],
  "solicitudes.registrar": ["admin", "despachador"],
  "solicitudes.cancelar": ["admin", "despachador"],
  "configuracion.editar": ["admin"],
  "planes.ver": ["admin", "despachador", "gerencia"],
  "planes.generar": ["admin", "despachador"],
  "planes.validar": ["admin", "despachador"],
  "ruta.operar": ["admin", "operador"],
  "operacion.ver": ["admin", "despachador", "gerencia"],
  "operacion.conciliar": ["admin", "despachador"],
  "incidentes.resolver": ["admin", "despachador"],
  "indicadores.ver": ["admin", "despachador", "gerencia"],
};

describe("matriz de permisos", () => {
  for (const permiso of Object.keys(PERMISOS) as Permiso[]) {
    for (const rol of ROLES) {
      const permitido = ESPERADO[permiso].includes(rol);
      it(`${rol} ${permitido ? "puede" : "no puede"} ${permiso}`, () => {
        expect(puede(usuario(rol), permiso)).toBe(permitido);
        if (permitido) expect(autorizar(usuario(rol), permiso).rol).toBe(rol);
        else expect(() => autorizar(usuario(rol), permiso)).toThrow(NoAutorizado);
      });
    }
  }

  it("sin sesión no se autentica", () => {
    expect(puede(null, "clientes.ver")).toBe(false);
    expect(() => autorizar(null, "clientes.ver")).toThrow(NoAutenticado);
  });

  it("un usuario inactivo no se autentica, aunque sea admin", () => {
    expect(puede(usuario("admin", false), "clientes.ver")).toBe(false);
    expect(() => autorizar(usuario("admin", false), "clientes.ver")).toThrow(NoAutenticado);
  });
});
