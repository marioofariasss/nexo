import { getByIndex, getAll, getById, bulkPut, deleteRecord } from './db.js';
import { listarTodoCrm } from './crmService.js';
import { ufJaImportada, importarUF, carregarIndiceUFs } from './importService.js';
import { distanciaKm, coordenadaValidaBrasil } from '../utils/geo.js';
import { normalizarNome } from './osmDescobertaService.js';

export async function getEscolaById(id) {
  return getById('escolas', id);
}

export async function deletarEscola(id) {
  return deleteRecord('escolas', id);
}

/**
 * Varre a base inteira (já carregada localmente, qualquer UF) procurando
 * pares de escolas com nome idêntico e muito muito perto uma da outra —
 * a MESMA regra usada na descoberta via OSM (ver
 * `osmDescobertaService.cruzarComCenso`), só que aplicada dentro da base
 * inteira, entre quaisquer duas escolas (Censo×Censo, OSM×OSM,
 * Censo×OSM), não só nas recém-descobertas de uma busca específica.
 * Antes disso, só cruzávamos OSM contra Censo — duas escolas do Censo
 * com nome idêntico nunca eram comparadas entre si.
 */
export async function encontrarDuplicidadesNaBase(escolas, raioConfirmadoKm = 0.15) {
  const comCoordENome = escolas
    .filter((e) => coordenadaValidaBrasil(e.lat, e.lon, e.uf) && e.nome)
    .map((e) => ({ ...e, nomeNormalizado: normalizarNome(e.nome) }));

  const pares = [];
  const jaEmPar = new Set();
  for (let i = 0; i < comCoordENome.length; i++) {
    const a = comCoordENome[i];
    if (jaEmPar.has(a.id)) continue;
    for (let j = i + 1; j < comCoordENome.length; j++) {
      const b = comCoordENome[j];
      if (jaEmPar.has(b.id)) continue;
      if (a.nomeNormalizado !== b.nomeNormalizado || !a.nomeNormalizado) continue;
      const dist = distanciaKm(a.lat, a.lon, b.lat, b.lon);
      if (dist <= raioConfirmadoKm) {
        pares.push({ a, b, distanciaKm: dist });
        jaEmPar.add(a.id);
        jaEmPar.add(b.id);
        break;
      }
    }
  }
  return pares;
}

/**
 * Incorpora escolas descobertas (OSM) permanentemente na base principal —
 * a partir daqui elas existem na Consulta de Escolas, no Dashboard, em
 * qualquer lugar do app, exatamente como uma escola do Censo (só que com
 * `fonte: 'osm'` e os campos comerciais/acadêmicos nulos, porque o OSM não
 * tem esse dado). Não é mais preciso reabrir a mesma pesquisa de raio pra
 * "achar" essa escola de novo.
 */
export async function incorporarEscolasNaBase(escolasNovas) {
  if (!escolasNovas.length) return;
  await bulkPut('escolas', escolasNovas);
}

function similaridadeTokens(a, b) {
  const aa = new Set(normalizarNome(a).split(' ').filter((p) => p.length > 2));
  const bb = new Set(normalizarNome(b).split(' ').filter((p) => p.length > 2));
  if (!aa.size || !bb.size) return 0;
  const intersecao = [...aa].filter((p) => bb.has(p)).length;
  return intersecao / new Set([...aa, ...bb]).size;
}

/**
 * Procura uma escola descoberta no cadastro oficial já disponível. Não
 * consulta pessoas nem faz scraping: cruza nome, município, CEP, telefone e
 * proximidade com o Censo INEP. O resultado é sugestão e exige confirmação.
 */
