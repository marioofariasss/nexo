import { montarLayout } from '../components/layout.js';
import { fmtInt, fmtMoedaCompacta, labelPorte } from '../utils/formatters.js';
import { buscarEscolas } from '../services/escolaService.js';
import { statusBaseCarregada, importarTodasUFs, importarUF, carregarIndiceUFs } from '../services/importService.js';
import { abrirPainelEscola } from '../components/painelEscola.js';
import { exportarCsv } from '../utils/csv.js';
import { getFiltrosSalvos, salvarFiltroSalvo } from '../services/crmService.js';

montarLayout({ paginaAtiva: 'busca', titulo: 'Base de Escolas', prefixo: '../' });
const content = document.getElementById('content');

const PAGE_SIZE = 50;
const LABEL_PORTE = {
  '1-Micro (ate 50)': 'Micro (até 50)', '2-Pequeno (51-200)': 'Pequeno (51-200)', '3-Medio (201-500)': 'Médio (201-500)',
  '4-Grande (501-1000)': 'Grande (501-1000)', '5-Muito Grande (1000+)': 'Muito grande (1000+)',
};

let resultadoCompleto = [];
let linhasExibidas = 0;
let indiceUFs = [];

function skeleton() {
  content.innerHTML = `
    <div id="aviso-base"></div>
    <div class="filters" id="filtros">
      <div><label>UF</label><select id="f-uf"><option value="">Todas</option></select></div>
      <div><label>Município</label><input type="text" id="f-municipio" placeholder="ex: Fortaleza"></div>
      <div><label>Nome da escola</label><input type="text" id="f-nome" placeholder="ex: Colégio..."></div>
      <div><label>Porte</label>
        <select id="f-porte"><option value="">Todos</option>
          ${Object.entries(LABEL_PORTE).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div><label>Sinal de matrículas</label>
        <select id="f-sinal"><option value="">Todos</option>
          <option>Evasao forte (queda >10%)</option>
          <option>Evasao leve</option>
          <option>Estavel</option>
          <option>Ganho de alunos (crescimento >10%)</option>
        </select>
      </div>
      <div><label>Ordenar por</label>
        <select id="f-ordenar">
          <option value="mat25">Matrículas</option>
          <option value="fatPotencial">Faturamento potencial</option>
          <option value="capOciosa">Capacidade ociosa</option>
          <option value="varMatPct">Variação de matrículas</option>
        </select>
      </div>
      <div><button class="btn btn-primary" id="btn-buscar">Buscar</button></div>
      <div><button class="btn" id="btn-exportar">Exportar CSV</button></div>
      <div><button class="btn" id="btn-salvar-filtro">Salvar filtro</button></div>
    </div>

    <div class="filtros-ativos" id="filtros-ativos"></div>

    <div class="card">
      <h2>Resultados</h2>
      <p class="sub" id="contagem-resultados">—</p>
      <div class="table-scroll" id="area-tabela"></div>
      <div style="text-align:center;margin-top:12px;">
        <button class="btn hidden" id="btn-mais">Carregar mais</button>
      </div>
    </div>
  `;
}

function renderTabela() {
  const area = document.getElementById('area-tabela');
  linhasExibidas = Math.min(PAGE_SIZE, resultadoCompleto.length);
  document.getElementById('contagem-resultados').textContent = `${fmtInt(resultadoCompleto.length)} escolas encontradas`;
  area.innerHTML = montarTabelaHtml(resultadoCompleto.slice(0, linhasExibidas));
  ligarCliquesLinha();
  const btnMais = document.getElementById('btn-mais');
  btnMais.classList.toggle('hidden', linhasExibidas >= resultadoCompleto.length);
}

function montarTabelaHtml(linhas) {
  return `
    <table class="data-table">
      <thead><tr>
        <th>Escola</th><th>UF</th><th>Município</th><th>Porte</th><th>Matrículas</th>
        <th>Ticket médio</th><th>Faturamento potencial</th><th>Telefone</th>
      </tr></thead>
      <tbody>
        ${linhas.map((r) => `
          <tr data-id="${r.id}" style="cursor:pointer;">
            <td>${r.nome}</td><td>${r.uf}</td><td>${r.municipio}</td><td>${labelPorte(r.porte)}</td>
            <td>${fmtInt(r.mat25)}</td>
            <td>${r.mensalidade != null ? fmtMoedaCompacta(r.mensalidade) : '-'}</td>
            <td>${fmtMoedaCompacta(r.fatPotencial)}</td>
            <td>${r.ddd ? `(${r.ddd}) ` : ''}${r.tel || '-'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function ligarCliquesLinha() {
  document.querySelectorAll('#area-tabela tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      abrirPainelEscola(Number(tr.dataset.id), { onAtualizar: executarBusca });
    });
  });
}

