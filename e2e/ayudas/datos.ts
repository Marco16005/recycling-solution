/** Nombre que no se repite entre corridas ni entre pruebas; cada prueba crea sus propios clientes. */
export function nombreUnico(prefijo: string): string {
  return `${prefijo} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
