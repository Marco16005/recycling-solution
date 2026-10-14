import type { EstadoPrivacidad } from "@/dominio/clientes/tipos";
import type { Contexto, Resultado } from "./tipos";

/**
 * Crea (id null, versionEsperada null) o actualiza un cliente. Permiso clientes.editar.
 * Si la versión no coincide responde "conflicto" y no escribe nada. Cliente, ventanas, documentos y bitácora van en una transacción.
 */
export async function guardarCliente(
  ctx: Contexto,
  id: unknown,
  versionEsperada: unknown,
  entrada: unknown,
): Promise<Resultado<{ id: string; version: number }>> {
  void ctx;
  void id;
  void versionEsperada;
  void entrada;
  throw new Error("pendiente: T4 (Claude)");
}

/** Agrega un movimiento del aviso de privacidad con la versión vigente. Permiso clientes.editar. */
export async function registrarPrivacidad(
  ctx: Contexto,
  clienteId: unknown,
  entrada: unknown,
): Promise<Resultado<{ privacidad: EstadoPrivacidad }>> {
  void ctx;
  void clienteId;
  void entrada;
  throw new Error("pendiente: T4 (Claude)");
}
