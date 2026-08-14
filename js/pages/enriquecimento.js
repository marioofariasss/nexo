import { montarLayout } from '../components/layout.js';
import { fmtInt, labelPorte } from '../utils/formatters.js';
import { buscarEscolas, encontrarDuplicidadesNaBase, deletarEscola } from '../services/escolaService.js';
import { importarTodasUFs, statusBaseCarregada } from '../services/importService.js';
import { estatisticasCompletude, calcularCompletude } from '../services/dataQualityService.js';
import { abrirPainelEscola } from '../components/painelEscola.js';
import { exportarCsv, baixarJson } from '../utils/csv.js';
import { processarFilaEnriquecimento, aplicarCnpjsAltaConfianca } from '../services/enrichmentBatchService.js';
import { importarCandidatosCnpj } from '../services/cnpjCandidateService.js';

montarLayout({ paginaAtiva: 'enriquecimento', titulo: 'Central de Enriquecimento', prefixo: '../' });
const content = document.getElementById('content');

let todasCarregadas = [];
let filtroAtivo = null;

function skeleton() {
  content.innerHTML = `
    <div class="dash-hero">
      <div>
        <h1 class="dash-hero-title"><i class="fa-solid fa-layer-group"></i> Central de Enriquecimento</h1>
        <p class="dash-hero-sub">Quanto da base já está completa, e o que falta enriquecer — só sobre o que já foi carregado localmente neste navegador</p>
      </div>
    </div>

    <div class="card" id="card-base">
      <p style="margin-bottom:12px;"><strong id="contador-base">...</strong> escolas carregadas localmente (de todas as UFs).</p>
      <button class="btn btn-primary" id="btn-importar">Carregar base completa agora</button>
      <span class="loading-bar" id="log-importacao"></span>
    </div>

    <div class="kpis" id="kpis-completude"></div>

    <div class="card">
      <h2><i class="fa-solid fa-gears"></i> Esteira das escolas mapeadas</h2>
      <p class="sub">Processa todas as descobertas, vincula automaticamente códigos INEP exatos e organiza os casos restantes entre revisão INEP, revisão de CNPJ e pesquisa de contato.</p>
      <div class="filters" style="margin-top:12px;">
        <div><button class="btn btn-primary" id="btn-processar-fila">Analisar todas as escolas mapeadas</button></div>
        <div><button class="btn" id="btn-exportar-fila">Exportar fila para o pipeline da Receita</button></div>
        <div><button class="btn" id="btn-aplicar-cnpj-alta">Validar e aplicar CNPJs de alta confiança</button></div>
        <div>
          <label class="btn" for="f-importar-candidatos" style="cursor:pointer;">Importar resultados da Receita</label>
          <input type="file" id="f-importar-candidatos" accept="application/json" multiple class="hidden">
        </div>
      </div>
      <p class="loading-bar" id="msg-processamento-fila"></p>
      <div class="kpis" id="kpis-fila" style="margin-top:12px;"></div>
      <p class="sub" style="margin-top:10px;">Fluxo: exportar JSON → executar <code>baixar_base_cnpj_receita.py</code> e <code>pipeline_cnpj_escolas_descobertas.py</code> → importar os arquivos por UF → validar os CNPJs fortes. O pipeline filtra PJs educacionais ativas e compara nome fantasia/razão social, município, endereço, CEP, telefone e e-mail.</p>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-filter"></i> Filtrar por lacuna</div>
    <div class="filters">
      <div><button class="btn" id="f-sem-cnpj">Sem CNPJ</button></div>
      <div><button class="btn" id="f-sem-telefone">Sem telefone</button></div>
      <div><button class="btn" id="f-inicial">Dados iniciais (não enriquecidas)</button></div>
      <div><button class="btn" id="f-osm">Descobertas via mapeamento (fora do Censo)</button></div>
      <div><button class="btn" id="f-candidatas">Candidatas privadas para revisar</button></div>
      <div><button class="btn" id="f-fora-escopo">Fora do escopo comercial</button></div>
      <div><button class="btn" id="f-duplicidades">Possíveis duplicidades</button></div>
      <div><button class="btn" id="f-limpar">Limpar filtro</button></div>
      <div><button class="btn" id="btn-exportar-enriq">Exportar CSV</button></div>
    </div>

    <div class="card hidden" id="card-duplicidades">
      <h2><i class="fa-solid fa-clone"></i> Possíveis duplicidades na base</h2>
      <p class="sub">
        Nome idêntico + muito muito próximas (raio de 150m) — regra aplicada em qualquer combinação de fonte
        (Censo×Censo, OSM×OSM, Censo×OSM), não só nas descobertas mais recentes de uma busca. Confira os dois
        registros e decida qual manter.
      </p>
      <div id="lista-duplicidades"><span class="loading-bar">Calculando...</span></div>
    </div>

    <div class="card" id="card-tabela-padrao">
      <h2 id="titulo-resultado">Escolas</h2>
      <p class="sub" id="contagem-resultado"></p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Escola</th><th>UF</th><th>Município</th><th>Origem</th><th>Próxima ação</th><th>Completude</th><th>CNPJ</th><th>Telefone</th></tr></thead>
          <tbody id="tbody-enriq"></tbody>
        </table>
      </div>
    </div>

    <div class="footer-note">
      As estatísticas de site/Instagram refletem só o que veio direto de uma descoberta (ex: mapeamento OSM) —
      não incluem links cadastrados manualmente na aba Contato da ficha de cada escola (isso fica guardado
      separado, por escola, não é fácil de agregar aqui ainda).
    </div>
  `;
}

