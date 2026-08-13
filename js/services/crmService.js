import { getById, put, getAll, getByIndex, deleteRecord, getMeta, setMeta } from './db.js';

export function crmVazio(escolaId) {
  return { id: escolaId, tags: [], observacoes: '', atualizadoEm: new Date().toISOString() };
}

export async function getCrm(escolaId) {
  const registro = await getById('crm', escolaId);
  return registro || crmVazio(escolaId);
}

export async function listarTodoCrm() {
  return getAll('crm');
}

export async function salvarObservacoes(escolaId, observacoes) {
  const crm = await getCrm(escolaId);
  crm.observacoes = observacoes;
  crm.atualizadoEm = new Date().toISOString();
  return put('crm', crm);
}

// ---------- Nome de quem está usando o app (só para atribuição no histórico) ----------

export async function getMeuNome() {
  return (await getMeta('meuNome')) || '';
}

export async function salvarMeuNome(nome) {
  return setMeta('meuNome', nome);
}

// ---------- Aplicar/remover tags, com histórico ----------

export async function adicionarTagNaEscola(escolaId, tag, usuario) {
  const crm = await getCrm(escolaId);
  if (crm.tags.includes(tag.id)) return crm;
  crm.tags.push(tag.id);
  crm.atualizadoEm = new Date().toISOString();
  await put('crm', crm);
  await put('tagHistorico', {
    escolaId, tagId: tag.id, tagNome: tag.nome, acao: 'adicionar',
    usuario: usuario || '', data: new Date().toISOString(),
  });
  return crm;
}

export async function removerTagDaEscola(escolaId, tag, usuario) {
  const crm = await getCrm(escolaId);
  crm.tags = crm.tags.filter((id) => id !== tag.id);
  crm.atualizadoEm = new Date().toISOString();
  await put('crm', crm);
  await put('tagHistorico', {
    escolaId, tagId: tag.id, tagNome: tag.nome, acao: 'remover',
    usuario: usuario || '', data: new Date().toISOString(),
  });
  return crm;
}

export async function listarHistoricoTags(escolaId) {
  const registros = await getByIndex('tagHistorico', 'escolaId', escolaId);
  return registros.sort((a, b) => new Date(b.data) - new Date(a.data));
}

// ---------- Interações (histórico de CRM) ----------

export async function listarInteracoes(escolaId) {
  const registros = await getByIndex('interacoes', 'escolaId', escolaId);
  return registros.sort((a, b) => new Date(b.data) - new Date(a.data));
}

export async function adicionarInteracao({ escolaId, tipo, descricao, autor }) {
  return put('interacoes', {
    escolaId, tipo, descricao, autor: autor || '',
    data: new Date().toISOString(),
  });
}

export async function removerInteracao(interacaoId) {
  return deleteRecord('interacoes', interacaoId);
}

export async function listarTodasInteracoes() {
  return getAll('interacoes');
}

// ---------- Documentos anexados ----------

export async function listarDocumentos(escolaId) {
  const registros = await getByIndex('documentos', 'escolaId', escolaId);
  return registros.sort((a, b) => new Date(b.dataUpload) - new Date(a.dataUpload));
}

export async function adicionarDocumento({ escolaId, nome, tipo, tamanho, blob }) {
  return put('documentos', { escolaId, nome, tipo, tamanho, blob, dataUpload: new Date().toISOString() });
}

export async function removerDocumento(documentoId) {
  return deleteRecord('documentos', documentoId);
}

// ---------- Filtros salvos ----------

export async function getFiltrosSalvos() {
  return (await getMeta('filtrosSalvos')) || [];
}

export async function salvarFiltroSalvo(nome, filtro) {
  const lista = await getFiltrosSalvos();
  lista.push({ nome, filtro, criadoEm: new Date().toISOString() });
  await setMeta('filtrosSalvos', lista);
  return lista;
}

export async function removerFiltroSalvo(nome) {
  const lista = (await getFiltrosSalvos()).filter((f) => f.nome !== nome);
  await setMeta('filtrosSalvos', lista);
  return lista;
}

// ---------- Chave de API opcional (recursos de IA) ----------

export async function getChaveApiIA() {
  return getMeta('chaveApiIA');
}

export async function salvarChaveApiIA(chave) {
  return setMeta('chaveApiIA', chave);
}
