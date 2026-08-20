import { montarLayout } from '../components/layout.js';
import { exportarCsv } from '../utils/csv.js';
import {
  AGENTES_HUNTER, KEDU_FORM_URL, adicionarEvidencia, adicionarTerritorio, confirmarEnvioKedu,
  criarLeadManual, definirLeadEspelho, descartarLead, enriquecerLeadAutomaticamente, executarCicloTerritorial, gerarRelatorio, historicoLead,
  listarLeads, listarLogs, listarTerritorios, obterConfiguracao, obterLead, obterLeadEspelho, prepararEnvioKedu,
  qualificarLead, registrarFalhaEnvioKedu, reprocessarRun, salvarConfiguracao, salvarLead, solicitarLoteCodex, validarParaKedu,
} from '../services/hunterService.js';

montarLayout({ paginaAtiva: 'hunter', titulo: 'Nexo Hunter', prefixo: '../' });

const content = document.getElementById('content');
let estado = { aba: 'visao', periodo: 'dia', inicio: '', fim: '', leads: [], territorios: [], logs: [], relatorio: null, config: null, espelho: null, busca: '', status: '' };
let graficoIcp = null;
let graficoProducao = null;

const STATUS = {
  revisao: ['Em revisão', 'warning'], revisao_duplicidade: ['Possível duplicidade', 'warning'],
  qualificada: ['Qualificada', 'success'], aguardando_envio_kedu: ['Pronta para kedu', 'info'],
  enviada_kedu: ['Enviada à kedu', 'success'], descartada: ['Descartada', 'muted'], erro: ['Erro', 'danger'],
  em_andamento: ['Em andamento', 'info'], na_fila: ['Na fila', 'muted'], saturado: ['Saturado', 'success'],
};

