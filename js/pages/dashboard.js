import { montarLayout } from '../components/layout.js';
import { fmtInt, fmtMoedaCompacta, labelPorte } from '../utils/formatters.js';
import { carregarDadosDashboard } from '../services/dashboardDataService.js';
import { importarTodasUFs, importarUF, carregarIndiceUFs, statusBaseCarregada, calcularCenarioAtual } from '../services/importService.js';
import { abrirPainelEscola } from '../components/painelEscola.js';

montarLayout({ paginaAtiva: 'dashboard', titulo: 'Dashboard', prefixo: '' });
const content = document.getElementById('content');

const CORES = {
  azul: '#2a78d6', verde: '#1baf7a', ambar: '#EDA100',
  icpAlta: '#0F6E56', icpMedia: '#EDA100', icpBaixa: '#B4B2A9',
  evasaoForte: '#E24B4A', evasaoLeve: '#EF9F27', estavel: '#B4B2A9', ganho: '#1baf7a',
  ativa: '#0F6E56', sumiu: '#E24B4A', nova: '#378ADD',
};

let dados = null;
let sortGrowth = { key: 'VARIACAO_MATRICULAS_PCT', dir: -1 };
let sortOcioso = { key: 'CAPACIDADE_OCIOSA_ESTIMADA_ALUNOS', dir: -1 };
let charts = {};

function destroyChart(nome) {
  if (charts[nome]) { charts[nome].destroy(); delete charts[nome]; }
}

function currentFiltro() {
  const el = document.getElementById('f-uf');
  return { uf: el ? el.value : '' };
}

