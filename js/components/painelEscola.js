import { getEscolaById, buscarConcorrentesNaRegiao, calcularPosicaoNaRegiao, buscarCorrespondenciasInep } from '../services/escolaService.js';
import {
  getCrm, salvarObservacoes,
  listarDocumentos, adicionarDocumento, removerDocumento,
} from '../services/crmService.js';
import { buscarDadosCnpj, getEnriquecimentoCache } from '../services/enriquecimentoService.js';
import { fmtInt, fmtMoedaCompacta, labelPorte } from '../utils/formatters.js';
import { chaveConfigurada, gerarComIA, TIPOS_ANALISE_IA } from '../services/aiService.js';
import { buscaSocialConfigurada, buscarRedesSociais } from '../services/socialSearchService.js';
import { chaveConfiguradaParaPesquisa, getPesquisaSalva, pesquisarMercado } from '../services/marketResearchService.js';
import { calcularCompletude, corNivel } from '../services/dataQualityService.js';
import { buscarCandidatosCnpj } from '../services/cnpjCandidateService.js';
import { put } from '../services/db.js';
import { coordenadaValidaBrasil } from '../utils/geo.js';
import { buscarSerieEscola, buscarDiagnosticoMunicipio } from '../services/inteligenciaService.js';

// Estrutura em 4 blocos, sem ICP (removido de propósito — o ICP media o
// perfil do responsável de uma escola específica, não é útil pra decidir
// se vale prospectar; ver docs/README.md).
const ABAS = [
  { chave: 'visaoGeral', label: 'Visão Geral' },
  { chave: 'contato', label: 'Contato' },
  { chave: 'institucional', label: 'Institucional' },
  { chave: 'escola', label: 'Escola' },
  { chave: 'inteligencia', label: 'Inteligência' },
  { chave: 'evolucao', label: 'Evolução 2019–2025' },
  { chave: 'observacoes', label: 'Observações' },
  { chave: 'documentos', label: 'Documentos' },
];

let estado = null; // guarda escola/crm/tags/interacoes/etc. carregados para a escola aberta no momento

export async function abrirPainelEscola(escolaId, { onAtualizar } = {}) {
  fecharPainelEscola();

  const escola = await getEscolaById(escolaId);
  if (!escola) return;

  estado = {
    escola,
    crm: await getCrm(escolaId),
    documentos: await listarDocumentos(escolaId),
    enriquecimento: await getEnriquecimentoCache(escola.cnpj),
    candidatosCnpj: await buscarCandidatosCnpj(escola),
    onAtualizar,
  };

  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.id = 'painel-escola-overlay';
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-header">
        <div>
          <h2>${escola.nome}</h2>
          <div class="drawer-meta">${escola.municipio}/${escola.uf} · ${labelPorte(escola.porte)}</div>
        </div>
        <button class="btn-fechar" id="btn-fechar-painel" aria-label="Fechar">&times;</button>
      </div>

      <div class="drawer-badges" id="drawer-badges"></div>

      <div class="tab-bar" id="tab-bar">
        ${ABAS.map((a, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-aba="${a.chave}">${a.label}</button>`).join('')}
      </div>

      ${ABAS.map((a, i) => `<div class="tab-panel ${i === 0 ? 'active' : ''}" id="painel-${a.chave}"></div>`).join('')}
    </div>
  `;
  document.body.appendChild(overlay);

  renderBadges();
  renderVisaoGeral();
  renderContato();
  renderInstitucional();
  renderEscola();
  renderInteligencia();
  renderEvolucao();
  renderObservacoes();
  renderDocumentos();

  overlay.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      overlay.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`painel-${btn.dataset.aba}`).classList.add('active');
    });
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharPainelEscola(); });
  document.getElementById('btn-fechar-painel').addEventListener('click', fecharPainelEscola);
  document.addEventListener('keydown', escHandler);
}

function escHandler(e) {
  if (e.key === 'Escape') fecharPainelEscola();
}

export function fecharPainelEscola() {
  const existente = document.getElementById('painel-escola-overlay');
  if (existente) existente.remove();
  document.removeEventListener('keydown', escHandler);
  estado = null;
}

function notificarAtualizacao() {
  if (estado && estado.onAtualizar) estado.onAtualizar();
}

// =====================================================================
// Badges (topo, visível em todas as abas)
// =====================================================================
function renderBadges() {
  const { escola } = estado;
  const completude = calcularCompletude(escola);
  document.getElementById('drawer-badges').innerHTML = `
    <span class="badge" style="border-color:${corNivel(completude.nivel)};color:${corNivel(completude.nivel)};">Dados: ${completude.nivel} (${completude.percentual}%)</span>
    <span class="badge">${escola.fonte === 'osm' ? 'Origem: OpenStreetMap' : 'Origem: Censo INEP'}</span>
    ${escola.mat25 != null ? `<span class="badge">${fmtInt(escola.mat25)} matrículas</span>` : ''}
    ${escola.fatPotencial != null ? `<span class="badge">${fmtMoedaCompacta(escola.fatPotencial)}/ano potencial</span>` : ''}
    ${escola.sinalMat ? `<span class="badge">${escola.sinalMat}</span>` : ''}
  `;
}