export async function buscarCorrespondenciasInep(escola, limite = 5) {
  if (!escola?.uf) return [];
  if (!(await ufJaImportada(escola.uf))) {
    const indice = await carregarIndiceUFs();
    const item = indice.find((i) => i.uf === escola.uf);
    if (item) await importarUF(escola.uf, item.arquivo);
  }
  const candidatos = (await getByIndex('escolas', 'uf', escola.uf)).filter((e) => e.fonte !== 'osm' && e.id !== escola.id);
  const municipioAlvo = normalizarNome(escola.municipio || '');
  const cepAlvo = String(escola.cep || '').replace(/\D/g, '');
  const telAlvo = String(escola.tel || '').replace(/\D/g, '').slice(-8);

  return candidatos.map((candidato) => {
    const evidencias = [];
    const simNome = similaridadeTokens(escola.nome || '', candidato.nome || '');
    let score = Math.round(simNome * 55);
    if (simNome >= 0.7) evidencias.push('nome muito semelhante');
    else if (simNome >= 0.45) evidencias.push('nome parcialmente semelhante');

    if (municipioAlvo && municipioAlvo === normalizarNome(candidato.municipio || '')) {
      score += 15; evidencias.push('mesmo município');
    }
    const cepCandidato = String(candidato.cep || '').replace(/\D/g, '');
    if (cepAlvo.length === 8 && cepAlvo === cepCandidato) { score += 15; evidencias.push('mesmo CEP'); }
    const telCandidato = String(candidato.tel || '').replace(/\D/g, '').slice(-8);
    if (telAlvo.length === 8 && telAlvo === telCandidato) { score += 20; evidencias.push('mesmo telefone'); }

    let distancia = null;
    if (coordenadaValidaBrasil(escola.lat, escola.lon, escola.uf) && coordenadaValidaBrasil(candidato.lat, candidato.lon, candidato.uf)) {
      distancia = distanciaKm(escola.lat, escola.lon, candidato.lat, candidato.lon);
      if (distancia <= 0.2) { score += 20; evidencias.push('a até 200 m'); }
      else if (distancia <= 1) { score += 14; evidencias.push('a até 1 km'); }
      else if (distancia <= 5) { score += 6; evidencias.push('a até 5 km'); }
    }
    return { escola: candidato, score: Math.min(100, score), evidencias, distanciaKm: distancia };
  }).filter((r) => r.score >= 48)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite);
}

/**
 * Posição de uma escola dentro de um raio geográfico ao redor dela mesma:
 * ranking por matrículas, market share (matrículas da escola ÷ matrículas
 * totais da região) e o segmento (Infantil/Fundamental/Médio) onde ela tem
 * a maior fatia de mercado. Tudo calculado só com o Censo já carregado —
 * sem custo, sem depender de nenhuma fonte externa nova.
 *
 * Não inclui renda por setor censitário (isso continua exigindo o
 * pipeline offline documentado em docs/ARQUITETURA.md — não é algo que dá
 * pra calcular só com o que já está na base).
 */
export async function calcularPosicaoNaRegiao(escola, raioKm = 3) {
  if (!coordenadaValidaBrasil(escola.lat, escola.lon, escola.uf)) return null;
  if (!(await ufJaImportada(escola.uf))) {
    const indice = await carregarIndiceUFs();
    const item = indice.find((i) => i.uf === escola.uf);
    if (item) await importarUF(escola.uf, item.arquivo);
  }
  const daUf = await getByIndex('escolas', 'uf', escola.uf);
  const naRegiao = daUf.filter((e) => coordenadaValidaBrasil(e.lat, e.lon, e.uf) && distanciaKm(escola.lat, escola.lon, e.lat, e.lon) <= raioKm);
  if (!naRegiao.length) return null;

  const comMatriculas = naRegiao.filter((e) => e.mat25 != null);
  const ordenadas = [...comMatriculas].sort((a, b) => (b.mat25 || 0) - (a.mat25 || 0));
  const posicao = ordenadas.findIndex((e) => e.id === escola.id) + 1;

  const totalMatriculas = comMatriculas.reduce((s, e) => s + (e.mat25 || 0), 0);
  const marketShare = totalMatriculas > 0 && escola.mat25 != null ? (escola.mat25 / totalMatriculas) * 100 : null;

  const somarEtapa = (campo) => comMatriculas.reduce((s, e) => s + (e[campo] || 0), 0);
  const totalInfantil = somarEtapa('matInf');
  const totalFund = somarEtapa('matFund');
  const totalMedio = somarEtapa('matMed');
  const segmentos = [
    { nome: 'Educação Infantil', escolaValor: escola.matInf || 0, totalRegiao: totalInfantil },
    { nome: 'Fundamental', escolaValor: escola.matFund || 0, totalRegiao: totalFund },
    { nome: 'Médio', escolaValor: escola.matMed || 0, totalRegiao: totalMedio },
  ].map((s) => ({ ...s, share: s.totalRegiao > 0 ? (s.escolaValor / s.totalRegiao) * 100 : null }))
    .filter((s) => s.share != null && s.escolaValor > 0);
  const segmentoMaisForte = segmentos.length ? segmentos.reduce((a, b) => (b.share > a.share ? b : a)) : null;

  return {
    raioKm, totalEscolasNaRegiao: naRegiao.length, totalComMatriculas: comMatriculas.length,
    posicao: posicao > 0 ? posicao : null, totalRanking: ordenadas.length,
    totalMatriculasRegiao: totalMatriculas, marketShare, segmentoMaisForte,
  };
}

