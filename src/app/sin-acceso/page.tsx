import { BotonSalir } from "@/components/sesion/boton-salir";

export default function SinAcceso() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Tu cuenta no tiene acceso a esta sección</h1>
      <p className="text-sm text-muted-foreground">
        Pide al administrador que revise tu rol. Si entraste con la cuenta equivocada, cierra la sesión.
      </p>
      <div>
        <BotonSalir />
      </div>
    </main>
  );
}