function skeleton() {
  const totalRegistrosBase = Object.values(dados.totalBasePorUF || {}).reduce((s, n) => s + n, 0);
  content.innerHTML = `
    <div class="dash-hero">
      <div>
        <h1 class="dash-hero-title"><i class="fa-solid fa-satellite-dish"></i> Visão geral do mercado</h1>
        <p class="dash-hero-sub" id="hero-total-escolas">${fmtInt(totalRegistrosBase)} registros de escolas do Brasil, atualizado com o Censo Escolar INEP 2025 + mapeamento próprio</p>
      </div>
      <div class="filters" style="margin-bottom:0;">
        <div>
          <label>Filtrar por UF</label>
          <select id="f-uf"><option value="">Todas</option></select>
        </div>
      </div>
    </div>

    <div class="kpis" id="kpis"></div>



    <div class="dash-section-header"><i class="fa-solid fa-map-location-dot"></i> Onde estão as escolas</div>
    <div class="card">
      <h2>Mapa interativo</h2>
      <p class="sub">Cada ponto é um município · tamanho = nº de escolas · cor = ticket médio estimado · clique pra ver detalhes e abrir o Mapear Mercado já centralizado ali</p>
      <div class="legend">
        <span><span class="dot" style="background:${CORES.icpBaixa}"></span>ticket baixo</span>
        <span><span class="dot" style="background:${CORES.icpMedia}"></span>ticket médio</span>
        <span><span class="dot" style="background:${CORES.icpAlta}"></span>ticket alto</span>
      </div>
      <div id="mapa-brasil" style="height:480px;border-radius:var(--radius-md);overflow:hidden;margin-top:8px;"></div>
    </div>

    <div class="card">
      <h2>Escolas por UF (top 15)</h2>
      <p class="sub">Nº de escolas privadas ativas · clique numa barra pra filtrar</p>
      <div style="position:relative;height:320px;">
        <canvas id="chart-uf" role="img" aria-label="Grafico de barras do numero de escolas privadas por estado"></canvas>
      </div>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-star"></i> Perfil das escolas e dos responsáveis</div>
    <div class="grid2">
      <div class="card">
        <h2>Distribuição por porte</h2>
        <div style="position:relative;height:240px;">
          <canvas id="chart-porte" role="img" aria-label="Grafico de barras da distribuicao de escolas por porte"></canvas>
        </div>
      </div>
      <div class="card">
        <h2>Top 10 por faturamento potencial</h2>
        <p class="sub">Maior faturamento potencial estimado no Brasil · clique numa barra pra abrir a ficha</p>
        <div style="position:relative;height:240px;">
          <canvas id="chart-icp" role="img" aria-label="Grafico de barras das 10 escolas com maior faturamento potencial no Brasil"></canvas>
        </div>
      </div>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-bullseye"></i> Prioridades de prospecção</div>
    <div class="card">
      <h2>Top oportunidades (maior faturamento potencial)</h2>
      <p class="sub">300 escolas com maior faturamento potencial estimado · clique numa linha pra abrir a ficha, ou num cabeçalho pra ordenar</p>
      <div class="table-scroll">
        <table class="data-table" id="tabela-top">
          <thead><tr>
            <th data-key="NO_ENTIDADE">Escola</th><th data-key="SG_UF">UF</th><th data-key="NO_MUNICIPIO">Município</th>
            <th data-key="PORTE">Porte</th><th data-key="QT_MAT_BAS">Matrículas</th>
            <th data-key="FATURAMENTO_POTENCIAL_ANUAL">Faturamento potencial/ano</th><th data-key="NU_DDD">DDD</th><th data-key="NU_TELEFONE">Telefone</th>
          </tr></thead>
          <tbody id="tbody-top"></tbody>
        </table>
      </div>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-arrow-trend-up"></i> Evolução 2024 → 2025</div>
    <p class="section-sub" style="margin-top:-8px;">Cruzamento com o Censo Escolar 2024 — evasão, ganho de matrículas, mudança de porte e capacidade ociosa</p>

    <div class="kpis" id="kpis-evo"></div>

    <div class="grid2">
      <div class="card">
        <h2>Sinal de matrículas por UF (top 15)</h2>
        <div style="position:relative;height:320px;">
          <canvas id="chart-sinal" role="img" aria-label="Grafico de barras empilhadas do sinal de variacao de matriculas por estado"></canvas>
        </div>
      </div>
      <div class="card">
        <h2>Continuidade das escolas</h2>
        <div style="position:relative;height:320px;">
          <canvas id="chart-status" role="img" aria-label="Grafico de pizza da continuidade das escolas entre 2024 e 2025"></canvas>
        </div>
      </div>
    </div>

    <div class="card">
      <h2><i class="fa-solid fa-arrow-up-right-dots" style="color:var(--icp-alta);"></i> Maiores ganhos de matrícula</h2>
      <p class="sub">Escolas ativas com maior crescimento percentual 2024→2025 — oportunidades de upsell · clique numa linha pra abrir a ficha</p>
      <div class="table-scroll">
        <table class="data-table" id="tabela-crescimento">
          <thead><tr>
            <th data-key="NO_ENTIDADE">Escola</th><th data-key="SG_UF">UF</th><th data-key="NO_MUNICIPIO">Município</th>
            <th data-key="QT_MAT_BAS_2024">Matrículas 2024</th><th data-key="QT_MAT_BAS_2025">Matrículas 2025</th>
            <th data-key="VARIACAO_MATRICULAS_PCT">Variação %</th><th data-key="MUDANCA_PORTE">Mudança de porte</th>
            <th data-key="MENSALIDADE_ESTIMADA">Ticket médio</th><th data-key="NU_DDD">DDD</th><th data-key="NU_TELEFONE">Telefone</th>
          </tr></thead>
          <tbody id="tbody-crescimento"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2><i class="fa-solid fa-door-open" style="color:var(--icp-media);"></i> Maior capacidade ociosa estimada</h2>
      <p class="sub">Escolas ativas com mais "vagas sobrando" vs. benchmark do mesmo porte/UF · clique numa linha pra abrir a ficha</p>
      <div class="table-scroll">
        <table class="data-table" id="tabela-ocioso">
          <thead><tr>
            <th data-key="NO_ENTIDADE">Escola</th><th data-key="SG_UF">UF</th><th data-key="NO_MUNICIPIO">Município</th>
            <th data-key="QT_MAT_BAS_2025">Matrículas 2025</th><th data-key="CAPACIDADE_OCIOSA_ESTIMADA_ALUNOS">Capacidade ociosa (alunos)</th>
            <th data-key="SINAL_MATRICULAS">Sinal de matrículas</th><th data-key="MENSALIDADE_ESTIMADA">Ticket médio</th>
            <th data-key="NU_DDD">DDD</th><th data-key="NU_TELEFONE">Telefone</th>
          </tr></thead>
          <tbody id="tbody-ocioso"></tbody>
        </table>
      </div>
    </div>

    <hr class="section-divider">
    <div class="card">
      <h2><i class="fa-solid fa-database"></i> Base local (neste navegador)</h2>
      <p class="sub">Necessária para a Consulta de escolas com busca instantânea. O dashboard acima não depende disso.</p>
      <p style="margin-bottom:12px;"><strong id="contador-base">...</strong> de ${fmtInt(dados.porUF.reduce((s, r) => s + r.n_escolas, 0))} escolas carregadas localmente.</p>
      <button class="btn btn-primary" id="btn-importar">Carregar base completa agora</button>
      <div class="loading-bar" id="log-importacao"></div>
    </div>

    <div class="footer-note">
      <strong>Sobre as premissas:</strong> o faturamento potencial anual é uma estimativa (mensalidade média por porte × multiplicador regional × matrículas × 12 meses), ainda não calibrada com benchmarks reais da Kedu. A capacidade ociosa compara a média de alunos/turma da escola com a mediana de escolas do mesmo porte/UF — não é a capacidade física real declarada. O grupo "sumiu em 2025" pode incluir tanto encerramentos reais quanto escolas que não atualizaram o Censo. Base: Censo Escolar INEP 2024 e 2025, escolas privadas.
    </div>
  `;
}