// =====================================================================
// Aba: Resumo (dados institucionais + enriquecimento por CNPJ + IA)
// =====================================================================
function montarLinkMaps(escola) {
  if (coordenadaValidaBrasil(escola.lat, escola.lon, escola.uf)) {
    return `https://www.google.com/maps?q=${escola.lat},${escola.lon}`;
  }
  const consulta = `${escola.nome}, ${escola.endereco || ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

function renderVisaoGeral() {
  const { escola, enriquecimento } = estado;
  const painel = document.getElementById('painel-visaoGeral');
  const completude = calcularCompletude(escola);
  painel.innerHTML = `
    ${escola.qualidadeIdentidade ? `<div class="drawer-section">
      <h3>Triagem de identidade</h3>
      <p><span class="badge">${escola.qualidadeIdentidade.status.replaceAll('_', ' ')}</span>
      <span class="badge">Confiança: ${escola.qualidadeIdentidade.confianca}</span></p>
      <p class="sub" style="margin-top:8px;">${(escola.qualidadeIdentidade.evidencias || []).join(' · ')}</p>
      <p class="sub">Triagem automática conservadora; confirme a natureza privada e a atividade antes de usar comercialmente.</p>
    </div>` : ''}
    <div class="drawer-section">
      <h3>Identificação</h3>
      <div class="info-grid">
        <div><span class="k">Nome fantasia:</span> ${enriquecimento?.nomeFantasia || escola.nome}</div>
        <div><span class="k">Razão social:</span> ${enriquecimento?.razaoSocial || '-'}</div>
        <div><span class="k">Situação cadastral:</span> ${enriquecimento?.situacaoCadastral || '-'}</div>
        <div><span class="k">Código INEP:</span> ${escola.fonte === 'osm' ? 'Não tem (fora do Censo)' : escola.id}</div>
        <div><span class="k">CNPJ:</span> ${escola.cnpj || '-'}</div>
        <div><span class="k">Origem do registro:</span> ${escola.fonte === 'osm' ? 'OpenStreetMap (mapeamento próprio)' : 'Censo Escolar INEP'}</div>
      </div>
    </div>
    <div class="drawer-section">
      <h3>Localização</h3>
      <div class="info-grid">
        <div><span class="k">Município/UF:</span> ${escola.municipio}/${escola.uf}</div>
        <div><span class="k">CEP:</span> ${escola.cep || '-'}</div>
        <div style="grid-column: 1 / -1;">
          <span class="k">Endereço:</span> ${escola.endereco || '-'}
          <a class="btn" style="margin-left:8px;padding:3px 10px;font-size:11.5px;" href="${montarLinkMaps(escola)}" target="_blank" rel="noopener">
            <i class="fa-solid fa-map-location-dot"></i> Abrir no Maps
          </a>
        </div>
      </div>
    </div>
    <div class="drawer-section">
      <h3>Completude da ficha</h3>
      <div style="background:var(--bg-surface-2);border-radius:6px;overflow:hidden;margin-bottom:6px;">
        <div style="width:${completude.percentual}%;background:${corNivel(completude.nivel)};height:18px;"></div>
      </div>
      <p class="sub" style="margin:0;">${completude.nivel} — ${completude.percentual}% dos campos-chave preenchidos. Descoberta: ${completude.estagios.descoberta}% · Identificação: ${completude.estagios.identificacao}% · Institucional: ${completude.estagios.institucional}% · Análise: ${completude.estagios.analise}%</p>
    </div>
  `;
}

function renderContato() {
  const { escola, crm, enriquecimento } = estado;
  const painel = document.getElementById('painel-contato');
  const dados = { site: escola.site || '', instagram: escola.instagram || '', ...(crm.marketingDigital || {}) };
  const emailInstitucional = enriquecimento?.email || escola.email || '';
  const telefoneInstitucional = escola.tel || enriquecimento?.telefone || '';
  const consultaBase = encodeURIComponent(`"${escola.nome}" "${escola.municipio}" ${escola.uf || ''}`);
  const telefoneWhatsApp = String(telefoneInstitucional).split('/')[0].replace(/\D/g, '');
  const telefoneComPais = telefoneWhatsApp.length <= 9
    ? `55${String(escola.ddd || '').replace(/\D/g, '')}${telefoneWhatsApp}`
    : telefoneWhatsApp.length <= 11 ? `55${telefoneWhatsApp}` : telefoneWhatsApp;
  const whatsappInstitucionalUrl = telefoneWhatsApp ? `https://wa.me/${telefoneComPais}` : null;

  painel.innerHTML = `
    <div class="drawer-section">
      ${whatsappInstitucionalUrl
        ? `<a class="btn btn-primary" style="background:#25D366;border-color:#25D366;font-size:14px;padding:10px 18px;" href="${whatsappInstitucionalUrl}" target="_blank" rel="noopener">
             <i class="fa-brands fa-whatsapp"></i> Chamar no WhatsApp (institucional)
           </a>`
        : '<span class="badge">Sem telefone cadastrado — sem WhatsApp institucional disponível</span>'}
    </div>
    <div class="drawer-section">
      <h3>Canais</h3>
      <div class="info-grid">
        <div><span class="k">Telefone:</span> ${telefoneInstitucional ? `<a href="tel:${String(telefoneInstitucional).replace(/[^\d+]/g, '')}"><i class="fa-solid fa-phone"></i> ${escola.ddd && escola.tel ? `(${escola.ddd}) ` : ''}${telefoneInstitucional}</a>` : '-'}</div>
        <div><span class="k">E-mail institucional:</span> ${emailInstitucional ? `<a href="mailto:${emailInstitucional}"><i class="fa-solid fa-envelope"></i> ${emailInstitucional}</a>` : '-'}</div>
        <div><span class="k">Site:</span> ${dados.site ? `<a href="${dados.site}" target="_blank" rel="noopener">${dados.site}</a>` : '-'}</div>
        <div><span class="k">Instagram:</span> ${dados.instagram ? `<a href="${dados.instagram}" target="_blank" rel="noopener">${dados.instagram}</a>` : '-'}</div>
      </div>
    </div>
    <div class="drawer-section">
      <h3>Busca automática (sugestão)</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;" id="texto-busca-automatica">Carregando...</p>
      <button class="btn" id="btn-buscar-social">Buscar automaticamente</button>
      <span class="loading-bar" id="msg-busca-social"></span>
      <p class="sub" style="margin-top:10px;">Investigação gratuita assistida:
        <a href="https://www.google.com/search?q=${consultaBase}" target="_blank" rel="noopener">web</a> ·
        <a href="https://www.google.com/maps/search/?api=1&query=${consultaBase}" target="_blank" rel="noopener">Google Maps</a> ·
        <a href="https://www.google.com/search?q=site%3Ainstagram.com+${consultaBase}" target="_blank" rel="noopener">Instagram</a> ·
        <a href="https://www.google.com/search?q=site%3Afacebook.com+${consultaBase}" target="_blank" rel="noopener">Facebook</a> ·
        <a href="https://www.google.com/search?q=site%3Alinkedin.com+${consultaBase}" target="_blank" rel="noopener">LinkedIn</a>
      </p>
    </div>
    <div class="drawer-section">
      <h3>Editar links</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">Site e Instagram ajudam a validar a identidade e a presença pública da instituição.</p>
      ${CAMPOS_MARKETING.map((c) => `
        <div style="margin-bottom:8px;">
          <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;"><i class="${c.icone}"></i> ${c.label}</label>
          <input type="text" id="f-mkt-${c.chave}" value="${dados[c.chave] || ''}" placeholder="https://..." style="width:100%;padding:7px 9px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary);">
        </div>
      `).join('')}
      <button class="btn btn-primary" id="btn-salvar-marketing">Salvar</button>
      <span class="loading-bar" id="msg-marketing"></span>
    </div>
  `;
  montarBuscaAutomatica();
  document.getElementById('btn-salvar-marketing').addEventListener('click', async () => {
    const novoMarketing = { ...estado.crm.marketingDigital };
    CAMPOS_MARKETING.forEach((c) => { novoMarketing[c.chave] = document.getElementById(`f-mkt-${c.chave}`).value.trim(); });
    estado.crm.marketingDigital = novoMarketing;
    await salvarMarketingDigital();
    document.getElementById('msg-marketing').textContent = 'Salvo.';
    renderContato();
    renderVisaoGeral();
    setTimeout(() => { const m = document.getElementById('msg-marketing'); if (m) m.textContent = ''; }, 1500);
  });
}

