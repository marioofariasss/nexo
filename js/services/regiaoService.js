import { getAll, put, deleteRecord } from './db.js';

const LIMITE_REGIOES = 50;

export async function listarRegioesSalvas() {
  const todas = await getAll('regioesSalvas');
  return todas.sort((a, b) => new Date(b.dataPesquisa) - new Date(a.dataPesquisa));
}

export async function salvarRegiao({ nome, centro, raioKm, uf, escolas, totalCenso, totalOsm }) {
  const existentes = await listarRegioesSalvas();
  if (existentes.length >= LIMITE_REGIOES) {
    throw new Error(`Limite de ${LIMITE_REGIOES} regiões salvas atingido — apague alguma antes de salvar uma nova.`);
  }
  const registro = {
    id: `regiao-${Date.now()}`,
    nome,
    centro,
    raioKm,
    uf,
    dataPesquisa: new Date().toISOString(),
    totalEscolas: escolas.length,
    totalCenso: totalCenso ?? escolas.filter((e) => e.fonte !== 'osm').length,
    totalOsm: totalOsm ?? escolas.filter((e) => e.fonte === 'osm').length,
    escolas,
  };
  await put('regioesSalvas', registro);
  return registro;
}

export async function deletarRegiao(id) {
  return deleteRecord('regioesSalvas', id);
}

export function exportarRegiaoJson(regiao) {
  const blob = new Blob([JSON.stringify(regiao, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${regiao.nome.replace(/[^a-z0-9]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