async function carregarTudoLocal() {
  todasCarregadas = await buscarEscolas({});
  document.getElementById('contador-base').textContent = fmtInt(todasCarregadas.length);
  renderKPIs();
  aplicarFiltro(filtroAtivo);
}

function renderKPIs() {
  const stats = estatisticasCompletude(todasCarregadas);
  const candidatas = todasCarregadas.filter((e) => e.qualidadeIdentidade?.status === 'candidata_privada_revisao').length;
  const foraEscopo = todasCarregadas.filter((e) => e.qualidadeIdentidade?.incluirAnalise === false).length;
  document.getElementById('kpis-completude').innerHTML = `
    <div class="kpi"><div class="label"><i class="fa-solid fa-id-card"></i> Com CNPJ</div><div class="value">${fmtInt(stats.comCnpj.quantidade)}</div><div class="sub">${stats.comCnpj.percentual}%</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-phone"></i> Com telefone</div><div class="value">${fmtInt(stats.comTelefone.quantidade)}</div><div class="sub">${stats.comTelefone.percentual}%</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-globe"></i> Com site</div><div class="value">${fmtInt(stats.comSite.quantidade)}</div><div class="sub">${stats.comSite.percentual}%</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-triangle-exclamation"></i> Só dados básicos</div><div class="value">${fmtInt(stats.somenteBasico)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-magnifying-glass"></i> Candidatas privadas a revisar</div><div class="value">${fmtInt(candidatas)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-filter-circle-xmark"></i> Fora do escopo nas análises</div><div class="value">${fmtInt(foraEscopo)}</div></div>
  `;
  renderKpisFila();
}

const LABEL_ETAPA = {
  vinculada_inep: 'Vinculadas ao INEP', cnpj_identificado: 'CNPJ identificado',
  revisar_inep: 'Revisar vínculo INEP', revisar_cnpj: 'Revisar CNPJ',
  aguardando_pesquisa: 'Pesquisar PJ/contato', fora_escopo: 'Fora do escopo',
};

function renderKpisFila() {
  const descobertas = todasCarregadas.filter((e) => e.fonte === 'osm');
  const contagem = {};
  descobertas.forEach((e) => {
    const etapa = e.enriquecimentoFila?.etapa || 'nao_processada';
    contagem[etapa] = (contagem[etapa] || 0) + 1;
  });
  document.getElementById('kpis-fila').innerHTML = `
    <div class="kpi"><div class="label">Mapeadas</div><div class="value">${fmtInt(descobertas.length)}</div></div>
    <div class="kpi"><div class="label">Mapeadas com CNPJ</div><div class="value">${fmtInt(descobertas.filter((e) => e.cnpj).length)}</div></div>
    <div class="kpi"><div class="label">Com contato público</div><div class="value">${fmtInt(descobertas.filter((e) => e.tel || e.email).length)}</div></div>
    <div class="kpi"><div class="label">Com site/mídia</div><div class="value">${fmtInt(descobertas.filter((e) => e.site || e.instagram).length)}</div></div>
    <div class="kpi"><div class="label">Com matrículas</div><div class="value">${fmtInt(descobertas.filter((e) => e.mat25 != null).length)}</div></div>
    <div class="kpi"><div class="label">Vinculadas ao INEP</div><div class="value">${fmtInt(contagem.vinculada_inep || 0)}</div></div>
    <div class="kpi"><div class="label">Revisar INEP/CNPJ</div><div class="value">${fmtInt((contagem.revisar_inep || 0) + (contagem.revisar_cnpj || 0))}</div></div>
    <div class="kpi"><div class="label">Pesquisar PJ/contato</div><div class="value">${fmtInt((contagem.aguardando_pesquisa || 0) + (contagem.nao_processada || 0))}</div></div>
  `;
}

