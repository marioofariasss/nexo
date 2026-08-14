import { distanciaKm } from '../utils/geo.js';

const DATA_BASE = new URL('../../data/', import.meta.url).href;
const cacheTerritorio = new Map();
let cacheConsumo = null;

export const REGIAO_POR_UF = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
};

export function listarRegioes() {
  return ['Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste'];
}

export function ufsDaRegiao(nomeRegiao) {
  return Object.entries(REGIAO_POR_UF).filter(([, r]) => r === nomeRegiao).map(([uf]) => uf);
}

function expandirRows(documento) {
  const schema = documento.schema || [];
  return (documento.rows || []).map((row) => Object.fromEntries(schema.map((campo, i) => [campo, row[i]])));
}

export async function carregarTerritorioUF(uf) {
  if (!uf) return null;
  if (cacheTerritorio.has(uf)) return cacheTerritorio.get(uf);
  const promessa = fetch(`${DATA_BASE}territorio/${uf}.json`).then(async (resposta) => {
    if (resposta.status === 404) return null;
    if (!resposta.ok) throw new Error(`Camada territorial de ${uf} respondeu ${resposta.status}`);
    const documento = await resposta.json();
    return { ...documento, registros: expandirRows(documento) };
  }).catch(() => null);
  cacheTerritorio.set(uf, promessa);
  return promessa;
}

function mediaPonderada(registros, campo, peso) {
  let soma = 0;
  let pesos = 0;
  registros.forEach((r) => {
    const valor = Number(r[campo]);
    const p = Number(r[peso]);
    if (Number.isFinite(valor) && Number.isFinite(p) && p > 0) {
      soma += valor * p;
      pesos += p;
    }
  });
  return pesos ? soma / pesos : null;
}

function medianaPonderada(registros, campo, peso) {
  const validos = registros.map((r) => ({ valor: Number(r[campo]), peso: Number(r[peso]) }))
    .filter((r) => Number.isFinite(r.valor) && Number.isFinite(r.peso) && r.peso > 0)
    .sort((a, b) => a.valor - b.valor);
  const total = validos.reduce((s, r) => s + r.peso, 0);
  let acumulado = 0;
  for (const item of validos) {
    acumulado += item.peso;
    if (acumulado >= total / 2) return item.valor;
  }
  return null;
}

function somar(registros, campo) {
  return registros.reduce((total, r) => total + (Number(r[campo]) || 0), 0);
}

export async function analisarTerritorioNoRaio({ uf, centro, raioKm }) {
  const documento = await carregarTerritorioUF(uf);
  if (!documento || !centro) return null;
  const registros = documento.registros.filter((r) => r.lat != null && r.lon != null
    && distanciaKm(centro.lat, centro.lon, Number(r.lat), Number(r.lon)) <= raioKm);
  if (!registros.length) return null;
  const domicilios = somar(registros, 'domicilios');
  const domiciliosComRenda = registros.reduce((s, r) => s + (r.rendaResponsavelMedia != null ? Number(r.domicilios) || 0 : 0), 0);
  return {
    setores: registros.length,
    domicilios,
    moradores: somar(registros, 'moradores'),
    rendaResponsavelMedia: mediaPonderada(registros, 'rendaResponsavelMedia', 'domicilios'),
    rendaResponsavelMedianaAproximada: medianaPonderada(registros, 'rendaResponsavelMediana', 'domicilios'),
    coberturaRendaPct: domicilios ? (domiciliosComRenda / domicilios) * 100 : null,
    populacao: {
      faixa0a4: somar(registros, 'pop0a4'),
      faixa5a9: somar(registros, 'pop5a9'),
      faixa10a14: somar(registros, 'pop10a14'),
      faixa15a19: somar(registros, 'pop15a19'),
    },
    metodologia: documento.metodologia,
    versao: documento.versao,
    aproximacaoEspacial: 'Setores incluidos quando o ponto representativo cai dentro do raio; setores de borda nao sao fracionados.',
  };
}

/**
 * Mesma agregação do território, mas sem filtro de raio — usa TODOS os
 * setores de uma ou mais UFs. Pra análise de estado inteiro (`ufs: ['CE']`)
 * ou de região com vários estados (`ufs: ufsDaRegiao('Nordeste')`). Carrega
 * um arquivo de território por UF (alguns MB cada) — aceitável aqui porque
 * é uma análise macro, deliberadamente mais pesada que a de raio.
 */
