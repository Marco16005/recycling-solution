import { FormularioEntrar } from "./formulario-entrar";

export default function Entrar() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Recycling Solution</h1>
        <p className="text-sm text-muted-foreground">Entra con la cuenta que te dio el administrador.</p>
      </div>
      <FormularioEntrar />
    </main>
  );
}