function aplicarFiltro(tipo) {
  filtroAtivo = tipo;
  document.getElementById('card-duplicidades').classList.add('hidden');
  document.getElementById('card-tabela-padrao').classList.remove('hidden');
  let filtradas = todasCarregadas;
  let titulo = 'Todas as escolas carregadas';

  if (tipo === 'semCnpj') { filtradas = todasCarregadas.filter((e) => !e.cnpj); titulo = 'Escolas sem CNPJ'; }
  else if (tipo === 'semTelefone') { filtradas = todasCarregadas.filter((e) => !e.tel); titulo = 'Escolas sem telefone'; }
  else if (tipo === 'inicial') { filtradas = todasCarregadas.filter((e) => calcularCompletude(e).nivel === 'Inicial'); titulo = 'Escolas com dados iniciais (pouco enriquecidas)'; }
  else if (tipo === 'osm') { filtradas = todasCarregadas.filter((e) => e.fonte === 'osm'); titulo = 'Escolas descobertas via mapeamento (fora do Censo)'; }
  else if (tipo === 'candidatas') { filtradas = todasCarregadas.filter((e) => e.qualidadeIdentidade?.status === 'candidata_privada_revisao'); titulo = 'Candidatas privadas que exigem confirmação'; }
  else if (tipo === 'foraEscopo') { filtradas = todasCarregadas.filter((e) => e.qualidadeIdentidade?.incluirAnalise === false); titulo = 'Registros fora do escopo comercial'; }

  document.getElementById('titulo-resultado').textContent = titulo;
  document.getElementById('contagem-resultado').textContent = `${fmtInt(filtradas.length)} escolas`;

  const limitadas = filtradas.slice(0, 500);
  document.getElementById('tbody-enriq').innerHTML = limitadas.map((e) => {
    const c = calcularCompletude(e);
    return `<tr data-id="${e.id}" style="cursor:pointer;">
      <td>${e.nome}</td><td>${e.uf || '-'}</td><td>${e.municipio || '-'}</td>
      <td>${e.fonte === 'osm' ? 'OpenStreetMap' : 'Censo INEP'}</td>
      <td>${e.fonte === 'osm' ? (LABEL_ETAPA[e.enriquecimentoFila?.etapa] || 'Ainda não processada') : (e.qualidadeIdentidade?.status ? e.qualidadeIdentidade.status.replaceAll('_', ' ') : 'Base oficial')}</td>
      <td>${c.nivel} (${c.percentual}%)</td>
      <td>${e.cnpj ? '<i class="fa-solid fa-check" style="color:var(--icp-alta);"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--danger);"></i>'}</td>
      <td>${e.tel ? '<i class="fa-solid fa-check" style="color:var(--icp-alta);"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--danger);"></i>'}</td>
    </tr>`;
  }).join('');
  if (filtradas.length > 500) {
    document.getElementById('contagem-resultado').textContent += ` (mostrando as primeiras 500 — exporte o CSV pra ver todas)`;
  }

  document.querySelectorAll('#tbody-enriq tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => abrirPainelEscola(Number(tr.dataset.id), { onAtualizar: () => {} }));
  });

  window.__filtradasAtual = filtradas;
}