function esc(valor) {
  return String(valor ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function fmtInt(valor) { return Number(valor || 0).toLocaleString('pt-BR'); }
function fmtPct(valor) { return `${Math.round(Number(valor || 0))}%`; }
function fmtData(valor, hora = false) {
  if (!valor) return '—';
  return new Date(valor).toLocaleString('pt-BR', hora ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' });
}
function fmtMoeda(valor) { return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function statusHtml(status) {
  const [label, tom] = STATUS[status] || [status || 'Sem status', 'muted'];
  return `<span class="hunter-status hunter-status-${tom}">${esc(label)}</span>`;
}
function icpHtml(lead) {
  const tier = lead.qualificacao?.tier || 'D';
  return `<span class="hunter-icp hunter-icp-${tier.toLowerCase()}">${tier}</span><span class="hunter-score">${lead.qualificacao?.icp || 0}</span>`;
}

function shell() {
  content.innerHTML = `
    <section class="hunter-hero">
      <div>
        <div class="hunter-eyebrow"><span class="hunter-live-dot"></span> OPERAÇÃO TERRITORIAL</div>
        <h1>Nexo Hunter</h1>
        <p>Descoberta, validação e qualificação de escolas privadas fora da base INEP — até o cadastro final no formulário da kedu.</p>
      </div>
      <div class="hunter-hero-actions">
        <label class="hunter-switch"><input type="checkbox" id="hunter-ativo"><span></span><b id="hunter-ativo-label">Agente ativo</b></label>
        <button class="btn btn-primary" id="btn-novo-lead"><i class="fa-solid fa-plus"></i> Nova escola</button>
      </div>
    </section>

    <section class="hunter-toolbar">
      <div class="hunter-tabs" role="tablist">
        <button class="hunter-tab active" data-aba="visao">Visão geral</button>
        <button class="hunter-tab" data-aba="escolas">Escolas <span id="badge-revisao">0</span></button>
        <button class="hunter-tab" data-aba="territorios">Territórios</button>
        <button class="hunter-tab" data-aba="agentes">Agentes</button>
        <button class="hunter-tab" data-aba="logs">Atividade</button>
      </div>
      <div class="hunter-periodo">
        <select id="f-periodo" aria-label="Período do relatório">
          <option value="dia">Hoje</option><option value="semana">Últimos 7 dias</option>
          <option value="mes">Últimos 30 dias</option><option value="custom">Personalizado</option>
        </select>
        <span id="periodo-custom" class="hidden"><input type="date" id="f-inicio"><input type="date" id="f-fim"></span>
        <button class="btn" id="btn-exportar-csv" title="Exportar CSV"><i class="fa-solid fa-file-csv"></i></button>
        <button class="btn" id="btn-exportar-xlsx" title="Exportar XLSX"><i class="fa-solid fa-file-excel"></i></button>
      </div>
    </section>
    <div id="hunter-view"><div class="hunter-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Preparando a operação...</div></div>
    <div id="hunter-modal"></div>`;
}

async function carregar() {
  const [leads, territorios, logs, config, espelho, relatorio] = await Promise.all([
    listarLeads(), listarTerritorios(), listarLogs(), obterConfiguracao(), obterLeadEspelho(),
    gerarRelatorio({ periodo: estado.periodo, inicio: estado.inicio, fim: estado.fim }),
  ]);
  estado = { ...estado, leads, territorios, logs, config, espelho, relatorio };
  document.getElementById('hunter-ativo').checked = config.ativo;
  document.getElementById('hunter-ativo-label').textContent = config.ativo ? 'Agente ativo' : 'Agente pausado';
  document.getElementById('badge-revisao').textContent = relatorio.metricas.revisao;
  render();
}

function render() {
  document.querySelectorAll('.hunter-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.aba === estado.aba));
  if (estado.aba === 'visao') renderVisao();
  if (estado.aba === 'escolas') renderEscolas();
  if (estado.aba === 'territorios') renderTerritorios();
  if (estado.aba === 'agentes') renderAgentes();
  if (estado.aba === 'logs') renderLogs();
}

function kpi(icone, label, valor, detalhe = '', tom = '') {
  return `<article class="hunter-kpi ${tom}"><div class="hunter-kpi-icon"><i class="fa-solid ${icone}"></i></div><div><span>${label}</span><strong>${valor}</strong>${detalhe ? `<small>${detalhe}</small>` : ''}</div></article>`;
}

function renderVisao() {
  const r = estado.relatorio;
  const m = r.metricas;
  const progresso = Math.min(100, Math.round(m.qualificadas / r.metaDiaria * 100));
  const atual = estado.territorios.find((t) => t.status === 'em_andamento');
  const fila = estado.territorios.filter((t) => t.status === 'na_fila').slice(0, 3);
  const view = document.getElementById('hunter-view');
  view.innerHTML = `
    ${estado.espelho ? `<section class="hunter-mirror-banner"><div><i class="fa-solid fa-wand-magic-sparkles"></i><span><b>Padrão de enriquecimento</b>${esc(estado.espelho.lead.nome)} · ${estado.espelho.perfil.camposPreenchidos.length} campos · ${estado.espelho.perfil.quantidadeEvidencias} evidências</span></div><button class="btn" data-lead="${estado.espelho.lead.id}">Ver espelho</button></section>` : ''}
    <section class="hunter-kpis">
      ${kpi('fa-bullseye', 'Qualificadas', fmtInt(m.qualificadas), `meta: ${r.metaDiaria}/dia`, 'primary')}
      ${kpi('fa-school-circle-check', 'Novas descobertas', fmtInt(m.novos), `${fmtPct(m.novidadePct)} de novidade`)}
      ${kpi('fa-address-card', 'Enriquecimento', fmtPct(m.enriquecimentoPct), `${fmtPct(m.decisorPct)} com decisor`)}
      ${kpi('fa-paper-plane', 'Enviadas à kedu', fmtInt(m.enviadas), 'pelo formulário oficial')}
      ${kpi('fa-map', 'Cobertura', fmtPct(m.coberturaMedia), `${estado.territorios.filter((t) => t.status === 'saturado').length} municípios saturados`)}
    </section>

    <section class="hunter-goal-card">
      <div class="hunter-goal-copy"><span>Meta diária</span><strong>${m.qualificadas} <small>de ${r.metaDiaria} escolas qualificadas</small></strong></div>
      <div class="hunter-progress"><span style="width:${progresso}%"></span></div><b>${progresso}%</b>
    </section>

    <div class="hunter-grid-main">
      <section class="card hunter-chart-card">
        <div class="hunter-card-head"><div><h2>Produção no período</h2><p>Do candidato bruto ao CRM da kedu</p></div><span class="hunter-caption">${m.encontrados} encontrados</span></div>
        <div class="hunter-funnel">
          <div><strong>${m.encontrados}</strong><span>Encontradas</span></div><i class="fa-solid fa-chevron-right"></i>
          <div><strong>${m.novos}</strong><span>Novas</span></div><i class="fa-solid fa-chevron-right"></i>
          <div><strong>${m.qualificadas}</strong><span>Qualificadas</span></div><i class="fa-solid fa-chevron-right"></i>
          <div class="is-final"><strong>${m.enviadas}</strong><span>kedu / CRM</span></div>
        </div>
        <div class="hunter-chart-wrap"><canvas id="chart-producao"></canvas></div>
      </section>
      <section class="card hunter-chart-card">
        <div class="hunter-card-head"><div><h2>Qualidade ICP</h2><p>Prioridade das escolas novas</p></div></div>
        <div class="hunter-chart-wrap hunter-chart-donut"><canvas id="chart-icp"></canvas></div>
        <div class="hunter-icp-legend">${r.porIcp.map((x) => `<span><i class="tier-${x.tier.toLowerCase()}"></i> ICP ${x.tier}<b>${x.total}</b></span>`).join('')}</div>
      </section>
    </div>

    <div class="hunter-grid-main">
      <section class="card hunter-territorio-atual">
        <div class="hunter-card-head"><div><h2><i class="fa-solid fa-location-crosshairs"></i> Território em operação</h2><p>Memória ativa evita repetir buscas já esgotadas</p></div>${atual ? `<button class="btn btn-primary" data-run="${atual.id}"><i class="fa-solid fa-robot"></i> Solicitar lote ao Codex</button>` : ''}</div>
        ${atual ? `<div class="hunter-location"><div><span>${esc(atual.uf)}</span><strong>${esc(atual.municipio)}</strong><small>${atual.ciclos} ciclos · última busca ${fmtData(atual.ultimaBuscaEm, true)}</small></div><div class="hunter-coverage"><strong>${fmtPct(atual.cobertura)}</strong><span>cobertura estimada</span></div></div>
        <div class="hunter-progress is-territory"><span style="width:${atual.cobertura}%"></span></div>
        <div class="hunter-territory-stats"><span><b>${atual.encontrados}</b> encontrados</span><span><b>${atual.novos}</b> novos</span><span><b>${atual.ciclosSemNovidade}</b> ciclos sem novidade</span></div>` : '<div class="empty-state"><h2>Fila territorial concluída</h2><p>Adicione o próximo município para continuar.</p></div>'}
        ${fila.length ? `<div class="hunter-next"><span>PRÓXIMOS</span>${fila.map((t, i) => `<b>${i + 1}. ${esc(t.municipio)}/${t.uf}</b>`).join('')}</div>` : ''}
      </section>
      <section class="card">
        <div class="hunter-card-head"><div><h2><i class="fa-solid fa-user-check"></i> Fila de revisão</h2><p>Decisões humanas pendentes</p></div><button class="btn" data-go="escolas">Ver fila</button></div>
        <div class="hunter-review-list">${estado.leads.filter((l) => ['revisao', 'revisao_duplicidade'].includes(l.status)).slice(0, 5).map((lead) => `
          <button data-lead="${lead.id}"><span class="hunter-avatar">${esc(lead.nome.charAt(0))}</span><span><strong>${esc(lead.nome)}</strong><small>${esc(lead.municipio)}/${lead.uf} · ${lead.qualificacao?.completude || 0}% completo</small></span>${icpHtml(lead)}<i class="fa-solid fa-chevron-right"></i></button>`).join('') || '<div class="hunter-empty-inline">Nenhuma revisão pendente.</div>'}</div>
      </section>
    </div>`;
  ligarAcoesComuns(view);
  desenharGraficos();
}

function desenharGraficos() {
  if (!window.Chart) return;
  const r = estado.relatorio;
  graficoIcp?.destroy(); graficoProducao?.destroy();
  const ctxProducao = document.getElementById('chart-producao');
  if (ctxProducao) graficoProducao = new Chart(ctxProducao, {
    type: 'bar', data: { labels: ['Encontradas', 'Novas', 'Qualificadas', 'Enviadas'], datasets: [{ data: [r.metricas.encontrados, r.metricas.novos, r.metricas.qualificadas, r.metricas.enviadas], backgroundColor: ['#D9E7EC', '#7CCCE9', '#1685AE', '#003F59'], borderRadius: 7, barThickness: 28 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(130,150,160,.12)' } }, x: { grid: { display: false } } } },
  });
  const ctxIcp = document.getElementById('chart-icp');
  if (ctxIcp) graficoIcp = new Chart(ctxIcp, {
    type: 'doughnut', data: { labels: r.porIcp.map((x) => `ICP ${x.tier}`), datasets: [{ data: r.porIcp.map((x) => x.total), backgroundColor: ['#0F8A5F', '#1685AE', '#E0A63B', '#C8D2D7'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } },
  });
}

function leadsFiltrados() {
  const termo = estado.busca.toLowerCase();
  return estado.leads.filter((lead) => (!estado.status || lead.status === estado.status) && (!termo || `${lead.nome} ${lead.municipio} ${lead.uf} ${lead.cnpj} ${lead.responsavel}`.toLowerCase().includes(termo)));
}

function renderEscolas() {
  const leads = leadsFiltrados();
  const view = document.getElementById('hunter-view');
  view.innerHTML = `
    <section class="hunter-section-head"><div><h2>Escolas mapeadas</h2><p>Cada registro mantém origem, evidências, estimativas e histórico de decisão.</p></div><button class="btn btn-primary" id="btn-novo-lead-2"><i class="fa-solid fa-plus"></i> Adicionar escola</button></section>
    <section class="filters hunter-filters"><div><label>Buscar</label><input id="f-busca-lead" value="${esc(estado.busca)}" placeholder="Escola, município, CNPJ ou responsável"></div><div><label>Status</label><select id="f-status-lead"><option value="">Todos</option>${Object.entries(STATUS).map(([valor, [label]]) => `<option value="${valor}" ${estado.status === valor ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="hunter-filter-count"><strong>${fmtInt(leads.length)}</strong><span>escolas</span></div></section>
    <section class="card hunter-table-card"><div class="table-scroll"><table class="data-table hunter-table"><thead><tr><th>Escola</th><th>Território</th><th>Status</th><th>ICP</th><th>Porte estimado</th><th>Enriquecimento</th><th>Atualização</th><th></th></tr></thead><tbody>${leads.map((lead) => `
      <tr data-lead="${lead.id}"><td><strong>${esc(lead.nome)}${estado.espelho?.lead.id === lead.id ? ' <span class="hunter-mirror-tag">ESPELHO</span>' : ''}</strong><small>${esc(lead.cnpj || lead.origem || 'Sem CNPJ')}</small></td><td>${esc(lead.municipio)}/${lead.uf}</td><td>${statusHtml(lead.status)}</td><td><span class="hunter-icp-cell">${icpHtml(lead)}</span></td><td>${esc(lead.qualificacao?.porte || '—')}<small>confiança ${lead.qualificacao?.confiancaPorte || 'baixa'}</small></td><td><div class="hunter-mini-progress"><span style="width:${lead.padraoEspelho?.coberturaPct ?? lead.qualificacao?.completude ?? 0}%"></span></div><small>${lead.padraoEspelho ? `${lead.padraoEspelho.coberturaPct}% do espelho` : `${lead.qualificacao?.completude || 0}%`}</small></td><td>${fmtData(lead.atualizadoEm, true)}</td><td><button class="hunter-row-action" aria-label="Abrir escola"><i class="fa-solid fa-chevron-right"></i></button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty-state"><h2>Nenhuma escola neste filtro</h2><p>Execute um ciclo territorial ou adicione uma descoberta manual.</p></div></td></tr>'}</tbody></table></div></section>`;
  document.getElementById('btn-novo-lead-2').addEventListener('click', () => abrirLead());
  document.getElementById('f-busca-lead').addEventListener('input', (e) => { estado.busca = e.target.value; renderEscolas(); });
  document.getElementById('f-status-lead').addEventListener('change', (e) => { estado.status = e.target.value; renderEscolas(); });
  ligarAcoesComuns(view);
}

function renderTerritorios() {
  const view = document.getElementById('hunter-view');
  view.innerHTML = `
    <section class="hunter-section-head"><div><h2>Memória territorial</h2><p>A fila avança quando a cobertura chega a 95% ou após três ciclos consecutivos sem novidade.</p></div></section>
    <section class="card hunter-add-territory"><form id="form-territorio"><div><label>Município</label><input name="municipio" required placeholder="Ex.: Recife"></div><div><label>UF</label><input name="uf" required maxlength="2" placeholder="PE"></div><button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus"></i> Adicionar à fila</button></form><p id="territorio-feedback"></p></section>
    <section class="hunter-territory-list">${estado.territorios.map((t, i) => `
      <article class="card hunter-territory-row ${t.status === 'em_andamento' ? 'is-current' : ''}"><div class="hunter-order">${String(i + 1).padStart(2, '0')}</div><div class="hunter-territory-name"><span>${t.uf}</span><strong>${esc(t.municipio)}</strong><small>${t.status === 'saturado' ? `Saturado em ${fmtData(t.saturadoEm)}` : t.status === 'em_andamento' ? 'Em operação agora' : 'Aguardando na fila'}</small></div><div class="hunter-territory-metrics"><span><b>${t.encontrados}</b> encontrados</span><span><b>${t.novos}</b> novos</span><span><b>${t.ciclos}</b> ciclos</span></div><div class="hunter-territory-progress"><span><b>${fmtPct(t.cobertura)}</b> cobertura</span><div class="hunter-progress is-territory"><span style="width:${t.cobertura}%"></span></div></div>${t.status === 'em_andamento' ? `<button class="btn btn-primary" data-run="${t.id}"><i class="fa-solid fa-play"></i> Executar</button>` : statusHtml(t.status)}</article>`).join('')}</section>`;
  document.getElementById('form-territorio').addEventListener('submit', async (e) => {
    e.preventDefault(); const form = new FormData(e.target); const feedback = document.getElementById('territorio-feedback');
    try { await adicionarTerritorio({ municipio: form.get('municipio'), uf: form.get('uf') }); feedback.textContent = 'Município incluído na fila.'; await carregar(); }
    catch (erro) { feedback.textContent = erro.message; feedback.className = 'is-error'; }
  });
  ligarAcoesComuns(view);
}

function renderAgentes() {
  const erros = estado.logs.filter((l) => l.nivel === 'erro');
  const view = document.getElementById('hunter-view');
  view.innerHTML = `<section class="hunter-section-head"><div><h2>Agentes especializados</h2><p>Uma esteira única, com responsabilidade, entrada e saída auditáveis em cada etapa.</p></div></section><section class="hunter-agents-grid">${AGENTES_HUNTER.map((agente, i) => {
    const ult = estado.logs.find((l) => l.agente === agente.id);
    const comErro = erros.some((l) => l.agente === agente.id);
    return `<article class="card hunter-agent"><div class="hunter-agent-top"><span><i class="fa-solid ${agente.icone}"></i></span>${statusHtml(comErro ? 'erro' : estado.config.ativo ? 'qualificada' : 'descartada')}</div><b>${String(i + 1).padStart(2, '0')}</b><h3>${esc(agente.nome)}</h3><p>${esc(agente.descricao)}</p><small>${ult ? `${fmtData(ult.criadoEm, true)} · ${esc(ult.mensagem)}` : 'Aguardando primeira execução'}</small></article>`;
  }).join('')}</section><section class="card hunter-settings"><h2>Ritmo da operação</h2><form id="form-config"><label>Meta diária<input type="number" min="1" max="500" name="metaDiaria" value="${estado.config.metaDiaria}"></label><label>Raio por ciclo (km)<input type="number" min="2" max="30" name="raioKm" value="${estado.config.raioKm}"></label><button class="btn btn-primary">Salvar configuração</button></form></section>`;
  document.getElementById('form-config').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); await salvarConfiguracao({ metaDiaria: f.get('metaDiaria'), raioKm: f.get('raioKm') }); await carregar(); });
}

function renderLogs() {
  const view = document.getElementById('hunter-view');
  const runsComErro = estado.relatorio.runs.filter((run) => run.status === 'erro');
  view.innerHTML = `<section class="hunter-section-head"><div><h2>Atividade e controle de erros</h2><p>Rastro cronológico das decisões e execuções do Hunter.</p></div></section>${runsComErro.length ? `<section class="card hunter-errors"><div class="hunter-card-head"><div><h2>Execuções com erro</h2><p>Reprocesse sem perder o histórico da tentativa original.</p></div></div>${runsComErro.map((run) => `<article><div><strong>${esc(run.municipio)}/${run.uf}</strong><p>${esc(run.erro)}</p><small>${fmtData(run.iniciadoEm, true)}</small></div><button class="btn" data-reprocess="${run.id}"><i class="fa-solid fa-rotate-right"></i> Reprocessar</button></article>`).join('')}</section>` : ''}<section class="card hunter-log-list">${estado.logs.map((log) => `<article class="hunter-log hunter-log-${log.nivel}"><span><i class="fa-solid ${log.nivel === 'erro' ? 'fa-triangle-exclamation' : log.nivel === 'atencao' ? 'fa-circle-exclamation' : 'fa-check'}"></i></span><div><strong>${esc(AGENTES_HUNTER.find((a) => a.id === log.agente)?.nome || log.agente)}</strong><p>${esc(log.mensagem)}</p><small>${fmtData(log.criadoEm, true)}${log.entidadeId ? ` · ${esc(log.entidadeId)}` : ''}</small></div></article>`).join('') || '<div class="empty-state"><h2>Sem atividade registrada</h2></div>'}</section>`;
  view.querySelectorAll('[data-reprocess]').forEach((btn) => btn.addEventListener('click', async () => {
    const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reprocessando';
    try { await reprocessarRun(btn.dataset.reprocess); await carregar(); }
    catch (erro) { alert(erro.message); btn.disabled = false; btn.innerHTML = original; await carregar(); }
  }));
}

function ligarAcoesComuns(raiz) {
  raiz.querySelectorAll('[data-lead]').forEach((el) => el.addEventListener('click', () => abrirLead(el.dataset.lead)));
  raiz.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => { estado.aba = el.dataset.go; render(); }));
  raiz.querySelectorAll('[data-run]').forEach((btn) => btn.addEventListener('click', () => executarCiclo(btn.dataset.run, btn)));
}

async function executarCiclo(territorioId, botao) {
  const original = botao.innerHTML; botao.disabled = true; botao.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Registrando solicitação';
  try {
    await solicitarLoteCodex({ territorioId, minimo: 10 });
    alert('Solicitação registrada. O Codex fará a investigação pública, preencherá as evidências e deixará o lote pronto para sua confirmação antes do envio à kedu.');
    await carregar();
  } catch (erro) {
    alert(`O lote não foi concluído: ${erro.message}`);
    botao.disabled = false; botao.innerHTML = original; await carregar();
  }
}

function blankLead() {
  return { nome: '', municipio: '', uf: '', endereco: '', bairro: '', cep: '', cnpj: '', telefone: '', email: '', site: '', instagram: '', responsavel: '', cargo: '', telefoneResponsavel: '', origem: 'Pesquisa manual', status: 'revisao', sinaisEstrutura: 0, alunosEstimados: '', mensalidadeEstimada: '', evidencias: [], classificacao: { elegivel: true }, qualificacao: { icp: 0, tier: 'D', completude: 0, porte: 'Não estimado', confiancaPorte: 'baixa' } };
}

async function abrirLead(leadId = '') {
  const lead = leadId ? await obterLead(leadId) : blankLead();
  const historico = leadId ? await historicoLead(leadId) : [];
  const validacao = validarParaKedu(lead);
  const modal = document.getElementById('hunter-modal');
  modal.innerHTML = `<div class="hunter-modal-overlay"><aside class="hunter-drawer"><header><div><span>${leadId ? statusHtml(lead.status) : '<span class="hunter-status hunter-status-info">Nova descoberta</span>'}</span><h2>${esc(lead.nome || 'Cadastrar escola')}</h2><p>${esc(lead.municipio || 'Município')}${lead.uf ? `/${lead.uf}` : ''} · ${esc(lead.origem || 'Pesquisa manual')}</p></div><button class="hunter-close" id="lead-fechar" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button></header>
    <div class="hunter-drawer-score"><div>${icpHtml(lead)}<span>ICP Score</span></div><div><strong>${lead.qualificacao?.completude || 0}%</strong><span>Enriquecimento</span></div><div><strong>${esc(lead.qualificacao?.porte || '—')}</strong><span>Porte · confiança ${lead.qualificacao?.confiancaPorte || 'baixa'}</span></div></div>
    <form id="lead-form" class="hunter-lead-form">
      <section><h3>Identificação da escola</h3><div class="hunter-form-grid"><label class="span2">Nome da escola<input name="nome" required value="${esc(lead.nome)}"></label><label>Município<input name="municipio" required value="${esc(lead.municipio)}"></label><label>UF<input name="uf" maxlength="2" required value="${esc(lead.uf)}"></label><label class="span2">Endereço<input name="endereco" value="${esc(lead.endereco)}"></label><label>CNPJ<input name="cnpj" value="${esc(lead.cnpj)}"></label><label>Telefone da escola<input name="telefone" value="${esc(lead.telefone)}"></label></div></section>
      <section><h3>Responsável e canais</h3><div class="hunter-form-grid"><label>Responsável<input name="responsavel" value="${esc(lead.responsavel)}"></label><label>Cargo<input name="cargo" value="${esc(lead.cargo)}" placeholder="Mantenedor(a), Diretor(a)..."></label><label>Telefone direto<input name="telefoneResponsavel" value="${esc(lead.telefoneResponsavel)}"></label><label>E-mail<input type="email" name="email" value="${esc(lead.email)}"></label><label>Instagram<input name="instagram" value="${esc(lead.instagram)}"></label><label>Site<input name="site" value="${esc(lead.site)}"></label></div></section>
      <section><h3>Estimativa de porte</h3><p class="hunter-method-note">Estimativa, não faturamento confirmado. O intervalo só é calculado quando há alunos e mensalidade estimados.</p><div class="hunter-form-grid"><label>Sinais de estrutura (0–5)<input type="number" min="0" max="5" name="sinaisEstrutura" value="${lead.sinaisEstrutura || 0}"></label><label>Alunos estimados<input type="number" min="0" name="alunosEstimados" value="${esc(lead.alunosEstimados || '')}"></label><label>Mensalidade estimada<input type="number" min="0" name="mensalidadeEstimada" value="${esc(lead.mensalidadeEstimada || '')}"></label><div class="hunter-estimate"><span>Receita mensal estimada</span><strong>${lead.qualificacao?.receitaEstimada ? `${fmtMoeda(lead.qualificacao.receitaEstimada.minimo)}–${fmtMoeda(lead.qualificacao.receitaEstimada.maximo)}` : 'Dados insuficientes'}</strong><small>confiança ${lead.qualificacao?.receitaEstimada?.confianca || 'não calculada'}</small></div></div></section>
      <footer><button type="button" class="btn" id="lead-cancelar">Cancelar</button><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> ${leadId ? 'Salvar alterações' : 'Criar escola'}</button></footer>
    </form>
    ${leadId ? `<section class="hunter-research"><h3>Investigação em fontes públicas</h3><div><button class="btn btn-primary" id="btn-investigar"><i class="fa-solid fa-wand-magic-sparkles"></i> Investigar como a Jemina</button><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`\"${lead.nome}\" ${lead.municipio} escola`)}"><i class="fa-brands fa-google"></i> Busca web</a><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.nome}, ${lead.municipio}, ${lead.uf}`)}"><i class="fa-solid fa-map-location-dot"></i> Google Maps</a><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com \"${lead.nome}\" ${lead.municipio}`)}"><i class="fa-brands fa-instagram"></i> Instagram</a>${lead.cnpj ? `<a class="btn" target="_blank" rel="noopener" href="https://brasilapi.com.br/api/cnpj/v1/${String(lead.cnpj).replace(/\D/g, '')}"><i class="fa-solid fa-building"></i> CNPJ público</a>` : ''}</div></section>${lead.padraoEspelho ? `<section class="hunter-mirror-gap"><h3>Comparação com ${esc(lead.padraoEspelho.espelhoNome)}</h3><div class="hunter-progress"><span style="width:${lead.padraoEspelho.coberturaPct}%"></span></div><b>${lead.padraoEspelho.coberturaPct}% do padrão</b>${lead.padraoEspelho.camposFaltantes.length ? `<p>Campos a investigar: ${lead.padraoEspelho.camposFaltantes.map(esc).join(', ')}.</p>` : ''}${lead.padraoEspelho.evidenciasFaltantes.length ? `<p>Evidências a buscar: ${lead.padraoEspelho.evidenciasFaltantes.map(esc).join(', ')}.</p>` : ''}</section>` : ''}<section class="hunter-evidence"><div class="hunter-section-inline"><div><h3>Evidências e fontes</h3><p>Registre a origem de cada informação usada.</p></div><button class="btn" id="btn-evidencia"><i class="fa-solid fa-plus"></i> Evidência</button></div>${(lead.evidencias || []).map((ev) => `<article><span><i class="fa-solid ${ev.tipo === 'contato' ? 'fa-address-book' : ev.tipo === 'cnpj' ? 'fa-building' : 'fa-link'}"></i></span><div><strong>${esc(ev.fonte)}</strong><p>${esc(ev.descricao)}</p><small>${fmtData(ev.coletadoEm, true)}</small></div>${ev.url ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}</article>`).join('') || '<div class="hunter-empty-inline">Nenhuma evidência registrada.</div>'}</section>
    <section class="hunter-review-actions"><h3>Decisão humana</h3><div>${['revisao', 'revisao_duplicidade'].includes(lead.status) ? `<button class="btn btn-success" id="btn-qualificar"><i class="fa-solid fa-check"></i> Qualificar</button>` : ''}${estado.espelho?.lead.id !== lead.id ? `<button class="btn" id="btn-espelho"><i class="fa-solid fa-wand-magic-sparkles"></i> Usar como espelho</button>` : '<span class="hunter-status hunter-status-info">Padrão atual do Hunter</span>'}<button class="btn" id="btn-descartar"><i class="fa-solid fa-ban"></i> Descartar</button><button class="btn btn-kedu" id="btn-kedu"><i class="fa-solid fa-paper-plane"></i> ${!validacao.pronto ? `Faltam ${validacao.faltantes.length} campos para kedu` : lead.status === 'enviada_kedu' ? 'Reenviar pelo formulário kedu' : lead.status === 'aguardando_envio_kedu' ? 'Tentar envio novamente' : 'Enviar pelo formulário kedu'}</button></div></section>
    <section class="hunter-history"><h3>Histórico</h3>${historico.slice(0, 8).map((h) => `<p><i></i><span><b>${esc(h.acao.replaceAll('_', ' '))}</b><small>${fmtData(h.criadoEm, true)} · ${esc(h.usuario)}</small></span></p>`).join('')}</section>` : ''}
  </aside></div>`;
  document.getElementById('lead-fechar').addEventListener('click', fecharModal);
  document.getElementById('lead-cancelar').addEventListener('click', fecharModal);
  modal.querySelector('.hunter-modal-overlay').addEventListener('click', (e) => { if (e.target.classList.contains('hunter-modal-overlay')) fecharModal(); });
  document.getElementById('lead-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const dados = Object.fromEntries(f.entries());
    dados.sinaisEstrutura = Number(dados.sinaisEstrutura || 0); dados.alunosEstimados = Number(dados.alunosEstimados || 0) || null; dados.mensalidadeEstimada = Number(dados.mensalidadeEstimada || 0) || null;
    try {
      if (leadId) await salvarLead({ ...lead, ...dados }, { acao: 'dados_atualizados' });
      else await criarLeadManual(dados);
      fecharModal(); await carregar();
    } catch (erro) { alert(erro.message); }
  });
  if (!leadId) return;
  document.getElementById('btn-evidencia').addEventListener('click', () => abrirFormularioEvidencia(leadId));
  document.getElementById('btn-investigar').addEventListener('click', async (e) => { const botao = e.currentTarget; const original = botao.innerHTML; botao.disabled = true; botao.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Investigando…'; try { await enriquecerLeadAutomaticamente(leadId); await carregar(); await abrirLead(leadId); } catch (erro) { alert(erro.message); botao.disabled = false; botao.innerHTML = original; } });
  document.getElementById('btn-espelho')?.addEventListener('click', async () => { await definirLeadEspelho(leadId); await carregar(); await abrirLead(leadId); });
  document.getElementById('btn-qualificar')?.addEventListener('click', async () => { try { await qualificarLead(leadId); fecharModal(); await carregar(); } catch (erro) { alert(erro.message); } });
  document.getElementById('btn-descartar').addEventListener('click', async () => { const motivo = prompt('Motivo do descarte:', lead.motivoDescarte || 'Fora do ICP comercial'); if (!motivo) return; await descartarLead(leadId, motivo); fecharModal(); await carregar(); });
  document.getElementById('btn-kedu').addEventListener('click', () => abrirEnvioKedu(lead));
}

function fecharModal() { document.getElementById('hunter-modal').innerHTML = ''; }

function abrirFormularioEvidencia(leadId) {
  const modal = document.getElementById('hunter-modal');
  const drawer = modal.querySelector('.hunter-drawer');
  const bloco = document.createElement('div'); bloco.className = 'hunter-popover';
  bloco.innerHTML = `<form id="form-evidencia"><div class="hunter-section-inline"><h3>Adicionar evidência</h3><button type="button" class="hunter-close" id="ev-fechar"><i class="fa-solid fa-xmark"></i></button></div><label>Fonte<input name="fonte" required placeholder="Site institucional, Instagram, Receita..."></label><label>URL pública<input name="url" type="url" placeholder="https://..."></label><label>Informação confirmada<textarea name="descricao" required rows="3"></textarea></label><label>Tipo<select name="tipo"><option value="web">Web</option><option value="contato">Contato</option><option value="cnpj">CNPJ</option><option value="decisor">Decisor</option><option value="estrutura">Estrutura</option></select></label><button class="btn btn-primary">Salvar evidência</button></form>`;
  drawer.appendChild(bloco);
  document.getElementById('ev-fechar').addEventListener('click', () => bloco.remove());
  document.getElementById('form-evidencia').addEventListener('submit', async (e) => { e.preventDefault(); await adicionarEvidencia(leadId, Object.fromEntries(new FormData(e.target).entries())); await abrirLead(leadId); await carregar(); });
}

async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); const original = botao.innerHTML; botao.innerHTML = '<i class="fa-solid fa-check"></i> Copiado'; setTimeout(() => { botao.innerHTML = original; }, 1200); }
  catch { prompt('Copie o valor abaixo:', texto); }
}

async function abrirEnvioKedu(lead) {
  let validacao;
  try { validacao = await prepararEnvioKedu(lead.id); }
  catch (erro) { alert(erro.message); return; }
  if (!validacao.pronto) { alert(`Complete antes do envio: ${validacao.faltantes.join(', ')}.`); return; }
  const modal = document.getElementById('hunter-modal');
  const drawer = modal.querySelector('.hunter-drawer');
  const campos = validacao.campos;
  const bloco = document.createElement('div'); bloco.className = 'hunter-popover hunter-kedu-popover';
  bloco.innerHTML = `<div class="hunter-section-inline"><div><span class="hunter-kedu-mark">kedu&gt;</span><h3>Cadastro no formulário oficial</h3><p>Abra a kedu, copie os cinco campos e confirme somente após o site aceitar o envio.</p></div><button class="hunter-close" id="kedu-fechar"><i class="fa-solid fa-xmark"></i></button></div><div class="hunter-kedu-fields">${Object.entries({ 'Seu nome': campos.name, 'Escola': campos.school, 'E-mail': campos.email, 'Cargo': campos.role, 'Telefone': campos.phone }).map(([label, valor]) => `<div><span>${label}</span><strong>${esc(valor)}</strong><button data-copy="${esc(valor)}" class="btn"><i class="fa-regular fa-copy"></i></button></div>`).join('')}</div><div class="hunter-kedu-warning"><i class="fa-solid fa-shield-halved"></i><p>O Nexo não simula o consentimento nem contorna a proteção do formulário. O registro só vira “enviado” depois da sua confirmação.</p></div><div class="hunter-kedu-actions"><a class="btn btn-kedu" href="${KEDU_FORM_URL}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir formulário da kedu</a><button class="btn" id="kedu-falhou"><i class="fa-solid fa-rotate-right"></i> O site não aceitou</button><button class="btn btn-primary" id="kedu-confirmar"><i class="fa-solid fa-check"></i> Confirmar envio aceito</button></div>`;
  drawer.appendChild(bloco);
  document.getElementById('kedu-fechar').addEventListener('click', () => bloco.remove());
  bloco.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => copiar(btn.dataset.copy, btn)));
  document.getElementById('kedu-falhou').addEventListener('click', async () => { await registrarFalhaEnvioKedu(lead.id); fecharModal(); await carregar(); });
  document.getElementById('kedu-confirmar').addEventListener('click', async () => { await confirmarEnvioKedu(lead.id); fecharModal(); await carregar(); });
}

function linhasExportacao() {
  return estado.relatorio.leads.map((lead) => ({
    escola: lead.nome, municipio: lead.municipio, uf: lead.uf, status: STATUS[lead.status]?.[0] || lead.status,
    icp: lead.qualificacao?.tier, score: lead.qualificacao?.icp, porteEstimado: lead.qualificacao?.porte,
    confiancaPorte: lead.qualificacao?.confiancaPorte, cnpj: lead.cnpj, responsavel: lead.responsavel,
    cargo: lead.cargo, telefone: lead.telefoneResponsavel || lead.telefone, email: lead.email,
    instagram: lead.instagram, site: lead.site, fontes: (lead.evidencias || []).map((e) => e.url || e.fonte).join(' | '),
    criadoEm: fmtData(lead.criadoEm, true), enviadoKeduEm: fmtData(lead.enviadoKeduEm, true),
  }));
}

function exportarRelatorioCsv() {
  exportarCsv(linhasExportacao(), [
    ['escola', 'Escola'], ['municipio', 'Município'], ['uf', 'UF'], ['status', 'Status'], ['icp', 'ICP'], ['score', 'Score'],
    ['porteEstimado', 'Porte estimado'], ['confiancaPorte', 'Confiança do porte'], ['cnpj', 'CNPJ'], ['responsavel', 'Responsável'],
    ['cargo', 'Cargo'], ['telefone', 'Telefone'], ['email', 'E-mail'], ['instagram', 'Instagram'], ['site', 'Site'],
    ['fontes', 'Evidências/fontes'], ['criadoEm', 'Descoberta em'], ['enviadoKeduEm', 'Enviado à kedu em'],
  ].map(([chave, titulo]) => ({ chave, titulo })), `nexo_hunter_${estado.periodo}`);
}

function exportarRelatorioXlsx() {
  if (!window.XLSX) { alert('A biblioteca de Excel não carregou. Use a exportação CSV.'); return; }
  const wb = XLSX.utils.book_new();
  const escolas = linhasExportacao();
  const resumo = Object.entries(estado.relatorio.metricas).map(([metrica, valor]) => ({ Métrica: metrica, Valor: valor }));
  const territorios = estado.territorios.map((t) => ({ Município: t.municipio, UF: t.uf, Status: t.status, Cobertura: t.cobertura, Ciclos: t.ciclos, Encontrados: t.encontrados, Novos: t.novos, 'Última busca': fmtData(t.ultimaBuscaEm, true) }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(escolas), 'Escolas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(territorios), 'Territórios');
  XLSX.writeFile(wb, `nexo_hunter_${estado.periodo}.xlsx`);
}

function ligarGlobais() {
  document.querySelectorAll('.hunter-tab').forEach((btn) => btn.addEventListener('click', () => { estado.aba = btn.dataset.aba; render(); }));
  document.getElementById('btn-novo-lead').addEventListener('click', () => abrirLead());
  document.getElementById('hunter-ativo').addEventListener('change', async (e) => { await salvarConfiguracao({ ativo: e.target.checked }); await carregar(); });
  document.getElementById('f-periodo').addEventListener('change', async (e) => { estado.periodo = e.target.value; document.getElementById('periodo-custom').classList.toggle('hidden', estado.periodo !== 'custom'); if (estado.periodo !== 'custom') await carregar(); });
  document.getElementById('f-inicio').addEventListener('change', async (e) => { estado.inicio = e.target.value; if (estado.inicio && estado.fim) await carregar(); });
  document.getElementById('f-fim').addEventListener('change', async (e) => { estado.fim = e.target.value; if (estado.inicio && estado.fim) await carregar(); });
  document.getElementById('btn-exportar-csv').addEventListener('click', exportarRelatorioCsv);
  document.getElementById('btn-exportar-xlsx').addEventListener('click', exportarRelatorioXlsx);
}

async function verificarExecucaoAutomatica() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('autorun') !== '1') return;
  const hoje = new Date().toISOString().slice(0, 10);
  const chave = `nexo_hunter_autorun_${hoje}`;
  if (localStorage.getItem(chave) === 'concluido' || localStorage.getItem(chave) === 'executando') return;
  const territorio = estado.territorios.find((item) => item.status === 'em_andamento');
  if (!territorio || !estado.config.ativo) return;
  localStorage.setItem(chave, 'executando');
  try {
    await solicitarLoteCodex({ territorioId: territorio.id, minimo: 10, origem: 'agendamento_9h' });
    localStorage.setItem(chave, 'concluido');
    await carregar();
  } catch (erro) {
    localStorage.removeItem(chave);
    console.error('Execução automática do Hunter não concluída:', erro);
    await carregar();
  }
}

async function init() {
  shell(); ligarGlobais();
  try { await carregar(); await verificarExecucaoAutomatica(); }
  catch (erro) { document.getElementById('hunter-view').innerHTML = `<div class="card hunter-fatal"><i class="fa-solid fa-triangle-exclamation"></i><h2>Não foi possível iniciar o Hunter</h2><p>${esc(erro.message)}</p><button class="btn btn-primary" onclick="location.reload()">Tentar novamente</button></div>`; }
}

init();
