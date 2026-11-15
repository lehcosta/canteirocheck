import { listarUsuarios } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { criarObraAction } from "@/features/obras/actions";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Nova obra" };

export default async function NovaObra() {
  const s = await exigirSessao();
  if (s.papel !== "admin") redirect("/obras");
  const engenheiros = (await listarUsuarios(s.contexto)).filter((u) => u.papel === "engenheiro" && u.ativo);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Nova obra</CardTitle>
        <CardDescription>O engenheiro responsável entra na equipe da obra automaticamente.</CardDescription>
      </CardHeader>
      <CardContent>
        {engenheiros.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cadastre ao menos um engenheiro em{" "}
            <a className="underline" href="/configuracoes/usuarios">
              Usuários
            </a>{" "}
            antes de criar uma obra.
          </p>
        ) : (
          <FormularioAcao acao={criarObraAction} className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome da obra" nome="nome" required className="sm:col-span-2" />
            <Campo rotulo="Endereço" nome="endereco" className="sm:col-span-2" />
            <Campo rotulo="Área (m²)" nome="areaM2" inputMode="decimal" placeholder="1250,50" />
            <Campo
              rotulo="Horário da pergunta diária"
              nome="horarioAnuncio"
              type="time"
              defaultValue="16:00"
            />
            <CampoSelect
              rotulo="Engenheiro responsável"
              nome="engenheiroResponsavelId"
              required
              vazio="Selecione…"
              opcoes={engenheiros.map((e) => ({ valor: e.id, rotulo: e.nome }))}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <Button type="submit">Criar obra</Button>
            </div>
          </FormularioAcao>
        )}
      </CardContent>
    </Card>
  );
}