function renderInstitucional() {
  const painel = document.getElementById('painel-institucional');
  if (!painel) return;
  const { crm, escola, enriquecimento: e, candidatosCnpj = [] } = estado;

  painel.innerHTML = `
    <div class="drawer-section">
      <h3>Busca automática sem custo</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">
        Cruza esta ficha com o Censo INEP já carregado e com os candidatos da base pública de CNPJ. Resultados são sugestões: nenhuma identidade é confirmada sem sua revisão.
      </p>
      <button class="btn btn-primary" id="btn-enriquecer-automatico">Buscar informações desta escola</button>
      <span class="loading-bar" id="msg-enriquecimento-auto"></span>
      <div id="resultado-enriquecimento-auto" style="margin-top:10px;"></div>
    </div>
    <div class="drawer-section">
      <h3>CNPJ</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">
        ${escola.cnpj ? 'Vem do Censo/mapeamento — edite aqui se encontrar um CNPJ diferente ou mais correto.' : 'Esta escola não tem CNPJ na fonte original (comum em escolas descobertas via mapeamento) — cole aqui assim que encontrar, pra habilitar a busca de dados institucionais abaixo.'}
      </p>
      <div class="field-row">
        <div><label>CNPJ</label><input type="text" id="f-cnpj-escola" value="${escola.cnpj || ''}" placeholder="00.000.000/0000-00"></div>
      </div>
      <button class="btn btn-primary" id="btn-salvar-cnpj">Salvar CNPJ</button>
      <span class="loading-bar" id="msg-cnpj-salvar"></span>
      ${!escola.cnpj && candidatosCnpj.length ? `
        <div style="margin-top:14px;">
          <h4 style="margin-bottom:6px;">Possíveis correspondências na Receita Federal</h4>
          <p class="sub">São sugestões geradas por nome, município, CEP e CNAE. Confirme visualmente antes de aplicar.</p>
          ${candidatosCnpj.map((c, indice) => `
            <div class="interacao-item" style="margin-top:8px;">
              <div><strong>${c.nomeFantasia || c.razaoSocial || c.cnpj}</strong> <span class="badge">${c.score}% de aderência</span></div>
              <div class="meta">${c.razaoSocial || ''}${c.cnae ? ` · CNAE ${c.cnae}` : ''}${c.cep ? ` · CEP ${c.cep}` : ''}</div>
              ${(c.telefone || c.email) ? `<div class="meta">Contato público da Receita: ${c.telefone || 'sem telefone'}${c.email ? ` · ${c.email}` : ''}</div>` : ''}
              ${(c.porteJuridico || c.capitalSocial) ? `<div class="meta">Porte jurídico: ${c.porteJuridico || '-'} · capital social: ${c.capitalSocial || '-'}</div>` : ''}
              <div class="meta">CNPJ ${c.cnpj} · ${(c.evidencias || []).join(' · ')}</div>
              <button class="btn" data-aplicar-cnpj="${indice}" style="margin-top:6px;">Confirmar e aplicar este CNPJ</button>
            </div>
          `).join('')}
        </div>` : ''}
    </div>

    <div class="drawer-section">
      <h3>Dados institucionais (Receita Federal)</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">
        Fonte pública (BrasilAPI/CNPJ), sem dados privados. CPF de sócios sempre mascarado pela própria fonte.
      </p>
      <div id="area-institucional-detalhe">
        ${!e ? '<p style="font-size:12.5px;color:var(--text-muted);">Ainda não buscado.</p>' : `
          <div class="info-grid">
            <div><span class="k">Data de abertura:</span> ${e.dataAbertura || '-'}</div>
            <div><span class="k">Natureza jurídica:</span> ${e.naturezaJuridica || '-'}</div>
            <div><span class="k">Capital social:</span> ${e.capitalSocial != null ? fmtMoedaCompacta(e.capitalSocial) : '-'}</div>
            <div><span class="k">CNAE principal:</span> ${e.cnaeFiscal || '-'}</div>
          </div>
          ${e.cnaesSecundarios && e.cnaesSecundarios.length ? `<p style="font-size:11.5px;margin-top:8px;"><span class="k">CNAEs secundários:</span> ${e.cnaesSecundarios.join('; ')}</p>` : ''}
          <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Buscado em ${new Date(e.buscadoEm).toLocaleString('pt-BR')}</p>
        `}
      </div>
      <button class="btn" id="btn-buscar-cnpj" style="margin-top:8px;" ${!escola.cnpj ? 'disabled' : ''}>
        ${e ? 'Atualizar dados institucionais' : 'Buscar dados institucionais (CNPJ)'}
      </button>
      ${!escola.cnpj ? '<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Salve um CNPJ acima primeiro.</p>' : ''}
      <span class="loading-bar" id="msg-cnpj"></span>
    </div>

    ${!e
      ? '<div class="drawer-section"><p style="font-size:12.5px;color:var(--text-muted);">Busque os dados institucionais acima pra carregar o quadro de sócios (fonte pública).</p></div>'
      : (!e.socios || !e.socios.length)
        ? '<div class="drawer-section"><p style="font-size:12.5px;color:var(--text-muted);">Nenhum sócio/administrador disponível na fonte pública para este CNPJ.</p></div>'
        : `<div class="drawer-section">
            <h3>Sócios e administradores (Receita Federal)</h3>
            ${e.socios.map((s) => `
              <div class="interacao-item">
                <div><strong>${s.nome}</strong></div>
                <div class="meta">${s.qualificacao || 'Qualificação não informada'}${s.dataEntrada ? ' · desde ' + s.dataEntrada : ''}${s.cpfMascarado ? ' · ' + s.cpfMascarado : ''}</div>
              </div>`).join('')}
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Fonte: Receita Federal (BrasilAPI). Dados exclusivamente públicos, CPF mascarado pela fonte.</p>
          </div>`
    }
  `;

  document.getElementById('btn-enriquecer-automatico').addEventListener('click', buscarEnriquecimentoAutomatico);

  document.getElementById('btn-salvar-cnpj').addEventListener('click', async () => {
    const msg = document.getElementById('msg-cnpj-salvar');
    const valor = document.getElementById('f-cnpj-escola').value.trim();
    estado.escola.cnpj = valor || null;
    if (valor && estado.escola.fonte === 'osm') {
      estado.escola.qualidadeIdentidade = {
        status: 'identidade_confirmada_cnpj',
        confianca: 'alta',
        incluirAnalise: true,
        evidencias: [...new Set([...(estado.escola.qualidadeIdentidade?.evidencias || []), 'CNPJ confirmado manualmente'])],
      };
    }
    await put('escolas', estado.escola); // salva na escola de verdade, não só no CRM — assim aparece na Base de Escolas e na Central de Enriquecimento também
    msg.textContent = 'Salvo.';
    renderInstitucional();
    renderVisaoGeral();
    renderBadges();
    notificarAtualizacao();
    setTimeout(() => { const m = document.getElementById('msg-cnpj-salvar'); if (m) m.textContent = ''; }, 1500);
  });
  painel.querySelectorAll('[data-aplicar-cnpj]').forEach((botao) => {
    botao.addEventListener('click', async () => {
      const candidato = candidatosCnpj[Number(botao.dataset.aplicarCnpj)];
      if (!candidato) return;
      estado.escola.cnpj = candidato.cnpj;
      estado.escola.qualidadeIdentidade = {
        status: 'identidade_confirmada_cnpj',
        confianca: 'alta',
        incluirAnalise: true,
        evidencias: [...new Set([...(estado.escola.qualidadeIdentidade?.evidencias || []), `CNPJ ${candidato.cnpj} confirmado a partir de candidato da Receita Federal`])],
      };
      estado.candidatosCnpj = [];
      await put('escolas', estado.escola);
      renderInstitucional();
      renderVisaoGeral();
      renderBadges();
      notificarAtualizacao();
    });
  });
  document.getElementById('btn-buscar-cnpj').addEventListener('click', () => buscarCnpjEAtualizar(true));
  if (!e && escola.cnpj) buscarCnpjEAtualizar(false);
}