function lerFiltros() {
  return {
    uf: document.getElementById('f-uf').value,
    municipio: document.getElementById('f-municipio').value.trim(),
    nome: document.getElementById('f-nome').value.trim(),
    porte: document.getElementById('f-porte').value,
    sinalMat: document.getElementById('f-sinal').value,
    ordenarPor: document.getElementById('f-ordenar').value,
  };
}

function limparCampo(campo) {
  const acoes = {
    uf: () => { document.getElementById('f-uf').value = ''; },
    municipio: () => { document.getElementById('f-municipio').value = ''; },
    nome: () => { document.getElementById('f-nome').value = ''; },
    porte: () => { document.getElementById('f-porte').value = ''; },
    sinalMat: () => { document.getElementById('f-sinal').value = ''; },
    ordenarPor: () => { document.getElementById('f-ordenar').value = 'mat25'; },
  };
  if (acoes[campo]) acoes[campo]();
}

function renderFiltrosAtivos(filtros) {
  const container = document.getElementById('filtros-ativos');
  const chips = [];

  if (filtros.uf) chips.push({ label: `UF: ${filtros.uf}`, onRemove: () => limparCampo('uf') });
  if (filtros.municipio) chips.push({ label: `Município: ${filtros.municipio}`, onRemove: () => limparCampo('municipio') });
  if (filtros.nome) chips.push({ label: `Nome: ${filtros.nome}`, onRemove: () => limparCampo('nome') });
  if (filtros.porte) chips.push({ label: LABEL_PORTE[filtros.porte] || filtros.porte, onRemove: () => limparCampo('porte') });
  if (filtros.sinalMat) chips.push({ label: filtros.sinalMat, onRemove: () => limparCampo('sinalMat') });

  if (!chips.length) { container.innerHTML = ''; return; }

  container.innerHTML = `<span class="rotulo">Filtros ativos:</span>` +
    chips.map((c, i) => `<span class="filtro-chip">${c.label}<span class="remover" data-i="${i}">&times;</span></span>`).join('') +
    `<span class="limpar-filtros" id="limpar-todos">Limpar tudo</span>`;

  container.querySelectorAll('.remover').forEach((el, i) => {
    el.addEventListener('click', () => { chips[i].onRemove(); executarBusca(); });
  });
  document.getElementById('limpar-todos').addEventListener('click', () => {
    ['uf', 'municipio', 'nome', 'porte', 'sinalMat'].forEach(limparCampo);
    executarBusca();
  });
}

async function garantirBaseParaFiltro(filtros) {
  if (filtros.uf) {
    if (!indiceUFs.length) indiceUFs = await carregarIndiceUFs();
    const item = indiceUFs.find((i) => i.uf === filtros.uf);
    if (item) await importarUF(filtros.uf, item.arquivo);
    return true;
  }
  const status = await statusBaseCarregada();
  return status.totalEscolas > 0;
}

async function executarBusca() {
  const filtros = lerFiltros();
  renderFiltrosAtivos(filtros);
  const baseOk = await garantirBaseParaFiltro(filtros);
  if (!baseOk) {
    renderAvisoBaseFaltando();
    return;
  }
  document.getElementById('aviso-base').innerHTML = '';
  document.getElementById('contagem-resultados').textContent = 'Buscando...';
  resultadoCompleto = await buscarEscolas(filtros);
  renderTabela();
}

