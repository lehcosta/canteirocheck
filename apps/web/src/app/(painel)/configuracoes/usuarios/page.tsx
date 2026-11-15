import { listarUsuarios } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { criarUsuarioAction, definirAtivoAction } from "@/features/usuarios/actions";
import { formatarWhatsapp, PAPEL } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Usuários" };

export default async function Usuarios() {
  const s = await exigirSessao();
  const usuarios = await listarUsuarios(s.contexto);
  const ehAdmin = s.papel === "admin";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Usuários</CardTitle>
          <CardDescription>
            Admin e engenheiro entram no painel com o e-mail. Encarregado usa só o WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Situação</TableHead>
                {ehAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell>{PAPEL[u.papel]}</TableCell>
                  <TableCell>{u.email ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{formatarWhatsapp(u.whatsappE164)}</TableCell>
                  <TableCell>
                    <Badge variant={u.ativo ? "outline" : "secondary"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
                  </TableCell>
                  {ehAdmin && (
                    <TableCell className="text-right">
                      {u.id !== s.usuarioId && (
                        <FormularioAcao acao={definirAtivoAction}>
                          <input type="hidden" name="usuarioId" value={u.id} />
                          <input type="hidden" name="ativo" value={String(!u.ativo)} />
                          <Button type="submit" variant="ghost" size="sm">
                            {u.ativo ? "Desativar" : "Reativar"}
                          </Button>
                        </FormularioAcao>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {ehAdmin && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Novo usuário</CardTitle>
          </CardHeader>
          <CardContent>
            <FormularioAcao acao={criarUsuarioAction} className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome" nome="nome" required />
              <CampoSelect
                rotulo="Papel"
                nome="papel"
                required
                defaultValue="encarregado"
                opcoes={Object.entries(PAPEL).map(([valor, rotulo]) => ({ valor, rotulo }))}
              />
              <Campo rotulo="E-mail (obrigatório para admin e engenheiro)" nome="email" type="email" />
              <Campo
                rotulo="WhatsApp"
                nome="whatsapp"
                required
                inputMode="tel"
                placeholder="(11) 99999-8888"
              />
              <div className="sm:col-span-2">
                <Button type="submit">Criar usuário</Button>
              </div>
            </FormularioAcao>
          </CardContent>
        </Card>
      )}
    </>
  );
}
