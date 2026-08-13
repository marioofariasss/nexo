/**
 * db.js — camada de acesso ao IndexedDB.
 *
 * Object stores:
 *  - "escolas"       (base fria, vinda do Censo INEP — somente leitura pelo
 *                     app, recriada a cada reimportação de uma base nova)
 *  - "crm"           (camada comercial, editável: tags aplicadas e
 *                     observações — nunca apagada por uma reimportação da
 *                     base fria)
 *  - "tags"          (catálogo de marcadores: nome, cor, ícone, ordem, tipo)
 *  - "tagHistorico"  (log de quem adicionou/removeu qual tag, e quando)
 *  - "interacoes"    (histórico de CRM: ligações, e-mails, reuniões, etc.)
 *  - "documentos"    (arquivos anexados à ficha da escola)
 *  - "enriquecimentoCnpj" (cache de dados públicos de CNPJ já buscados)
 *  - "meta"          (controle interno: versão da base, nome do usuário
 *                     atual, filtros salvos, chave de API opcional)
 *
 * escolas/crm ligadas pela chave `id` (= CO_ENTIDADE do Censo).
 *
 * Histórico de versões:
 *  - v1/v2: schema antigo com status/vendedor/etapaKanban e stores de
 *    kanban/agenda (removidos na refatoração para o sistema de tags).
 *  - v3: introduz tags/marcadores; migra registros antigos de "crm"
 *    (status + vendedor) para tags equivalentes, e remove "compromissos".
 */

const DB_NAME = 'kedu_crm';
const DB_VERSION = 5;

const CORES_PADRAO = ['#0F6E56', '#378ADD', '#7F77DD', '#D85A30', '#D4537E', '#639922', '#BA7517', '#5F5E5A'];

