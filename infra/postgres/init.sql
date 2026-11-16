-- Roda uma vez, quando o volume do Postgres é criado (docker-entrypoint-initdb.d).
-- Em produção, este papel é da infra (Terraform/console do provedor), não das migrations.
--
-- canteiro_owner    LOGIN · dono dos bancos e das tabelas · só migrations e seed
-- canteiro_app      NOLOGIN · runtime, sujeito a RLS (políticas são TO canteiro_app)
-- canteiro_sistema  NOLOGIN BYPASSRLS · só via SET LOCAL ROLE em packages/db/src/sistema.ts
-- canteiro_runtime  LOGIN · usuário do web e do worker:
--                     herda canteiro_app (INHERIT TRUE) → políticas se aplicam a ele;
--                     NÃO herda canteiro_sistema (INHERIT FALSE, SET TRUE) → só com SET ROLE explícito.
--                     BYPASSRLS é atributo e nunca é herdado, por isso o SET ROLE é obrigatório.

CREATE ROLE canteiro_owner LOGIN PASSWORD 'owner_dev';
CREATE ROLE canteiro_app NOLOGIN;
CREATE ROLE canteiro_sistema NOLOGIN BYPASSRLS;
CREATE ROLE canteiro_runtime LOGIN PASSWORD 'runtime_dev' NOINHERIT;

GRANT canteiro_app TO canteiro_runtime WITH INHERIT TRUE, SET TRUE;
GRANT canteiro_sistema TO canteiro_runtime WITH INHERIT FALSE, SET TRUE;

CREATE DATABASE canteirocheck OWNER canteiro_owner;
CREATE DATABASE canteirocheck_test OWNER canteiro_owner;
