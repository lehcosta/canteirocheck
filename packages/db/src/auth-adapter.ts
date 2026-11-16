/**
 * Conexão para o adaptador Drizzle do Better Auth.
 * Roda como canteiro_runtime fora de withTenant: enxerga só as tabelas de auth (sem RLS).
 * Qualquer leitura de tabela de cliente por aqui volta vazia (falha fechada).
 * Não use para mais nada.
 */
export { obterDb as obterDbParaAuth } from "./cliente";
export * as schemaAuth from "./schema/auth";
