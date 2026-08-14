import { getMeta, setMeta } from './db.js';

const DATA_BASE = new URL('../../data/', import.meta.url).href;
const cache = new Map();

const CHAVE_IMPORTADOS = 'cnpjCandidatosImportados';
let importadosCache = null;

async function carregarImportados() {
  if (!importadosCache) importadosCache = getMeta(CHAVE_IMPORTADOS).then((dados) => dados || {});
  return importadosCache;
}

async function carregarUF(uf) {
  if (cache.has(uf)) return cache.get(uf);
  const promessa = fetch(`${DATA_BASE}cnpj_candidatos/${uf}.json`).then(async (resposta) => {
    if (resposta.status === 404) return null;
    if (!resposta.ok) throw new Error(`Candidatos de CNPJ responderam ${resposta.status}`);
    return resposta.json();
  }).catch(() => null);
  cache.set(uf, promessa);
  return promessa;
}

export async function buscarCandidatosCnpj(escola) {
  if (!escola?.uf || escola.fonte !== 'osm' || escola.cnpj) return [];
  const documento = await carregarUF(escola.uf);
  const importados = await carregarImportados();
  const candidatos = [
    ...(importados?.[escola.uf]?.[String(escola.id)] || []),
    ...(documento?.escolas?.[String(escola.id)] || []),
  ].filter((c, indice, lista) => lista.findIndex((x) => String(x.cnpj) === String(c.cnpj)) === indice);
  const idOsm = String(escola.cnpjOsm || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cnpjOsm = /^\d+$/.test(idOsm) && idOsm.length < 14 ? idOsm.padStart(14, '0') : idOsm;
  if (cnpjOsm.length === 14 && !candidatos.some((c) => String(c.cnpj).toUpperCase().replace(/[^A-Z0-9]/g, '') === cnpjOsm)) {
    candidatos.unshift({
      cnpj: cnpjOsm,
      nomeFantasia: escola.nome,
      razaoSocial: '', cnae: '', cep: escola.cep || '',
      score: 65,
      evidencias: ['CNPJ informado no próprio cadastro do OpenStreetMap; validar na Receita antes de confirmar'],
      status: 'candidato_revisao',
    });
  }
  return candidatos;
}

/** Importa um ou mais arquivos {UF}.json gerados pelo pipeline da Receita. */
export async function importarCandidatosCnpj(documentos) {
  const atuais = (await getMeta(CHAVE_IMPORTADOS)) || {};
  let escolasComCandidatos = 0;
  for (const documento of documentos) {
    if (!documento?.uf || !documento?.escolas) throw new Error('Arquivo de candidatos inválido: UF ou escolas ausentes.');
    atuais[documento.uf] = { ...(atuais[documento.uf] || {}), ...documento.escolas };
    escolasComCandidatos += Object.keys(documento.escolas).length;
  }
  await setMeta(CHAVE_IMPORTADOS, atuais);
  importadosCache = Promise.resolve(atuais);
  return { arquivos: documentos.length, escolasComCandidatos };
}
