/** Dados fixos do cenário da §10 (sem dependências: pode ser importado pelo simulador). */
export const SEED = {
  cnpj: "00000000000191",
  admin: { nome: "Admin Exemplo", email: "admin@exemplo.test", whatsappE164: "+5511900000001" },
  ana: { nome: "Eng. Ana", email: "ana@exemplo.test", whatsappE164: "+5511900000002" },
  joao: { nome: "João", whatsappE164: "+5511900000003" },
} as const;