async function buscarEnriquecimentoAutomatico() {
  const btn = document.getElementById('btn-enriquecer-automatico');
  const msg = document.getElementById('msg-enriquecimento-auto');
  const resultado = document.getElementById('resultado-enriquecimento-auto');
  btn.disabled = true;
  msg.textContent = 'Cruzando fontes públicas e a base local...';
  try {
    if (estado.escola.cnpj) {
      estado.enriquecimento = await buscarDadosCnpj(estado.escola.cnpj);
    }
    estado.candidatosCnpj = await buscarCandidatosCnpj(estado.escola);
    const correspondencias = estado.escola.fonte === 'osm' ? await buscarCorrespondenciasInep(estado.escola) : [];
    const links = [
      { label: 'Consultar no Catálogo de Escolas do INEP', url: 'https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/inep-data/catalogo-de-escolas' },
      { label: 'Consultar comprovante oficial de CNPJ', url: 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp' },
    ];
    resultado.innerHTML = `
      ${estado.enriquecimento ? '<p><span class="badge">CNPJ consultado</span> Dados institucionais públicos atualizados.</p>' : ''}
      ${correspondencias.length ? `
        <h4>Possíveis correspondências no Censo INEP</h4>
        ${correspondencias.map((r, i) => `<div class="interacao-item" style="margin-top:7px;">
          <div><strong>${r.escola.nome}</strong> <span class="badge">${r.score}% de aderência</span></div>
          <div class="meta">Código INEP ${r.escola.id} · ${r.escola.municipio}/${r.escola.uf} · ${(r.evidencias || []).join(' · ')}</div>
          <div class="meta">${r.escola.mat25 != null ? `${fmtInt(r.escola.mat25)} matrículas · ${labelPorte(r.escola.porte)}` : 'sem matrículas disponíveis'}${r.escola.cnpj ? ` · CNPJ ${r.escola.cnpj}` : ''}</div>
          <button class="btn" data-aplicar-inep="${i}" style="margin-top:6px;">Confirmar vínculo e aplicar dados oficiais</button>
        </div>`).join('')}`
        : '<p class="sub">Nenhuma correspondência suficientemente segura foi encontrada no Censo já carregado.</p>'}
      ${estado.candidatosCnpj.length ? `<p><span class="badge">${estado.candidatosCnpj.length} candidato(s) de CNPJ</span> Veja as sugestões no bloco CNPJ abaixo.</p>` : ''}
      <p class="sub" style="margin-top:10px;">Verificação manual oficial: ${links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join(' · ')}</p>
      <p class="sub">Matrículas e porte vêm do INEP. Capital social e situação cadastral vêm da Receita. Ticket e faturamento permanecem estimativas — não são valores declarados pela escola.</p>
    `;
    resultado.querySelectorAll('[data-aplicar-inep]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const match = correspondencias[Number(botao.dataset.aplicarInep)];
        if (!match) return;
        const oficial = match.escola;
        const campos = ['cnpj','cnpjMant','porte','mat25','mat24','matInf','matFund','matMed','matEja','matTec','mensalidade','fatPotencial','capOciosa','varMatPct','sinalMat','mudancaPorte','temRegular','temEja','temProf','temEad'];
        campos.forEach((campo) => { if (oficial[campo] != null) estado.escola[campo] = oficial[campo]; });
        estado.escola.codigoInepVinculado = oficial.id;
        estado.escola.qualidadeIdentidade = {
          status: 'vinculada_ao_censo_inep', confianca: 'alta', incluirAnalise: false,
          evidencias: [...new Set([...(estado.escola.qualidadeIdentidade?.evidencias || []), `Vínculo com código INEP ${oficial.id} confirmado manualmente`])],
        };
        await put('escolas', estado.escola);
        estado.candidatosCnpj = await buscarCandidatosCnpj(estado.escola);
        if (estado.escola.cnpj) estado.enriquecimento = await buscarDadosCnpj(estado.escola.cnpj).catch(() => estado.enriquecimento);
        renderInstitucional(); renderEscola(); renderVisaoGeral(); renderBadges(); notificarAtualizacao();
      });
    });
    msg.textContent = 'Busca concluída.';
  } catch (err) {
    msg.textContent = `Erro: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function buscarCnpjEAtualizar(forcar) {
  const btn = document.getElementById('btn-buscar-cnpj');
  const msg = document.getElementById('msg-cnpj');
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = 'Buscando...';
  try {
    estado.enriquecimento = await buscarDadosCnpj(estado.escola.cnpj, { forcarAtualizacao: forcar });
    let escolaAlterada = false;
    if (!estado.escola.tel && estado.enriquecimento.telefone) { estado.escola.tel = estado.enriquecimento.telefone.split('/')[0].trim(); escolaAlterada = true; }
    if (!estado.escola.email && estado.enriquecimento.email) { estado.escola.email = estado.enriquecimento.email; escolaAlterada = true; }
    estado.escola.dadosPJ = {
      razaoSocial: estado.enriquecimento.razaoSocial,
      nomeFantasia: estado.enriquecimento.nomeFantasia,
      situacaoCadastral: estado.enriquecimento.situacaoCadastral,
      capitalSocial: estado.enriquecimento.capitalSocial,
      naturezaJuridica: estado.enriquecimento.naturezaJuridica,
      fonte: 'Receita Federal/BrasilAPI',
    };
    escolaAlterada = true;
    if (escolaAlterada) await put('escolas', estado.escola);
    renderInstitucional();
    renderVisaoGeral();
    renderContato();
    if (msg) msg.textContent = '';
  } catch (err) {
    if (msg) msg.textContent = err.message;
    // não usa "finally" pra reabilitar/renomear o botão às cegas — no erro,
    // o estado real (tem CNPJ salvo ou não? já tem enriquecimento ou não?)
    // decide o texto/estado certo, não um valor fixo
    if (btn) {
      btn.disabled = !estado.escola.cnpj;
      btn.textContent = estado.enriquecimento ? 'Atualizar dados institucionais' : 'Buscar dados institucionais (CNPJ)';
    }
  }
}

async function montarSecaoIA() {
  const secao = document.getElementById('secao-ia');
  if (!secao) return;
  const configurada = await chaveConfigurada();
  if (!configurada) {
    secao.innerHTML = `
      <h3>Análise de marketing e abordagem (IA)</h3>
      <p style="font-size:12px;color:var(--text-muted);">Configure sua chave de API da Anthropic em Configurações para que esta análise apareça automaticamente ao abrir cada escola.</p>`;
    return;
  }
  secao.innerHTML = `
    <h3>Análise de marketing</h3>
    <div id="resultado-potencial" style="font-size:12.5px;white-space:pre-wrap;background:var(--bg-surface-2);border-radius:var(--radius-sm);padding:10px;min-height:20px;margin-bottom:12px;">Gerando...</div>
    <h3>Sugestão de abordagem</h3>
    <div id="resultado-abordagem" style="font-size:12.5px;white-space:pre-wrap;background:var(--bg-surface-2);border-radius:var(--radius-sm);padding:10px;min-height:20px;margin-bottom:12px;">Gerando...</div>
    <details>
      <summary style="cursor:pointer;font-size:12px;color:var(--text-secondary);">Outras análises</summary>
      <div class="field-row" style="margin-top:8px;">
        <select id="f-tipo-ia">
          <option value="resumo">Resumo automático</option>
          <option value="objecoes">Sugestão de objeções</option>
          <option value="proximoPasso">Próximo melhor passo</option>
        </select>
        <button class="btn" id="btn-gerar-ia">Gerar</button>
      </div>
      <div id="resultado-ia" style="font-size:12.5px;white-space:pre-wrap;background:var(--bg-surface-2);border-radius:var(--radius-sm);padding:10px;min-height:20px;margin-top:8px;"></div>
    </details>
  `;
  const contexto = montarContextoIA();
  gerarComIA(TIPOS_ANALISE_IA.potencial(contexto))
    .then((t) => { const el = document.getElementById('resultado-potencial'); if (el) el.textContent = t; })
    .catch((err) => { const el = document.getElementById('resultado-potencial'); if (el) el.textContent = `Erro: ${err.message}`; });
  gerarComIA(TIPOS_ANALISE_IA.abordagem(contexto))
    .then((t) => { const el = document.getElementById('resultado-abordagem'); if (el) el.textContent = t; })
    .catch((err) => { const el = document.getElementById('resultado-abordagem'); if (el) el.textContent = `Erro: ${err.message}`; });

  document.getElementById('btn-gerar-ia').addEventListener('click', async () => {
    const tipo = document.getElementById('f-tipo-ia').value;
    const resultadoDiv = document.getElementById('resultado-ia');
    resultadoDiv.textContent = 'Gerando...';
    const contextoExtra = montarContextoIA();
    try {
      resultadoDiv.textContent = await gerarComIA(TIPOS_ANALISE_IA[tipo](contextoExtra));
    } catch (err) {
      resultadoDiv.textContent = `Erro: ${err.message}`;
    }
  });
}

function montarContextoIA() {
  const { escola, crm, interacoes, tags } = estado;
  const nomesTags = tags.filter((t) => crm.tags.includes(t.id)).map((t) => t.nome).join(', ') || 'nenhuma';
  const historico = interacoes.slice(0, 5).map((i) => `- ${i.tipo} em ${new Date(i.data).toLocaleDateString('pt-BR')}: ${i.descricao}`).join('\n');
  return `
Escola: ${escola.nome} (${escola.municipio}/${escola.uf})
Porte: ${escola.porte ? labelPorte(escola.porte) : 'não disponível'} · Matrículas: ${escola.mat25 != null ? escola.mat25 : 'não disponível'}
Ticket médio (mensalidade estimada): ${escola.mensalidade != null ? fmtMoedaCompacta(escola.mensalidade) : 'não disponível'}
Faturamento potencial estimado: ${escola.fatPotencial != null ? fmtMoedaCompacta(escola.fatPotencial) : 'não disponível'}
Sinal de matrículas: ${escola.sinalMat || 'sem dado'}
Marcadores atuais: ${nomesTags}
Observações do vendedor: ${crm.observacoes || 'nenhuma'}
Histórico recente:
${historico || 'nenhuma interação registrada'}
  `.trim();
}

// =====================================================================
// Aba: Escola (matrículas, porte, evolução — sem ICP)
// =====================================================================
function renderEscola() {
  const { escola } = estado;
  document.getElementById('painel-escola').innerHTML = `
    <div class="drawer-section">
      <h3>Matrículas e porte</h3>
      <div class="info-grid">
        <div><span class="k">Matrículas totais (2025):</span> ${escola.mat25 != null ? fmtInt(escola.mat25) : 'Não disponível (fora do Censo)'}</div>
        <div><span class="k">Educação infantil:</span> ${escola.matInf != null ? fmtInt(escola.matInf) : '-'}</div>
        <div><span class="k">Ensino fundamental:</span> ${escola.matFund != null ? fmtInt(escola.matFund) : '-'}</div>
        <div><span class="k">Ensino médio:</span> ${escola.matMed != null ? fmtInt(escola.matMed) : '-'}</div>
        <div><span class="k">Porte:</span> ${escola.porte ? labelPorte(escola.porte) : '-'}</div>
        <div><span class="k">Ticket médio (mensalidade estimada):</span> ${escola.mensalidade != null ? fmtMoedaCompacta(escola.mensalidade) : '-'}</div>
      </div>
    </div>

    <div class="drawer-section">
      <h3>Evolução e capacidade</h3>
      <div class="info-grid">
        <div><span class="k">Matrículas 2024:</span> ${escola.mat24 != null ? fmtInt(escola.mat24) : '-'}</div>
        <div><span class="k">Variação de matrículas:</span> ${escola.varMatPct != null ? escola.varMatPct.toFixed(1) + '%' : '-'}</div>
        <div><span class="k">Mudança de porte:</span> ${escola.mudancaPorte || (escola.mat24 != null ? 'Manteve' : '-')}</div>
        <div><span class="k">Capacidade ociosa estimada:</span> ${escola.capOciosa != null ? fmtInt(escola.capOciosa) + ' alunos' : '-'}</div>
        <div><span class="k">Faturamento potencial/ano:</span> ${escola.fatPotencial != null ? fmtMoedaCompacta(escola.fatPotencial) : '-'}</div>
      </div>
    </div>

    <div class="drawer-section">
      <h3>Modalidades</h3>
      <p style="font-size:12.5px;margin:0;">
        ${escola.temRegular ? '<span class="badge">Regular</span> ' : ''}
        ${escola.temEja ? '<span class="badge">EJA</span> ' : ''}
        ${escola.temProf ? '<span class="badge">Profissionalizante</span> ' : ''}
        ${escola.temEad ? '<span class="badge">EAD</span> ' : ''}
        ${!escola.temRegular && !escola.temEja && !escola.temProf && !escola.temEad ? '<span class="sub">Não disponível (fora do Censo)</span>' : ''}
      </p>
    </div>
  `;
}

// =====================================================================
// Aba: Contato — canais de marketing digital (só site + instagram)
// =====================================================================
const CAMPOS_MARKETING = [
  { chave: 'site', label: 'Site oficial', icone: 'fa-solid fa-globe' },
  { chave: 'instagram', label: 'Instagram', icone: 'fa-brands fa-instagram' },
];

async function salvarMarketingDigital() {
  await put('crm', estado.crm);
}

async function carregarConcorrentes() {
  const container = document.getElementById('lista-concorrentes');
  if (!container) return;
  try {
    const concorrentes = await buscarConcorrentesNaRegiao(estado.escola);
    if (!concorrentes.length) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Nenhuma outra escola com ticket comparável encontrada no mesmo município.</p>';
      return;
    }
    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Escola</th><th>Porte</th><th>Matrículas</th><th>Ticket estimado</th></tr></thead>
        <tbody>
          ${concorrentes.map((c) => `
            <tr data-id="${c.id}" style="cursor:pointer;">
              <td>${c.nome}</td><td>${labelPorte(c.porte)}</td><td>${fmtInt(c.mat25)}</td><td>${fmtMoedaCompacta(c.mensalidade)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    container.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => abrirPainelEscola(Number(tr.dataset.id), { onAtualizar: () => {} }));
    });
  } catch (err) {
    container.innerHTML = `<p style="font-size:12px;color:var(--danger);">Erro ao carregar: ${err.message}</p>`;
  }
}