export async function analisarTerritorioAgregado({ ufs }) {
  const documentos = (await Promise.all(ufs.map((uf) => carregarTerritorioUF(uf)))).filter(Boolean);
  if (!documentos.length) return null;
  const registros = documentos.flatMap((d) => d.registros);
  if (!registros.length) return null;
  const domicilios = somar(registros, 'domicilios');
  const domiciliosComRenda = registros.reduce((s, r) => s + (r.rendaResponsavelMedia != null ? Number(r.domicilios) || 0 : 0), 0);
  return {
    ufs,
    setores: registros.length,
    domicilios,
    moradores: somar(registros, 'moradores'),
    rendaResponsavelMedia: mediaPonderada(registros, 'rendaResponsavelMedia', 'domicilios'),
    rendaResponsavelMedianaAproximada: medianaPonderada(registros, 'rendaResponsavelMediana', 'domicilios'),
    coberturaRendaPct: domicilios ? (domiciliosComRenda / domicilios) * 100 : null,
    populacao: {
      faixa0a4: somar(registros, 'pop0a4'),
      faixa5a9: somar(registros, 'pop5a9'),
      faixa10a14: somar(registros, 'pop10a14'),
      faixa15a19: somar(registros, 'pop15a19'),
    },
    metodologia: documentos[0].metodologia,
    versao: documentos[0].versao,
    aproximacaoEspacial: `Todos os setores censitários de ${ufs.length > 1 ? ufs.length + ' UFs' : ufs[0]} — sem filtro de raio, é uma leitura macro do território inteiro.`,
  };
}

export async function analisarTerritorioMunicipio({ uf, codigoMunicipio }) {
  const documento = await carregarTerritorioUF(uf);
  if (!documento || !codigoMunicipio) return null;
  const registros = documento.registros.filter((r) => String(r.municipio) === String(codigoMunicipio));
  if (!registros.length) return null;
  const domicilios = somar(registros, 'domicilios');
  const domiciliosComRenda = registros.reduce((s, r) => s + (r.rendaResponsavelMedia != null ? Number(r.domicilios) || 0 : 0), 0);
  return {
    ufs: [uf], setores: registros.length, domicilios,
    moradores: somar(registros, 'moradores'),
    rendaResponsavelMedia: mediaPonderada(registros, 'rendaResponsavelMedia', 'domicilios'),
    rendaResponsavelMedianaAproximada: medianaPonderada(registros, 'rendaResponsavelMediana', 'domicilios'),
    coberturaRendaPct: domicilios ? (domiciliosComRenda / domicilios) * 100 : null,
    populacao: {
      faixa0a4: somar(registros, 'pop0a4'), faixa5a9: somar(registros, 'pop5a9'),
      faixa10a14: somar(registros, 'pop10a14'), faixa15a19: somar(registros, 'pop15a19'),
    },
    metodologia: documento.metodologia, versao: documento.versao,
    aproximacaoEspacial: 'Todos os setores censitários associados ao município selecionado; sem aproximação por raio.',
  };
}

export function calcularIndicadoresEducacionaisMunicipio(escolasUf, municipio, demanda) {
  if (!municipio || !demanda) return null;
  const alvo = municipio.trim().toLocaleLowerCase('pt-BR');
  const escolas = escolasUf.filter((e) => (e.municipio || '').trim().toLocaleLowerCase('pt-BR') === alvo && e.fonte !== 'osm');
  const matriculas = {
    infantil: escolas.reduce((s, e) => s + (Number(e.matInf) || 0), 0),
    fundamental: escolas.reduce((s, e) => s + (Number(e.matFund) || 0), 0),
    medio: escolas.reduce((s, e) => s + (Number(e.matMed) || 0), 0),
  };
  const populacao = {
    infantil: demanda.educacaoInfantil,
    fundamental: (demanda.fundamentalI || 0) + (demanda.fundamentalII || 0),
    medio: demanda.medio,
  };
  const penetracao = Object.fromEntries(Object.keys(matriculas).map((etapa) => [
    etapa,
    populacao[etapa] > 0 ? matriculas[etapa] / populacao[etapa] : null,
  ]));
  const totalMatriculas = Object.values(matriculas).reduce((s, v) => s + v, 0);
  const totalPopulacao = Object.values(populacao).reduce((s, v) => s + (v || 0), 0);
  return {
    escolasPrivadasCenso: escolas.length,
    matriculas,
    populacao,
    penetracao,
    penetracaoTotal: totalPopulacao ? totalMatriculas / totalPopulacao : null,
    nota: 'Razao entre matriculas privadas do Censo Escolar 2025 e populacao da faixa no Censo 2022; anos de referencia diferentes.',
  };
}

async function carregarBenchmarkConsumo() {
  if (cacheConsumo) return cacheConsumo;
  cacheConsumo = fetch(`${DATA_BASE}benchmarks_consumo.json`).then((r) => r.json());
  return cacheConsumo;
}

export async function montarPerfilConsumo({ uf, rendaPerCapitaMunicipal }) {
  const benchmark = await carregarBenchmarkConsumo();
  const regiao = REGIAO_POR_UF[uf] || 'Brasil';
  const participacaoEducacao = benchmark.participacaoEducacaoDespesaConsumoPct[regiao]
    ?? benchmark.participacaoEducacaoDespesaConsumoPct.Brasil;
  const mediaBrasil2022 = 1638.06;
  const indicePoderCompra = rendaPerCapitaMunicipal != null ? (rendaPerCapitaMunicipal / mediaBrasil2022) * 100 : null;
  return {
    regiao,
    participacaoEducacaoDespesaConsumoPct: participacaoEducacao,
    indicePoderCompraBrasil100: indicePoderCompra,
    rendaMediaBrasil2022: mediaBrasil2022,
    fonte: benchmark.fonte,
    versao: benchmark.versao,
    observacao: benchmark.observacao,
    tipo: 'proxy_agregado',
  };
}
