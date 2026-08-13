import { getAll, getById, put, deleteRecord } from './db.js';

export async function listarTags() {
  const tags = await getAll('tags');
  return tags.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
}

export async function getTag(id) {
  return getById('tags', id);
}

export async function criarTag({ nome, cor, icone, tipo, ordem }) {
  return put('tags', { nome, cor: cor || '#B4B2A9', icone: icone || '', tipo: tipo || 'outro', ordem: ordem ?? 999 });
}

export async function atualizarTag(tag) {
  return put('tags', tag);
}

export async function excluirTag(id) {
  return deleteRecord('tags', id);
}

export function corDaTag(tags, tagId) {
  const tag = tags.find((t) => t.id === tagId);
  return tag ? tag.cor : '#B4B2A9';
}
