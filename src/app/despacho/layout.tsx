/** Pendiente: T5 (Codex). Encabezado con usuarioDeLaSesion() y BotonSalir; lo que lee la sesión, dentro de <Suspense>. */
export default function DespachoLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>;
}