async function renderKPIs(f) {
  let rows = dados.porUF;
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  const totalEscolasEstatico = f.uf
    ? (dados.totalBasePorUF?.[f.uf] ?? rows.reduce((s, r) => s + r.n_escolas, 0))
    : Object.values(dados.totalBasePorUF || {}).reduce((s, n) => s + n, 0);
  const totalMat = rows.reduce((s, r) => s + r.matriculas, 0);
  const totalFat = rows.reduce((s, r) => s + r.faturamento_potencial, 0);
  const ticketMedio = totalMat ? totalFat / (totalMat * 12) : 0;
  const base = f.uf ? { uf: f.uf } : {};

  // Combina o índice semente com o que já foi importado/enriquecido neste
  // navegador. Assim carregar uma única UF nunca derruba o total nacional.
  let totalEscolas = totalEscolasEstatico;
  let cenarioAtual = null;
  try {
    cenarioAtual = await calcularCenarioAtual();
    totalEscolas = f.uf ? (cenarioAtual.porUF[f.uf]?.atual ?? totalEscolasEstatico) : cenarioAtual.total;
  } catch (err) { /* segue com o número estático se o banco local falhar */ }

  const variacao = cenarioAtual?.variacaoLiquida || 0;
  const complementoInventario = !f.uf && variacao
    ? `<div class="sub" style="margin-top:5px;">${variacao > 0 ? '+' : ''}${fmtInt(variacao)} no cenário local</div>`
    : '';

  document.getElementById('kpis').innerHTML = `
    <div class="kpi clicavel" data-nav='${JSON.stringify(base)}'><div class="label"><i class="fa-solid fa-school"></i> Registros de escolas na base</div><div class="value">${fmtInt(totalEscolas)}</div>${complementoInventario}</div>
    <div class="kpi clicavel" data-nav='${JSON.stringify({ ...base, ordenarPor: 'mat25' })}'><div class="label"><i class="fa-solid fa-users"></i> Matrículas totais</div><div class="value">${fmtInt(totalMat)}</div></div>
    <div class="kpi clicavel" data-nav='${JSON.stringify({ ...base, ordenarPor: 'fatPotencial' })}'><div class="label"><i class="fa-solid fa-sack-dollar"></i> Faturamento potencial estimado/ano</div><div class="value">${fmtMoedaCompacta(totalFat)}</div></div>
    <div class="kpi clicavel" data-nav='${JSON.stringify({ ...base, ordenarPor: 'mensalidade' })}'><div class="label"><i class="fa-solid fa-sack-dollar"></i> Ticket médio estimado</div><div class="value">${fmtMoedaCompacta(ticketMedio)}</div></div>`;
  ligarCliqueKpis('#kpis');
  const heroEl = document.getElementById('hero-total-escolas');
  if (heroEl && !f.uf) {
    const detalhe = variacao ? ` · ${variacao > 0 ? '+' : ''}${fmtInt(variacao)} incorporados ao cenário local` : '';
    heroEl.textContent = `${fmtInt(totalEscolas)} registros de escolas do Brasil, atualizado com o Censo Escolar INEP 2025 + mapeamento próprio${detalhe}`;
  }
}

