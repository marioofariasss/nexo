const MARCA = 'Nexo — Inteligência de mercado para escolas · nexo.app (ajuste pro domínio real)';

export function exportarCsv(linhas, colunas, nomeArquivo) {
  const preambulo = `"${MARCA}"\n"Exportado em ${new Date().toLocaleString('pt-BR')}"\n\n`;
  const header = colunas.map((c) => `"${c.titulo}"`).join(';');
  const corpo = linhas.map((linha) => colunas.map((c) => {
    const valor = linha[c.chave];
    if (valor == null) return '';
    return `"${String(valor).replace(/"/g, '""')}"`;
  }).join(';')).join('\n');

  const csv = '\uFEFF' + preambulo + header + '\n' + corpo; // BOM para acentuação abrir certo no Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo.endsWith('.csv') ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function baixarJson(objeto, nomeArquivo) {
  const objetoComMarca = { marca: MARCA, ...objeto };
  const blob = new Blob([JSON.stringify(objetoComMarca, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo.endsWith('.json') ? nomeArquivo : `${nomeArquivo}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