async function mostrarDuplicidades() {
  document.getElementById('card-tabela-padrao').classList.add('hidden');
  const card = document.getElementById('card-duplicidades');
  card.classList.remove('hidden');
  const lista = document.getElementById('lista-duplicidades');
  lista.innerHTML = '<span class="loading-bar">Calculando...</span>';

  const pares = await encontrarDuplicidadesNaBase(todasCarregadas);
  if (!pares.length) {
    lista.innerHTML = '<p class="sub">Nenhuma duplicidade óbvia encontrada na base carregada (nome idêntico + muito muito perto).</p>';
    return;
  }

  const linhaEscola = (e) => `
    <div style="flex:1;min-width:220px;">
      <strong>${e.nome}</strong>
      <div class="sub" style="margin:2px 0;">${e.municipio || '-'}/${e.uf || '-'} · ${e.fonte === 'osm' ? 'OpenStreetMap' : 'Censo INEP'} · ${e.mat25 != null ? fmtInt(e.mat25) + ' matrículas' : 'sem matrículas'}</div>
      <button class="btn" data-abrir="${e.id}" style="padding:3px 10px;font-size:11px;">Ver ficha</button>
      <button class="btn" data-excluir="${e.id}" style="padding:3px 10px;font-size:11px;color:var(--danger);">Excluir esta</button>
    </div>`;

  lista.innerHTML = pares.map((p, i) => `
    <div data-par="${i}" style="display:flex;gap:16px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--border);align-items:flex-start;">
      ${linhaEscola(p.a)}
      <div style="align-self:center;color:var(--text-muted);font-size:11px;">~${Math.round(p.distanciaKm * 1000)}m</div>
      ${linhaEscola(p.b)}
    </div>
  `).join('');

  lista.querySelectorAll('[data-abrir]').forEach((btn) => {
    btn.addEventListener('click', () => abrirPainelEscola(Number(btn.dataset.abrir), { onAtualizar: () => {} }));
  });
  lista.querySelectorAll('[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta escola da base? Isso não pode ser desfeito.')) return;
      await deletarEscola(Number(btn.dataset.excluir));
      todasCarregadas = todasCarregadas.filter((e) => e.id !== Number(btn.dataset.excluir));
      document.getElementById('contador-base').textContent = fmtInt(todasCarregadas.length);
      renderKPIs();
      mostrarDuplicidades();
    });
  });
}

function ligarFiltros() {
  document.getElementById('f-sem-cnpj').addEventListener('click', () => aplicarFiltro('semCnpj'));
  document.getElementById('f-sem-telefone').addEventListener('click', () => aplicarFiltro('semTelefone'));
  document.getElementById('f-inicial').addEventListener('click', () => aplicarFiltro('inicial'));
  document.getElementById('f-osm').addEventListener('click', () => aplicarFiltro('osm'));
  document.getElementById('f-candidatas').addEventListener('click', () => aplicarFiltro('candidatas'));
  document.getElementById('f-fora-escopo').addEventListener('click', () => aplicarFiltro('foraEscopo'));
  document.getElementById('f-duplicidades').addEventListener('click', mostrarDuplicidades);
  document.getElementById('f-limpar').addEventListener('click', () => aplicarFiltro(null));
  document.getElementById('btn-exportar-enriq').addEventListener('click', () => {
    const linhas = (window.__filtradasAtual || todasCarregadas).map((e) => ({
      ...e,
      statusIdentidade: e.qualidadeIdentidade?.status || '',
      confiancaIdentidade: e.qualidadeIdentidade?.confianca || '',
      evidenciasIdentidade: (e.qualidadeIdentidade?.evidencias || []).join('; '),
    }));
    exportarCsv(linhas, [
      { chave: 'nome', titulo: 'Escola' }, { chave: 'uf', titulo: 'UF' }, { chave: 'municipio', titulo: 'Município' },
      { chave: 'fonte', titulo: 'Fonte' }, { chave: 'cnpj', titulo: 'CNPJ' }, { chave: 'tel', titulo: 'Telefone' },
      { chave: 'statusIdentidade', titulo: 'Triagem de identidade' }, { chave: 'confiancaIdentidade', titulo: 'Confiança' },
      { chave: 'evidenciasIdentidade', titulo: 'Evidências' },
      { chave: 'ddd', titulo: 'DDD' }, { chave: 'endereco', titulo: 'Endereço' },
    ], 'enriquecimento_escolas');
  });
  document.getElementById('btn-processar-fila').addEventListener('click', processarFila);
  document.getElementById('btn-exportar-fila').addEventListener('click', exportarFilaPipeline);
  document.getElementById('btn-aplicar-cnpj-alta').addEventListener('click', aplicarAltaConfianca);
  document.getElementById('f-importar-candidatos').addEventListener('change', importarResultadosReceita);
}