function ligarCliqueKpis(containerSelector) {
  document.querySelectorAll(`${containerSelector} .kpi.clicavel`).forEach((el) => {
    el.addEventListener('click', () => irParaBusca(JSON.parse(el.dataset.nav)));
  });
}

function renderKPIsEvo() {
  const k = dados.kpisEvolucao;
  document.getElementById('kpis-evo').innerHTML = `
    <div class="kpi"><div class="label"><i class="fa-solid fa-circle-check" style="color:var(--icp-alta);"></i> Continuam ativas</div><div class="value">${fmtInt(k.continua_ativa)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-circle-xmark" style="color:var(--danger);"></i> Sumiram em 2025</div><div class="value">${fmtInt(k.sumiu)}</div></div>
    <div class="kpi clicavel" data-nav='${JSON.stringify({ sinalMat: 'Evasao forte (queda >10%)' })}'><div class="label"><i class="fa-solid fa-arrow-trend-down" style="color:var(--danger);"></i> Evasão forte (>10%)</div><div class="value">${fmtInt(k.evasao_forte)}</div></div>
    <div class="kpi clicavel" data-nav='${JSON.stringify({ sinalMat: 'Ganho de alunos (crescimento >10%)' })}'><div class="label"><i class="fa-solid fa-arrow-trend-up" style="color:var(--icp-alta);"></i> Ganho de alunos (>10%)</div><div class="value">${fmtInt(k.ganho)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-up-long"></i> Subiram de porte</div><div class="value">${fmtInt(k.subiu_porte)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-down-long"></i> Caíram de porte</div><div class="value">${fmtInt(k.caiu_porte)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-door-open"></i> Capacidade ociosa (alunos)</div><div class="value">${fmtInt(k.capacidade_ociosa_total_estim)}</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-plus"></i> Escolas novas em 2025</div><div class="value">${fmtInt(k.nova)}</div></div>`;
  ligarCliqueKpis('#kpis-evo');
}

function iconTextColor() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return dark ? '#B4B2A5' : '#6B6A63';
}

function irParaBusca(params) {
  const qs = new URLSearchParams(params).toString();
  window.location.href = `pages/busca.html?${qs}`;
}

let indiceUFsCache = null;
async function abrirEscolaDoDashboard(uf, id) {
  if (!indiceUFsCache) indiceUFsCache = await carregarIndiceUFs();
  const item = indiceUFsCache.find((i) => i.uf === uf);
  if (item) await importarUF(uf, item.arquivo);
  abrirPainelEscola(Number(id), { onAtualizar: () => renderTudo() });
}

