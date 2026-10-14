import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SelectorFecha({ fecha, ruta }: { fecha: string; ruta: string }) {
  return (
    <form action={ruta} method="get" className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="fecha-consulta">Fecha de consulta</Label>
        <Input key={fecha} id="fecha-consulta" type="date" name="fecha" defaultValue={fecha} required />
      </div>
      <Button type="submit" variant="secondary">Ver fecha</Button>
    </form>
  );
}
