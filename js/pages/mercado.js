import { montarLayout } from '../components/layout.js';
import { fmtInt, fmtMoedaCompacta, labelPorte } from '../utils/formatters.js';
import { distanciaKm, coordenadaValidaBrasil } from '../utils/geo.js';
import { buscarEscolas, incorporarEscolasNaBase } from '../services/escolaService.js';
import { importarUF, ufJaImportada } from '../services/importService.js';
import { listarMunicipiosPorUF, buscarDadosDemograficos, resumirDemandaEscolar, projetarCoortesEscolares } from '../services/ibgeService.js';
import { analisarTerritorioNoRaio, analisarTerritorioAgregado, calcularIndicadoresEducacionaisMunicipio, montarPerfilConsumo, listarRegioes, ufsDaRegiao } from '../services/socioeconomicoService.js';
import { agruparPorRede, identificarRede, calcularScoreOportunidade, calcularRanking, montarFunil, gerarAnaliseCritica, gerarPlanoAcao, gerarGoToMarket, calcularConcentracaoMercado } from '../services/mercadoAnaliseService.js';
import { gerarRelatorioPdf } from '../services/pdfReportService.js';
import { geocodificarEndereco, buscarEscolasOSM, cruzarComCenso } from '../services/osmDescobertaService.js';
import { listarRegioesSalvas, salvarRegiao, deletarRegiao, exportarRegiaoJson } from '../services/regiaoService.js';
import { abrirPainelEscola } from '../components/painelEscola.js';
import { exportarCsv } from '../utils/csv.js';

let mediasNacionais = null;
fetch(new URL('../../data/medias_nacionais.json', import.meta.url)).then((r) => r.json()).then((d) => { mediasNacionais = d; }).catch(() => {});

montarLayout({ paginaAtiva: 'mercado', titulo: 'Mapear Mercado', prefixo: '../' });
const content = document.getElementById('content');

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const REGIOES = listarRegioes();
const CAPITAIS = {
  AC: 'Rio Branco', AL: 'Maceió', AP: 'Macapá', AM: 'Manaus', BA: 'Salvador', CE: 'Fortaleza', DF: 'Brasília',
  ES: 'Vitória', GO: 'Goiânia', MA: 'São Luís', MT: 'Cuiabá', MS: 'Campo Grande', MG: 'Belo Horizonte',
  PA: 'Belém', PB: 'João Pessoa', PR: 'Curitiba', PE: 'Recife', PI: 'Teresina', RJ: 'Rio de Janeiro',
  RN: 'Natal', RS: 'Porto Alegre', RO: 'Porto Velho', RR: 'Boa Vista', SC: 'Florianópolis', SP: 'São Paulo',
  SE: 'Aracaju', TO: 'Palmas',
};

let mapa = null;
let marcadorCentro = null;
let circuloRaio = null;
let centro = null;
let charts = {};
let municipioSelecionado = null;
let camadaCalor = null;
let marcadoresEscolas = [];
let modoMapa = 'pins';
let escolasNovasOsm = [];
let escolasDuplicidade = [];
let filtroFonte = 'todas'; // 'todas' | 'censo' | 'osm'

function fmtMoedaExata(valor) {
  if (valor == null || !Number.isFinite(Number(valor))) return '-';
  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
  });
}

function skeleton() {
  content.innerHTML = `
    <div class="dash-hero">
      <div>
        <h1 class="dash-hero-title"><i class="fa-solid fa-map-location-dot"></i> Pesquisa de Mercado</h1>
        <p class="dash-hero-sub">Analise qualquer região por raio: escolas concorrentes, ticket médio e dados demográficos do IBGE</p>
      </div>
    </div>

    <div class="filters" id="campos-endereco">
      <div><label>Escopo da análise</label>
        <select id="f-escopo">
          <option value="raio">Raio ao redor de um ponto</option>
          <option value="uf">Estado inteiro (UF)</option>
          <option value="regiao">Região (vários estados)</option>
        </select>
      </div>
      <div id="campo-regiao" class="hidden"><label>Região</label>
        <select id="f-regiao">${REGIOES.map((r) => `<option>${r}</option>`).join('')}</select>
      </div>
    </div>
    <div class="filters">
      <div><label>Endereço (opcional — centraliza sem precisar de UF/Município)</label>
        <input type="text" id="f-endereco" placeholder="Ex: Av. Paulista, São Paulo, SP" style="min-width:260px;">
      </div>
      <div><button class="btn" id="btn-buscar-endereco">Buscar endereço</button></div>
    </div>
    <div class="filters">
      <div id="campo-uf"><label>UF</label><select id="f-uf"><option value="">Selecione</option>${UFS.map((u) => `<option>${u}</option>`).join('')}</select></div>
      <div id="campo-municipio"><label>Município (opcional — traz dados do IBGE)</label><select id="f-municipio" disabled><option value="">Selecione a UF primeiro</option></select></div>
      <div><button class="btn" id="btn-usar-capital" disabled>Usar capital</button></div>
      <div id="campo-raio"><label>Raio (km): <strong id="valor-raio">5</strong></label>
        <input type="range" id="f-raio" min="1" max="30" value="5" style="width:180px;">
      </div>
      <div><label>Porte de referência (concorrente direto)</label>
        <select id="f-porte-referencia">
          <option value="">Não classificar</option>
          <option value="1-Micro (ate 50)">Micro (até 50)</option>
          <option value="2-Pequeno (51-200)">Pequeno (51-200)</option>
          <option value="3-Medio (201-500)">Médio (201-500)</option>
          <option value="4-Grande (501-1000)">Grande (501-1000)</option>
          <option value="5-Muito Grande (1000+)">Muito grande (1000+)</option>
        </select>
      </div>
      <div><button class="btn btn-primary" id="btn-analisar">Mapear região</button></div>
      <div id="campo-btn-osm"><button class="btn" id="btn-buscar-osm">Buscar escolas novas (OpenStreetMap)</button></div>
      <div><button class="btn" id="btn-salvar-regiao">Salvar no histórico de mapeamentos</button></div>
    </div>
    <p class="sub" id="msg-osm"></p>
    <p class="sub" id="instrucao-mapa" style="margin-bottom:14px;">
      Clica no mapa pra marcar o centro da análise (ou escolhe um município/endereço acima pra centralizar automaticamente), ajusta o raio, e clica em "Mapear região".
    </p>

    <div class="card" id="card-regioes-salvas">
      <h2>Histórico de mapeamentos</h2>
      <p class="sub">
        As escolas descobertas já ficam salvas na base principal assim que um mapeamento roda — não é preciso
        reabrir isto pra "recuperar" nada. Isto aqui é só um registro de quando/onde cada mapeamento foi feito,
        útil pra saber se uma região já foi coberta antes.
      </p>
      <div id="lista-regioes-salvas"><span class="loading-bar">Carregando...</span></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
        <span class="sub" style="margin:0;">Visualização do mapa:</span>
        <div>
          <button class="btn" id="btn-modo-pins" style="padding:5px 12px;font-size:12px;">Pins</button>
          <button class="btn" id="btn-modo-calor" style="padding:5px 12px;font-size:12px;">Calor (faturamento potencial)</button>
          <button class="btn" id="btn-filtro-todas" style="padding:5px 12px;font-size:12px;">Todas</button>
          <button class="btn" id="btn-filtro-censo" style="padding:5px 12px;font-size:12px;">Só Censo</button>
          <button class="btn" id="btn-filtro-osm" style="padding:5px 12px;font-size:12px;">Só novas (OSM)</button>
        </div>
      </div>
      <div id="mapa-mercado" style="height:420px;border-radius:var(--radius-md);overflow:hidden;"></div>
    </div>

    <div id="resultados-mercado"></div>

    <div class="footer-note">
      <strong>Sobre os dados:</strong> as escolas mostradas vêm do Censo Escolar INEP (mesma base do restante do
      app) — o raio é calculado em linha reta a partir do ponto marcado no mapa. Os dados populacionais vêm da API
      pública do IBGE (Censo Demográfico 2022), sempre no nível de <strong>município</strong> — o IBGE não
      disponibiliza população recortada por um raio livre, então esse número é do município inteiro, não só da
      área dentro do raio. Use como referência de escala da região, não como número exato da área marcada.
    </div>
  `;
}

function iconTextColor() { return document.documentElement.getAttribute('data-theme') === 'dark' ? '#9DBAC5' : '#5C7480'; }
function destroyChart(nome) { if (charts[nome]) { charts[nome].destroy(); delete charts[nome]; } }