function renderChartUF(f) {
  let rows = [...dados.porUF];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  rows.sort((a, b) => b.n_escolas - a.n_escolas);
  rows = rows.slice(0, 15);
  destroyChart('uf');
  charts.uf = new Chart(document.getElementById('chart-uf'), {
    type: 'bar',
    data: { labels: rows.map((r) => r.SG_UF), datasets: [{ data: rows.map((r) => r.n_escolas), backgroundColor: CORES.azul, borderRadius: 4, maxBarThickness: 28 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      onClick: (evt, elems) => { if (elems.length) irParaBusca({ uf: rows[elems[0].index].SG_UF }); },
      onHover: (evt, elems) => { evt.native.target.style.cursor = elems.length ? 'pointer' : 'default'; },
      scales: { y: { beginAtZero: true, ticks: { color: iconTextColor() } }, x: { grid: { display: false }, ticks: { color: iconTextColor() } } } },
  });
}

function renderChartPorte(f) {
  let rows = [...dados.porUfPorte];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  const portes = ['1-Micro (ate 50)', '2-Pequeno (51-200)', '3-Medio (201-500)', '4-Grande (501-1000)', '5-Muito Grande (1000+)'];
  const totals = portes.map((p) => rows.filter((r) => r.PORTE === p).reduce((s, r) => s + r.n, 0));
  destroyChart('porte');
  charts.porte = new Chart(document.getElementById('chart-porte'), {
    type: 'bar',
    data: { labels: portes.map(labelPorte), datasets: [{ data: totals, backgroundColor: CORES.verde, borderRadius: 4, maxBarThickness: 40 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      onClick: (evt, elems) => { if (elems.length) irParaBusca({ porte: portes[elems[0].index], ...(f.uf ? { uf: f.uf } : {}) }); },
      onHover: (evt, elems) => { evt.native.target.style.cursor = elems.length ? 'pointer' : 'default'; },
      scales: { y: { beginAtZero: true, ticks: { color: iconTextColor() } }, x: { grid: { display: false }, ticks: { color: iconTextColor() } } } },
  });
}

function renderChartIcp() {
  const rows = [...(dados.top10Faturamento || [])].sort((a, b) => a.FATURAMENTO_POTENCIAL_ANUAL - b.FATURAMENTO_POTENCIAL_ANUAL); // Chart.js horizontal bar desenha de baixo pra cima
  destroyChart('icp');
  charts.icp = new Chart(document.getElementById('chart-icp'), {
    type: 'bar',
    data: {
      labels: rows.map((r) => `${r.NO_ENTIDADE.length > 28 ? r.NO_ENTIDADE.slice(0, 26) + '…' : r.NO_ENTIDADE} (${r.SG_UF})`),
      datasets: [{ data: rows.map((r) => r.FATURAMENTO_POTENCIAL_ANUAL), backgroundColor: CORES.icpAlta, borderRadius: 4, maxBarThickness: 16 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${fmtMoedaCompacta(ctx.raw)}/ano — clique para abrir a ficha` } },
      },
      onClick: (evt, elems) => { if (elems.length) { const r = rows[elems[0].index]; abrirEscolaDoDashboard(r.SG_UF, r.id); } },
      onHover: (evt, elems) => { evt.native.target.style.cursor = elems.length ? 'pointer' : 'default'; },
      scales: { x: { beginAtZero: true, ticks: { color: iconTextColor() } }, y: { ticks: { color: iconTextColor(), font: { size: 10.5 } } } },
    },
  });
}

function ticketColor(v) {
  if (v >= 900) return CORES.icpAlta;
  if (v >= 400) return CORES.icpMedia;
  return CORES.icpBaixa;
}

let mapaBrasil = null;
let marcadoresBrasil = [];

function initMapaBrasil() {
  const el = document.getElementById('mapa-brasil');
  if (!el || typeof L === 'undefined') {
    if (el) el.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;">Não foi possível carregar o mapa (biblioteca Leaflet indisponível — verifique sua conexão).</div>';
    return;
  }
  try {
    mapaBrasil = L.map('mapa-brasil', { scrollWheelZoom: false }).setView([-14.2, -51.9], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 15,
    }).addTo(mapaBrasil);
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:13px;">Erro ao carregar o mapa: ${err.message}</div>`;
  }
}

function renderMapaBrasil(f) {
  if (!mapaBrasil) return;
  marcadoresBrasil.forEach((m) => mapaBrasil.removeLayer(m));
  marcadoresBrasil = [];

  let rows = dados.porMunicipio;
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);

  rows.forEach((r) => {
    if (r.lat == null || r.lon == null) return;
    const ticket = r.matriculas ? r.faturamento_potencial / (r.matriculas * 12) : 0;
    const raio = Math.min(22, 4 + Math.sqrt(r.n_escolas) * 1.6);
    const marcador = L.circleMarker([r.lat, r.lon], {
      radius: raio, color: ticketColor(ticket), fillColor: ticketColor(ticket), fillOpacity: 0.55, weight: 1.5,
    }).addTo(mapaBrasil);

    const popupHtml = `
      <div style="font-size:12.5px;min-width:180px;">
        <strong>${r.NO_MUNICIPIO}/${r.SG_UF}</strong><br>
        ${fmtInt(r.n_escolas)} escolas · ${fmtInt(r.matriculas)} matrículas<br>
        Ticket médio estimado: ${fmtMoedaCompacta(ticket)}<br>
        <a href="#" data-abrir-mercado='${JSON.stringify({ uf: r.SG_UF, municipio: r.NO_MUNICIPIO, lat: r.lat, lon: r.lon })}' style="display:inline-block;margin-top:6px;font-weight:600;">
          Abrir Mapear Mercado aqui →
        </a>
      </div>`;
    marcador.bindPopup(popupHtml);
    marcador.on('popupopen', (e) => {
      const link = e.popup.getElement().querySelector('[data-abrir-mercado]');
      if (link) {
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          const p = JSON.parse(link.dataset.abrirMercado);
          window.location.href = `pages/mercado.html?uf=${encodeURIComponent(p.uf)}&municipio=${encodeURIComponent(p.municipio)}&lat=${p.lat}&lon=${p.lon}`;
        });
      }
    });
    marcadoresBrasil.push(marcador);
  });

  if (f.uf && rows.length) {
    const grupo = L.featureGroup(marcadoresBrasil);
    mapaBrasil.fitBounds(grupo.getBounds().pad(0.3));
  } else {
    mapaBrasil.setView([-14.2, -51.9], 4);
  }
}

function renderChartSinal(f) {
  let rows = [...dados.porUfSinal];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  const totaisPorUf = {};
  rows.forEach((r) => { totaisPorUf[r.SG_UF] = (totaisPorUf[r.SG_UF] || 0) + r.n; });
  const topUFs = Object.entries(totaisPorUf).sort((a, b) => b[1] - a[1]).slice(0, 15).map((e) => e[0]);
  const sinais = ['Evasao forte (queda >10%)', 'Evasao leve', 'Estavel', 'Ganho de alunos (crescimento >10%)'];
  const cores = [CORES.evasaoForte, CORES.evasaoLeve, CORES.estavel, CORES.ganho];
  const labels = ['Evasão forte', 'Evasão leve', 'Estável', 'Ganho >10%'];
  const datasets = sinais.map((s, i) => ({
    label: labels[i], backgroundColor: cores[i],
    data: topUFs.map((uf) => (rows.find((r) => r.SG_UF === uf && r.SINAL_MATRICULAS === s) || {}).n || 0),
  }));
  destroyChart('sinal');
  charts.sinal = new Chart(document.getElementById('chart-sinal'), {
    type: 'bar',
    data: { labels: topUFs, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true, ticks: { color: iconTextColor() } }, y: { stacked: true, ticks: { color: iconTextColor() } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: iconTextColor() } } },
    },
  });
}

function renderChartStatus(f) {
  let rows = [...dados.porUfStatus];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  const statuses = ['Continua ativa', 'Sumiu em 2025 (encerrada/nao localizada)', 'Nova em 2025 (nao existia em 2024)'];
  const cores = [CORES.ativa, CORES.sumiu, CORES.nova];
  const totals = statuses.map((s) => rows.filter((r) => r.STATUS_CONTINUIDADE === s).reduce((sum, r) => sum + r.n, 0));
  destroyChart('status');
  charts.status = new Chart(document.getElementById('chart-status'), {
    type: 'doughnut',
    data: { labels: ['Continua ativa', 'Sumiu em 2025', 'Nova em 2025'], datasets: [{ data: totals, backgroundColor: cores, borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: iconTextColor() } } } },
  });
}

function renderTabelaTop(f) {
  let rows = [...dados.topOportunidades];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  rows.sort((a, b) => b.FATURAMENTO_POTENCIAL_ANUAL - a.FATURAMENTO_POTENCIAL_ANUAL);
  document.getElementById('tbody-top').innerHTML = rows.slice(0, 300).map((r) => `
    <tr data-id="${r.id}" data-uf="${r.SG_UF}" style="cursor:pointer;"><td>${r.NO_ENTIDADE}</td><td>${r.SG_UF}</td><td>${r.NO_MUNICIPIO}</td><td>${labelPorte(r.PORTE)}</td>
    <td>${fmtInt(r.QT_MAT_BAS)}</td><td>${r.MENSALIDADE_ESTIMADA != null ? fmtMoedaCompacta(r.MENSALIDADE_ESTIMADA) : '-'}</td><td>${fmtMoedaCompacta(r.FATURAMENTO_POTENCIAL_ANUAL)}</td>
    <td>${r.NU_DDD ? Math.round(r.NU_DDD) : '-'}</td><td>${r.NU_TELEFONE ? Math.round(r.NU_TELEFONE) : '-'}</td></tr>`).join('');
  ligarCliquesTabela('tbody-top');
}

function ordenar(rows, sort) {
  return rows.sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return sort.dir * va.localeCompare(vb);
    return sort.dir * (va - vb);
  });
}

