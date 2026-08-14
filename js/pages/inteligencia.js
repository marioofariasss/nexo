import { montarLayout } from '../components/layout.js';
import { fmtInt, fmtMoedaCompacta } from '../utils/formatters.js';
import { carregarResumoInteligencia, buscarSerieMunicipio } from '../services/inteligenciaService.js';
import { buscarDadosDemograficos, resumirDemandaEscolar, projetarCoortesEscolares } from '../services/ibgeService.js';

montarLayout({ paginaAtiva: 'inteligencia', titulo: 'Inteligência Educacional', prefixo: '../' });
const content = document.getElementById('content');

let dados;
let charts = {};

function destruir(nome) {
  if (charts[nome]) { charts[nome].destroy(); delete charts[nome]; }
}

function corTexto() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#B4B2A5' : '#6B6A63';
}

function pct(valor, casas = 1) {
  return valor == null ? '—' : `${valor.toFixed(casas)}%`;
}

function skeleton() {
  content.innerHTML = `
    <div class="dash-hero">
      <div>
        <h1 class="dash-hero-title"><i class="fa-solid fa-chart-line"></i> Mercado educacional em perspectiva</h1>
        <p class="dash-hero-sub">Série anual de escolas, matrículas, etapas e estrutura · microdados oficiais do Censo Escolar</p>
      </div>
      <div class="filters" style="margin-bottom:0;">
        <div><label>UF</label><select id="f-intel-uf"><option value="">Brasil</option></select></div>
        <div><label>Município</label><select id="f-intel-municipio" disabled><option value="">Todos</option></select></div>
      </div>
    </div>

    <div class="kpis" id="intel-kpis"></div>

    <div class="dash-section-header"><i class="fa-solid fa-timeline"></i> Evolução longitudinal</div>
    <div class="grid2">
      <div class="card"><h2>Matrículas privadas</h2><p class="sub">Evolução anual das matrículas declaradas em escolas privadas em funcionamento</p><div style="height:300px"><canvas id="chart-matriculas"></canvas></div></div>
      <div class="card"><h2>Oferta de escolas privadas</h2><p class="sub">Quantidade de estabelecimentos em funcionamento em cada edição</p><div style="height:300px"><canvas id="chart-escolas"></canvas></div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Participação da rede privada</h2><p class="sub">Matrículas privadas como percentual de todas as matrículas da educação básica</p><div style="height:280px"><canvas id="chart-participacao"></canvas></div></div>
      <div class="card"><h2>Composição por etapa</h2><p class="sub">Matrículas privadas por etapa; EJA e educação profissional não entram neste gráfico</p><div style="height:280px"><canvas id="chart-etapas"></canvas></div></div>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-scale-balanced"></i> Oferta, demanda observada e saturação</div>
    <div class="grid2">
      <div class="card"><h2>Matriz de pressão de mercado</h2><p class="sub">Cada ponto é um município. Acima da diagonal, a oferta cresce mais que as matrículas — sinal de pressão.</p><div style="height:390px"><canvas id="chart-pressao"></canvas></div></div>
      <div class="card"><h2>Distribuição do risco</h2><p class="sub">Classificação explicável baseada na diferença entre o crescimento anual da oferta e das matrículas</p><div style="height:390px"><canvas id="chart-risco"></canvas></div></div>
    </div>

    <div class="card">
      <h2>Diagnóstico municipal</h2>
      <p class="sub">Municípios com pelo menos 3 escolas e 500 matrículas privadas · clique em uma linha para aprofundar</p>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Município</th><th>UF</th><th>Escolas privadas</th><th>Matrículas privadas</th><th>Participação privada</th><th>Crescimento matrículas</th><th>Crescimento oferta</th><th>Pressão</th><th>Top 3</th><th>Risco</th></tr></thead><tbody id="tbody-diagnosticos"></tbody></table></div>
    </div>

    <div id="bloco-demanda"></div>

    <div class="footer-note">
      <strong>Leitura correta:</strong> “demanda observada” significa matrículas registradas, não toda a demanda potencial da população. O risco de saturação é um sinal comparativo: crescimento da oferta de escolas menos crescimento das matrículas privadas. População, renda e nascimentos são incorporados quando um município é selecionado. Fonte: Inep, microdados do Censo Escolar; IBGE/SIDRA para demografia e renda.
    </div>`;
}

