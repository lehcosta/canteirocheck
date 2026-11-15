import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Campo({
  rotulo,
  nome,
  className,
  ...props
}: { rotulo: string; nome: string } & Omit<React.ComponentProps<"input">, "name" | "id">) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={nome}>{rotulo}</Label>
      <Input id={nome} name={nome} {...props} />
    </div>
  );
}

export function CampoSelect({
  rotulo,
  nome,
  opcoes,
  vazio,
  className,
  ...props
}: {
  rotulo: string;
  nome: string;
  opcoes: { valor: string; rotulo: string }[];
  vazio?: string;
} & Omit<React.ComponentProps<"select">, "name" | "id">) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={nome}>{rotulo}</Label>
      <select
        id={nome}
        name={nome}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        {...props}
      >
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}
