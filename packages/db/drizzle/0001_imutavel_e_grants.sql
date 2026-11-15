-- ════════════════════ Grants + imutabilidade (migration custom, revisada à mão) ════════════════════
-- Roda como o dono das tabelas (canteiro_owner).
--
-- ATENÇÃO ao criar tabelas novas em migrations futuras:
--   • os DEFAULT PRIVILEGES abaixo já dão SELECT/INSERT/UPDATE/DELETE aos papéis de runtime;
--   • se a tabela nova for append-only, repita o REVOKE e os triggers dela na mesma migration;
--   • se for de cliente, ela PRECISA de tenant_id + isolamentoTenant() (o teste de isolamento falha sem isso).

GRANT USAGE ON SCHEMA public TO canteiro_app, canteiro_sistema;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO canteiro_app, canteiro_sistema;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO canteiro_app, canteiro_sistema;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO canteiro_app, canteiro_sistema;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO canteiro_app, canteiro_sistema;--> statement-breakpoint

-- Catálogo global: só leitura em runtime (o seed roda como dono).
REVOKE INSERT, UPDATE, DELETE ON etapa FROM canteiro_app, canteiro_sistema;--> statement-breakpoint
-- Tenants são criados pela plataforma (CLI criar-tenant / seed), não pelo app.
REVOKE INSERT, UPDATE, DELETE ON tenant FROM canteiro_app;--> statement-breakpoint

-- Append-only, 1ª camada: runtime não tem UPDATE/DELETE/TRUNCATE.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, liberacao, verificacao, divergencia
  FROM canteiro_app, canteiro_sistema;--> statement-breakpoint

-- Append-only, 2ª camada: trigger que vale até para o dono das tabelas.
-- Corrigir dado exige desligar o trigger explicitamente numa migration revisada.
CREATE OR REPLACE FUNCTION bloquear_alteracao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% é append-only: % não permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log', 'liberacao', 'verificacao', 'divergencia'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %1$s_sem_update_delete BEFORE UPDATE OR DELETE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao()', t);
    EXECUTE format(
      'CREATE TRIGGER %1$s_sem_truncate BEFORE TRUNCATE ON %1$I
         FOR EACH STATEMENT EXECUTE FUNCTION bloquear_alteracao()', t);
  END LOOP;
END $$;
