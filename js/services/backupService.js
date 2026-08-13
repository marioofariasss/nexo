import { getAll, bulkPut } from './db.js';
import { baixarJson } from '../utils/csv.js';

/**
 * Exporta a camada comercial (crm/tags aplicadas, catálogo de tags, histórico
 * de marcadores, interações) para um único JSON. Como o app não tem backend
 * compartilhado, este é o mecanismo de "sincronização manual" entre
 * vendedores — cada um exporta o snapshot e um gestor pode consolidar, ou
 * repassar entre computadores.
 *
 * Documentos anexados (arquivos) NÃO entram neste backup — eles ficam
 * salvos como Blob no IndexedDB local, que não é serializável em JSON de
 * forma simples. Se isso virar uma necessidade real, vale migrar para um
 * backend com armazenamento de arquivo de verdade.
 */
export async function exportarBackupCompleto() {
  const [crm, tags, tagHistorico, interacoes] = await Promise.all([
    getAll('crm'), getAll('tags'), getAll('tagHistorico'), getAll('interacoes'),
  ]);
  const backup = {
    versao: 2,
    exportadoEm: new Date().toISOString(),
    crm, tags, tagHistorico, interacoes,
  };
  baixarJson(backup, `nexo-backup-${new Date().toISOString().slice(0, 10)}`);
}

export async function importarBackupCompleto(arquivo) {
  const texto = await arquivo.text();
  const backup = JSON.parse(texto);
  if (!backup.crm && !backup.tags && !backup.interacoes) {
    throw new Error('Arquivo não parece ser um backup válido do Nexo.');
  }
  if (backup.tags) await bulkPut('tags', backup.tags);
  if (backup.crm) await bulkPut('crm', backup.crm);
  if (backup.tagHistorico) await bulkPut('tagHistorico', backup.tagHistorico);
  if (backup.interacoes) await bulkPut('interacoes', backup.interacoes);
  return {
    crm: (backup.crm || []).length,
    tags: (backup.tags || []).length,
    interacoes: (backup.interacoes || []).length,
  };
}