/**
 * Concorrentes diretos de uma escola: outras escolas do mesmo município,
 * ordenadas pela proximidade de ticket (mensalidade estimada). Usa só dados
 * já carregados do Censo Escolar — sem custo, sem chamada de IA, sem
 * depender de nada externo. É o equivalente automático do bloco
 * "Mapeamento de Entrega dos Concorrentes" das pesquisas de mercado da kedu.
 */
export async function buscarConcorrentesNaRegiao(escola, limite = 8) {
  if (!(await ufJaImportada(escola.uf))) {
    const indice = await carregarIndiceUFs();
    const item = indice.find((i) => i.uf === escola.uf);
    if (item) await importarUF(escola.uf, item.arquivo);
  }
  const daUf = await getByIndex('escolas', 'uf', escola.uf);
  const doMunicipio = daUf.filter((r) => r.id !== escola.id && (r.municipio || '').toLowerCase() === (escola.municipio || '').toLowerCase() && r.mensalidade != null);
  const alvo = escola.mensalidade;
  doMunicipio.sort((a, b) => {
    if (alvo == null) return (b.mensalidade || 0) - (a.mensalidade || 0);
    return Math.abs(a.mensalidade - alvo) - Math.abs(b.mensalidade - alvo);
  });
  return doMunicipio.slice(0, limite);
}

/**
 * Busca escolas combinando filtros. Usa o índice de UF quando possível
 * (muito mais rápido que varrer as 42 mil escolas), e filtra o restante
 * em memória — aceitável porque mesmo "todas as UFs" cabe tranquilamente
 * em memória em um array de objetos já achatado.
 */
export async function buscarEscolas(filtros = {}) {
  let registros;
  if (filtros.uf) {
    registros = await getByIndex('escolas', 'uf', filtros.uf);
  } else {
    registros = await getAll('escolas');
  }

  // A Base de Escolas é um inventário: por padrão mostra tudo que foi
  // incorporado, inclusive registros OSM ainda em auditoria. Somente telas
  // analíticas pedem explicitamente `somenteAnalise`, evitando que uma regra
  // de score faça registros desaparecerem da busca ou da busca global.
  if (filtros.somenteAnalise) {
    registros = registros.filter((r) => r.qualidadeIdentidade?.incluirAnalise !== false);
  }

  if (filtros.porte) registros = registros.filter((r) => r.porte === filtros.porte);
  if (filtros.municipio) {
    const alvo = filtros.municipio.toLowerCase();
    registros = registros.filter((r) => (r.municipio || '').toLowerCase().includes(alvo));
  }
  if (filtros.nome) {
    const alvo = filtros.nome.toLowerCase();
    registros = registros.filter((r) => (r.nome || '').toLowerCase().includes(alvo));
  }
  if (filtros.matMin != null) registros = registros.filter((r) => (r.mat25 || 0) >= filtros.matMin);
  if (filtros.matMax != null) registros = registros.filter((r) => (r.mat25 || 0) <= filtros.matMax);
  if (filtros.sinalMat) registros = registros.filter((r) => r.sinalMat === filtros.sinalMat);
  if (filtros.statusContinuidade) registros = registros.filter((r) => r.statusContinuidade === filtros.statusContinuidade);
  if (filtros.capOciosaMin != null) registros = registros.filter((r) => (r.capOciosa || 0) >= filtros.capOciosaMin);
  if (filtros.temEad) registros = registros.filter((r) => r.temEad === 1);
  if (filtros.temProf) registros = registros.filter((r) => r.temProf === 1);

  // filtro por tags (marcadores) — aceita uma ou várias tags selecionadas
  if ((filtros.tagIds && filtros.tagIds.length) || filtros.semTag || filtros.comTag) {
    const crm = await listarTodoCrm();
    const mapaCrm = new Map(crm.map((c) => [c.id, c]));
    registros = registros.filter((r) => {
      const c = mapaCrm.get(r.id);
      const tagsDaEscola = c ? c.tags : [];
      if (filtros.semTag) return !tagsDaEscola.length;
      if (filtros.comTag) return tagsDaEscola.length > 0;
      return filtros.tagIds.some((tid) => tagsDaEscola.includes(tid));
    });
  }

  // ordenação
  const chave = filtros.ordenarPor || 'mat25';
  const dir = filtros.ordemDesc === false ? 1 : -1;
  registros.sort((a, b) => {
    const va = a[chave], vb = b[chave];
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * (va - vb);
  });

  // anexa as tags atuais de cada escola (usado pela coluna "Marcadores" da tabela)
  const todoCrm = await listarTodoCrm();
  const mapaTagsPorEscola = new Map(todoCrm.map((c) => [c.id, c.tags || []]));
  registros.forEach((r) => { r.tagIds = mapaTagsPorEscola.get(r.id) || []; });

  return registros;
}