function renderTabelaCrescimento(f) {
  let rows = [...dados.topCrescimento];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  rows = ordenar(rows, sortGrowth);
  document.getElementById('tbody-crescimento').innerHTML = rows.slice(0, 300).map((r) => `
    <tr data-id="${r.id}" data-uf="${r.SG_UF}" style="cursor:pointer;"><td>${r.NO_ENTIDADE}</td><td>${r.SG_UF}</td><td>${r.NO_MUNICIPIO}</td>
    <td>${fmtInt(r.QT_MAT_BAS_2024)}</td><td>${fmtInt(r.QT_MAT_BAS_2025)}</td>
    <td>${r.VARIACAO_MATRICULAS_PCT != null ? r.VARIACAO_MATRICULAS_PCT.toFixed(1) + '%' : '-'}</td>
    <td>${r.MUDANCA_PORTE || '-'}</td><td>${r.MENSALIDADE_ESTIMADA != null ? fmtMoedaCompacta(r.MENSALIDADE_ESTIMADA) : '-'}</td>
    <td>${r.NU_DDD ? Math.round(r.NU_DDD) : '-'}</td><td>${r.NU_TELEFONE ? Math.round(r.NU_TELEFONE) : '-'}</td></tr>`).join('');
  ligarCliquesTabela('tbody-crescimento');
}

