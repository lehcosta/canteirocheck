#!/usr/bin/env bash
# Regenera test/fixtures/amostra.dwg a partir do DXF escrito à mão em test/fixtures/amostra.dxf.
#
# O libredwg-web só lê DWG (e lê/escreve DXF), então a conversão usa o dxf2dwg do LibreDWG nativo:
#   brew install libredwg        # testado com dxf2dwg 0.13.3
#
# Perdas conhecidas do dxf2dwg 0.13.3 (encoder R2000), cobertas no teste via leitura do próprio DXF:
#   - altura do MTEXT (grupo 40) vai para rect_width; text_height fica 0;
#   - flag "congelada" da camada (grupo 70, bit 1) é descartado.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v dxf2dwg >/dev/null 2>&1; then
  echo "dxf2dwg não encontrado. Instale o LibreDWG: brew install libredwg" >&2
  exit 1
fi

echo "Usando $(dxf2dwg --version 2>&1 | head -n 1)"
dxf2dwg -y --as r2000 -o test/fixtures/amostra.dwg test/fixtures/amostra.dxf

echo "Conferindo a leitura com o libredwg-web..."
pnpm exec vitest run test/extrair.test.ts