// Tags de status sugeridas no briefing do usuário — semeadas na primeira vez
// que o app roda, se o catálogo de tags ainda estiver vazio.
const TAGS_PADRAO = [
  { nome: 'Livre', cor: '#B4B2A9', tipo: 'status', ordem: 0 },
  { nome: 'Prospectando', cor: '#378ADD', tipo: 'status', ordem: 1 },
  { nome: 'Em contato', cor: '#0F6E56', tipo: 'status', ordem: 2 },
  { nome: 'Sem retorno', cor: '#EDA100', tipo: 'status', ordem: 3 },
  { nome: 'Retornar depois', cor: '#7F77DD', tipo: 'status', ordem: 4 },
  { nome: 'Cliente', cor: '#1baf7a', tipo: 'status', ordem: 5 },
  { nome: 'Perdido', cor: '#E24B4A', tipo: 'status', ordem: 6 },
  { nome: 'Não prospectar', cor: '#5F5E5A', tipo: 'status', ordem: 7 },
  { nome: 'Prioridade Alta', cor: '#E24B4A', tipo: 'outro', ordem: 8 },
  { nome: 'Prioridade Média', cor: '#EDA100', tipo: 'outro', ordem: 9 },
  { nome: 'Prioridade Baixa', cor: '#B4B2A9', tipo: 'outro', ordem: 10 },
];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains('escolas')) {
        const store = db.createObjectStore('escolas', { keyPath: 'id' });
        store.createIndex('uf', 'uf', { unique: false });
        store.createIndex('porte', 'porte', { unique: false });
        store.createIndex('icpTier', 'icpTier', { unique: false });
        store.createIndex('municipio', 'municipio', { unique: false });
        store.createIndex('nome', 'nome', { unique: false });
      }

      let crmStore;
      if (!db.objectStoreNames.contains('crm')) {
        crmStore = db.createObjectStore('crm', { keyPath: 'id' });
      } else {
        crmStore = tx.objectStore('crm');
        // schema antigo tinha índices por status/vendedor/etapaKanban — não
        // são mais usados (tags substituem tudo isso), então removemos.
        ['status', 'vendedor', 'etapaKanban'].forEach((nome) => {
          if (crmStore.indexNames.contains(nome)) crmStore.deleteIndex(nome);
        });
      }

      if (db.objectStoreNames.contains('compromissos')) {
        db.deleteObjectStore('compromissos'); // Agenda removida nesta versão
      }

      if (!db.objectStoreNames.contains('tags')) {
        const tagsStore = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
        tagsStore.createIndex('tipo', 'tipo', { unique: false });
      }

      if (!db.objectStoreNames.contains('tagHistorico')) {
        const histStore = db.createObjectStore('tagHistorico', { keyPath: 'historicoId', autoIncrement: true });
        histStore.createIndex('escolaId', 'escolaId', { unique: false });
      }

      if (!db.objectStoreNames.contains('interacoes')) {
        const interStore = db.createObjectStore('interacoes', { keyPath: 'interacaoId', autoIncrement: true });
        interStore.createIndex('escolaId', 'escolaId', { unique: false });
      }

      if (!db.objectStoreNames.contains('documentos')) {
        const docStore = db.createObjectStore('documentos', { keyPath: 'documentoId', autoIncrement: true });
        docStore.createIndex('escolaId', 'escolaId', { unique: false });
      }

      if (!db.objectStoreNames.contains('enriquecimentoCnpj')) {
        db.createObjectStore('enriquecimentoCnpj', { keyPath: 'cnpj' });
      }

      if (!db.objectStoreNames.contains('pesquisaMercado')) {
        db.createObjectStore('pesquisaMercado', { keyPath: 'escolaId' });
      }

      if (!db.objectStoreNames.contains('regioesSalvas')) {
        db.createObjectStore('regioesSalvas', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'chave' });
      }

      if (oldVersion > 0 && oldVersion < 3) {
        migrarStatusVendedorParaTags(tx, crmStore);
      }
    };

    req.onsuccess = async () => {
      await semearTagsPadrao(req.result);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Migração v1/v2 → v3: registros antigos de "crm" tinham campos soltos
 * (status, vendedor, etapaKanban). Convertemos cada valor distinto em uma
 * tag equivalente e a aplicamos à escola, preservando o que já existia.
 *
 * Importante: primeiro descobrimos todos os nomes de tag distintos entre
 * TODOS os registros e criamos cada um uma única vez, só depois atualizamos
 * os registros de crm. Fazer isso registro-por-registro (com criação de tag
 * sob demanda) duplicaria tags — como os `add()` são assíncronos, um
 * `forEach` síncrono sobre vários registros do mesmo vendedor tentaria criar
 * "Mario" mais de uma vez antes que a primeira criação fosse concluída.
 */
function migrarStatusVendedorParaTags(tx, crmStore) {
  const tagsStore = tx.objectStore('tags');

  const reqAll = crmStore.getAll();
  reqAll.onsuccess = () => {
    const registros = reqAll.result || [];

    function tagsDoRegistro(registro) {
      const lista = [];
      if (registro.status && registro.status !== 'Sem contato') lista.push({ nome: registro.status, tipo: 'status' });
      if (registro.vendedor) lista.push({ nome: registro.vendedor, tipo: 'vendedor' });
      return lista;
    }

    // 1) descobre os nomes de tag distintos necessários, em toda a base
    const chavesUnicas = new Map(); // "nome|tipo" -> { nome, tipo }
    registros.forEach((registro) => {
      tagsDoRegistro(registro).forEach((t) => chavesUnicas.set(`${t.nome}|${t.tipo}`, t));
    });

    function aplicarTagsNosRegistros(mapaNomeParaId) {
      registros.forEach((registro) => {
        const ids = tagsDoRegistro(registro).map((t) => mapaNomeParaId.get(t.nome));
        crmStore.put({
          id: registro.id, tags: ids,
          observacoes: registro.observacoes || '',
          atualizadoEm: registro.atualizadoEm || new Date().toISOString(),
        });
      });
    }

    const pendentes = Array.from(chavesUnicas.values());
    if (!pendentes.length) {
      aplicarTagsNosRegistros(new Map());
      return;
    }

    // 2) cria cada tag distinta em sequência (uma de cada vez, encadeando
    // pelo onsuccess) para não disparar dois `add()` concorrentes do mesmo nome
    const mapaNomeParaId = new Map();
    let indice = 0;
    function criarProxima() {
      if (indice >= pendentes.length) {
        aplicarTagsNosRegistros(mapaNomeParaId);
        return;
      }
      const t = pendentes[indice];
      const tag = { nome: t.nome, cor: CORES_PADRAO[indice % CORES_PADRAO.length], tipo: t.tipo, ordem: 100 + indice };
      const reqAdd = tagsStore.add(tag);
      reqAdd.onsuccess = () => {
        mapaNomeParaId.set(t.nome, reqAdd.result);
        indice += 1;
        criarProxima();
      };
    }
    criarProxima();
  };
}

async function semearTagsPadrao(db) {
  const contagem = await new Promise((resolve, reject) => {
    const req = db.transaction('tags', 'readonly').objectStore('tags').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (contagem > 0) return;
  await new Promise((resolve, reject) => {
    const t = db.transaction('tags', 'readwrite');
    const store = t.objectStore('tags');
    TAGS_PADRAO.forEach((tag) => store.add(tag));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function getMeta(chave) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'meta', 'readonly').get(chave);
    req.onsuccess = () => resolve(req.result ? req.result.valor : undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(chave, valor) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'meta', 'readwrite').put({ chave, valor });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function bulkPut(storeName, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    records.forEach((r) => store.put(r));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function countStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getById(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(storeName, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