function renderTabelaOcioso(f) {
  let rows = [...dados.topOcioso];
  if (f.uf) rows = rows.filter((r) => r.SG_UF === f.uf);
  rows = ordenar(rows, sortOcioso);
  document.getElementById('tbody-ocioso').innerHTML = rows.slice(0, 300).map((r) => `
    <tr data-id="${r.id}" data-uf="${r.SG_UF}" style="cursor:pointer;"><td>${r.NO_ENTIDADE}</td><td>${r.SG_UF}</td><td>${r.NO_MUNICIPIO}</td>
    <td>${fmtInt(r.QT_MAT_BAS_2025)}</td><td>${fmtInt(r.CAPACIDADE_OCIOSA_ESTIMADA_ALUNOS)}</td>
    <td>${r.SINAL_MATRICULAS}</td><td>${r.MENSALIDADE_ESTIMADA != null ? fmtMoedaCompacta(r.MENSALIDADE_ESTIMADA) : '-'}</td>
    <td>${r.NU_DDD ? Math.round(r.NU_DDD) : '-'}</td><td>${r.NU_TELEFONE ? Math.round(r.NU_TELEFONE) : '-'}</td></tr>`).join('');
  ligarCliquesTabela('tbody-ocioso');
}

function ligarCliquesTabela(tbodyId) {
  document.querySelectorAll(`#${tbodyId} tr`).forEach((tr) => {
    tr.addEventListener('click', () => abrirEscolaDoDashboard(tr.dataset.uf, tr.dataset.id));
  });
}