function renderAvisoBaseFaltando() {
  document.getElementById('aviso-base').innerHTML = `
    <div class="card">
      <h2>Base ainda não carregada</h2>
      <p class="sub">Pra buscar em todas as UFs de uma vez, carregue a base completa (leva alguns segundos). Se preferir, selecione uma UF específica no filtro acima — ela é carregada automaticamente.</p>
      <button class="btn btn-primary" id="btn-carregar-tudo">Carregar base completa agora</button>
      <div class="loading-bar" id="log-import"></div>
    </div>`;
  document.getElementById('btn-carregar-tudo').addEventListener('click', async () => {
    const log = document.getElementById('log-import');
    await importarTodasUFs((p) => { log.textContent = `Importando ${p.uf}...`; });
    document.getElementById('aviso-base').innerHTML = '';
    executarBusca();
  });
}

function ligarBotoes() {
  document.getElementById('btn-buscar').addEventListener('click', executarBusca);
  document.getElementById('btn-mais').addEventListener('click', () => {
    linhasExibidas = Math.min(linhasExibidas + PAGE_SIZE, resultadoCompleto.length);
    document.getElementById('area-tabela').innerHTML = montarTabelaHtml(resultadoCompleto.slice(0, linhasExibidas));
    ligarCliquesLinha();
    document.getElementById('btn-mais').classList.toggle('hidden', linhasExibidas >= resultadoCompleto.length);
  });
  document.getElementById('btn-exportar').addEventListener('click', () => {
    exportarCsv(resultadoCompleto, [
      { chave: 'nome', titulo: 'Escola' }, { chave: 'uf', titulo: 'UF' }, { chave: 'municipio', titulo: 'Município' },
      { chave: 'porte', titulo: 'Porte' }, { chave: 'mat25', titulo: 'Matrículas 2025' }, { chave: 'mensalidade', titulo: 'Ticket médio' },
      { chave: 'fatPotencial', titulo: 'Faturamento potencial' },
      { chave: 'ddd', titulo: 'DDD' }, { chave: 'tel', titulo: 'Telefone' },
      { chave: 'cnpj', titulo: 'CNPJ' }, { chave: 'endereco', titulo: 'Endereço' }, { chave: 'cep', titulo: 'CEP' },
    ], 'escolas_filtradas');
  });
  document.getElementById('btn-salvar-filtro').addEventListener('click', async () => {
    const nome = prompt('Nome para este filtro salvo:');
    if (!nome) return;
    await salvarFiltroSalvo(nome, lerFiltros());
    alert('Filtro salvo. Você pode reaplicá-lo na página de Configurações.');
  });
}

async function popularUFs() {
  indiceUFs = await carregarIndiceUFs();
  const select = document.getElementById('f-uf');
  [...indiceUFs].sort((a, b) => a.uf.localeCompare(b.uf)).forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.uf; opt.textContent = `${item.uf} (${item.n})`;
    select.appendChild(opt);
  });
}

/**
 * Aplica filtros vindos da URL — tanto no formato de deep-link direto
 * (?uf=CE&porte=3-Medio%20(201-500)&tagIds=1,2&semTag=1&ordenarPor=mat25)
 * usado pelos cards clicáveis do Dashboard, quanto no formato de filtro
 * salvo (?filtro=NomeDoFiltro) usado em Configurações.
 */
async function aplicarFiltrosDaUrl() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('filtro')) {
    const salvos = await getFiltrosSalvos();
    const achado = salvos.find((f) => f.nome === params.get('filtro'));
    if (achado) aplicarObjetoFiltro(achado.filtro);
    return;
  }

  if (![...params.keys()].length) return;
  aplicarObjetoFiltro({
    uf: params.get('uf') || '',
    municipio: params.get('municipio') || '',
    nome: params.get('nome') || '',
    porte: params.get('porte') || '',
    sinalMat: params.get('sinalMat') || '',
    ordenarPor: params.get('ordenarPor') || '',
  });
}

function aplicarObjetoFiltro(f) {
  if (f.uf) document.getElementById('f-uf').value = f.uf;
  if (f.municipio) document.getElementById('f-municipio').value = f.municipio;
  if (f.nome) document.getElementById('f-nome').value = f.nome;
  if (f.porte) document.getElementById('f-porte').value = f.porte;
  if (f.sinalMat) document.getElementById('f-sinal').value = f.sinalMat;
  if (f.ordenarPor) document.getElementById('f-ordenar').value = f.ordenarPor;
}

async function init() {
  skeleton();
  await popularUFs();
  await aplicarFiltrosDaUrl();
  ligarBotoes();
  await executarBusca();
}

init();
