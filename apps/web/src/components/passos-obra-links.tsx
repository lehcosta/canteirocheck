"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Os dois caminhos do passo 4 na faixa. Na aba Pontos eles somem: lá o próprio vazio já traz os dois botões. */
export function LinksDoPasso4({ obraId }: { obraId: string }) {
  const caminho = usePathname();
  if (caminho.endsWith("/pontos")) return null;
  return (
    <p className="flex gap-3 pt-1.5 text-[13px] leading-[18px] font-semibold text-prumo-text">
      <Link href={`/obras/${obraId}/projetos`} className="hover:underline">
        Enviar o DWG
      </Link>
      <Link href={`/obras/${obraId}/pontos#novo-ponto`} className="hover:underline">
        Criar à mão
      </Link>
    </p>
  );
}
