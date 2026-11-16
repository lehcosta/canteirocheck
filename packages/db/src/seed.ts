/**
 * Cenário obrigatório da §10 do prompt: Construtora Exemplo, Edifício Teste, Eng. Ana, encarregado João,
 * Lajes L3 (já concretada) e L4, e os 3 pontos aprovados para a concretagem da L4.
 * Idempotente: se a construtora já existe, não faz nada.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { criarTenantComAdmin, type DbDono, semearEtapas } from "./plataforma";
import * as schema from "./schema";
import { SEED } from "./seed-dados";

export { SEED };

export async function semearCenario(db: DbDono): Promise<{ tenantId: string; criado: boolean }> {
  await semearEtapas(db);

  const [existente] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.cnpj, SEED.cnpj));
  if (existente) return { tenantId: existente.id, criado: false };

  const { tenantId, adminUsuarioId } = await criarTenantComAdmin(db, {
    nome: "Construtora Exemplo",
    cnpj: SEED.cnpj,
    admin: SEED.admin,
  });

  await db.transaction(async (tx) => {
    const anaAuthId = randomUUID();
    await tx
      .insert(schema.auth_user)
      .values({ id: anaAuthId, name: SEED.ana.nome, email: SEED.ana.email, emailVerified: true });

    const [ana] = await tx
      .insert(schema.usuario)
      .values({
        tenantId,
        nome: SEED.ana.nome,
        email: SEED.ana.email,
        whatsappE164: SEED.ana.whatsappE164,
        papel: "engenheiro",
        authUserId: anaAuthId,
      })
      .returning({ id: schema.usuario.id });
    const [joao] = await tx
      .insert(schema.usuario)
      .values({ tenantId, nome: SEED.joao.nome, whatsappE164: SEED.joao.whatsappE164, papel: "encarregado" })
      .returning({ id: schema.usuario.id });
    if (!ana || !joao) throw new Error("falha ao criar usuários do seed");

    const [obra] = await tx
      .insert(schema.obra)
      .values({
        tenantId,
        nome: "Edifício Teste",
        endereco: "Rua Exemplo, 100 — São Paulo/SP",
        engenheiroResponsavelId: ana.id,
      })
      .returning({ id: schema.obra.id });
    if (!obra) throw new Error("falha ao criar obra do seed");

    await tx.insert(schema.obraMembro).values([
      { tenantId, obraId: obra.id, usuarioId: ana.id, papel: "engenheiro" },
      { tenantId, obraId: obra.id, usuarioId: joao.id, papel: "encarregado" },
    ]);

    const [l3] = await tx
      .insert(schema.local)
      .values({ tenantId, obraId: obra.id, tipo: "laje", nome: "L3" })
      .returning({ id: schema.local.id });
    const [l4] = await tx
      .insert(schema.local)
      .values({ tenantId, obraId: obra.id, tipo: "laje", nome: "L4" })
      .returning({ id: schema.local.id });
    if (!l3 || !l4) throw new Error("falha ao criar locais do seed");

    const [concretagem] = await tx
      .select({ id: schema.etapa.id })
      .from(schema.etapa)
      .where(eq(schema.etapa.codigo, "concretagem"));
    if (!concretagem) throw new Error("etapa concretagem não encontrada");

    await tx.insert(schema.toleranciaPadrao).values({
      tenantId,
      grandeza: "nivel",
      toleranciaMais: "0.0100",
      toleranciaMenos: "0.0100",
      unidade: "m",
    });

    const base = {
      tenantId,
      obraId: obra.id,
      etapaId: concretagem.id,
      localId: l4.id,
      regiao: "Laje L4",
      grandeza: "nivel" as const,
      unidade: "m" as const,
      origem: "manual" as const,
      statusRevisao: "aprovado" as const,
      referenciaNivel: "RN-01",
      revisadoPorId: ana.id,
      revisadoEm: new Date(),
    };
    await tx.insert(schema.pontoControle).values([
      {
        ...base,
        descricao: "Nível do fundo da forma — eixo A",
        valorEsperado: "6.0000",
        toleranciaMais: "0.0100",
        toleranciaMenos: "0.0100",
      },
      {
        ...base,
        descricao: "Nível do fundo da forma — eixo B",
        valorEsperado: "6.0000",
        toleranciaMais: "0.0100",
        toleranciaMenos: "0.0100",
      },
      {
        ...base,
        descricao: "Interface L3/L4 — borda da L3 (concretada) × forma da L4 no mesmo ponto",
        valorEsperado: "6.0000",
        toleranciaMais: "0.0050",
        toleranciaMenos: "0.0050",
        ehInterface: true,
        localReferenciaId: l3.id,
        exigeFoto: true,
      },
    ]);

    await tx.insert(schema.auditLog).values({
      tenantId,
      atorTipo: "sistema",
      atorId: adminUsuarioId,
      acao: "seed.cenario_l3_l4",
      entidade: "obra",
      entidadeId: obra.id,
      depois: { obra: "Edifício Teste", pontos: 3 },
    });
  });

  return { tenantId, criado: true };
}
