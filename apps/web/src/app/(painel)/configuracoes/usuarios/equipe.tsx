import type { UsuarioListado } from "@canteirocheck/servicos";
import { Check } from "lucide-react";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { definirAtivoAction } from "@/features/usuarios/actions";
import { formatarWhatsapp, PAPEL } from "@/lib/rotulos";
import { cn } from "@/lib/utils";

/**
 * Lista da equipe. Tabela quando a seção tem largura (container ≥ 42rem);
 * cartões empilhados quando é estreita (celular, tablet), para o botão não sair da tela.
 */
export function Equipe({
  usuarios,
  usuarioId,
  ehAdmin,
  idTitulo,
}: {
  usuarios: UsuarioListado[];
  usuarioId: string;
  ehAdmin: boolean;
  idTitulo: string;
}) {
  return (
    <div className="@container">
      <div className="hidden rounded-md border bg-card @2xl:block">
        <Table aria-labelledby={idTitulo}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">Nome e e-mail</TableHead>
              <TableHead className="px-4">Papel</TableHead>
              <TableHead className="px-4">WhatsApp</TableHead>
              <TableHead className="px-4">Situação</TableHead>
              {ehAdmin && <TableHead className="px-4 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((u) => (
              <TableRow key={u.id} className={cn(!u.ativo && "text-muted-foreground")}>
                <TableCell className="px-4 whitespace-normal">
                  <p className="font-semibold">{u.nome}</p>
                  {u.email && (
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{u.email}</p>
                  )}
                </TableCell>
                <TableCell className="px-4">{PAPEL[u.papel]}</TableCell>
                <TableCell className="px-4 font-mono text-sm tabular-nums">
                  {formatarWhatsapp(u.whatsappE164)}
                </TableCell>
                <TableCell className="px-4">
                  <Situacao ativo={u.ativo} />
                </TableCell>
                {ehAdmin && (
                  <TableCell className="px-4 py-2 text-right">
                    <Acao usuario={u} eVoce={u.id === usuarioId} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul aria-labelledby={idTitulo} className="divide-y rounded-md border bg-card @2xl:hidden">
        {usuarios.map((u) => (
          <li key={u.id} className={cn("flex flex-col gap-3 p-4", !u.ativo && "text-muted-foreground")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{u.nome}</p>
                <p className="text-sm text-muted-foreground">{PAPEL[u.papel]}</p>
              </div>
              <Situacao ativo={u.ativo} />
            </div>
            <dl className="grid gap-1 text-[15px]">
              {u.email && (
                <div>
                  <dt className="sr-only">E-mail</dt>
                  <dd className="[overflow-wrap:anywhere]">{u.email}</dd>
                </div>
              )}
              <div>
                <dt className="sr-only">WhatsApp</dt>
                <dd className="font-mono text-sm tabular-nums">{formatarWhatsapp(u.whatsappE164)}</dd>
              </div>
            </dl>
            {ehAdmin && <Acao usuario={u} eVoce={u.id === usuarioId} cheio />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Situacao({ ativo }: { ativo: boolean }) {
  return ativo ? (
    <Badge variant="nivel">
      <Check aria-hidden strokeWidth={3} />
      Ativo
    </Badge>
  ) : (
    <Badge variant="secondary">Inativo</Badge>
  );
}

/** Desativar / Reativar. A própria conta não se desativa: mostra "Você". */
function Acao({ usuario, eVoce, cheio }: { usuario: UsuarioListado; eVoce: boolean; cheio?: boolean }) {
  if (eVoce) return <span className="text-sm text-muted-foreground">Você</span>;
  const rotulo = usuario.ativo ? "Desativar" : "Reativar";
  return (
    <FormularioAcao
      acao={definirAtivoAction}
      className={cn("flex flex-col gap-1 space-y-0", cheio ? "items-stretch" : "items-end")}
    >
      <input type="hidden" name="usuarioId" value={usuario.id} />
      <input type="hidden" name="ativo" value={String(!usuario.ativo)} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        aria-label={`${rotulo} ${usuario.nome}`}
        className={cn("min-h-11", !usuario.ativo && "border-foreground", cheio && "w-full")}
      >
        {rotulo}
      </Button>
    </FormularioAcao>
  );
}