function initMapa() {
  const el = document.getElementById('mapa-mercado');
  if (typeof L === 'undefined') {
    el.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;">Não foi possível carregar o mapa (biblioteca Leaflet indisponível — verifique sua conexão). Os filtros de UF/Município abaixo continuam funcionando normalmente.</div>';
    return;
  }
  try {
    mapa = L.map('mapa-mercado').setView([-14.2, -51.9], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(mapa);
    mapa.on('click', (e) => { definirCentro(e.latlng.lat, e.latlng.lng); });
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:13px;">Erro ao carregar o mapa: ${err.message}</div>`;
  }
}

function definirCentro(lat, lon) {
  centro = { lat, lon };
  if (mapa) {
    if (marcadorCentro) mapa.removeLayer(marcadorCentro);
    marcadorCentro = L.marker([lat, lon]).addTo(mapa);
    desenharCirculo();
  }
  atualizarDisponibilidadeDescoberta();
}

function desenharCirculo() {
  if (!centro || !mapa) return;
  const raioKm = Number(document.getElementById('f-raio').value);
  if (circuloRaio) mapa.removeLayer(circuloRaio);
  circuloRaio = L.circle([centro.lat, centro.lon], { radius: raioKm * 1000, color: '#0B5C7D', fillOpacity: 0.12 }).addTo(mapa);
}

async function popularMunicipios(uf) {
  const select = document.getElementById('f-municipio');
  select.innerHTML = '<option value="">Carregando...</option>';
  select.disabled = true;
  try {
    const municipios = await listarMunicipiosPorUF(uf);
    select.innerHTML = '<option value="">Nenhum (só usar o clique no mapa)</option>' +
      municipios.map((m) => `<option value="${m.id}">${m.nome}</option>`).join('');
    select.disabled = false;
    select.dataset.municipios = JSON.stringify(municipios);
  } catch (err) {
    select.innerHTML = '<option value="">Erro ao carregar municípios do IBGE</option>';
  }
}

async function centralizarNoMunicipio(uf, nomeMunicipio, idIbge) {
  if (!(await ufJaImportada(uf))) await importarUF(uf, `escolas/${uf}.json`).catch(() => {});
  const escolas = await buscarEscolas({ uf, municipio: nomeMunicipio });
  const comCoord = escolas.filter((e) => coordenadaValidaBrasil(e.lat, e.lon, e.uf || uf));
  if (comCoord.length) {
    // usa a MEDIANA, não a média — a base tem uma minoria de escolas com
    // coordenada corrompida (resíduo de um bug de escala na conversão
    // original do Censo), e a média é sensível a esses outliers. A mediana
    // não é.
    const lat = mediana(comCoord.map((e) => e.lat));
    const lon = mediana(comCoord.map((e) => e.lon));
    if (mapa) mapa.setView([lat, lon], 12);
    definirCentro(lat, lon);
  }
  municipioSelecionado = { id: idIbge, nome: nomeMunicipio, uf };
}

function mediana(valores) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

async function mapearRegiao() {
  const escopo = document.getElementById('f-escopo').value;
  if (escopo === 'uf') return analisarUf();
  if (escopo === 'regiao') return analisarRegiaoMultiUf();
  return analisarRegiao();
}

/**
 * Análise macro de um estado inteiro — mesma lógica de análise (score,
 * SWOT, concentração, ranking, território) da versão por raio, só que sem
 * centro/raio: usa todas as escolas já carregadas da UF e todos os setores
 * censitários dela. "Buscar escolas novas (OSM)" não faz sentido aqui (o
 * Overpass precisa de um ponto+raio pequeno, não dá pra varrer um estado
 * inteiro de uma vez) — fica desabilitado nesse escopo.
 */
async function analisarUf() {
  const resultadosDiv = document.getElementById('resultados-mercado');
  const uf = document.getElementById('f-uf').value;
  if (!uf) { resultadosDiv.innerHTML = '<div class="card"><p class="sub">Escolhe uma UF antes de analisar o estado inteiro.</p></div>'; return; }
  resultadosDiv.innerHTML = '<p class="loading-bar">Carregando e analisando o estado inteiro (pode levar alguns segundos)...</p>';
  escolasNovasOsm = [];

  if (!(await ufJaImportada(uf))) await importarUF(uf, `escolas/${uf}.json`).catch(() => {});
  const todasDaUf = await buscarEscolas({ uf, somenteAnalise: true });
  const candidatasNaRegiao = todasDaUf.filter((e) => e.fonte === 'osm' && e.qualidadeIdentidade?.status === 'candidata_privada_revisao');
  const naRegiao = todasDaUf.filter((e) => e.fonte !== 'osm' || e.qualidadeIdentidade?.status === 'identidade_confirmada_cnpj');

  const [territorio, perfilConsumo] = await Promise.all([
    analisarTerritorioAgregado({ ufs: [uf] }),
    montarPerfilConsumo({ uf, rendaPerCapitaMunicipal: null }),
  ]);

  const porteReferencia = document.getElementById('f-porte-referencia').value;
  ultimosResultados = naRegiao;
  escolasNovasOsm = candidatasNaRegiao;
  desenharEscolasNoMapa();
  if (mapa) mapa.setView([-14.2, -51.9], 4); // sem ponto único pra centralizar — volta pra visão Brasil
  renderResultados(naRegiao, null, null, null, porteReferencia, {
    territorio, perfilConsumo, candidatasNaRegiao,
    escopoLabel: `estado inteiro (${uf})`,
  });
}

/**
 * Mesma ideia, mas somando várias UFs de uma região (Nordeste, Sul etc).
 * Carrega a base de escolas de cada UF da região (pode ser pesado — 9
 * estados no caso do Nordeste) e a camada territorial agregada de todas.
 */
async function analisarRegiaoMultiUf() {
  const resultadosDiv = document.getElementById('resultados-mercado');
  const nomeRegiao = document.getElementById('f-regiao').value;
  const ufs = ufsDaRegiao(nomeRegiao);
  resultadosDiv.innerHTML = `<p class="loading-bar">Carregando e analisando a região ${nomeRegiao} (${ufs.length} estados — pode levar um tempo)...</p>`;
  escolasNovasOsm = [];

  for (const uf of ufs) {
    if (!(await ufJaImportada(uf))) await importarUF(uf, `escolas/${uf}.json`).catch(() => {});
  }
  const todasDaRegiao = (await Promise.all(ufs.map((uf) => buscarEscolas({ uf, somenteAnalise: true })))).flat();
  const candidatasNaRegiao = todasDaRegiao.filter((e) => e.fonte === 'osm' && e.qualidadeIdentidade?.status === 'candidata_privada_revisao');
  const naRegiao = todasDaRegiao.filter((e) => e.fonte !== 'osm' || e.qualidadeIdentidade?.status === 'identidade_confirmada_cnpj');

  const [territorio, perfilConsumo] = await Promise.all([
    analisarTerritorioAgregado({ ufs }),
    montarPerfilConsumo({ uf: ufs[0], rendaPerCapitaMunicipal: null }),
  ]);

  const porteReferencia = document.getElementById('f-porte-referencia').value;
  ultimosResultados = naRegiao;
  escolasNovasOsm = candidatasNaRegiao;
  desenharEscolasNoMapa();
  if (mapa) mapa.setView([-14.2, -51.9], 4);
  renderResultados(naRegiao, null, null, null, porteReferencia, {
    territorio, perfilConsumo, candidatasNaRegiao,
    escopoLabel: `região ${nomeRegiao} (${ufs.length} estados)`,
  });
}

async function analisarRegiao() {
  const resultadosDiv = document.getElementById('resultados-mercado');
  if (!centro) {
    resultadosDiv.innerHTML = '<div class="card"><p class="sub">Marca um ponto no mapa (ou escolhe um município) antes de analisar.</p></div>';
    return;
  }
  resultadosDiv.innerHTML = '<p class="loading-bar">Analisando região...</p>';
  escolasNovasOsm = [];

  const uf = document.getElementById('f-uf').value;
  const raioKm = Number(document.getElementById('f-raio').value);
  if (uf && !(await ufJaImportada(uf))) {
    resultadosDiv.innerHTML = '<p class="loading-bar">Carregando base de escolas da UF...</p>';
    await importarUF(uf, `escolas/${uf}.json`).catch(() => {});
  }

  const todasDaUf = uf ? await buscarEscolas({ uf, somenteAnalise: true }) : [];
  const noRaio = todasDaUf.filter((e) => coordenadaValidaBrasil(e.lat, e.lon, e.uf || uf)
    && distanciaKm(centro.lat, centro.lon, e.lat, e.lon) <= raioKm);
  const candidatasNaRegiao = noRaio.filter((e) => e.fonte === 'osm'
    && e.qualidadeIdentidade?.status === 'candidata_privada_revisao');
  // Registros OSM só entram nos indicadores depois da confirmação de identidade/CNPJ.
  // Permanecem visíveis no mapa, em laranja, como uma fila separada de investigação.
  const naRegiao = noRaio.filter((e) => e.fonte !== 'osm'
    || e.qualidadeIdentidade?.status === 'identidade_confirmada_cnpj');

  let demografia = null;
  let demandaEscolar = null;
  if (municipioSelecionado) {
    try {
      demografia = await buscarDadosDemograficos(municipioSelecionado.id);
      if (demografia.faixasEtarias && demografia.faixasEtarias.length) demandaEscolar = resumirDemandaEscolar(demografia.faixasEtarias);
    } catch (err) { demografia = { erro: err.message }; }
  }

  const indicadoresMunicipais = municipioSelecionado && demandaEscolar
    ? calcularIndicadoresEducacionaisMunicipio(todasDaUf, municipioSelecionado.nome, demandaEscolar)
    : null;
  const penetracaoProjecao = indicadoresMunicipais?.penetracao?.infantil ?? indicadoresMunicipais?.penetracaoTotal ?? null;
  const projecaoCoortes = demografia?.natalidade
    ? projetarCoortesEscolares(demografia.natalidade, penetracaoProjecao)
    : null;
  const [territorio, perfilConsumo] = await Promise.all([
    analisarTerritorioNoRaio({ uf, centro, raioKm }),
    montarPerfilConsumo({ uf, rendaPerCapitaMunicipal: demografia?.rendaDomiciliarPerCapita?.media }),
  ]);

  const porteReferencia = document.getElementById('f-porte-referencia').value;
  ultimosResultados = naRegiao;
  escolasNovasOsm = candidatasNaRegiao;
  desenharEscolasNoMapa();
  renderResultados(naRegiao, raioKm, demografia, demandaEscolar, porteReferencia, {
    territorio, indicadoresMunicipais, projecaoCoortes, perfilConsumo, candidatasNaRegiao,
  });
}

function renderResultados(escolas, raioKm, demografia, demandaEscolar, porteReferencia, extras = {}) {
  const { territorio = null, indicadoresMunicipais = null, projecaoCoortes = null, perfilConsumo = null, candidatasNaRegiao = [], escopoLabel = `raio de ${raioKm}km` } = extras;
  const resultadosDiv = document.getElementById('resultados-mercado');
  const totalMat = escolas.reduce((s, e) => s + (e.mat25 || 0), 0);
  const comTicket = escolas.filter((e) => e.mensalidade != null);
  const ticketMedio = comTicket.length ? comTicket.reduce((s, e) => s + e.mensalidade, 0) / comTicket.length : null;

  const diretos = porteReferencia ? escolas.filter((e) => e.porte === porteReferencia) : [];
  const indiretos = porteReferencia ? escolas.filter((e) => e.porte !== porteReferencia) : [];
  const ticketDiretos = diretos.filter((e) => e.mensalidade != null);
  const ticketMedioDiretos = ticketDiretos.length ? ticketDiretos.reduce((s, e) => s + e.mensalidade, 0) / ticketDiretos.length : null;

  // --- Camada 2: Score de Oportunidade Regional ---
  const scoreOportunidade = calcularScoreOportunidade({ escolas, populacaoMunicipio: demografia?.populacaoTotal });
  const corScore = scoreOportunidade.classificacao === 'Alta' ? 'var(--icp-alta)' : scoreOportunidade.classificacao === 'Média' ? 'var(--icp-media)' : 'var(--icp-baixa)';

  // --- Camada 5: Clusters por rede ---
  const clusters = agruparPorRede(escolas);

  // --- Camada 6: Ranking com relevância e distância ---
  const ranking = calcularRanking(escolas, centro, raioKm);

  // --- Camada 8: Funil de mercado ---
  const populacaoIdadeEscolar = demandaEscolar
    ? (demandaEscolar.educacaoInfantil || 0) + (demandaEscolar.fundamentalI || 0) + (demandaEscolar.fundamentalIIEMedio || 0) + (demandaEscolar.medio || 0)
    : null;
  const escolasAlvo = escolas.filter((e) => e.mensalidade != null && demografia && scoreOportunidade?.entradas?.ticketMedio != null && e.mensalidade >= scoreOportunidade.entradas.ticketMedio).length;
  const topOportunidades = escolas.filter((e) => (e.capOciosa || 0) > 0 && e.mensalidade != null && scoreOportunidade?.entradas?.ticketMedio != null && e.mensalidade >= scoreOportunidade.entradas.ticketMedio).length;
  const funil = montarFunil({
    populacaoMunicipio: demografia?.populacaoTotal,
    populacaoIdadeEscolar,
    matriculasRegiao: totalMat,
    escolasAlvo,
    topOportunidades,
  });

  resultadosDiv.innerHTML = `
    <div class="card" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
      <div style="text-align:center;min-width:140px;">
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;">Score de Atratividade Regional</div>
        <div style="font-size:42px;font-weight:800;color:${corScore};">${scoreOportunidade.score}</div>
        <span class="badge" style="border-color:${corScore};color:${corScore};">${scoreOportunidade.classificacao}</span>
      </div>
      <div style="flex:1;min-width:260px;font-size:11.5px;color:var(--text-secondary);">
        Combina densidade populacional, crescimento de matrículas, ticket médio, faturamento potencial per capita,
        capacidade ociosa e presença de redes conhecidas na região — pesos e fatores abaixo, sem caixa-preta. Não
        usa ICP (isso mede perfil do responsável de uma escola, não atratividade de uma região).
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;">
          <span>Densidade: <strong>${Math.round(scoreOportunidade.componentes.densidade)}</strong></span>
          <span>Crescimento: <strong>${Math.round(scoreOportunidade.componentes.crescimento)}</strong></span>
          <span>Ticket médio: <strong>${Math.round(scoreOportunidade.componentes.ticketMedio)}</strong></span>
          <span>Faturamento/capita: <strong>${Math.round(scoreOportunidade.componentes.fatPotencialPerCapita)}</strong></span>
          <span>Ociosidade: <strong>${Math.round(scoreOportunidade.componentes.capacidadeOciosa)}</strong></span>
          <span>Presença de redes: <strong>${Math.round(scoreOportunidade.componentes.presencaRedes)}</strong></span>
        </div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="label"><i class="fa-solid fa-school"></i> Escolas no ${escopoLabel}</div><div class="value">${fmtInt(escolas.length)}</div></div>
      <div class="kpi"><div class="label"><i class="fa-solid fa-users"></i> Matrículas na região</div><div class="value">${fmtInt(totalMat)}</div></div>
      <div class="kpi"><div class="label"><i class="fa-solid fa-sack-dollar"></i> Ticket médio na região</div><div class="value">${ticketMedio != null ? fmtMoedaCompacta(ticketMedio) : '-'}</div></div>
      <div class="kpi"><div class="label"><i class="fa-solid fa-city"></i> População do município (IBGE)</div><div class="value">${demografia && demografia.populacaoTotal != null ? fmtInt(demografia.populacaoTotal) : '-'}</div></div>
      <div class="kpi"><div class="label"><i class="fa-solid fa-wallet"></i> Renda domiciliar per capita média</div><div class="value">${fmtMoedaExata(demografia?.rendaDomiciliarPerCapita?.media)}</div><div class="sub">Município · Censo 2022</div></div>
      <div class="kpi"><div class="label"><i class="fa-solid fa-scale-balanced"></i> Renda domiciliar per capita mediana</div><div class="value">${fmtMoedaExata(demografia?.rendaDomiciliarPerCapita?.mediana)}</div><div class="sub">Município · Censo 2022</div></div>
      <div class="kpi"><div class="label"><i class="fa-solid fa-magnifying-glass-location"></i> Candidatas descobertas</div><div class="value">${fmtInt(candidatasNaRegiao.length)}</div><div class="sub">Visíveis no mapa; fora dos indicadores até confirmação</div></div>
    </div>

    ${candidatasNaRegiao.length ? `<div class="card">
      <h2>Fila de validação de novas escolas</h2>
      <p class="sub">${fmtInt(candidatasNaRegiao.length)} registros do OpenStreetMap parecem escolas privadas neste raio, mas ainda não têm identidade confirmada. Eles aparecem como pins laranja e não alteram score, concorrência, matrículas ou ticket. Confirme o CNPJ pela Central de Enriquecimento para promovê-los à análise.</p>
    </div>` : ''}

    ${demandaEscolar ? `
    <div class="dash-section-header"><i class="fa-solid fa-child-reaching"></i> Demanda vs. oferta por faixa etária</div>
    <div class="card">
      <p class="sub">
        População do município por faixa etária (IBGE) comparada com matrículas por etapa das escolas na região —
        idades exatas do Censo 2022 agrupadas nas etapas educacionais. População é demanda potencial, não uma
        estimativa de procura por escola privada; as matrículas consideram somente o raio selecionado.
      </p>
      <div style="position:relative;height:280px;"><canvas id="chart-demanda-oferta"></canvas></div>
      ${montarPenetracaoHtml(indicadoresMunicipais)}
    </div>` : ''}

    ${montarNatalidadeHtml(demografia?.natalidade, projecaoCoortes)}

    <div class="dash-section-header"><i class="fa-solid fa-arrow-trend-up"></i> Projeção de demanda (tendência observada)</div>
    <div class="card">
      <p class="sub">
        <strong>Importante:</strong> isto NÃO é uma projeção demográfica oficial do IBGE (o IBGE não publica
        projeção populacional por município de forma simples via API) — é a tendência de matrículas 2024→2025 já
        observada no Censo, projetada linearmente. Trate como cenário ilustrativo, não previsão oficial.
      </p>
      <div style="position:relative;height:260px;"><canvas id="chart-projecao"></canvas></div>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-chart-column"></i> Perfil das escolas na região</div>
    <div class="grid2">
      <div class="card">
        <h2>Escolas por porte, na região</h2>
        <div style="position:relative;height:260px;"><canvas id="chart-porte-regiao"></canvas></div>
      </div>
      <div class="card">
        <h2>Faixas de ticket médio, na região</h2>
        <div style="position:relative;height:260px;"><canvas id="chart-ticket-regiao"></canvas></div>
      </div>
    </div>

    ${demografia && demografia.faixasEtarias && demografia.faixasEtarias.length ? `
    <div class="card">
      <h2>População por faixa etária — ${municipioSelecionado.nome}/${municipioSelecionado.uf} (IBGE, Censo 2022)</h2>
      <p class="sub">Dado do município inteiro, não só da área do raio — use como referência de escala.</p>
      <div style="position:relative;height:260px;"><canvas id="chart-idade-municipio"></canvas></div>
    </div>` : demografia && demografia.erro ? `
    <div class="card"><h2>Dados demográficos do IBGE</h2><p class="sub">Não foi possível carregar agora: ${demografia.erro}</p></div>
    ` : ''}

    <div class="dash-section-header"><i class="fa-solid fa-diagram-project"></i> Clusters de concorrentes por rede/franquia</div>
    <div class="card">
      <p class="sub">
        Identificado por padrão de nome no Censo (não é uma base oficial de franquias) — pode não reconhecer redes
        regionais menores. Pins verdes no mapa = escola de rede identificada; azuis = independente/não identificada.
      </p>
      ${clusters.redes.length ? `
        <div class="kpis">
          ${clusters.redes.slice(0, 6).map((r) => `<div class="kpi"><div class="label">${r.rede}</div><div class="value">${fmtInt(r.quantidade)}</div></div>`).join('')}
        </div>
        <p class="sub" style="margin-top:8px;">${fmtInt(clusters.semRedeIdentificada)} de ${fmtInt(clusters.totalEscolas)} escolas na região são independentes ou de rede não reconhecida pelo padrão de nome — ${clusters.redes.length ? 'região ' + (clusters.redes[0].quantidade / clusters.totalEscolas > 0.3 ? 'com presença forte de rede dominante' : 'fragmentada entre várias redes/independentes') : ''}.</p>
      ` : '<p class="sub">Nenhuma rede conhecida identificada nesta região — provavelmente dominada por escolas independentes.</p>'}
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-chart-line"></i> Região vs. média estadual vs. média nacional</div>
    <div class="card">
      <p class="sub">${mediasNacionais ? '' : 'Médias nacionais ainda carregando ou indisponíveis — a comparação usa só região e UF enquanto isso.'}</p>
      <div id="comparativo-regiao"></div>
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-chart-pie"></i> Concentração de mercado na região</div>
    <div class="card">
      <p class="sub">
        Quais escolas concentram o maior volume de matrículas nesta região — dados comerciais/estruturais, não
        perfil de responsável. Ajuda a ver se o mercado depende de poucas escolas grandes ou está pulverizado.
      </p>
      ${montarConcentracaoHtml(calcularConcentracaoMercado(escolas))}
    </div>

    ${porteReferencia ? `
    <div class="dash-section-header"><i class="fa-solid fa-crosshairs"></i> Benchmarking: concorrentes diretos vs. indiretos</div>
    <div class="kpis">
      <div class="kpi"><div class="label">Concorrentes diretos (mesmo porte)</div><div class="value">${fmtInt(diretos.length)}</div></div>
      <div class="kpi"><div class="label">Ticket médio dos diretos</div><div class="value">${ticketMedioDiretos != null ? fmtMoedaCompacta(ticketMedioDiretos) : '-'}</div></div>
      <div class="kpi"><div class="label">Concorrentes indiretos (outros portes)</div><div class="value">${fmtInt(indiretos.length)}</div></div>
    </div>` : ''}

    ${montarTerritorioHtml(territorio, escopoLabel)}

    ${montarConsumoHtml(perfilConsumo, demografia?.rendaDomiciliarPerCapita)}

    <div class="dash-section-header"><i class="fa-solid fa-filter"></i> Funil de mercado regional</div>
    <div class="card">
      ${montarFunilHtml(funil)}
    </div>

    <div class="dash-section-header"><i class="fa-solid fa-file-lines"></i> Relatório da região</div>
    ${montarRelatorioHtml(escolas, escopoLabel, totalMat, ticketMedio, demografia, demandaEscolar, porteReferencia, diretos, ticketMedioDiretos, scoreOportunidade, territorio, indicadoresMunicipais)}

    <div class="dash-section-header"><i class="fa-solid fa-magnifying-glass-chart"></i> Análise crítica e construtiva</div>
    <div class="card" id="card-analise-critica">
      <p class="sub">
        Gerada por regras sobre os números já calculados nesta tela — nunca por IA aqui, exatamente pra cada
        frase ser rastreável a um dado real, incluindo limitações da própria base usada.
      </p>
      <div id="conteudo-analise-critica"></div>
      <button class="btn btn-primary" id="btn-exportar-pdf" style="margin-top:12px;"><i class="fa-solid fa-file-pdf"></i> Exportar PDF</button>
      <span class="loading-bar" id="msg-pdf"></span>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2>Ranking de concorrentes diretos</h2>
        <button class="btn" id="btn-exportar-ranking">Exportar CSV</button>
      </div>
      <p class="sub">Ordenado por relevância (ticket médio × porte × proximidade do centro marcado) — clique numa linha pra abrir a ficha</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>#</th><th>Escola</th><th>Porte</th><th>Matrículas</th><th>Ticket médio</th><th>Faturamento potencial</th><th>Distância</th><th>Sinal de matrículas</th><th>Telefone</th>${porteReferencia ? '<th>Classificação</th>' : ''}</tr></thead>
          <tbody>
            ${ranking.slice(0, 200).map((e, i) => `
              <tr data-id="${e.id}" style="cursor:pointer;">
                <td>${i + 1}</td><td>${e.nome}</td><td>${labelPorte(e.porte)}</td>
                <td>${fmtInt(e.mat25)}</td>
                <td>${e.mensalidade != null ? fmtMoedaCompacta(e.mensalidade) : '-'}</td>
                <td>${e.fatPotencial != null ? fmtMoedaCompacta(e.fatPotencial) : '-'}</td>
                <td>${e.distanciaKm != null ? e.distanciaKm.toFixed(1) + 'km' : '-'}</td>
                <td>${e.sinalMat || '-'}</td>
                <td>${e.ddd ? `(${e.ddd}) ` : ''}${e.tel || '-'}</td>
                ${porteReferencia ? `<td>${e.porte === porteReferencia ? '<span class="badge badge-icp-alta">Direto</span>' : '<span class="badge">Indireto</span>'}</td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.querySelectorAll('#resultados-mercado tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => abrirPainelEscola(Number(tr.dataset.id), { onAtualizar: () => {} }));
  });

  document.getElementById('btn-exportar-ranking').addEventListener('click', () => {
    exportarCsv(ranking, [
      { chave: 'nome', titulo: 'Escola' }, { chave: 'municipio', titulo: 'Município' }, { chave: 'porte', titulo: 'Porte' },
      { chave: 'mat25', titulo: 'Matrículas' }, { chave: 'mensalidade', titulo: 'Ticket médio' },
      { chave: 'fatPotencial', titulo: 'Faturamento potencial' }, { chave: 'distanciaKm', titulo: 'Distância (km)' },
      { chave: 'relevancia', titulo: 'Relevância' }, { chave: 'sinalMat', titulo: 'Sinal de matrículas' },
      { chave: 'ddd', titulo: 'DDD' }, { chave: 'tel', titulo: 'Telefone' }, { chave: 'endereco', titulo: 'Endereço' },
    ], 'ranking_concorrentes_regiao');
  });

  renderChartPorte(escolas);
  renderChartTicket(comTicket);
  if (demografia && demografia.faixasEtarias && demografia.faixasEtarias.length) renderChartIdade(demografia.faixasEtarias);
  if (demandaEscolar) renderChartDemandaOferta(demandaEscolar, escolas);
  renderChartProjecao(escolas, totalMat);
  renderComparativoRegiao(escolas, scoreOportunidade, demografia);

  const analiseCritica = gerarAnaliseCritica({
    escolas, scoreOportunidade, demandaEscolar, populacaoIdadeEscolar,
    matriculasRegiao: totalMat, clusters, ticketMedioNacional: mediasNacionais?.ticketMedio, raioKm,
  });
  document.getElementById('conteudo-analise-critica').innerHTML = montarAnaliseCriticaHtml(analiseCritica);
  ultimaAnaliseParaPdf = { escolas, raioKm, escopoLabel, totalMat, ticketMedio, demografia, municipioSelecionado, scoreOportunidade, analiseCritica, ranking };
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPdf);
}

function montarAnaliseCriticaHtml(a) {
  const bloco = (titulo, itens, icone, cor) => !itens.length ? '' : `
    <div style="margin-bottom:14px;">
      <h4 style="font-size:12.5px;color:${cor};margin-bottom:6px;"><i class="${icone}"></i> ${titulo}</h4>
      <ul style="font-size:12px;line-height:1.6;padding-left:20px;margin:0;">
        ${itens.map((t) => `<li>${t}</li>`).join('')}
      </ul>
    </div>`;
  return `
    ${bloco('Pontos fortes', a.pontosFortes, 'fa-solid fa-circle-plus', 'var(--icp-alta)')}
    ${bloco('Pontos de atenção', a.pontosAtencao, 'fa-solid fa-triangle-exclamation', '#EDA100')}
    ${bloco('Limitações desta análise', a.limitacoesDados, 'fa-solid fa-circle-info', 'var(--text-muted)')}
    <p style="font-size:12.5px;font-weight:600;margin-top:4px;">${a.recomendacao}</p>
  `;
}

let ultimaAnaliseParaPdf = null;

function exportarPdf() {
  const msg = document.getElementById('msg-pdf');
  if (!ultimaAnaliseParaPdf) { msg.textContent = 'Nada pra exportar ainda — mapeie uma região primeiro.'; return; }
  if (typeof window.jspdf === 'undefined') { msg.textContent = 'Biblioteca de PDF não carregou (verifique sua conexão) — tente recarregar a página.'; return; }
  const { escolas, raioKm, escopoLabel = `raio de ${raioKm}km`, totalMat, ticketMedio, demografia, municipioSelecionado: municipio, scoreOportunidade, analiseCritica, ranking } = ultimaAnaliseParaPdf;

  const dadosPdf = {
    tituloRegiao: municipio ? `${municipio.nome}/${municipio.uf} — ${escopoLabel}` : `Região marcada — ${escopoLabel}`,
    escolas, raioKm, totalMat, ticketMedio, demografia, scoreOportunidade, analiseCritica, ranking,
    ticketMedioNacional: mediasNacionais?.ticketMedio,
    goToMarket: gerarGoToMarket({ analiseCritica, escolas, raioKm, ranking }),
    planoAcao: gerarPlanoAcao({ analiseCritica, escolas, raioKm, porteReferencia: document.getElementById('f-porte-referencia').value }),
    imagens: {
      porte: charts.porte ? charts.porte.toBase64Image() : null,
      ticket: charts.ticket ? charts.ticket.toBase64Image() : null,
    },
    fmtInt, fmtMoedaCompacta, labelPorte,
  };

  try {
    const doc = gerarRelatorioPdf({ jsPDF: window.jspdf.jsPDF, dados: dadosPdf });
    const nomeArquivo = `nexo-${municipio ? municipio.nome.toLowerCase().replace(/\s+/g, '-') : escopoLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    doc.save(nomeArquivo);
    msg.textContent = 'PDF gerado.';
  } catch (err) {
    msg.textContent = `Erro ao gerar PDF: ${err.message}`;
  }
  setTimeout(() => { const m = document.getElementById('msg-pdf'); if (m) m.textContent = ''; }, 2500);
}

function montarConcentracaoHtml(c) {
  if (!c.top.length) {
    return '<p class="sub">Nenhuma escola com matrículas conhecidas nesta região pra calcular concentração de mercado.</p>';
  }
  const leituraConcentracao = c.concentracaoTop3 >= 60
    ? 'Mercado concentrado — poucas escolas grandes dominam o volume. Elas são as referências de preço/posicionamento na região.'
    : c.concentracaoTop3 <= 30
      ? 'Mercado pulverizado — nenhuma escola domina sozinha, matrículas distribuídas entre várias.'
      : 'Concentração intermediária — algumas escolas grandes convivem com uma base pulverizada.';

  return `
    <div class="kpis">
      <div class="kpi"><div class="label">Top 3 escolas concentram</div><div class="value">${c.concentracaoTop3.toFixed(0)}%</div><div class="sub">das matrículas privadas na região</div></div>
      <div class="kpi"><div class="label">Top 5 escolas concentram</div><div class="value">${c.concentracaoTop5.toFixed(0)}%</div></div>
      <div class="kpi"><div class="label">Top 10 escolas concentram</div><div class="value">${c.concentracaoTop10.toFixed(0)}%</div></div>
      <div class="kpi"><div class="label">Escolas com dado de matrícula</div><div class="value">${fmtInt(c.totalComDado)}</div></div>
    </div>
    <p class="sub" style="margin:8px 0 14px;">${leituraConcentracao}</p>
    <table class="data-table">
      <thead><tr><th>#</th><th>Escola</th><th>Matrículas</th><th>Market share</th></tr></thead>
      <tbody>
        ${c.top.map((e, i) => `
          <tr data-id="${e.id}" style="cursor:pointer;">
            <td>${i + 1}</td><td>${e.nome}</td><td>${fmtInt(e.mat25)}</td>
            <td><strong>${e.marketShare.toFixed(1)}%</strong></td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function montarFunilHtml(funil) {
  if (!funil.length) return '<p class="sub">Selecione um município pra ver o funil completo (precisa da população do IBGE).</p>';
  const max = funil[0].valor || 1;
  return `<div style="display:flex;flex-direction:column;gap:8px;">
    ${funil.map((etapa) => {
      const pct = Math.max(4, (etapa.valor / max) * 100);
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span>${etapa.label}</span><strong>${fmtInt(etapa.valor)}</strong>
        </div>
        <div style="background:var(--bg-surface-2);border-radius:6px;overflow:hidden;">
          <div style="width:${pct}%;background:var(--accent);height:22px;border-radius:6px;"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function pct(valor, casas = 1) {
  return valor == null || !Number.isFinite(Number(valor)) ? '-' : `${(Number(valor) * 100).toFixed(casas)}%`;
}

function montarPenetracaoHtml(indicadores) {
  if (!indicadores) return '';
  return `
    <div class="kpis" style="margin-top:14px;">
      <div class="kpi"><div class="label">Penetração privada · Infantil</div><div class="value">${pct(indicadores.penetracao.infantil)}</div><div class="sub">${fmtInt(indicadores.matriculas.infantil)} matrículas</div></div>
      <div class="kpi"><div class="label">Penetração privada · Fundamental</div><div class="value">${pct(indicadores.penetracao.fundamental)}</div><div class="sub">${fmtInt(indicadores.matriculas.fundamental)} matrículas</div></div>
      <div class="kpi"><div class="label">Penetração privada · Médio</div><div class="value">${pct(indicadores.penetracao.medio)}</div><div class="sub">${fmtInt(indicadores.matriculas.medio)} matrículas</div></div>
      <div class="kpi"><div class="label">Escolas privadas no município</div><div class="value">${fmtInt(indicadores.escolasPrivadasCenso)}</div><div class="sub">Censo Escolar 2025</div></div>
    </div>
    <p class="sub" style="margin-top:8px;">${indicadores.nota}</p>`;
}

function montarNatalidadeHtml(natalidade, projecao) {
  if (!natalidade || !Object.keys(natalidade.serie || {}).length) return '';
  const serie = Object.entries(natalidade.serie).sort(([a], [b]) => Number(a) - Number(b));
  const coortes = (projecao?.coortes || []).slice().sort((a, b) => b.anoNascimento - a.anoNascimento);
  const variacao = natalidade.variacaoPeriodoPct;
  return `
    <div class="dash-section-header"><i class="fa-solid fa-baby"></i> Natalidade e novas coortes de demanda</div>
    <div class="card">
      <p class="sub">Nascidos vivos por ano de nascimento e município de residência da mãe. Fonte: IBGE, Estatísticas do Registro Civil, tabela SIDRA 2609.</p>
      <div class="kpis">
        ${serie.map(([ano, valor]) => `<div class="kpi"><div class="label">Nascidos em ${ano}</div><div class="value">${fmtInt(valor)}</div></div>`).join('')}
        <div class="kpi"><div class="label">Variação no período</div><div class="value" style="color:${variacao >= 0 ? 'var(--icp-alta)' : '#B23A3A'};">${variacao != null ? `${variacao.toFixed(1)}%` : '-'}</div></div>
      </div>
      ${coortes.length ? `
        <h2 style="margin-top:16px;">Calendário de entrada das coortes</h2>
        <table class="data-table">
          <thead><tr><th>Nascimento</th><th>Nascidos vivos</th><th>Pré-escola</th><th>Fundamental I</th><th>Fundamental II</th><th>Potencial privado · cenário base</th></tr></thead>
          <tbody>${coortes.map((c) => `<tr><td>${c.anoNascimento}</td><td>${fmtInt(c.nascimentos)}</td><td>${c.entradaPreEscola}</td><td>${c.entradaFundamentalI}</td><td>${c.entradaFundamentalII}</td><td>${fmtInt(c.demandaPrivada.base)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="sub" style="margin-top:8px;">Cenários de conversão privada: conservador ${pct(projecao.cenarios.conservador)}, base ${pct(projecao.cenarios.base)} e otimista ${pct(projecao.cenarios.otimista)}. Não há ajuste de sobrevivência ou migração; é uma projeção de coorte, não promessa de matrícula.</p>
      ` : ''}
    </div>`;
}

function montarTerritorioHtml(territorio, escopoLabel) {
  if (!territorio) {
    return `
      <div class="dash-section-header"><i class="fa-solid fa-layer-group"></i> Renda e população por setor censitário</div>
      <div class="card"><p class="sub">A camada territorial desta UF ainda não está no pacote publicado. A renda domiciliar per capita municipal continua disponível acima; execute o pipeline de dados por UF para habilitar o recorte aproximado do raio.</p></div>`;
  }
  const pop0a19 = Object.values(territorio.populacao).reduce((s, v) => s + (v || 0), 0);
  return `
    <div class="dash-section-header"><i class="fa-solid fa-layer-group"></i> Renda e população por setor censitário</div>
    <div class="card">
      <p class="sub">Setores cujo ponto representativo cai no ${escopoLabel}. Renda setorial é da pessoa responsável pelo domicílio — não é renda domiciliar per capita. Fonte: Censo 2022, agregados por setores, versão ${territorio.versao}.</p>
      <div class="kpis">
        <div class="kpi"><div class="label">Setores no recorte</div><div class="value">${fmtInt(territorio.setores)}</div></div>
        <div class="kpi"><div class="label">Moradores cobertos</div><div class="value">${fmtInt(territorio.moradores)}</div></div>
        <div class="kpi"><div class="label">População de 0–19 anos</div><div class="value">${fmtInt(pop0a19)}</div></div>
        <div class="kpi"><div class="label">Renda média do responsável</div><div class="value">${territorio.rendaResponsavelMedia != null ? fmtMoedaCompacta(territorio.rendaResponsavelMedia) : '-'}</div></div>
        <div class="kpi"><div class="label">Mediana setorial ponderada</div><div class="value">${territorio.rendaResponsavelMedianaAproximada != null ? fmtMoedaCompacta(territorio.rendaResponsavelMedianaAproximada) : '-'}</div></div>
        <div class="kpi"><div class="label">Cobertura do indicador de renda</div><div class="value">${territorio.coberturaRendaPct != null ? territorio.coberturaRendaPct.toFixed(1) + '%' : '-'}</div></div>
      </div>
      <p class="sub" style="margin-top:8px;">${territorio.aproximacaoEspacial}</p>
    </div>`;
}

function montarConsumoHtml(perfil, renda) {
  if (!perfil) return '';
  return `
    <div class="dash-section-header"><i class="fa-solid fa-basket-shopping"></i> Perfil de consumo — proxies públicos</div>
    <div class="card">
      <p class="sub">Não representa intenção individual de compra. Combina poder de compra municipal com o padrão agregado de despesas da POF.</p>
      <div class="kpis">
        <div class="kpi"><div class="label">Índice de poder de compra</div><div class="value">${perfil.indicePoderCompraBrasil100 != null ? perfil.indicePoderCompraBrasil100.toFixed(0) : '-'}</div><div class="sub">Brasil = 100 · renda per capita média 2022</div></div>
        <div class="kpi"><div class="label">Participação da educação no consumo</div><div class="value">${perfil.participacaoEducacaoDespesaConsumoPct.toFixed(1)}%</div><div class="sub">${perfil.regiao} · POF 2017–2018</div></div>
        <div class="kpi"><div class="label">Renda per capita média municipal</div><div class="value">${fmtMoedaExata(renda?.media)}</div><div class="sub">Censo 2022</div></div>
      </div>
      <p class="sub" style="margin-top:8px;">${perfil.observacao}</p>
    </div>`;
}

/**
 * Monta um relatório-síntese 100% derivado de números já calculados (nunca
 * texto gerado por IA aqui) — no espírito do fechamento de uma pesquisa de
 * mercado da kedu, mas construído por template, então não tem risco de
 * inventar dado.
 */
function montarRelatorioHtml(escolas, escopoLabel, totalMat, ticketMedio, demografia, demandaEscolar, porteReferencia, diretos, ticketMedioDiretos, scoreOportunidade, territorio, indicadoresMunicipais) {
  const partes = [];
  partes.push(`Dentro do ${escopoLabel}, foram encontradas <strong>${fmtInt(escolas.length)} escolas particulares</strong> do Censo Escolar INEP, somando <strong>${fmtInt(totalMat)} matrículas</strong>${ticketMedio != null ? ` e ticket médio de <strong>${fmtMoedaCompacta(ticketMedio)}</strong>` : ''}.`);
  partes.push(`O <strong>Score de Atratividade Regional é ${scoreOportunidade.score}/100 (${scoreOportunidade.classificacao})</strong>, combinando densidade, crescimento de matrículas, ticket médio, faturamento potencial per capita, ociosidade e presença de redes conhecidas na região.`);
  if (demandaEscolar && (demandaEscolar.educacaoInfantil != null || demandaEscolar.fundamentalI != null)) {
    partes.push(`O município ${municipioSelecionado ? municipioSelecionado.nome : ''} tem <strong>${fmtInt(demandaEscolar.educacaoInfantil || 0)} crianças de 0-5 anos</strong> e <strong>${fmtInt(demandaEscolar.fundamentalI || 0)} de 6-10 anos</strong> (IBGE, Censo 2022) — população potencial para Educação Infantil e Fundamental I, sem presumir preferência por escola privada.`);
  }
  if (porteReferencia && diretos.length) {
    partes.push(`Considerando porte ${labelPorte(porteReferencia)} como referência, há <strong>${fmtInt(diretos.length)} concorrentes diretos</strong> na região${ticketMedioDiretos != null ? `, com ticket médio de <strong>${fmtMoedaCompacta(ticketMedioDiretos)}</strong>` : ''}.`);
  } else if (porteReferencia) {
    partes.push(`Não foram encontrados concorrentes diretos (mesmo porte ${labelPorte(porteReferencia)}) dentro deste raio — pode indicar um nicho de mercado pouco disputado nessa faixa, ou dado insuficiente na base pra essa região.`);
  }
  if (territorio?.rendaResponsavelMedia != null) {
    partes.push(`No recorte aproximado do raio, ${fmtInt(territorio.setores)} setores censitários somam ${fmtInt(territorio.moradores)} moradores e renda média de <strong>${fmtMoedaCompacta(territorio.rendaResponsavelMedia)}</strong> para a pessoa responsável pelo domicílio.`);
  }
  if (indicadoresMunicipais?.penetracaoTotal != null) {
    partes.push(`A razão agregada entre matrículas privadas e população das faixas escolares no município é de <strong>${pct(indicadoresMunicipais.penetracaoTotal)}</strong>, usando Censo Escolar 2025 e população do Censo 2022.`);
  }

  return `<div class="card"><p style="line-height:1.7;">${partes.join(' ')}</p></div>`;
}

function renderChartPorte(escolas) {
  const contagem = {};
  escolas.forEach((e) => { const p = labelPorte(e.porte) || 'Não informado'; contagem[p] = (contagem[p] || 0) + 1; });
  destroyChart('porte');
  const el = document.getElementById('chart-porte-regiao');
  if (!el) return;
  charts.porte = new Chart(el, {
    type: 'bar',
    data: { labels: Object.keys(contagem), datasets: [{ data: Object.values(contagem), backgroundColor: '#2a78d6', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { color: iconTextColor() } }, x: { ticks: { color: iconTextColor() } } } },
  });
}

function renderChartTicket(comTicket) {
  const faixas = [
    { label: 'até R$300', min: 0, max: 300 },
    { label: 'R$300-600', min: 300, max: 600 },
    { label: 'R$600-1000', min: 600, max: 1000 },
    { label: 'R$1000-2000', min: 1000, max: 2000 },
    { label: 'acima de R$2000', min: 2000, max: Infinity },
  ];
  const contagem = faixas.map((f) => comTicket.filter((e) => e.mensalidade >= f.min && e.mensalidade < f.max).length);
  destroyChart('ticket');
  const el = document.getElementById('chart-ticket-regiao');
  if (!el) return;
  charts.ticket = new Chart(el, {
    type: 'bar',
    data: { labels: faixas.map((f) => f.label), datasets: [{ data: contagem, backgroundColor: '#1baf7a', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { color: iconTextColor() } }, x: { ticks: { color: iconTextColor() } } } },
  });
}

function renderChartIdade(faixas) {
  destroyChart('idade');
  const el = document.getElementById('chart-idade-municipio');
  if (!el) return;
  charts.idade = new Chart(el, {
    type: 'bar',
    data: { labels: faixas.map((f) => f.faixa), datasets: [{ data: faixas.map((f) => f.populacao), backgroundColor: '#5CB3FA', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { color: iconTextColor() } }, x: { ticks: { color: iconTextColor(), font: { size: 10 } } } } },
  });
}

function renderChartDemandaOferta(demandaEscolar, escolas) {
  destroyChart('demandaOferta');
  const el = document.getElementById('chart-demanda-oferta');
  if (!el) return;
  const matInfantil = escolas.reduce((s, e) => s + (e.matInf || 0), 0);
  const matFund = escolas.reduce((s, e) => s + (e.matFund || 0), 0);
  const matMedio = escolas.reduce((s, e) => s + (e.matMed || 0), 0);
  const etapas = [
    { label: 'Educação Infantil (0-5)', populacao: demandaEscolar.educacaoInfantil, matriculas: matInfantil },
    { label: 'Fundamental (6-14)', populacao: (demandaEscolar.fundamentalI || 0) + (demandaEscolar.fundamentalII || 0), matriculas: matFund },
    { label: 'Ensino Médio (15-17)', populacao: demandaEscolar.medio, matriculas: matMedio },
  ].filter((e) => e.populacao != null);

  charts.demandaOferta = new Chart(el, {
    type: 'bar',
    data: {
      labels: etapas.map((e) => e.label),
      datasets: [
        { label: 'População (IBGE, no município)', data: etapas.map((e) => e.populacao), backgroundColor: '#5CB3FA', borderRadius: 4 },
        { label: 'Matrículas (Censo, na região)', data: etapas.map((e) => e.matriculas), backgroundColor: '#22E29A', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: iconTextColor() } } },
      scales: { y: { beginAtZero: true, ticks: { color: iconTextColor() } }, x: { ticks: { color: iconTextColor() } } },
    },
  });
}

function renderChartProjecao(escolas, totalMat) {
  destroyChart('projecao');
  const el = document.getElementById('chart-projecao');
  if (!el) return;
  const comCrescimento = escolas.filter((e) => e.varMatPct != null);
  const taxaMedia = comCrescimento.length ? comCrescimento.reduce((s, e) => s + e.varMatPct, 0) / comCrescimento.length / 100 : 0;

  const anos = [0, 1, 3, 5];
  const central = anos.map((a) => Math.round(totalMat * Math.pow(1 + taxaMedia, a)));
  const otimista = anos.map((a) => Math.round(totalMat * Math.pow(1 + taxaMedia + 0.03, a)));
  const pessimista = anos.map((a) => Math.round(totalMat * Math.pow(1 + taxaMedia - 0.03, a)));

  charts.projecao = new Chart(el, {
    type: 'line',
    data: {
      labels: anos.map((a) => a === 0 ? 'Hoje' : `+${a} ano${a > 1 ? 's' : ''}`),
      datasets: [
        { label: 'Cenário otimista (+3pp)', data: otimista, borderColor: '#22E29A', backgroundColor: 'transparent', borderDash: [4, 4] },
        { label: `Tendência observada (${(taxaMedia * 100).toFixed(1)}%/ano)`, data: central, borderColor: '#5CB3FA', backgroundColor: 'rgba(92,179,250,0.15)', fill: true },
        { label: 'Cenário pessimista (-3pp)', data: pessimista, borderColor: '#D14848', backgroundColor: 'transparent', borderDash: [4, 4] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: iconTextColor(), font: { size: 10.5 } } } },
      scales: { y: { beginAtZero: false, ticks: { color: iconTextColor() } }, x: { ticks: { color: iconTextColor() } } },
    },
  });
}

function renderComparativoRegiao(escolas, scoreOportunidade, demografia) {
  const container = document.getElementById('comparativo-regiao');
  if (!container) return;
  container.innerHTML = '<p class="sub">Calculando comparação...</p>';

  const { entradas } = scoreOportunidade;
  const comFat = escolas.filter((e) => e.fatPotencial != null);
  const regiao = {
    ticketMedio: entradas.ticketMedio,
    fatPotencialMedio: comFat.length ? comFat.reduce((s, e) => s + e.fatPotencial, 0) / comFat.length : null,
    crescimento: entradas.crescimentoMedio,
    ociosidade: entradas.ociosaMedia,
  };

  const ufCarregada = document.getElementById('f-uf').value;
  buscarEscolas({ uf: ufCarregada, somenteAnalise: true }).then((todasUf) => {
    const comTicketUf = todasUf.filter((e) => e.mensalidade != null);
    const comFatUf = todasUf.filter((e) => e.fatPotencial != null);
    const comCrescUf = todasUf.filter((e) => e.varMatPct != null);
    const comOciosaUf = todasUf.filter((e) => e.capOciosa != null);
    const estadual = {
      ticketMedio: comTicketUf.length ? comTicketUf.reduce((s, e) => s + e.mensalidade, 0) / comTicketUf.length : null,
      fatPotencialMedio: comFatUf.length ? comFatUf.reduce((s, e) => s + e.fatPotencial, 0) / comFatUf.length : null,
      crescimento: comCrescUf.length ? comCrescUf.reduce((s, e) => s + e.varMatPct, 0) / comCrescUf.length : null,
      ociosidade: comOciosaUf.length ? comOciosaUf.reduce((s, e) => s + e.capOciosa, 0) / comOciosaUf.length : null,
    };
    const nacional = mediasNacionais ? {
      ticketMedio: mediasNacionais.ticketMedio, fatPotencialMedio: mediasNacionais.fatPotencialMedio,
      crescimento: mediasNacionais.crescimentoMatriculasMedio, ociosidade: mediasNacionais.capOciosaMedia,
    } : null;

    const metricas = [
      { chave: 'ticketMedio', label: 'Ticket médio', formatar: (v) => v != null ? fmtMoedaCompacta(v) : '-', maiorEMelhor: true },
      { chave: 'fatPotencialMedio', label: 'Faturamento potencial médio/escola', formatar: (v) => v != null ? fmtMoedaCompacta(v) : '-', maiorEMelhor: true },
      { chave: 'crescimento', label: 'Crescimento de matrículas', formatar: (v) => v != null ? v.toFixed(1) + '%' : '-', maiorEMelhor: true },
      { chave: 'ociosidade', label: 'Capacidade ociosa', formatar: (v) => v != null ? Math.round(v) + '%' : '-', maiorEMelhor: false },
    ];

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Métrica</th><th>Região selecionada</th><th>Média estadual (${ufCarregada})</th><th>Média nacional</th></tr></thead>
        <tbody>
          ${metricas.map((m) => {
            const valorRegiao = regiao[m.chave];
            const comparativos = [estadual[m.chave], nacional ? nacional[m.chave] : null].filter((v) => v != null);
            const mediaComparativos = comparativos.length ? comparativos.reduce((s, v) => s + v, 0) / comparativos.length : null;
            let seta = '';
            let corSeta = 'var(--text-muted)';
            if (valorRegiao != null && mediaComparativos != null) {
              const favoravel = m.maiorEMelhor ? valorRegiao > mediaComparativos : valorRegiao < mediaComparativos;
              const desfavoravel = m.maiorEMelhor ? valorRegiao < mediaComparativos : valorRegiao > mediaComparativos;
              if (favoravel) { seta = '<i class="fa-solid fa-arrow-up"></i>'; corSeta = 'var(--icp-alta)'; }
              else if (desfavoravel) { seta = '<i class="fa-solid fa-arrow-down"></i>'; corSeta = '#B23A3A'; }
              else { seta = '<i class="fa-solid fa-equals"></i>'; corSeta = 'var(--text-muted)'; }
            }
            return `<tr>
              <td>${m.label}</td>
              <td><strong style="color:${corSeta};">${m.formatar(valorRegiao)} ${seta}</strong></td>
              <td>${m.formatar(estadual[m.chave])}</td>
              <td>${nacional ? m.formatar(nacional[m.chave]) : '-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p class="sub" style="margin-top:8px;">
        <i class="fa-solid fa-arrow-up" style="color:var(--icp-alta);"></i> região acima da média (favorável) ·
        <i class="fa-solid fa-arrow-down" style="color:#B23A3A;"></i> região abaixo da média (desfavorável) —
        pra capacidade ociosa, "favorável" é o inverso (menos ociosidade é melhor).
      </p>
    `;
  });
}


function limparCamadasEscolas() {
  marcadoresEscolas.forEach((m) => mapa.removeLayer(m));
  marcadoresEscolas = [];
  if (camadaCalor) { mapa.removeLayer(camadaCalor); camadaCalor = null; }
}

function escolasVisiveis() {
  const censo = filtroFonte === 'osm' ? [] : ultimosResultados;
  const osm = filtroFonte === 'censo' ? [] : escolasNovasOsm;
  return [...censo, ...osm];
}

function desenharEscolasNoMapa() {
  if (!mapa) return;
  limparCamadasEscolas();
  const todas = escolasVisiveis();
  const escolas = todas.filter((e) => coordenadaValidaBrasil(e.lat, e.lon, e.uf));
  const ignoradas = todas.length - escolas.length;
  if (ignoradas > 0) {
    const msg = document.getElementById('msg-osm');
    if (msg && !msg.textContent.includes('coordenada')) {
      msg.textContent = `${msg.textContent ? `${msg.textContent} · ` : ''}${fmtInt(ignoradas)} registro(s) sem coordenada territorial confiável não foram desenhados.`;
    }
  }
  if (modoMapa === 'calor') {
    if (typeof L.heatLayer !== 'function') return; // plugin indisponível (ex: sem rede) — falha silenciosa, tabela ainda funciona
    const pontos = escolas.filter((e) => e.fatPotencial).map((e) => [Number(e.lat), Number(e.lon), Math.min(1, e.fatPotencial / 5000000)]);
    camadaCalor = L.heatLayer(pontos, { radius: 28, blur: 20, maxZoom: 15 }).addTo(mapa);
  } else {
    escolas.forEach((e) => {
      const ehOsm = e.fonte === 'osm';
      const rede = !ehOsm && identificarRede(e.nome);
      const marcador = L.circleMarker([Number(e.lat), Number(e.lon)], {
        radius: ehOsm ? 6 : 5,
        color: ehOsm ? '#E8862E' : (rede ? '#22E29A' : '#0B5C7D'),
        fillOpacity: 0.75,
      }).bindTooltip(`${e.nome}${rede ? ` (${rede})` : ''}${ehOsm ? ' — NOVA (fora do Censo)' : ''}`);
      if (!ehOsm) marcador.on('click', () => abrirPainelEscola(e.id, { onAtualizar: () => {} }));
      else marcador.bindPopup(montarPopupOsm(e));
      marcador.addTo(mapa);
      marcadoresEscolas.push(marcador);
    });
  }
}

function montarPopupOsm(e) {
  return `<div style="font-size:12px;max-width:200px;">
    <span class="badge" style="border-color:#E8862E;color:#E8862E;margin-bottom:4px;display:inline-block;">ESCOLA NOVA (fora do Censo)</span><br>
    <strong>${e.nome}</strong><br>
    ${e.endereco ? e.endereco + '<br>' : ''}
    ${e.tel ? `<a href="tel:${e.tel}">${e.tel}</a><br>` : ''}
    ${e.site ? `<a href="${e.site}" target="_blank" rel="noopener">Site</a>` : ''}
  </div>`;
}

function ligarToggleMapa() {
  document.getElementById('btn-modo-pins').addEventListener('click', () => {
    modoMapa = 'pins';
    desenharEscolasNoMapa();
  });
  document.getElementById('btn-modo-calor').addEventListener('click', () => {
    modoMapa = 'calor';
    desenharEscolasNoMapa();
  });
  document.getElementById('btn-filtro-todas').addEventListener('click', () => { filtroFonte = 'todas'; desenharEscolasNoMapa(); atualizarContadorFiltro(); });
  document.getElementById('btn-filtro-censo').addEventListener('click', () => { filtroFonte = 'censo'; desenharEscolasNoMapa(); atualizarContadorFiltro(); });
  document.getElementById('btn-filtro-osm').addEventListener('click', () => { filtroFonte = 'osm'; desenharEscolasNoMapa(); atualizarContadorFiltro(); });
}

function atualizarContadorFiltro() {
  const msg = document.getElementById('msg-osm');
  if (!msg) return;
  const visiveis = escolasVisiveis();
  msg.textContent = `Mostrando ${fmtInt(visiveis.length)} escolas (filtro: ${filtroFonte === 'todas' ? 'todas' : filtroFonte === 'censo' ? 'só Censo' : 'só novas/OSM'})`;
}

let ultimosResultados = [];

async function buscarPorEndereco() {
  const input = document.getElementById('f-endereco');
  const msg = document.getElementById('msg-osm');
  const endereco = input.value.trim();
  if (!endereco) return;
  msg.textContent = 'Buscando endereço...';
  try {
    const resultado = await geocodificarEndereco(endereco);
    if (mapa) mapa.setView([resultado.lat, resultado.lon], 14);
    definirCentro(resultado.lat, resultado.lon);
    msg.textContent = `Centralizado em: ${resultado.nomeExibicao}`;
  } catch (err) {
    msg.textContent = `Erro: ${err.message}`;
  }
}

async function buscarViaOsm() {
  const msg = document.getElementById('msg-osm');
  if (!centro) { msg.textContent = 'Marca um ponto no mapa (ou busca um endereço/município) antes de mapear.'; return; }
  const raioKm = Number(document.getElementById('f-raio').value);
  const uf = document.getElementById('f-uf').value;
  msg.textContent = `Mapeando região (raio de ${raioKm}km — pode levar alguns segundos)...`;
  const btn = document.getElementById('btn-buscar-osm');
  btn.disabled = true;
  try {
    const escolasOsm = await buscarEscolasOSM(centro.lat, centro.lon, raioKm);
    let escolasCensoParaComparar = ultimosResultados;
    if (uf && !escolasCensoParaComparar.length) {
      if (!(await ufJaImportada(uf))) await importarUF(uf, `escolas/${uf}.json`).catch(() => {});
      escolasCensoParaComparar = await buscarEscolas({ uf });
    }
    const { novas, duplicidades, totalOsm, matches } = cruzarComCenso(escolasOsm, escolasCensoParaComparar, distanciaKm);

    // o OpenStreetMap frequentemente não preenche addr:state/addr:city —
    // sem UF, a escola incorporada não apareceria ao filtrar por estado na
    // Consulta de Escolas. Completa com o contexto da busca (UF selecionada
    // e/ou município centralizado), que é uma inferência segura já que foi
    // exatamente ali que o usuário mapeou.
    const completarContexto = (e) => ({
      ...e,
      uf: e.uf || uf || null,
      municipio: e.municipio || (municipioSelecionado ? municipioSelecionado.nome : null),
    });
    const novasCompletas = novas.map(completarContexto);
    const duplicidadesCompletas = duplicidades.map(completarContexto);

    // incorpora as novas confiáveis direto na base principal — a partir de
    // agora elas existem na Consulta de Escolas, não só nesta análise
    await incorporarEscolasNaBase(novasCompletas);
    escolasNovasOsm = novasCompletas;
    escolasDuplicidade = duplicidadesCompletas;
    desenharEscolasNoMapa();

    msg.innerHTML = `
      <strong>Mapeamento em ${municipioSelecionado ? municipioSelecionado.nome : 'região marcada'} — raio de ${raioKm}km</strong><br>
      ${fmtInt(totalOsm)} escolas encontradas no OpenStreetMap<br>
      ${fmtInt(matches)} já estavam no Radar (Censo)<br>
      <strong>${fmtInt(novasCompletas.length)} novas escolas identificadas e adicionadas à base</strong>
      ${duplicidadesCompletas.length ? `<br>${fmtInt(duplicidadesCompletas.length)} possíveis duplicidades para revisão (veja abaixo)` : ''}
    `;
    renderTabelaOsm(novasCompletas, duplicidadesCompletas);
  } catch (err) {
    msg.textContent = `Erro no mapeamento via OpenStreetMap: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function renderTabelaOsm(novas, duplicidades) {
  let container = document.getElementById('card-escolas-osm');
  if (!container) {
    container = document.createElement('div');
    container.id = 'card-escolas-osm';
    container.className = 'card';
    document.getElementById('resultados-mercado').prepend(container);
  }
  const semNadaNovo = !novas.length && !(duplicidades && duplicidades.length);
  if (semNadaNovo) {
    container.innerHTML = '<h2>Mapeamento (OpenStreetMap)</h2><p class="sub">Nenhuma escola nova encontrada nesta busca — todas as escolas mapeadas na região já estavam no Radar.</p>';
    return;
  }
  container.innerHTML = `
    ${novas.length ? `
    <h2><i class="fa-solid fa-map-pin" style="color:#E8862E;"></i> Escolas novas adicionadas à base (OpenStreetMap)</h2>
    <p class="sub">Já fazem parte do Radar a partir de agora — aparecem na Base de Escolas mesmo sem reabrir esta pesquisa. Não têm matrículas ou faturamento (isso só existe pra escolas do Censo). Marcador laranja no mapa.</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Endereço</th><th>Telefone</th><th>Site</th></tr></thead>
        <tbody>
          ${novas.map((e) => `<tr data-id="${e.id}" style="cursor:pointer;">
            <td>${e.nome}</td><td>${e.tipo === 'creche' ? 'Creche' : 'Escola'}</td>
            <td>${e.endereco || '-'}</td><td>${e.tel ? `<a href="tel:${e.tel}" onclick="event.stopPropagation();">${e.tel}</a>` : '-'}</td>
            <td>${e.site ? `<a href="${e.site}" target="_blank" rel="noopener" onclick="event.stopPropagation();">Abrir</a>` : '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${duplicidades && duplicidades.length ? `
    <h2 style="margin-top:${novas.length ? '16px' : '0'};"><i class="fa-solid fa-triangle-exclamation" style="color:#EDA100;"></i> Possíveis duplicidades (não adicionadas — revisão manual)</h2>
    <p class="sub">Nome ou localização parecidos com uma escola que já existe no Radar, mas não o suficiente pra ter certeza. Confira e decida se é a mesma escola ou não.</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Nome (OpenStreetMap)</th><th>Possível correspondência já no Radar</th><th>Distância</th><th>Ação</th></tr></thead>
        <tbody>
          ${duplicidades.map((d, i) => `<tr>
            <td>${d.nome}</td><td>${d.possivelCorrespondencia}</td>
            <td>${d.distanciaCorrespondencia != null ? d.distanciaCorrespondencia.toFixed(2) + 'km' : '-'}</td>
            <td><button class="btn" data-confirmar-nova="${i}" style="padding:3px 10px;font-size:11px;">É diferente, adicionar</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;
  container.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => abrirPainelEscola(Number(tr.dataset.id), { onAtualizar: () => {} }));
  });
  container.querySelectorAll('[data-confirmar-nova]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = escolasDuplicidade[Number(btn.dataset.confirmarNova)];
      if (!item) return;
      await incorporarEscolasNaBase([item]);
      escolasNovasOsm = [...escolasNovasOsm, item];
      btn.closest('tr').innerHTML = `<td colspan="4" class="sub">Adicionada à base.</td>`;
      desenharEscolasNoMapa();
    });
  });
}

async function abrirModalSalvarRegiao() {
  const msg = document.getElementById('msg-osm');
  if (!centro) { msg.textContent = 'Marca um ponto e analisa a região antes de salvar.'; return; }
  const nome = prompt('Nome para esta região (ex: "Zona Sul SP — 5km"):');
  if (!nome) return;
  const raioKm = Number(document.getElementById('f-raio').value);
  const uf = document.getElementById('f-uf').value;
  const escolas = [...ultimosResultados, ...escolasNovasOsm];
  try {
    await salvarRegiao({ nome, centro, raioKm, uf, escolas, totalCenso: ultimosResultados.length, totalOsm: escolasNovasOsm.length });
    msg.textContent = `Região "${nome}" salva.`;
    renderRegioesSalvas();
  } catch (err) {
    msg.textContent = `Erro ao salvar: ${err.message}`;
  }
}

async function renderRegioesSalvas() {
  const container = document.getElementById('lista-regioes-salvas');
  if (!container) return;
  const regioes = await listarRegioesSalvas();
  if (!regioes.length) {
    container.innerHTML = '<p class="sub">Nenhum mapeamento salvo no histórico ainda — mapeia uma região e clica em "Salvar no histórico de mapeamentos".</p>';
    return;
  }
  container.innerHTML = regioes.map((r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
      <div>
        <strong>${r.nome}</strong>
        <div class="sub" style="margin:0;">${r.uf || ''} · raio ${r.raioKm}km · ${fmtInt(r.totalEscolas)} escolas (${fmtInt(r.totalCenso)} Censo + ${fmtInt(r.totalOsm)} novas) · ${new Date(r.dataPesquisa).toLocaleDateString('pt-BR')}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn" data-carregar="${r.id}" style="padding:4px 10px;font-size:11.5px;">Carregar</button>
        <button class="btn" data-exportar="${r.id}" style="padding:4px 10px;font-size:11.5px;">Exportar</button>
        <button class="btn" data-deletar="${r.id}" style="padding:4px 10px;font-size:11.5px;color:var(--danger);">Excluir</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-carregar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const regiao = regioes.find((r) => r.id === btn.dataset.carregar);
      if (!regiao) return;
      ultimosResultados = regiao.escolas.filter((e) => e.fonte !== 'osm');
      escolasNovasOsm = regiao.escolas.filter((e) => e.fonte === 'osm');
      definirCentro(regiao.centro.lat, regiao.centro.lon);
      if (mapa) mapa.setView([regiao.centro.lat, regiao.centro.lon], 12);
      document.getElementById('f-raio').value = regiao.raioKm;
      document.getElementById('valor-raio').textContent = regiao.raioKm;
      desenharEscolasNoMapa();
      renderResultados(ultimosResultados, regiao.raioKm, null, null, '');
      renderTabelaOsm(escolasNovasOsm);
      document.getElementById('msg-osm').textContent = `Região "${regiao.nome}" carregada (sem nova chamada de API).`;
    });
  });
  container.querySelectorAll('[data-exportar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const regiao = regioes.find((r) => r.id === btn.dataset.exportar);
      if (regiao) exportarRegiaoJson(regiao);
    });
  });
  container.querySelectorAll('[data-deletar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta região salva?')) return;
      await deletarRegiao(btn.dataset.deletar);
      renderRegioesSalvas();
    });
  });
}

function ligarFiltros() {
  document.getElementById('f-uf').addEventListener('change', (e) => {
    const uf = e.target.value;
    municipioSelecionado = null;
    document.getElementById('btn-usar-capital').disabled = !uf;
    if (uf) popularMunicipios(uf);
    else {
      document.getElementById('f-municipio').innerHTML = '<option value="">Selecione a UF primeiro</option>';
      document.getElementById('f-municipio').disabled = true;
    }
  });
  document.getElementById('f-municipio').addEventListener('change', (e) => {
    const select = e.target;
    if (!select.value) { municipioSelecionado = null; return; }
    const municipios = JSON.parse(select.dataset.municipios || '[]');
    const m = municipios.find((mm) => String(mm.id) === select.value);
    const uf = document.getElementById('f-uf').value;
    if (m) centralizarNoMunicipio(uf, m.nome, m.id);
  });
  document.getElementById('f-raio').addEventListener('input', (e) => {
    document.getElementById('valor-raio').textContent = e.target.value;
    desenharCirculo();
  });
  document.getElementById('f-escopo').addEventListener('change', aplicarEscopoNaInterface);
  document.getElementById('f-regiao').addEventListener('change', aplicarEscopoNaInterface);
  document.getElementById('btn-usar-capital').addEventListener('click', usarCapitalSelecionada);
  document.getElementById('btn-analisar').addEventListener('click', mapearRegiao);
  document.getElementById('btn-buscar-endereco').addEventListener('click', buscarPorEndereco);
  document.getElementById('btn-buscar-osm').addEventListener('click', buscarViaOsm);
  document.getElementById('btn-salvar-regiao').addEventListener('click', abrirModalSalvarRegiao);
  aplicarEscopoNaInterface();
}

function preencherUfsPermitidas(permitidas = null) {
  const select = document.getElementById('f-uf');
  const valorAtual = select.value;
  const lista = permitidas || UFS;
  select.innerHTML = `<option value="">${permitidas ? 'Selecione um estado da região' : 'Selecione'}</option>${lista.map((uf) => `<option>${uf}</option>`).join('')}`;
  if (lista.includes(valorAtual)) select.value = valorAtual;
  else {
    municipioSelecionado = null;
    document.getElementById('f-municipio').innerHTML = '<option value="">Selecione a UF primeiro</option>';
    document.getElementById('f-municipio').disabled = true;
  }
  document.getElementById('btn-usar-capital').disabled = !select.value;
}

async function usarCapitalSelecionada() {
  const uf = document.getElementById('f-uf').value;
  if (!uf || !CAPITAIS[uf]) return;
  const select = document.getElementById('f-municipio');
  if (select.disabled || !select.dataset.municipios) await popularMunicipios(uf);
  const municipios = JSON.parse(select.dataset.municipios || '[]');
  const capital = municipios.find((m) => m.nome.localeCompare(CAPITAIS[uf], 'pt-BR', { sensitivity: 'base' }) === 0);
  if (!capital) return;
  select.value = String(capital.id);
  await centralizarNoMunicipio(uf, capital.nome, capital.id);
  document.getElementById('msg-osm').textContent = `Funil refinado para ${capital.nome}/${uf}. Agora você pode descobrir novas escolas no raio ou trocar o escopo para analisar só este ponto.`;
}

function atualizarDisponibilidadeDescoberta() {
  const btn = document.getElementById('btn-buscar-osm');
  if (!btn) return;
  btn.disabled = !centro;
  btn.title = centro ? 'Busca novas escolas no raio definido' : 'Selecione município/capital, busque um endereço ou marque um ponto no mapa';
}

/** Mantém o funil inteiro disponível ao trocar o escopo. */
function aplicarEscopoNaInterface() {
  const escopo = document.getElementById('f-escopo').value;
  document.getElementById('campo-regiao').classList.toggle('hidden', escopo !== 'regiao');
  const permitidas = escopo === 'regiao' ? ufsDaRegiao(document.getElementById('f-regiao').value) : null;
  preencherUfsPermitidas(permitidas);
  document.getElementById('btn-analisar').textContent = escopo === 'regiao' ? 'Analisar Grande Região' : escopo === 'uf' ? 'Analisar estado' : 'Analisar ponto/raio';
  document.getElementById('instrucao-mapa').textContent = escopo === 'raio'
    ? 'Escolha UF e município, use uma capital, busque um endereço ou marque um ponto. O funil permanece aberto para você voltar a estado ou Grande Região.'
    : escopo === 'uf'
      ? 'Analise o estado inteiro ou continue refinando por município, capital, endereço e raio para descobrir novas escolas sem perder o contexto estadual.'
      : 'Analise a Grande Região e continue o funil escolhendo um estado, capital/município, endereço e raio. Nenhum campo desaparece.';
  atualizarDisponibilidadeDescoberta();
}

async function aplicarParametrosUrl() {
  const params = new URLSearchParams(window.location.search);
  const uf = params.get('uf');
  const municipioNome = params.get('municipio');
  const lat = params.get('lat');
  const lon = params.get('lon');

  if (lat && lon) {
    definirCentro(Number(lat), Number(lon));
    if (mapa) mapa.setView([Number(lat), Number(lon)], 12);
  }
  if (uf) {
    const selectUf = document.getElementById('f-uf');
    selectUf.value = uf;
    await popularMunicipios(uf);
    if (municipioNome) {
      const selectMunicipio = document.getElementById('f-municipio');
      const municipios = JSON.parse(selectMunicipio.dataset.municipios || '[]');
      const match = municipios.find((m) => m.nome.toLowerCase() === municipioNome.toLowerCase());
      if (match) {
        selectMunicipio.value = String(match.id);
        // já temos lat/lon exatos vindos do Dashboard — não precisa recalcular
        // o centro pela mediana das escolas, só registra qual município é
        // (pra trazer os dados do IBGE) sem mover o mapa de novo
        municipioSelecionado = { id: match.id, nome: match.nome, uf };
      }
    }
  }
  if (lat && lon) {
    document.getElementById('msg-osm').textContent = `Centralizado em ${municipioNome || 'região'}/${uf || ''} — clique em "Mapear região" pra analisar.`;
  }
}

function init() {
  skeleton();
  initMapa();
  ligarFiltros();
  ligarToggleMapa();
  renderRegioesSalvas();
  aplicarParametrosUrl();
}

init();