async function carregarPosicaoMercado() {
  const container = document.getElementById('posicao-mercado');
  if (!container) return;
  const { escola } = estado;
  if (!coordenadaValidaBrasil(escola.lat, escola.lon, escola.uf)) {
    container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Esta escola não tem coordenada territorial confiável — ela foi retirada do mapa e dos cálculos por raio até ser corrigida.</p>';
    return;
  }
  try {
    const pos = await calcularPosicaoNaRegiao(escola, 3);
    if (!pos) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Nenhuma outra escola com coordenada encontrada no raio de 3km.</p>';
      return;
    }
    container.innerHTML = `
      <div class="kpis" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));">
        <div class="kpi">
          <div class="label">Ranking (3km)</div>
          <div class="value">${pos.posicao != null ? `${pos.posicao}ª` : '-'}</div>
          <div class="sub">${pos.posicao != null ? `de ${fmtInt(pos.totalRanking)} escolas` : 'sem matrículas suficientes'}</div>
        </div>
        <div class="kpi">
          <div class="label">Matrículas privadas (3km)</div>
          <div class="value">${fmtInt(pos.totalMatriculasRegiao)}</div>
          <div class="sub">alunos, ${fmtInt(pos.totalEscolasNaRegiao)} escolas no raio</div>
        </div>
        <div class="kpi">
          <div class="label">Market share</div>
          <div class="value">${pos.marketShare != null ? pos.marketShare.toFixed(1) + '%' : '-'}</div>
          <div class="sub">raio de 3km</div>
        </div>
        <div class="kpi">
          <div class="label">Segmento mais forte</div>
          <div class="value">${pos.segmentoMaisForte ? pos.segmentoMaisForte.share.toFixed(1) + '%' : '-'}</div>
          <div class="sub">${pos.segmentoMaisForte ? pos.segmentoMaisForte.nome : 'sem dado por etapa'}</div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="font-size:12px;color:var(--danger);">Erro ao calcular: ${err.message}</p>`;
  }
}