function popularFiltros() {
  const ufSelect = document.getElementById('f-intel-uf');
  [...new Set(dados.ufs.map((r) => r.uf))].sort().forEach((uf) => {
    ufSelect.insertAdjacentHTML('beforeend', `<option value="${uf}">${uf}</option>`);
  });
  ufSelect.addEventListener('change', () => {
    popularMunicipios(ufSelect.value);
    renderTudo();
  });
  document.getElementById('f-intel-municipio').addEventListener('change', renderTudo);
}

function popularMunicipios(uf) {
  const select = document.getElementById('f-intel-municipio');
  const lista = dados.diagnosticosMunicipais.filter((r) => !uf || r.uf === uf)
    .sort((a, b) => a.municipio.localeCompare(b.municipio, 'pt-BR'));
  select.innerHTML = '<option value="">Todos</option>' + lista.map((r) => `<option value="${r.municipio}">${r.municipio}</option>`).join('');
  select.disabled = !uf;
}

async function serieAtual() {
  const uf = document.getElementById('f-intel-uf').value;
  const municipio = document.getElementById('f-intel-municipio').value;
  if (uf && municipio) return buscarSerieMunicipio(uf, municipio);
  return (uf ? dados.ufs.filter((r) => r.uf === uf) : dados.nacional).sort((a, b) => a.ano - b.ano);
}

function diagnosticosAtuais() {
  const uf = document.getElementById('f-intel-uf').value;
  return dados.diagnosticosMunicipais.filter((r) => (!uf || r.uf === uf)
    && r.riscoSaturacao !== 'Amostra pequena' && r.riscoSaturacao !== 'Dados insuficientes');
}

function crescimentoPeriodo(serie, campo) {
  const primeiro = serie.find((r) => Number(r[campo]) > 0);
  const ultimo = serie.at(-1);
  if (!primeiro || !ultimo || ultimo.ano === primeiro.ano) return null;
  return ((ultimo[campo] / primeiro[campo]) ** (1 / (ultimo.ano - primeiro.ano)) - 1) * 100;
}

function renderKpis(serie) {
  const ultimo = serie.at(-1) || {};
  const crescMat = crescimentoPeriodo(serie, 'matriculasPrivadas');
  const crescOferta = crescimentoPeriodo(serie, 'escolasPrivadas');
  const pressao = crescMat == null || crescOferta == null ? null : crescOferta - crescMat;
  document.getElementById('intel-kpis').innerHTML = `
    <div class="kpi"><div class="label"><i class="fa-solid fa-graduation-cap"></i> Matrículas privadas (${ultimo.ano || '—'})</div><div class="value">${fmtInt(ultimo.matriculasPrivadas)}</div><div class="sub">${pct(crescMat)} ao ano no período</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-school"></i> Escolas privadas</div><div class="value">${fmtInt(ultimo.escolasPrivadas)}</div><div class="sub">${pct(crescOferta)} ao ano no período</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-chart-pie"></i> Participação privada</div><div class="value">${pct(ultimo.participacaoPrivadaPct)}</div><div class="sub">das matrículas totais</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-people-group"></i> Matrículas por escola</div><div class="value">${ultimo.alunosPorEscolaPrivada?.toFixed(1) || '—'}</div><div class="sub">média da rede privada</div></div>
    <div class="kpi"><div class="label"><i class="fa-solid fa-gauge-high"></i> Pressão oferta − demanda</div><div class="value">${pressao == null ? '—' : `${pressao.toFixed(1)} p.p.`}</div><div class="sub">positivo = oferta cresce mais</div></div>`;
}

function graficoLinha(nome, id, serie, campo, cor, formato = (v) => fmtInt(v)) {
  destruir(nome);
  charts[nome] = new Chart(document.getElementById(id), {
    type: 'line',
    data: { labels: serie.map((r) => r.ano), datasets: [{ data: serie.map((r) => r[campo]), borderColor: cor, backgroundColor: `${cor}22`, fill: true, tension: 0.25, pointRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formato(ctx.raw) } } }, scales: { x: { ticks: { color: corTexto() } }, y: { beginAtZero: false, ticks: { color: corTexto(), callback: formato } } } },
  });
}

