/**
 * dashboardDataService.js — busca os JSONs agregados que alimentam o
 * dashboard (Fase 1). Esses arquivos são pré-calculados pelo pipeline de
 * ETL (fora deste repositório) para que o dashboard abra instantaneamente,
 * sem depender de importar a base inteira para o IndexedDB primeiro — essa
 * é feita sob demanda pela Fase 2 (busca de escolas).
 */

async function buscarJson(caminho) {
  const DATA_BASE = new URL('../../data/', import.meta.url).href;
  const resp = await fetch(`${DATA_BASE}${caminho}`);
  if (!resp.ok) throw new Error(`Falha ao carregar data/${caminho}`);
  return resp.json();
}

export async function carregarDadosDashboard() {
  const [
    porUF, porUfPorte, porMunicipio,
    porUfSinal, porUfStatus, kpisEvolucao,
    topOportunidades, topOcioso, topCrescimento, top10Faturamento, indiceUFs,
  ] = await Promise.all([
    buscarJson('dashboard_kpis.json'),
    buscarJson('agg_uf_porte.json'),
    buscarJson('agg_municipio.json'),
    buscarJson('agg_uf_sinal.json'),
    buscarJson('agg_uf_status.json'),
    buscarJson('kpis_evolucao.json'),
    buscarJson('top_opportunities.json'),
    buscarJson('top_capacidade_ociosa.json'),
    buscarJson('top_crescimento.json'),
    buscarJson('top10_faturamento.json'),
    buscarJson('uf_index.json'),
  ]);
  return {
    porUF, porUfPorte, porMunicipio,
    porUfSinal, porUfStatus, kpisEvolucao,
    topOportunidades, topOcioso, topCrescimento, top10Faturamento,
    totalBasePorUF: Object.fromEntries(indiceUFs.map((item) => [item.uf, item.n])),
  };
}
