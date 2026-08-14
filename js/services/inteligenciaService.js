const DATA_BASE = new URL('../../data/inteligencia/', import.meta.url).href;

let resumoPromise = null;
const cacheUf = new Map();

async function buscarJson(caminho) {
  const resposta = await fetch(`${DATA_BASE}${caminho}`);
  if (!resposta.ok) throw new Error(`Camada de inteligência indisponível (${resposta.status})`);
  return resposta.json();
}

export function carregarResumoInteligencia() {
  if (!resumoPromise) resumoPromise = buscarJson('resumo.json');
  return resumoPromise;
}

export function carregarInteligenciaUF(uf) {
  if (!cacheUf.has(uf)) cacheUf.set(uf, buscarJson(`escolas/${uf}.json`));
  return cacheUf.get(uf);
}

export async function buscarSerieEscola(uf, escolaId) {
  if (!uf || !escolaId) return null;
  const documento = await carregarInteligenciaUF(uf);
  const valores = documento.escolas?.[String(escolaId)] || null;
  if (!valores) return null;
  const campos = documento.metadados.schemaSerieEscola;
  return {
    campos,
    valores,
    registros: valores.map((linha) => Object.fromEntries(campos.map((campo, i) => [campo, linha[i]]))),
    fonte: documento.metadados.fonte,
  };
}

export async function buscarSerieMunicipio(uf, municipio) {
  const documento = await carregarInteligenciaUF(uf);
  const alvo = (municipio || '').localeCompare ? municipio : String(municipio || '');
  return (documento.municipios || [])
    .filter((r) => r.municipio.localeCompare(alvo, 'pt-BR', { sensitivity: 'base' }) === 0)
    .sort((a, b) => a.ano - b.ano);
}

export async function buscarDiagnosticoMunicipio(uf, municipio) {
  const resumo = await carregarResumoInteligencia();
  return resumo.diagnosticosMunicipais.find((r) => r.uf === uf
    && r.municipio.localeCompare(municipio, 'pt-BR', { sensitivity: 'base' }) === 0) || null;
}