async function montarBuscaAutomatica() {
  const configurada = await buscaSocialConfigurada();
  const texto = document.getElementById('texto-busca-automatica');
  const btn = document.getElementById('btn-buscar-social');
  if (!texto || !btn) return;
  if (!configurada) {
    texto.textContent = 'Configure sua chave da API do Gemini em Configurações para habilitar a busca automática de Instagram/Facebook/LinkedIn/YouTube/Google Maps.';
    btn.disabled = true;
    return;
  }
  texto.textContent = 'Preenche os campos abaixo com sugestões — confira e clique em Salvar antes de confiar nelas (podem confundir escolas com nomes parecidos).';
  btn.addEventListener('click', async () => {
    const msg = document.getElementById('msg-busca-social');
    btn.disabled = true;
    msg.textContent = 'Buscando...';
    try {
      const sugestoes = await buscarRedesSociais(estado.escola.nome, estado.escola.municipio);
      Object.entries(sugestoes).forEach(([chave, valor]) => {
        const campo = document.getElementById(`f-mkt-${chave}`);
        if (campo && valor && !campo.value) campo.value = valor;
      });
      msg.textContent = 'Sugestões preenchidas abaixo — confira e clique em Salvar.';
    } catch (err) {
      msg.textContent = `Erro: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

// =====================================================================
// Aba: Inteligência (concorrentes na região + IA sob demanda)
// =====================================================================

async function renderInteligencia() {
  const painel = document.getElementById('painel-inteligencia');
  if (!painel) return;
  const configurada = await chaveConfiguradaParaPesquisa();
  const salva = await getPesquisaSalva(estado.escola.id);

  painel.innerHTML = `
    <div class="drawer-section">
      <h3>Posição de mercado (raio de 3km ao redor desta escola)</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">
        Calculado a partir do Censo Escolar já carregado — ranking por matrículas, market share e o segmento
        (Infantil/Fundamental/Médio) onde esta escola tem a maior fatia local. Sem custo, sem fonte externa nova.
      </p>
      <div id="posicao-mercado"><span class="loading-bar">Calculando...</span></div>
    </div>


    <div class="drawer-section">
      <h3>Concorrentes na região (do Censo Escolar — sem custo)</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">
        Outras escolas do mesmo município, ordenadas pela proximidade de ticket (mensalidade estimada) com esta
        escola. Dado que já está na base — não gera custo, carrega na hora.
      </p>
      <div id="lista-concorrentes"><span class="loading-bar">Carregando...</span></div>
    </div>

    <div class="drawer-section">
      <h3>Pesquisa de mercado com IA (sob demanda)</h3>
      <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">
        Busca na web o perfil socioeconômico da região, como a escola se posiciona e o que entrega, e canais
        locais de indicação — no padrão das pesquisas de inteligência de mercado da kedu. Cada clique é uma
        pesquisa pontual, com um custo pequeno (cobrado pela mesma chave configurada em Configurações) — não roda
        sozinho, e o resultado fica salvo pra não pagar de novo à toa.
      </p>
      ${!configurada
        ? '<p style="font-size:12px;color:var(--text-muted);">Configure sua chave de API da Anthropic em Configurações para habilitar isso.</p>'
        : `<button class="btn btn-primary" id="btn-pesquisar-mercado">${salva ? 'Pesquisar de novo' : 'Pesquisar agora'}</button>
           <span class="loading-bar" id="msg-pesquisa-mercado"></span>
           <div id="resultado-pesquisa-mercado" style="margin-top:12px;">
             ${salva ? montarResultadoPesquisaHtml(salva) : ''}
           </div>`
      }
    </div>
  `;

  carregarConcorrentes();
  carregarPosicaoMercado();

  const btn = document.getElementById('btn-pesquisar-mercado');
  if (btn) {
    btn.addEventListener('click', async () => {
      const msg = document.getElementById('msg-pesquisa-mercado');
      const resultadoDiv = document.getElementById('resultado-pesquisa-mercado');
      btn.disabled = true;
      msg.textContent = 'Pesquisando...';
      try {
        const registro = await pesquisarMercado(estado.escola);
        resultadoDiv.innerHTML = montarResultadoPesquisaHtml(registro);
        msg.textContent = '';
        btn.textContent = 'Pesquisar de novo';
      } catch (err) {
        msg.textContent = `Erro: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }
}

/**
 * Conversor leve de markdown pra HTML — só pro que o modelo realmente usa
 * nesse tipo de resposta (negrito, cabeçalhos, listas, parágrafos).
 * Não é uma biblioteca completa de propósito: escapa HTML primeiro (evita
 * qualquer risco de injeção vinda da resposta da IA), depois aplica só
 * essas poucas conversões — suficiente pra parar de mostrar "**" e "##"
 * literalmente na tela.
 */
function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

function markdownParaHtml(texto) {
  const escapado = escaparHtml(texto);
  const linhas = escapado.split('\n');
  const blocos = [];
  let listaAtual = null;

  const fecharLista = () => { if (listaAtual) { blocos.push(`<${listaAtual.tipo}>${listaAtual.itens.join('')}</${listaAtual.tipo}>`); listaAtual = null; } };

  linhas.forEach((linha) => {
    const l = linha.trim();
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');

    if (!l) { fecharLista(); return; }
    const headerMatch = l.match(/^(#{1,4})\s+(.*)/);
    const numeradaMatch = l.match(/^\d+[.)]\s+(.*)/);
    const bulletMatch = l.match(/^[-*]\s+(.*)/);

    if (headerMatch) {
      fecharLista();
      const nivel = Math.min(4, headerMatch[1].length) + 2; // # vira h3, ## vira h4 etc — mantém hierarquia visual sem competir com os títulos da própria ficha
      blocos.push(`<h${nivel} style="font-size:${15 - nivel}px;margin:10px 0 4px;">${inline(headerMatch[2])}</h${nivel}>`);
    } else if (numeradaMatch) {
      if (!listaAtual || listaAtual.tipo !== 'ol') { fecharLista(); listaAtual = { tipo: 'ol', itens: [] }; }
      listaAtual.itens.push(`<li>${inline(numeradaMatch[1])}</li>`);
    } else if (bulletMatch) {
      if (!listaAtual || listaAtual.tipo !== 'ul') { fecharLista(); listaAtual = { tipo: 'ul', itens: [] }; }
      listaAtual.itens.push(`<li>${inline(bulletMatch[1])}</li>`);
    } else {
      fecharLista();
      blocos.push(`<p style="margin:0 0 8px;">${inline(l)}</p>`);
    }
  });
  fecharLista();
  return blocos.join('');
}

function montarResultadoPesquisaHtml(registro) {
  const data = new Date(registro.atualizadoEm).toLocaleString('pt-BR');
  const fontesHtml = registro.fontes.length
    ? `<div style="margin-top:10px;"><strong style="font-size:11px;color:var(--text-secondary);">Fontes:</strong>
        <ul style="font-size:11.5px;margin-top:4px;padding-left:18px;">
          ${registro.fontes.map((f) => `<li><a href="${f.url}" target="_blank" rel="noopener">${f.titulo}</a></li>`).join('')}
        </ul></div>`
    : '';
  const { escola } = estado;
  const prefixoRaiz = window.location.pathname.includes('/pages/') ? '' : 'pages/';
  const linkMercado = coordenadaValidaBrasil(escola.lat, escola.lon, escola.uf)
    ? `<a class="btn btn-primary" style="margin-top:10px;display:inline-block;" href="${prefixoRaiz}mercado.html?uf=${encodeURIComponent(escola.uf || '')}&municipio=${encodeURIComponent(escola.municipio || '')}&lat=${escola.lat}&lon=${escola.lon}">
         <i class="fa-solid fa-arrow-right"></i> Aprofundar num estudo de mercado completo (Mapear Mercado)
       </a>`
    : '';
  return `
    <div style="font-size:12.5px;background:var(--bg-surface-2);border-radius:var(--radius-sm);padding:10px 12px;">${markdownParaHtml(registro.texto)}</div>
    ${fontesHtml}
    <p style="font-size:10.5px;color:var(--text-muted);margin-top:6px;">Pesquisado em ${data}</p>
    ${linkMercado}
  `;

}

// =====================================================================
// Aba: Evolução longitudinal — microdados oficiais do Inep
// =====================================================================
async function renderEvolucao() {
  const painel = document.getElementById('painel-evolucao');
  if (!painel) return;
  painel.innerHTML = '<p class="loading-bar">Carregando série histórica do Inep...</p>';
  try {
    const [serie, diagnostico] = await Promise.all([
      buscarSerieEscola(estado.escola.uf, estado.escola.id),
      buscarDiagnosticoMunicipio(estado.escola.uf, estado.escola.municipio),
    ]);
    if (!serie?.registros?.length) {
      painel.innerHTML = '<div class="drawer-section"><h3>Série histórica</h3><p class="sub">Esta escola não possui observações compatíveis na série pública de 2019–2025.</p></div>';
      return;
    }
    const registros = serie.registros;
    const valores = registros.map((r) => Number(r.matriculas) || 0);
    const maximo = Math.max(...valores, 1);
    const largura = 560;
    const altura = 150;
    const pontos = registros.map((r, i) => {
      const x = registros.length === 1 ? largura / 2 : 20 + i * ((largura - 40) / (registros.length - 1));
      const y = altura - 24 - ((Number(r.matriculas) || 0) / maximo) * (altura - 48);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const primeiro = registros[0];
    const ultimo = registros.at(-1);
    const variacao = primeiro.matriculas > 0 ? ((ultimo.matriculas - primeiro.matriculas) / primeiro.matriculas) * 100 : null;
    const corRisco = { Alto: 'var(--danger)', Moderado: 'var(--icp-media)', Baixo: 'var(--icp-alta)' }[diagnostico?.riscoSaturacao] || 'var(--text-muted)';
    painel.innerHTML = `
      <div class="drawer-section">
        <h3>Trajetória de matrículas</h3>
        <div class="kpis" style="margin:10px 0;">
          <div class="kpi"><div class="label">Primeira observação (${primeiro.ano})</div><div class="value">${fmtInt(primeiro.matriculas)}</div></div>
          <div class="kpi"><div class="label">Última observação (${ultimo.ano})</div><div class="value">${fmtInt(ultimo.matriculas)}</div></div>
          <div class="kpi"><div class="label">Variação no período</div><div class="value">${variacao == null ? '—' : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(1)}%`}</div></div>
        </div>
        <svg viewBox="0 0 ${largura} ${altura}" style="width:100%;height:170px;background:var(--bg-surface-2);border-radius:var(--radius-sm);" role="img" aria-label="Série histórica de matrículas da escola">
          <polyline points="${pontos}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
          ${registros.map((r, i) => {
            const [x, y] = pontos.split(' ')[i].split(',');
            return `<circle cx="${x}" cy="${y}" r="5" fill="var(--accent)"><title>${r.ano}: ${fmtInt(r.matriculas)} matrículas</title></circle><text x="${x}" y="${altura - 7}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${r.ano}</text>`;
          }).join('')}
        </svg>
      </div>
      <div class="drawer-section">
        <h3>Composição e estrutura por ano</h3>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Ano</th><th>Matrículas</th><th>Infantil</th><th>Fundamental</th><th>Médio</th><th>Turmas</th><th>Alunos/turma</th><th>Docentes</th></tr></thead>
          <tbody>${registros.map((r) => `<tr><td>${r.ano}</td><td>${fmtInt(r.matriculas)}</td><td>${fmtInt(r.infantil)}</td><td>${fmtInt(r.fundamental)}</td><td>${fmtInt(r.medio)}</td><td>${fmtInt(r.turmas)}</td><td>${r.turmas ? (r.matriculas / r.turmas).toFixed(1) : '—'}</td><td>${fmtInt(r.docentes)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      ${diagnostico ? `<div class="drawer-section">
        <h3>Contexto do município</h3>
        <p><span class="badge" style="border-color:${corRisco};color:${corRisco};">Pressão de saturação: ${diagnostico.riscoSaturacao}</span></p>
        <div class="info-grid" style="margin-top:10px;">
          <div><span class="k">Crescimento anual de matrículas privadas:</span> ${diagnostico.crescimentoMatriculasCagrPct == null ? '—' : `${diagnostico.crescimentoMatriculasCagrPct}%`}</div>
          <div><span class="k">Crescimento anual da oferta:</span> ${diagnostico.crescimentoEscolasCagrPct == null ? '—' : `${diagnostico.crescimentoEscolasCagrPct}%`}</div>
          <div><span class="k">Pressão oferta − demanda:</span> ${diagnostico.pressaoOfertaPp == null ? '—' : `${diagnostico.pressaoOfertaPp} p.p.`}</div>
          <div><span class="k">Concentração das 3 maiores:</span> ${diagnostico.concentracaoTop3Pct == null ? '—' : `${diagnostico.concentracaoTop3Pct}%`}</div>
        </div>
        <p class="sub" style="margin-top:8px;">Sinal estatístico baseado na evolução de escolas e matrículas privadas; não representa capacidade física observada.</p>
      </div>` : ''}
      <div class="footer-note">Fonte: ${serie.fonte}. Série harmonizada pelo Nexo; somente escolas declaradas em funcionamento em cada edição.</div>`;
  } catch (err) {
    painel.innerHTML = `<div class="drawer-section"><h3>Série histórica</h3><p class="sub">Não foi possível carregar a camada longitudinal: ${err.message}</p></div>`;
  }
}

// =====================================================================
// Aba: Histórico (interações + mudanças de marcadores, timeline única)
// =====================================================================
function renderHistorico() {
  const { interacoes, historicoTags } = estado;
  const eventos = [
    ...interacoes.map((i) => ({ data: i.data, tipo: 'interacao', item: i })),
    ...historicoTags.map((h) => ({ data: h.data, tipo: 'tag', item: h })),
  ].sort((a, b) => new Date(b.data) - new Date(a.data));

  const painel = document.getElementById('painel-historico');
  painel.innerHTML = `
    <div class="drawer-section">
      <h3>Linha do tempo</h3>
      <div id="lista-historico">${eventos.length ? eventos.map(renderEventoHistorico).join('') : '<p style="color:var(--text-muted);font-size:12.5px;">Nada registrado ainda.</p>'}</div>
    </div>

    <div class="drawer-section">
      <h3>Registrar nova interação</h3>
      <div class="field-row">
        <div>
          <label>Tipo</label>
          <select id="f-nova-interacao-tipo">${TIPO_INTERACAO.map((t) => `<option>${t}</option>`).join('')}</select>
        </div>
        <div>
          <label>Autor</label>
          <input id="f-nova-interacao-autor" type="text" placeholder="Seu nome" value="${estado._meuNomeCache || ''}">
        </div>
      </div>
      <textarea id="f-nova-interacao-desc" rows="2" placeholder="O que foi conversado/feito..." style="width:100%;margin-bottom:8px;"></textarea>
      <button class="btn" id="btn-add-interacao">Registrar interação</button>
    </div>
  `;

  getMeuNome().then((nome) => {
    const campo = document.getElementById('f-nova-interacao-autor');
    if (campo && !campo.value) campo.value = nome;
  });

  document.getElementById('btn-add-interacao').addEventListener('click', async () => {
    const descricao = document.getElementById('f-nova-interacao-desc').value.trim();
    if (!descricao) return;
    await adicionarInteracao({
      escolaId: estado.escola.id,
      tipo: document.getElementById('f-nova-interacao-tipo').value,
      autor: document.getElementById('f-nova-interacao-autor').value.trim(),
      descricao,
    });
    estado.interacoes = await listarInteracoes(estado.escola.id);
    renderHistorico();
    notificarAtualizacao();
  });
}

function renderEventoHistorico(evento) {
  const data = new Date(evento.data).toLocaleString('pt-BR');
  if (evento.tipo === 'interacao') {
    const i = evento.item;
    return `<div class="interacao-item"><div><strong>${i.tipo}</strong> ${i.descricao}</div><div class="meta">${data}${i.autor ? ' · ' + i.autor : ''}</div></div>`;
  }
  const h = evento.item;
  const verbo = h.acao === 'adicionar' ? 'adicionou' : 'removeu';
  return `<div class="interacao-item"><div>${h.usuario || 'Alguém'} ${verbo} o marcador <strong>${h.tagNome}</strong></div><div class="meta">${data}</div></div>`;
}

// =====================================================================
// Aba: Marcadores (aplicar/remover tags + responsável)
// =====================================================================
function renderMarcadores() {
  const { crm, tags, historicoTags } = estado;
  const tagsDaEscola = tags.filter((t) => crm.tags.includes(t.id));
  const tagsDisponiveis = tags.filter((t) => !crm.tags.includes(t.id));

  document.getElementById('painel-marcadores').innerHTML = `
    <div class="drawer-section">
      <h3>Marcadores aplicados</h3>
      <div id="chips-tags-atuais">
        ${tagsDaEscola.length ? tagsDaEscola.map((t) => `
          <span class="tag-chip" style="background:${t.cor}">${t.nome} <span class="remove-tag" data-id="${t.id}">&times;</span></span>
        `).join('') : '<p style="color:var(--text-muted);font-size:12.5px;">Nenhum marcador ainda.</p>'}
      </div>
      <div class="tag-add-row">
        <select id="f-add-tag">
          <option value="">Adicionar marcador...</option>
          ${tagsDisponiveis.map((t) => `<option value="${t.id}">${t.nome}${t.tipo === 'vendedor' ? ' (responsável)' : ''}</option>`).join('')}
        </select>
        <button class="btn" id="btn-add-tag">Adicionar</button>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:6px;">
        Marcadores do tipo "responsável" funcionam como a tag pessoal do vendedor — aplique a sua para indicar quem está com a escola.
        Gerencie o catálogo completo em Configurações → Marcadores.
      </p>
    </div>

    <div class="drawer-section">
      <h3>Histórico de marcadores desta escola</h3>
      <div>${historicoTags.length ? historicoTags.map((h) => `
        <div class="interacao-item">
          <div>${h.usuario || 'Alguém'} ${h.acao === 'adicionar' ? 'adicionou' : 'removeu'}: <strong>${h.tagNome}</strong></div>
          <div class="meta">${new Date(h.data).toLocaleString('pt-BR')}</div>
        </div>`).join('') : '<p style="color:var(--text-muted);font-size:12.5px;">Nenhuma alteração registrada ainda.</p>'}
      </div>
    </div>
  `;

  document.querySelectorAll('#chips-tags-atuais .remove-tag').forEach((el) => {
    el.addEventListener('click', async () => {
      const tag = tags.find((t) => t.id === Number(el.dataset.id));
      const usuario = await getMeuNome();
      estado.crm = await removerTagDaEscola(estado.escola.id, tag, usuario);
      estado.historicoTags = await listarHistoricoTags(estado.escola.id);
      renderMarcadores();
      renderBadges();
      renderHistorico();
      notificarAtualizacao();
    });
  });

  document.getElementById('btn-add-tag').addEventListener('click', async () => {
    const select = document.getElementById('f-add-tag');
    const tagId = Number(select.value);
    if (!tagId) return;
    const tag = tags.find((t) => t.id === tagId);
    const usuario = await getMeuNome();
    estado.crm = await adicionarTagNaEscola(estado.escola.id, tag, usuario);
    estado.historicoTags = await listarHistoricoTags(estado.escola.id);
    renderMarcadores();
    renderBadges();
    renderHistorico();
    notificarAtualizacao();
  });
}

// =====================================================================
// Aba: Observações
// =====================================================================
function renderObservacoes() {
  const { crm } = estado;
  document.getElementById('painel-observacoes').innerHTML = `
    <div class="drawer-section">
      <h3>Observações livres</h3>
      <textarea id="f-observacoes" rows="8" style="width:100%;">${crm.observacoes || ''}</textarea>
      <button class="btn btn-primary" id="btn-salvar-obs" style="margin-top:8px;">Salvar</button>
      <span class="loading-bar" id="msg-obs"></span>
    </div>
  `;
  document.getElementById('btn-salvar-obs').addEventListener('click', async () => {
    await salvarObservacoes(estado.escola.id, document.getElementById('f-observacoes').value);
    estado.crm.observacoes = document.getElementById('f-observacoes').value;
    document.getElementById('msg-obs').textContent = 'Salvo.';
    setTimeout(() => { const m = document.getElementById('msg-obs'); if (m) m.textContent = ''; }, 1500);
    notificarAtualizacao();
  });
}

// =====================================================================
// Aba: Documentos
// =====================================================================
function renderDocumentos() {
  const { documentos } = estado;
  document.getElementById('painel-documentos').innerHTML = `
    <div class="drawer-section">
      <h3>Arquivos anexados</h3>
      <div id="lista-documentos">${documentos.length ? documentos.map(documentoItemHtml).join('') : '<p style="color:var(--text-muted);font-size:12.5px;">Nenhum documento anexado.</p>'}</div>
      <input type="file" id="f-novo-documento" style="margin-top:10px;">
      <p style="font-size:11px;color:var(--text-muted);margin-top:6px;">Arquivos ficam salvos apenas neste navegador (não fazem parte do backup exportado em Configurações).</p>
    </div>
  `;
  document.querySelectorAll('.btn-remover-doc').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removerDocumento(Number(btn.dataset.id));
      estado.documentos = await listarDocumentos(estado.escola.id);
      renderDocumentos();
    });
  });
  document.getElementById('f-novo-documento').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    await adicionarDocumento({ escolaId: estado.escola.id, nome: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size, blob: arquivo });
    estado.documentos = await listarDocumentos(estado.escola.id);
    renderDocumentos();
  });
}

function documentoItemHtml(d) {
  const url = URL.createObjectURL(d.blob);
  const kb = (d.tamanho / 1024).toFixed(0);
  return `
    <div class="interacao-item">
      <div><a href="${url}" download="${d.nome}" style="text-decoration:underline;">${d.nome}</a> (${kb} KB)</div>
      <div class="meta">${new Date(d.dataUpload).toLocaleString('pt-BR')}
        <button class="btn-fechar btn-remover-doc" data-id="${d.documentoId}" style="font-size:14px;">&times;</button>
      </div>
    </div>`;
}