function tentativa(fn) {
  try { fn(); } catch (err) { console.error('Falha ao renderizar um bloco do dashboard:', err); }
}

function renderTudo() {
  const f = currentFiltro();
  tentativa(() => renderKPIs(f));
  tentativa(() => renderChartUF(f));
  tentativa(() => renderChartPorte(f));
  tentativa(() => renderChartIcp());
  tentativa(() => renderMapaBrasil(f));
  tentativa(() => renderTabelaTop(f));
  tentativa(() => renderKPIsEvo());
  tentativa(() => renderChartSinal(f));
  tentativa(() => renderChartStatus(f));
  tentativa(() => renderTabelaCrescimento(f));
  tentativa(() => renderTabelaOcioso(f));
}

function popularFiltroUF() {
  const select = document.getElementById('f-uf');
  [...dados.porUF].sort((a, b) => a.SG_UF.localeCompare(b.SG_UF)).forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.SG_UF; opt.textContent = r.SG_UF;
    select.appendChild(opt);
  });
  select.addEventListener('change', renderTudo);
}

function ligarOrdenacaoTabelas() {
  document.querySelectorAll('#tabela-crescimento th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      sortGrowth = { key, dir: sortGrowth.key === key ? -sortGrowth.dir : -1 };
      renderTudo();
    });
  });
  document.querySelectorAll('#tabela-ocioso th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      sortOcioso = { key, dir: sortOcioso.key === key ? -sortOcioso.dir : -1 };
      renderTudo();
    });
  });
}


async function ligarImportacaoBase() {
  const status = await statusBaseCarregada();
  document.getElementById('contador-base').textContent = fmtInt(status.totalEscolas);
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
    btn.disabled = true;
    btn.textContent = 'Carregando...';
    await importarTodasUFs((p) => { log.textContent = `Importado ${p.uf} (${fmtInt(p.totalAcumulado)} escolas até agora)...`; });
    const statusFinal = await statusBaseCarregada();
    document.getElementById('contador-base').textContent = fmtInt(statusFinal.totalEscolas);
    btn.textContent = 'Base completa carregada';
    log.textContent = 'Importação concluída — pronto para a Fase 2 (consulta de escolas).';
  });
}

async function init() {
  content.innerHTML = '<p class="loading-bar">Carregando dados do dashboard...</p>';
  dados = await carregarDadosDashboard();
  skeleton();
  initMapaBrasil();
  popularFiltroUF();
  ligarOrdenacaoTabelas();
  try {
    renderTudo();
  } catch (err) {
    console.error('Falha ao renderizar gráficos do dashboard:', err);
  }
  ligarImportacaoBase();
}

init();
