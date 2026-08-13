/**
 * importService.js — carrega a base fria (Censo INEP) para o IndexedDB.
 *
 * Estratégia de performance (lazy loading):
 *  - `data/uf_index.json` é pequeno e sempre carregado (lista de UFs + contagens).
 *  - `data/escolas/{UF}.json` só é buscado e importado quando aquela UF é
 *    necessária pela primeira vez (ex: usuário filtra por aquele estado).
 *  - Uma vez importada, a UF fica marcada em `meta` e não é buscada de novo,
 *    a não ser que a versão da base semente mude (VERSAO_BASE abaixo).
 */

import { bulkPut, getMeta, setMeta, countStore, getAll } from './db.js';

const VERSAO_BASE = '2025-v4'; // v4: força a reaplicação da triagem OSM em bases locais antigas

// Caminho absoluto (a partir da localização deste arquivo, não da página que
// importou o módulo) — assim funciona igual seja chamado do index.html na
// raiz ou de uma página dentro de /pages/.
const DATA_BASE = new URL('../../data/', import.meta.url).href;

export async function carregarIndiceUFs() {
  const resp = await fetch(`${DATA_BASE}uf_index.json`);
  if (!resp.ok) throw new Error('Não foi possível carregar o índice de UFs');
  return resp.json();
}

export async function ufJaImportada(uf) {
  const versaoImportada = await getMeta(`uf_${uf}_versao`);
  return versaoImportada === VERSAO_BASE;
}

export async function importarUF(uf, arquivo) {
  if (await ufJaImportada(uf)) return { uf, jaImportada: true };
  const resp = await fetch(`${DATA_BASE}${arquivo}`);
  if (!resp.ok) throw new Error(`Não foi possível carregar dados de ${uf}`);
  const registros = await resp.json();
  await bulkPut('escolas', registros);
  await setMeta(`uf_${uf}_versao`, VERSAO_BASE);
  return { uf, jaImportada: false, quantidade: registros.length };
}

export async function importarTodasUFs(onProgress) {
  const indice = await carregarIndiceUFs();
  let total = 0;
  for (const item of indice) {
    const resultado = await importarUF(item.uf, item.arquivo);
    total += resultado.quantidade || 0;
    if (onProgress) onProgress({ ...item, ...resultado, totalAcumulado: total });
  }
  return total;
}

export async function statusBaseCarregada() {
  const indice = await carregarIndiceUFs();
  const totalEscolas = await countStore('escolas');
  const statusPorUf = await Promise.all(indice.map(async (item) => ({ uf: item.uf, importada: await ufJaImportada(item.uf) })));
  const ufsFaltando = statusPorUf.filter((s) => !s.importada).map((s) => s.uf);
  const todasCarregadas = ufsFaltando.length === 0;
  return { totalEscolas, versao: VERSAO_BASE, todasCarregadas, ufsFaltando, totalUfs: indice.length };
}

/**
 * Monta o inventário que existe AGORA sem confundir "UF ainda não carregada"
 * com ausência de escolas. Para cada UF já importada, o IndexedDB é a fonte
 * da verdade (inclui descobertas OSM e eventuais exclusões). Para uma UF ainda
 * não importada, preserva a contagem do índice semente e soma apenas registros
 * descobertos localmente que já existam para ela.
 */
export async function calcularCenarioAtual() {
  const indice = await carregarIndiceUFs();
  const registrosLocais = await getAll('escolas');
  const ufsConhecidas = new Set(indice.map((item) => item.uf));
  const locaisPorUf = new Map();

  registrosLocais.forEach((escola) => {
    const uf = String(escola.uf || '').toUpperCase();
    if (!uf) return;
    if (!locaisPorUf.has(uf)) locaisPorUf.set(uf, []);
    locaisPorUf.get(uf).push(escola);
  });

  const porUF = {};
  let totalSemente = 0;
  let total = 0;
  let totalDescobertas = 0;

  for (const item of indice) {
    const locais = locaisPorUf.get(item.uf) || [];
    const importada = await ufJaImportada(item.uf);
    const descobertas = locais.filter((e) => e.fonte === 'osm').length;
    const atual = importada ? locais.length : Number(item.n || 0) + descobertas;
    porUF[item.uf] = { semente: Number(item.n || 0), atual, importada, descobertas };
    totalSemente += Number(item.n || 0);
    total += atual;
    totalDescobertas += descobertas;
  }

  // Registros sem UF não podem desaparecer do total nacional. Eles ficam
  // separados para correção cadastral e não contaminam nenhum estado.
  const semUf = registrosLocais.filter((e) => !e.uf || !ufsConhecidas.has(String(e.uf).toUpperCase())).length;
  total += semUf;

  return {
    total,
    totalSemente,
    variacaoLiquida: total - totalSemente,
    totalDescobertas,
    semUf,
    porUF,
  };
}