async function aplicarAltaConfianca() {
  const btn = document.getElementById('btn-aplicar-cnpj-alta');
  const msg = document.getElementById('msg-processamento-fila');
  btn.disabled = true;
  try {
    const resultado = await aplicarCnpjsAltaConfianca(todasCarregadas, ({ atual, total, aplicadas }) => {
      msg.textContent = `Validando ${fmtInt(atual)} de ${fmtInt(total)} PJs de alta confiança · ${fmtInt(aplicadas)} aplicadas...`;
    });
    msg.textContent = `${fmtInt(resultado.aplicadas)} CNPJs validados e aplicados; ${fmtInt(resultado.falhas.length)} rejeitados/indisponíveis; ${fmtInt(resultado.candidatas)} candidatos únicos avaliados; ${fmtInt(resultado.duplicadasIgnoradas)} sugestões duplicadas mantidas para revisão manual.`;
    await carregarTudoLocal();
    aplicarFiltro('osm');
  } catch (err) { msg.textContent = `Erro: ${err.message}`; }
  finally { btn.disabled = false; }
}

async function processarFila() {
  const btn = document.getElementById('btn-processar-fila');
  const msg = document.getElementById('msg-processamento-fila');
  btn.disabled = true;
  try {
    const status = await statusBaseCarregada();
    if (!status.todasCarregadas) {
      await importarTodasUFs((p) => { msg.textContent = `Preparando base oficial para o cruzamento: ${p.uf}...`; });
      todasCarregadas = await buscarEscolas({});
    }
    const resultado = await processarFilaEnriquecimento(todasCarregadas, ({ atual, total }) => {
      msg.textContent = `Analisando ${fmtInt(atual)} de ${fmtInt(total)} escolas mapeadas...`;
    });
    msg.textContent = `Concluído: ${fmtInt(resultado.total)} escolas organizadas por próxima ação.`;
    await carregarTudoLocal();
    aplicarFiltro('osm');
  } catch (err) {
    msg.textContent = `Erro: ${err.message}`;
  } finally { btn.disabled = false; }
}

function exportarFilaPipeline() {
  const campos = ['id', 'nome', 'uf', 'municipio', 'bairro', 'endereco', 'cep', 'tel', 'email', 'fonte'];
  const escolas = todasCarregadas
    .filter((e) => e.fonte === 'osm' && !e.cnpj && e.qualidadeIdentidade?.incluirAnalise !== false)
    .map((e) => ({
      ...Object.fromEntries(campos.map((campo) => [campo, e[campo] ?? null])),
      qualidadeIdentidade: { incluirAnalise: true },
    }));
  baixarJson({
    tipo: 'nexo_fila_cnpj_compacta', versao: 1,
    exportadoEm: new Date().toISOString(), total: escolas.length, escolas,
  }, `nexo_fila_enriquecimento_${new Date().toISOString().slice(0, 10)}`);
  document.getElementById('msg-processamento-fila').textContent = `${fmtInt(escolas.length)} escolas exportadas para enriquecimento externo.`;
}

async function importarResultadosReceita(evento) {
  const arquivos = [...(evento.target.files || [])];
  if (!arquivos.length) return;
  const msg = document.getElementById('msg-processamento-fila');
  try {
    const documentos = await Promise.all(arquivos.map(async (arquivo) => JSON.parse(await arquivo.text())));
    const resultado = await importarCandidatosCnpj(documentos);
    msg.textContent = `${resultado.arquivos} arquivo(s) importado(s), com candidatos para ${fmtInt(resultado.escolasComCandidatos)} escolas. Processando a fila novamente...`;
    await processarFila();
  } catch (err) {
    msg.textContent = `Erro ao importar: ${err.message}`;
  } finally { evento.target.value = ''; }
}

async function ligarImportacao() {
  const status = await statusBaseCarregada();
  const btn = document.getElementById('btn-importar');
  const log = document.getElementById('log-importacao');
  if (status.todasCarregadas) {
    btn.disabled = true;
    btn.textContent = 'Base completa carregada';
  } else {
    btn.textContent = status.totalEscolas > 0
      ? `Carregar o restante (faltam ${status.ufsFaltando.length} de ${status.totalUfs} UFs)`
      : 'Carregar base completa agora';
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Carregando...';
    await importarTodasUFs((p) => { log.textContent = `Importando... (${fmtInt(p.totalAcumulado)} escolas)`; });
    btn.textContent = 'Base completa carregada';
    log.textContent = 'Importação concluída.';
    carregarTudoLocal();
  });
}

async function init() {
  skeleton();
  ligarFiltros();
  ligarImportacao();
  await carregarTudoLocal();
}

init();