function renderSeries(serie) {
  graficoLinha('matriculas', 'chart-matriculas', serie, 'matriculasPrivadas', '#1baf7a');
  graficoLinha('escolas', 'chart-escolas', serie, 'escolasPrivadas', '#378ADD');
  graficoLinha('participacao', 'chart-participacao', serie, 'participacaoPrivadaPct', '#7F77DD', (v) => `${v}%`);
  destruir('etapas');
  const nomes = [['infantil', 'Educação infantil', '#378ADD'], ['fundamentalI', 'Fundamental I', '#1baf7a'], ['fundamentalII', 'Fundamental II', '#7F77DD'], ['medio', 'Ensino médio', '#EDA100']];
  charts.etapas = new Chart(document.getElementById('chart-etapas'), {
    type: 'line', data: { labels: serie.map((r) => r.ano), datasets: nomes.map(([campo, label, cor]) => ({ label, data: serie.map((r) => r.etapasPrivadas?.[campo] || 0), borderColor: cor, tension: 0.2, pointRadius: 2 })) },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: corTexto(), boxWidth: 10 } } }, scales: { x: { ticks: { color: corTexto() } }, y: { ticks: { color: corTexto(), callback: (v) => fmtInt(v) } } } },
  });
}

function renderMercado() {
  const lista = diagnosticosAtuais();
  const amostra = [...lista].sort((a, b) => b.matriculasPrivadas - a.matriculasPrivadas).slice(0, 700);
  destruir('pressao');
  charts.pressao = new Chart(document.getElementById('chart-pressao'), {
    type: 'scatter',
    data: { datasets: [{ label: 'Municípios', data: amostra.map((r) => ({ x: r.crescimentoMatriculasCagrPct, y: r.crescimentoEscolasCagrPct, r })), backgroundColor: amostra.map((r) => ({ Alto: '#E24B4A99', Moderado: '#EDA10099', Baixo: '#1baf7a99' }[r.riscoSaturacao])) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => { const r = ctx.raw.r; return `${r.municipio}/${r.uf}: matrículas ${pct(r.crescimentoMatriculasCagrPct)}, oferta ${pct(r.crescimentoEscolasCagrPct)}`; } } } }, scales: { x: { title: { display: true, text: 'Crescimento anual das matrículas (%)', color: corTexto() }, ticks: { color: corTexto() } }, y: { title: { display: true, text: 'Crescimento anual das escolas (%)', color: corTexto() }, ticks: { color: corTexto() } } } },
  });

  const riscos = ['Baixo', 'Moderado', 'Alto'];
  destruir('risco');
  charts.risco = new Chart(document.getElementById('chart-risco'), {
    type: 'doughnut', data: { labels: riscos, datasets: [{ data: riscos.map((r) => lista.filter((x) => x.riscoSaturacao === r).length), backgroundColor: ['#1baf7a', '#EDA100', '#E24B4A'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: corTexto() } } } },
  });

  const municipioSelecionado = document.getElementById('f-intel-municipio').value;
  const tabela = municipioSelecionado ? lista.filter((r) => r.municipio === municipioSelecionado) : lista;
  document.getElementById('tbody-diagnosticos').innerHTML = [...tabela]
    .sort((a, b) => (b.pressaoOfertaPp ?? -999) - (a.pressaoOfertaPp ?? -999)).slice(0, 300)
    .map((r) => `<tr data-uf="${r.uf}" data-municipio="${r.municipio}" style="cursor:pointer"><td>${r.municipio}</td><td>${r.uf}</td><td>${fmtInt(r.escolasPrivadas)}</td><td>${fmtInt(r.matriculasPrivadas)}</td><td>${pct(r.participacaoPrivadaPct)}</td><td>${pct(r.crescimentoMatriculasCagrPct)}</td><td>${pct(r.crescimentoEscolasCagrPct)}</td><td>${r.pressaoOfertaPp == null ? '—' : `${r.pressaoOfertaPp} p.p.`}</td><td>${pct(r.concentracaoTop3Pct)}</td><td><span class="badge">${r.riscoSaturacao}</span></td></tr>`).join('');
  document.querySelectorAll('#tbody-diagnosticos tr').forEach((tr) => tr.addEventListener('click', () => {
    document.getElementById('f-intel-uf').value = tr.dataset.uf;
    popularMunicipios(tr.dataset.uf);
    document.getElementById('f-intel-municipio').value = tr.dataset.municipio;
    renderTudo();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

async function renderDemanda(serie) {
  const bloco = document.getElementById('bloco-demanda');
  const uf = document.getElementById('f-intel-uf').value;
  const municipio = document.getElementById('f-intel-municipio').value;
  if (!uf || !municipio) {
    bloco.innerHTML = `<div class="card"><h2>Demanda demográfica e poder de compra</h2><p class="sub">Selecione uma UF e um município para cruzar matrículas com população por idade, renda domiciliar per capita e coortes de nascimentos.</p></div>`;
    return;
  }
  const diag = dados.diagnosticosMunicipais.find((r) => r.uf === uf && r.municipio === municipio);
  if (!diag?.codigoMunicipio) return;
  bloco.innerHTML = '<p class="loading-bar">Consultando demografia e renda oficiais do município...</p>';
  try {
    const demo = await buscarDadosDemograficos(diag.codigoMunicipio);
    const demanda = resumirDemandaEscolar(demo.faixasEtarias || []);
    const ultimo = serie.at(-1);
    const penetracoes = [
      ['Educação infantil', ultimo.etapasPrivadas.infantil, demanda.educacaoInfantil],
      ['Fundamental I', ultimo.etapasPrivadas.fundamentalI, demanda.fundamentalI],
      ['Fundamental II', ultimo.etapasPrivadas.fundamentalII, demanda.fundamentalII],
      ['Ensino médio', ultimo.etapasPrivadas.medio, demanda.medio],
    ];
    const taxaAtual = ultimo.participacaoPrivadaPct != null ? ultimo.participacaoPrivadaPct / 100 : null;
    const coortes = projetarCoortesEscolares(demo.natalidade, taxaAtual);
    const renda = demo.rendaDomiciliarPerCapita;
    bloco.innerHTML = `
      <div class="dash-section-header"><i class="fa-solid fa-children"></i> Demanda e poder de compra — ${municipio}/${uf}</div>
      <div class="kpis">
        <div class="kpi"><div class="label">População 0–17</div><div class="value">${fmtInt(Object.values(demanda).filter((_, i) => i !== 2 && i !== 5).reduce((s, v) => s + (Number(v) || 0), 0))}</div><div class="sub">Censo Demográfico 2022</div></div>
        <div class="kpi"><div class="label">Renda per capita média</div><div class="value">${renda?.media == null ? '—' : fmtMoedaCompacta(renda.media)}</div><div class="sub">IBGE 2022</div></div>
        <div class="kpi"><div class="label">Renda per capita mediana</div><div class="value">${renda?.mediana == null ? '—' : fmtMoedaCompacta(renda.mediana)}</div><div class="sub">IBGE 2022</div></div>
        <div class="kpi"><div class="label">Nascimentos — variação</div><div class="value">${pct(demo.natalidade?.variacaoPeriodoPct)}</div><div class="sub">município de residência da mãe</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h2>Penetração privada por etapa</h2><p class="sub">Matrículas privadas ${ultimo.ano} ÷ população da faixa em 2022; anos diferentes, comparação indicativa.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Etapa</th><th>Matrículas privadas</th><th>População da faixa</th><th>Penetração</th></tr></thead><tbody>${penetracoes.map(([nome, mat, pop]) => `<tr><td>${nome}</td><td>${fmtInt(mat)}</td><td>${fmtInt(pop)}</td><td>${pop ? pct(mat / pop * 100) : '—'}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><h2>Coortes futuras</h2><p class="sub">Nascimentos observados e cenário-base de conversão privada; sem ajuste de migração ou sobrevivência.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Nascimento</th><th>Nascidos vivos</th><th>Entrada pré</th><th>Entrada fund.</th><th>Demanda privada base</th></tr></thead><tbody>${coortes.coortes.map((c) => `<tr><td>${c.anoNascimento}</td><td>${fmtInt(c.nascimentos)}</td><td>${c.entradaPreEscola}</td><td>${c.entradaFundamentalI}</td><td>${fmtInt(c.demandaPrivada.base)}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      ${demo.avisos?.length || demo.erro ? `<div class="footer-note">${[demo.erro, ...(demo.avisos || [])].filter(Boolean).join(' · ')}</div>` : ''}`;
  } catch (err) {
    bloco.innerHTML = `<div class="card"><h2>Demanda demográfica</h2><p class="sub">A consulta oficial do IBGE está temporariamente indisponível: ${err.message}. As análises longitudinais do Inep continuam válidas.</p></div>`;
  }
}

async function renderTudo() {
  const serie = await serieAtual();
  renderKpis(serie);
  renderSeries(serie);
  renderMercado();
  await renderDemanda(serie);
}

async function init() {
  content.innerHTML = '<p class="loading-bar">Carregando a série histórica do Censo Escolar...</p>';
  try {
    dados = await carregarResumoInteligencia();
    skeleton();
    popularFiltros();
    await renderTudo();
  } catch (err) {
    content.innerHTML = `<div class="card"><h2>Camada de inteligência indisponível</h2><p class="sub">${err.message}</p></div>`;
  }
}

init();
