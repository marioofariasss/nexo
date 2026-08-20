import { getAll, getById, getByIndex, getMeta, put, setMeta, deleteRecord } from './db.js';
import { carregarIndiceUFs, importarUF } from './importService.js';
import { buscarEscolas } from './escolaService.js';
import { buscarEscolasOSM, cruzarComCenso, geocodificarEndereco, normalizarNome, pareceSerPublica } from './osmDescobertaService.js';
import { distanciaKm } from '../utils/geo.js';
import { buscarDadosCnpj } from './enriquecimentoService.js';
import { chamarGeminiComBusca, getConfigBuscaSocial } from './socialSearchService.js';

export const META_DIARIA_PADRAO = 20;
export const KEDU_FORM_URL = 'https://kedu.com.br/#kedu-lead';

export const AGENTES_HUNTER = [
  { id: 'territorio', nome: 'Território', descricao: 'Escolhe o próximo município e controla saturação.', icone: 'fa-map-location-dot' },
  { id: 'descoberta', nome: 'Descoberta', descricao: 'Busca escolas em fontes geográficas públicas.', icone: 'fa-magnifying-glass-location' },
  { id: 'deduplicacao', nome: 'Deduplicação', descricao: 'Cruza INEP, Nexo e candidatos já encontrados.', icone: 'fa-clone' },
  { id: 'classificacao', nome: 'Classificação', descricao: 'Exclui públicas, técnicas e instituições fora do ensino regular.', icone: 'fa-filter-circle-xmark' },
  { id: 'enriquecimento', nome: 'Investigação', descricao: 'Organiza contatos e evidências de fontes públicas.', icone: 'fa-user-magnifying-glass' },
  { id: 'icp', nome: 'ICP e porte', descricao: 'Calcula prioridade e confiança sem tratar estimativa como fato.', icone: 'fa-chart-simple' },
  { id: 'kedu', nome: 'Cadastro kedu', descricao: 'Valida os cinco campos e prepara o formulário oficial.', icone: 'fa-paper-plane' },
  { id: 'relatorios', nome: 'Relatórios', descricao: 'Consolida produção, qualidade e cobertura territorial.', icone: 'fa-file-lines' },
];

const TERRITORIOS_INICIAIS = [
  ['Fortaleza', 'CE'], ['Caucaia', 'CE'], ['Maracanaú', 'CE'], ['Eusébio', 'CE'],
  ['Aquiraz', 'CE'], ['Sobral', 'CE'], ['Juazeiro do Norte', 'CE'], ['Crato', 'CE'],
];

const FORA_ESCOPO = /\b(t[eé]cnic[oa]|profissionalizante|idiomas?|faculdade|universidade|cursinho|preparat[oó]rio|refor[cç]o|eja|supletivo|senai|senac|instituto federal|eeep)\b/i;
const ENSINO_REGULAR = /\b(escola|col[eé]gio|educa[cç][aã]o infantil|ensino fundamental|ensino m[eé]dio|centro educacional|creche)\b/i;

function agora() { return new Date().toISOString(); }
function id(prefixo) { return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function somenteDigitos(valor) { return String(valor || '').replace(/\D/g, ''); }
function dominio(url) {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
function urlInstagram(instagram) {
  if (!instagram) return '';
  if (/^https?:/i.test(instagram)) return instagram;
  return `https://instagram.com/${String(instagram).replace(/^@/, '')}`;
}
function nomeMunicipio(valor) {
  return String(valor || '').trim().replace(/\s+/g, ' ');
}

export async function registrarLog(agente, mensagem, { entidadeId = '', nivel = 'info', detalhes = null } = {}) {
  return put('hunterLogs', { agente, mensagem, entidadeId, nivel, detalhes, criadoEm: agora() });
}

export async function listarLogs(limite = 200) {
  const logs = await getAll('hunterLogs');
  return logs.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, limite);
}

export async function obterConfiguracao() {
  // Migração única da meta original (50) para a nova meta operacional (20).
  // O valor fica persistido para que navegadores que já abriram o Hunter
  // também recebam a alteração, não apenas instalações novas.
  const versaoMeta = await getMeta('hunter_meta_diaria_versao');
  if (versaoMeta !== 'v2-meta-20') {
    await setMeta('hunter_meta_diaria', META_DIARIA_PADRAO);
    await setMeta('hunter_meta_diaria_versao', 'v2-meta-20');
  }
  return {
    metaDiaria: Number(await getMeta('hunter_meta_diaria')) || META_DIARIA_PADRAO,
    ativo: (await getMeta('hunter_ativo')) !== false,
    raioKm: Number(await getMeta('hunter_raio_km')) || 12,
  };
}

export async function salvarConfiguracao(config) {
  if (config.metaDiaria != null) await setMeta('hunter_meta_diaria', Math.max(1, Number(config.metaDiaria) || META_DIARIA_PADRAO));
  if (config.ativo != null) await setMeta('hunter_ativo', Boolean(config.ativo));
  if (config.raioKm != null) await setMeta('hunter_raio_km', Math.min(30, Math.max(2, Number(config.raioKm) || 12)));
  await registrarLog('territorio', 'Configuração operacional atualizada.');
}

export async function garantirTerritoriosIniciais() {
  const existentes = await getAll('hunterTerritorios');
  if (existentes.length) return existentes;
  const criados = TERRITORIOS_INICIAIS.map(([municipio, uf], ordem) => ({
    id: `territorio_${uf}_${normalizarNome(municipio).replaceAll(' ', '_')}`,
    municipio, uf, ordem, status: ordem === 0 ? 'em_andamento' : 'na_fila',
    cobertura: 0, ciclos: 0, ciclosSemNovidade: 0, encontrados: 0, novos: 0,
    ultimaBuscaEm: null, saturadoEm: null, consultas: [], criadoEm: agora(), atualizadoEm: agora(),
  }));
  for (const territorio of criados) await put('hunterTerritorios', territorio);
  await registrarLog('territorio', 'Fila territorial inicial criada, começando por Fortaleza/CE.');
  return criados;
}

export async function listarTerritorios() {
  await garantirTerritoriosIniciais();
  const itens = await getAll('hunterTerritorios');
  return itens.sort((a, b) => Number(a.ordem) - Number(b.ordem));
}

export async function adicionarTerritorio({ municipio, uf }) {
  const nome = nomeMunicipio(municipio);
  const estado = String(uf || '').trim().toUpperCase();
  if (!nome || !/^[A-Z]{2}$/.test(estado)) throw new Error('Informe município e UF com duas letras.');
  const existentes = await listarTerritorios();
  if (existentes.some((t) => normalizarNome(t.municipio) === normalizarNome(nome) && t.uf === estado)) {
    throw new Error('Esse município já está na memória territorial.');
  }
  const territorio = {
    id: id('territorio'), municipio: nome, uf: estado, ordem: existentes.length,
    status: existentes.some((t) => t.status === 'em_andamento') ? 'na_fila' : 'em_andamento',
    cobertura: 0, ciclos: 0, ciclosSemNovidade: 0, encontrados: 0, novos: 0,
    ultimaBuscaEm: null, saturadoEm: null, consultas: [], criadoEm: agora(), atualizadoEm: agora(),
  };
  await put('hunterTerritorios', territorio);
  await registrarLog('territorio', `${nome}/${estado} adicionado à fila.`, { entidadeId: territorio.id });
  return territorio;
}

export async function atualizarTerritorio(territorio) {
  await put('hunterTerritorios', { ...territorio, atualizadoEm: agora() });
}

export async function avancarTerritorioAtual(territorioAtual) {
  const territorios = await listarTerritorios();
  const atual = territorios.find((t) => t.id === territorioAtual.id);
  if (atual) await atualizarTerritorio({ ...atual, status: 'saturado', cobertura: Math.max(95, atual.cobertura || 0), saturadoEm: agora() });
  const proximo = territorios.find((t) => t.id !== territorioAtual.id && t.status === 'na_fila');
  if (proximo) await atualizarTerritorio({ ...proximo, status: 'em_andamento' });
  await registrarLog('territorio', proximo
    ? `${territorioAtual.municipio}/${territorioAtual.uf} saturado; avançando para ${proximo.municipio}/${proximo.uf}.`
    : `${territorioAtual.municipio}/${territorioAtual.uf} saturado; fila territorial precisa de novo município.`,
  { entidadeId: territorioAtual.id, nivel: proximo ? 'info' : 'atencao' });
  return proximo || null;
}

export async function listarLeads() {
  const leads = await getAll('hunterLeads');
  return leads.sort((a, b) => String(b.atualizadoEm || b.criadoEm).localeCompare(String(a.atualizadoEm || a.criadoEm)));
}

export async function obterLead(leadId) { return getById('hunterLeads', leadId); }

const CAMPOS_ESPELHO = ['cnpj', 'telefone', 'email', 'instagram', 'site', 'responsavel', 'cargo', 'telefoneResponsavel', 'endereco'];

function ehColegioJemina(lead) {
  const nome = normalizarNome(lead?.nome || '');
  return nome.includes('colegio professora jemina gois') || nome.includes('professora jemina gois');
}

function perfilDoEspelho(lead) {
  const preenchidos = CAMPOS_ESPELHO.filter((campo) => Boolean(String(lead?.[campo] || '').trim()));
  const tiposEvidencia = [...new Set((lead?.evidencias || []).map((item) => item.tipo).filter(Boolean))];
  const fontes = [...new Set((lead?.evidencias || []).map((item) => item.fonte).filter(Boolean))];
  return {
    leadId: lead.id, nome: lead.nome, camposPreenchidos: preenchidos,
    tiposEvidencia, fontes, quantidadeEvidencias: (lead.evidencias || []).length,
    completudeAlvo: lead.qualificacao?.completude || 0,
    sinaisEstruturaAlvo: Number(lead.sinaisEstrutura || 0),
    exigeReceitaEstimada: Boolean(lead.alunosEstimados && lead.mensalidadeEstimada),
    atualizadoEm: agora(),
  };
}

export async function definirLeadEspelho(leadId) {
  const lead = await obterLead(leadId);
  if (!lead) throw new Error('Escola não encontrada.');
  const perfil = perfilDoEspelho(lead);
  await setMeta('hunter_lead_espelho_id', leadId);
  await setMeta('hunter_perfil_espelho', perfil);
  await registrarLog('enriquecimento', `${lead.nome} definida como padrão de enriquecimento do Hunter.`, { entidadeId: leadId });
  return { lead, perfil };
}

export async function obterLeadEspelho() {
  let leadId = await getMeta('hunter_lead_espelho_id');
  // Migração automática para quem já enriqueceu a Jemina antes da criação
  // do recurso de espelho. O registro e suas fontes continuam intactos.
  if (!leadId) {
    const jemina = (await getAll('hunterLeads')).find(ehColegioJemina);
    if (jemina) {
      const definido = await definirLeadEspelho(jemina.id);
      return definido;
    }
  }
  if (!leadId) return null;
  const lead = await obterLead(leadId);
  if (!lead) return null;
  return { lead, perfil: (await getMeta('hunter_perfil_espelho')) || perfilDoEspelho(lead) };
}

export function compararComEspelho(lead, espelho) {
  if (!espelho?.perfil) return null;
  const camposAlvo = espelho.perfil.camposPreenchidos || [];
  const faltantes = camposAlvo.filter((campo) => !String(lead?.[campo] || '').trim());
  const tiposAtuais = new Set((lead.evidencias || []).map((item) => item.tipo));
  const evidenciasFaltantes = (espelho.perfil.tiposEvidencia || []).filter((tipo) => !tiposAtuais.has(tipo));
  const total = camposAlvo.length + (espelho.perfil.tiposEvidencia || []).length;
  const atendidos = total - faltantes.length - evidenciasFaltantes.length;
  return {
    espelhoId: espelho.lead.id, espelhoNome: espelho.lead.nome,
    coberturaPct: total ? Math.round(Math.max(0, atendidos) / total * 100) : 100,
    camposFaltantes: faltantes, evidenciasFaltantes,
    quantidadeEvidenciasAlvo: espelho.perfil.quantidadeEvidencias || 0,
    sinaisEstruturaAlvo: espelho.perfil.sinaisEstruturaAlvo || 0,
    exigeReceitaEstimada: espelho.perfil.exigeReceitaEstimada || false,
  };
}

function fingerprint(candidato) {
  const cnpj = somenteDigitos(candidato.cnpj || candidato.cnpjOsm);
  if (cnpj) return `cnpj:${cnpj}`;
  const tel = somenteDigitos(candidato.telefone || candidato.tel);
  if (tel) return `tel:${tel}`;
  const site = dominio(candidato.site);
  if (site) return `site:${site}`;
  return `nome:${normalizarNome(candidato.nome)}|${normalizarNome(candidato.municipio)}|${candidato.uf || ''}`;
}

function classificar(candidato) {
  const texto = `${candidato.nome || ''} ${candidato.tipo || ''} ${candidato.operador || ''}`;
  if (pareceSerPublica(candidato.nome, candidato.tags || {}) || /\b(municipal|estadual|federal|prefeitura|governo)\b/i.test(texto)) {
    return { elegivel: false, motivo: 'Sinais de instituição pública', confianca: 'alta' };
  }
  if (FORA_ESCOPO.test(texto)) return { elegivel: false, motivo: 'Instituição técnica ou fora do ensino regular', confianca: 'alta' };
  return { elegivel: true, motivo: ENSINO_REGULAR.test(texto) ? 'Sinais de ensino regular privado' : 'Natureza escolar requer confirmação', confianca: ENSINO_REGULAR.test(texto) ? 'media' : 'baixa' };
}

export function calcularQualificacao(lead) {
  let icp = 0;
  const razoes = [];
  const contato = lead.telefone || lead.email;
  if (lead.classificacao?.elegivel) { icp += 25; razoes.push('ensino regular privado'); }
  if (lead.cnpj) { icp += 10; razoes.push('CNPJ identificado'); }
  if (contato) { icp += 15; razoes.push('canal de contato'); }
  if (lead.site || lead.instagram) { icp += 12; razoes.push('presença digital'); }
  if (lead.responsavel && lead.cargo) { icp += 23; razoes.push('decisor identificado'); }
  const sinaisEstrutura = Number(lead.sinaisEstrutura || 0);
  icp += Math.min(15, sinaisEstrutura * 3);
  if (sinaisEstrutura) razoes.push(`${sinaisEstrutura} sinais de estrutura`);
  const tier = icp >= 75 ? 'A' : icp >= 55 ? 'B' : icp >= 35 ? 'C' : 'D';
  let porte = 'Não estimado';
  if (sinaisEstrutura >= 4 || lead.multiplasUnidades) porte = 'Grande';
  else if (sinaisEstrutura >= 2 || (lead.site && lead.instagram)) porte = 'Médio';
  else if (lead.classificacao?.elegivel) porte = 'Pequeno ou médio';
  const confiancaPorte = sinaisEstrutura >= 4 ? 'alta' : sinaisEstrutura >= 2 ? 'média' : 'baixa';
  let receitaEstimada = null;
  if (lead.alunosEstimados > 0 && lead.mensalidadeEstimada > 0) {
    const centro = Number(lead.alunosEstimados) * Number(lead.mensalidadeEstimada);
    receitaEstimada = { minimo: Math.round(centro * 0.8), maximo: Math.round(centro * 1.2), confianca: 'baixa' };
  }
  const campos = ['cnpj', 'telefone', 'email', 'instagram', 'site', 'responsavel', 'cargo'];
  const completude = Math.round(campos.filter((campo) => Boolean(lead[campo])).length / campos.length * 100);
  return { icp, tier, razoes, porte, confiancaPorte, receitaEstimada, completude };
}

function evidenciasDoCandidato(candidato) {
  const lista = [{ tipo: 'descoberta', fonte: 'OpenStreetMap', url: candidato.osmId ? `https://www.openstreetmap.org/${candidato.osmId}` : '', descricao: 'Instituição localizada no mapeamento público.', coletadoEm: agora() }];
  if (candidato.site) lista.push({ tipo: 'site', fonte: 'Site informado no OpenStreetMap', url: candidato.site, descricao: candidato.site, coletadoEm: agora() });
  if (candidato.email) lista.push({ tipo: 'contato', fonte: 'OpenStreetMap', url: '', descricao: `E-mail: ${candidato.email}`, coletadoEm: agora() });
  if (candidato.tel) lista.push({ tipo: 'contato', fonte: 'OpenStreetMap', url: '', descricao: `Telefone: ${candidato.tel}`, coletadoEm: agora() });
  if (candidato.cnpjOsm) lista.push({ tipo: 'cnpj', fonte: 'OpenStreetMap — requer validação', url: '', descricao: candidato.cnpjOsm, coletadoEm: agora() });
  return lista;
}

function candidatoParaLead(candidato, territorio, runId) {
  const classificacao = classificar(candidato);
  const base = {
    id: id('lead'), runId, territorioId: territorio.id, origemId: candidato.osmId || '', origem: 'OpenStreetMap',
    nome: candidato.nome, nomeNormalizado: normalizarNome(candidato.nome), municipio: candidato.municipio || territorio.municipio,
    uf: candidato.uf || territorio.uf, endereco: candidato.endereco || '', bairro: candidato.bairro || '', cep: candidato.cep || '',
    latitude: candidato.lat, longitude: candidato.lon, cnpj: candidato.cnpjOsm || '', telefone: candidato.tel || '', email: candidato.email || '',
    site: candidato.site || '', instagram: '', responsavel: '', cargo: '', telefoneResponsavel: '',
    classificacao, evidencias: evidenciasDoCandidato(candidato), fingerprint: fingerprint(candidato),
    sinaisEstrutura: 0, multiplasUnidades: false, alunosEstimados: null, mensalidadeEstimada: null,
    status: classificacao.elegivel ? 'revisao' : 'descartada', motivoDescarte: classificacao.elegivel ? '' : classificacao.motivo,
    tentativas: 0, erro: '', criadoEm: agora(), atualizadoEm: agora(), qualificadoEm: null, enviadoKeduEm: null,
  };
  return { ...base, qualificacao: calcularQualificacao(base) };
}

function normalizarLead(lead) {
  const proximo = { ...lead };
  proximo.nome = String(proximo.nome || '').trim();
  proximo.uf = String(proximo.uf || '').trim().toUpperCase();
  proximo.municipio = nomeMunicipio(proximo.municipio);
  proximo.cnpj = String(proximo.cnpj || '').trim();
  proximo.instagram = urlInstagram(proximo.instagram);
  proximo.atualizadoEm = agora();
  proximo.fingerprint = fingerprint(proximo);
  proximo.qualificacao = calcularQualificacao(proximo);
  return proximo;
}

export async function salvarLead(lead, { acao = 'atualizado', usuario = 'Operação Hunter' } = {}) {
  const proximo = normalizarLead(lead);
  const espelho = await obterLeadEspelho();
  if (espelho && espelho.lead.id !== proximo.id) proximo.padraoEspelho = compararComEspelho(proximo, espelho);
  await put('hunterLeads', proximo);
  const espelhoId = await getMeta('hunter_lead_espelho_id');
  if (espelhoId === proximo.id || (!espelhoId && ehColegioJemina(proximo))) {
    await setMeta('hunter_lead_espelho_id', proximo.id);
    await setMeta('hunter_perfil_espelho', perfilDoEspelho(proximo));
  }
  await put('hunterReviews', { leadId: proximo.id, acao, usuario, criadoEm: agora(), resumo: `${proximo.nome} · ${proximo.status}` });
  await registrarLog(acao === 'enviado_kedu' ? 'kedu' : 'enriquecimento', `${proximo.nome}: ${acao}.`, { entidadeId: proximo.id });
  return proximo;
}

export async function criarLeadManual(dados) {
  const classificacao = classificar(dados);
  const base = {
    id: id('lead'), runId: '', territorioId: dados.territorioId || '', origemId: '', origem: dados.origem || 'Pesquisa manual',
    nome: dados.nome, municipio: dados.municipio, uf: dados.uf, endereco: dados.endereco || '', bairro: dados.bairro || '', cep: dados.cep || '',
    latitude: null, longitude: null, cnpj: dados.cnpj || '', telefone: dados.telefone || '', email: dados.email || '',
    site: dados.site || '', instagram: dados.instagram || '', responsavel: dados.responsavel || '', cargo: dados.cargo || '', telefoneResponsavel: dados.telefoneResponsavel || '',
    classificacao, evidencias: dados.evidencias || [], sinaisEstrutura: Number(dados.sinaisEstrutura || 0), multiplasUnidades: Boolean(dados.multiplasUnidades),
    alunosEstimados: dados.alunosEstimados || null, mensalidadeEstimada: dados.mensalidadeEstimada || null,
    status: classificacao.elegivel ? 'revisao' : 'descartada', motivoDescarte: classificacao.elegivel ? '' : classificacao.motivo,
    tentativas: 0, erro: '', criadoEm: agora(), atualizadoEm: agora(), qualificadoEm: null, enviadoKeduEm: null,
  };
  const lead = normalizarLead(base);
  const existentes = await listarLeads();
  if (existentes.some((item) => item.fingerprint === lead.fingerprint)) throw new Error('Possível duplicidade: já existe uma escola com o mesmo identificador.');
  // A inclusão manual também passa pela mesma barreira da descoberta
  // automática: primeiro garante que a UF esteja localmente disponível e
  // então compara o fingerprint com a base oficial Nexo/INEP.
  await importarUF(lead.uf, await arquivoDaUf(lead.uf));
  const baseNexo = await buscarEscolas({ uf: lead.uf });
  if (baseNexo.some((item) => fingerprint(item) === lead.fingerprint)) {
    throw new Error('Esta escola já existe na base INEP/Nexo e não deve entrar como descoberta nova.');
  }
  await salvarLead(lead, { acao: 'criado_manualmente' });
  return lead;
}

export async function adicionarEvidencia(leadId, evidencia) {
  const lead = await obterLead(leadId);
  if (!lead) throw new Error('Escola não encontrada.');
  lead.evidencias = [...(lead.evidencias || []), { id: id('evidencia'), tipo: evidencia.tipo || 'web', fonte: evidencia.fonte || 'Fonte pública', url: evidencia.url || '', descricao: evidencia.descricao || '', coletadoEm: agora() }];
  return salvarLead(lead, { acao: 'evidencia_adicionada' });
}

function extrairJsonPesquisa(texto) {
  const limpo = String(texto || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) throw new Error('A pesquisa não devolveu dados estruturados utilizáveis.');
  return JSON.parse(limpo.slice(inicio, fim + 1));
}

function primeiroValor(...valores) {
  return valores.find((valor) => String(valor || '').trim()) || '';
}

export async function enriquecerLeadAutomaticamente(leadId) {
  const lead = await obterLead(leadId);
  if (!lead) throw new Error('Escola não encontrada.');
  const config = await getConfigBuscaSocial();
  if (!config.chaveGemini) throw new Error('Configure a chave do Gemini em Configurações para a investigação automática.');
  const espelho = await obterLeadEspelho();
  const camposAlvo = espelho?.perfil?.camposPreenchidos || CAMPOS_ESPELHO;
  const prompt = `Investigue somente em fontes públicas a escola "${lead.nome}", em ${lead.municipio}/${lead.uf}, Brasil. Confirme cuidadosamente que os resultados pertencem à mesma escola usando nome, cidade e endereço. O padrão de enriquecimento exige estes campos: ${camposAlvo.join(', ')}. Busque site oficial, Instagram oficial, CNPJ, telefone com DDD, e-mail institucional, endereço, nome do responsável/mantenedor/diretor e cargo. Avalie também se é escola privada de ensino regular (não pública, técnica, curso livre ou faculdade) e sinais públicos de estrutura/porte. Não adivinhe e deixe string vazia quando não houver evidência. Responda SOMENTE com JSON válido neste formato: {"cnpj":"","telefone":"","email":"","instagram":"","site":"","endereco":"","responsavel":"","cargo":"","telefoneResponsavel":"","privadaRegular":"sim|nao|incerto","motivoClassificacao":"","sinaisEstrutura":0,"confianca":"baixa|media|alta"}.`;
  await registrarLog('enriquecimento', `Investigação pública iniciada para ${lead.nome}.`, { entidadeId: lead.id });
  const { texto, fontes } = await chamarGeminiComBusca(prompt, config.chaveGemini);
  const sugestao = extrairJsonPesquisa(texto);
  const proximo = { ...lead };
  for (const campo of CAMPOS_ESPELHO) {
    if (!String(proximo[campo] || '').trim() && String(sugestao[campo] || '').trim()) proximo[campo] = String(sugestao[campo]).trim();
  }
  if (!Number(proximo.sinaisEstrutura || 0) && Number.isFinite(Number(sugestao.sinaisEstrutura))) {
    proximo.sinaisEstrutura = Math.min(5, Math.max(0, Number(sugestao.sinaisEstrutura)));
  }
  proximo.investigacaoAutomatica = {
    executadaEm: agora(), confianca: sugestao.confianca || 'baixa',
    privadaRegular: sugestao.privadaRegular || 'incerto', motivo: sugestao.motivoClassificacao || '',
  };
  if (sugestao.privadaRegular === 'nao' && sugestao.confianca === 'alta') {
    proximo.classificacao = { elegivel: false, motivo: sugestao.motivoClassificacao || 'Fonte pública indica instituição fora do escopo', confianca: 'alta' };
    proximo.status = 'descartada';
    proximo.motivoDescarte = proximo.classificacao.motivo;
  }
  proximo.evidencias = [...(proximo.evidencias || [])];
  for (const url of [...new Set(fontes || [])]) {
    if (proximo.evidencias.some((item) => item.url === url)) continue;
    const tipo = /instagram\.com/i.test(url) ? 'instagram' : 'web';
    proximo.evidencias.push({ id: id('evidencia'), tipo, fonte: 'Pesquisa pública do Hunter', url, descricao: 'Fonte consultada na investigação automática; requer conferência humana.', coletadoEm: agora() });
  }
  const cnpj = somenteDigitos(proximo.cnpj);
  if (cnpj.length === 14) {
    try {
      const oficial = await buscarDadosCnpj(cnpj);
      proximo.telefone = primeiroValor(proximo.telefone, oficial.telefone);
      proximo.email = primeiroValor(proximo.email, oficial.email);
      proximo.endereco = primeiroValor(proximo.endereco, oficial.endereco);
      const socio = oficial.socios?.[0];
      proximo.responsavel = primeiroValor(proximo.responsavel, socio?.nome);
      proximo.cargo = primeiroValor(proximo.cargo, socio?.qualificacao);
      const url = `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
      if (!proximo.evidencias.some((item) => item.url === url)) proximo.evidencias.push({ id: id('evidencia'), tipo: 'cnpj', fonte: 'BrasilAPI / dados públicos de CNPJ', url, descricao: `${oficial.razaoSocial || proximo.nome} · ${oficial.situacaoCadastral || 'situação não informada'}`, coletadoEm: agora() });
    } catch (erro) {
      await registrarLog('enriquecimento', `CNPJ de ${lead.nome} não pôde ser validado: ${erro.message}`, { entidadeId: lead.id, nivel: 'aviso' });
    }
  }
  return salvarLead(proximo, { acao: 'investigado_automaticamente', usuario: 'Agente de investigação' });
}

export async function excluirLead(leadId) {
  await deleteRecord('hunterLeads', leadId);
  await registrarLog('deduplicacao', 'Candidato removido da fila.', { entidadeId: leadId, nivel: 'atencao' });
}

export function validarParaKedu(lead) {
  const telefone = lead.telefoneResponsavel || lead.telefone;
  const campos = {
    name: lead.responsavel, school: lead.nome, email: lead.email,
    role: lead.cargo, phone: telefone,
  };
  const faltantes = Object.entries(campos).filter(([, valor]) => !String(valor || '').trim()).map(([campo]) => campo);
  if (campos.phone && somenteDigitos(campos.phone).length < 10) faltantes.push('phone');
  if (campos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campos.email)) faltantes.push('email');
  const papeisKedu = ['Mantenedor(a)', 'Diretor(a)', 'Coordenador(a)', 'Secretário(a)', 'Professor(a)', 'Outro'];
  const cargo = String(campos.role || '').toLowerCase();
  if (/mantenedor|propriet[aá]rio|s[oó]cio|fundador/.test(cargo)) campos.role = 'Mantenedor(a)';
  else if (/diretor/.test(cargo)) campos.role = 'Diretor(a)';
  else if (/coordenador/.test(cargo)) campos.role = 'Coordenador(a)';
  else if (/secret[aá]ri/.test(cargo)) campos.role = 'Secretário(a)';
  else if (/professor/.test(cargo)) campos.role = 'Professor(a)';
  else if (!papeisKedu.includes(campos.role)) campos.role = 'Outro';
  return { pronto: [...new Set(faltantes)].length === 0, faltantes: [...new Set(faltantes)], campos };
}

export async function prepararEnvioKedu(leadId) {
  const lead = await obterLead(leadId);
  if (!['qualificada', 'aguardando_envio_kedu', 'enviada_kedu'].includes(lead?.status)) {
    throw new Error('Qualifique a escola na revisão humana antes de preparar o cadastro na kedu.');
  }
  const validacao = validarParaKedu(lead);
  if (!validacao.pronto) return validacao;
  // Preparar/abrir o formulário não desfaz a qualificação. Registros antigos
  // que ficaram presos em "aguardando" voltam para "qualificada" e podem
  // tentar novamente. Uma escola já enviada também pode ser reenviada.
  if (lead.status === 'aguardando_envio_kedu') lead.status = 'qualificada';
  lead.envioKeduStatus = 'preparado';
  lead.tentativas = Number(lead.tentativas || 0) + 1;
  lead.ultimoPreparoKeduEm = agora();
  await salvarLead(lead, { acao: 'formulario_kedu_preparado' });
  return validacao;
}

export async function confirmarEnvioKedu(leadId) {
  const lead = await obterLead(leadId);
  const validacao = validarParaKedu(lead);
  if (!validacao.pronto) throw new Error('Ainda faltam campos obrigatórios do formulário kedu.');
  lead.status = 'enviada_kedu';
  lead.envioKeduStatus = 'confirmado';
  lead.enviadoKeduEm = agora();
  return salvarLead(lead, { acao: 'enviado_kedu' });
}

export async function registrarFalhaEnvioKedu(leadId, motivo = 'O formulário da kedu não confirmou o recebimento.') {
  const lead = await obterLead(leadId);
  if (!lead) throw new Error('Escola não encontrada.');
  lead.status = 'qualificada';
  lead.envioKeduStatus = 'erro';
  lead.erroEnvioKedu = motivo;
  lead.ultimoErroKeduEm = agora();
  return salvarLead(lead, { acao: 'falha_envio_kedu' });
}

export async function qualificarLead(leadId) {
  const lead = await obterLead(leadId);
  if (!lead?.classificacao?.elegivel) throw new Error('A escola não passou pelo filtro de escopo.');
  lead.status = 'qualificada';
  lead.qualificadoEm = agora();
  return salvarLead(lead, { acao: 'qualificado' });
}

export async function descartarLead(leadId, motivo) {
  const lead = await obterLead(leadId);
  lead.status = 'descartada';
  lead.motivoDescarte = motivo || 'Descartada na revisão humana';
  return salvarLead(lead, { acao: 'descartado' });
}

async function arquivoDaUf(uf) {
  const indice = await carregarIndiceUFs();
  const item = indice.find((x) => x.uf === uf);
  if (!item) throw new Error(`UF ${uf} não encontrada no índice do Nexo.`);
  return item.arquivo;
}

export async function executarCicloTerritorial(territorioId) {
  const config = await obterConfiguracao();
  if (!config.ativo) throw new Error('O Hunter está pausado nas configurações.');
  const territorio = await getById('hunterTerritorios', territorioId);
  if (!territorio) throw new Error('Território não encontrado.');
  const run = { id: id('run'), territorioId, municipio: territorio.municipio, uf: territorio.uf, status: 'executando', iniciadoEm: agora(), concluidoEm: null, erro: '', metricas: {} };
  await put('hunterRuns', run);
  await registrarLog('territorio', `Ciclo iniciado em ${territorio.municipio}/${territorio.uf}.`, { entidadeId: run.id });
  try {
    await registrarLog('descoberta', 'Geocodificando o município e consultando o OpenStreetMap.', { entidadeId: run.id });
    const centro = await geocodificarEndereco(`${territorio.municipio}, ${territorio.uf}, Brasil`);
    const arquivo = await arquivoDaUf(territorio.uf);
    await importarUF(territorio.uf, arquivo);
    const [candidatosOsm, baseInep, leadsExistentes] = await Promise.all([
      buscarEscolasOSM(centro.lat, centro.lon, config.raioKm), buscarEscolas({ uf: territorio.uf }), listarLeads(),
    ]);
    await registrarLog('deduplicacao', `${candidatosOsm.length} registros brutos comparados com a base INEP/Nexo.`, { entidadeId: run.id });
    const cruzamento = cruzarComCenso(candidatosOsm, baseInep, distanciaKm);
    const fingerprints = new Set(leadsExistentes.map((lead) => lead.fingerprint));
    const preparados = cruzamento.novas.map((c) => candidatoParaLead(c, territorio, run.id));
    cruzamento.duplicidades.forEach((c) => {
      const lead = candidatoParaLead(c, territorio, run.id);
      lead.status = 'revisao_duplicidade';
      lead.possivelCorrespondencia = c.possivelCorrespondencia;
      preparados.push(lead);
    });
    const unicos = preparados.filter((lead) => {
      if (fingerprints.has(lead.fingerprint)) return false;
      fingerprints.add(lead.fingerprint);
      return true;
    });
    // Toda descoberta já nasce comparada ao padrão de enriquecimento. Isso
    // também cria o histórico inicial da ficha e evita leads "soltos" sem a
    // régua definida pela escola espelho.
    for (const lead of unicos) await salvarLead(lead, { acao: 'descoberto_territorialmente', usuario: 'Agente Hunter' });
    // Enriquecimento sequencial para respeitar as fontes e o limite diário.
    // A ausência de chave não impede a descoberta nem cria dados fictícios.
    const chaveBusca = (await getConfigBuscaSocial()).chaveGemini;
    if (chaveBusca) {
      const limite = Math.min(config.metaDiaria, unicos.filter((lead) => lead.classificacao.elegivel).length);
      for (const lead of unicos.filter((item) => item.classificacao.elegivel).slice(0, limite)) {
        try { await enriquecerLeadAutomaticamente(lead.id); }
        catch (erro) { await registrarLog('enriquecimento', `Falha ao investigar ${lead.nome}: ${erro.message}`, { entidadeId: lead.id, nivel: 'erro' }); }
      }
    }
    const elegiveis = unicos.filter((lead) => lead.classificacao.elegivel).length;
    const descartados = unicos.length - elegiveis;
    const ciclos = Number(territorio.ciclos || 0) + 1;
    const semNovidade = unicos.length === 0 ? Number(territorio.ciclosSemNovidade || 0) + 1 : 0;
    const cobertura = Math.min(98, Math.max(Number(territorio.cobertura || 0), 28 + ciclos * 18 + (unicos.length === 0 ? 10 : 0)));
    const atualizado = {
      ...territorio, status: 'em_andamento', ciclos, ciclosSemNovidade: semNovidade,
      cobertura, encontrados: Number(territorio.encontrados || 0) + candidatosOsm.length,
      novos: Number(territorio.novos || 0) + unicos.length, ultimaBuscaEm: agora(),
      consultas: [...(territorio.consultas || []), { em: agora(), consulta: `Escolas em raio de ${config.raioKm} km`, encontrados: candidatosOsm.length, novos: unicos.length }].slice(-30),
    };
    await atualizarTerritorio(atualizado);
    run.status = 'concluido'; run.concluidoEm = agora();
    run.metricas = { encontrados: candidatosOsm.length, existentesInep: cruzamento.matches, novos: unicos.length, elegiveis, descartados, duplicidades: cruzamento.duplicidades.length };
    await put('hunterRuns', run);
    await registrarLog('classificacao', `${elegiveis} candidatos elegíveis e ${descartados} fora do escopo.`, { entidadeId: run.id });
    await registrarLog('relatorios', `Ciclo concluído: ${unicos.length} escolas novas registradas.`, { entidadeId: run.id });
    if (semNovidade >= 3 || cobertura >= 95) await avancarTerritorioAtual(atualizado);
    return { run, territorio: atualizado, candidatos: unicos };
  } catch (erro) {
    run.status = 'erro'; run.erro = erro.message; run.concluidoEm = agora();
    await put('hunterRuns', run);
    await registrarLog('descoberta', `Falha no ciclo: ${erro.message}`, { entidadeId: run.id, nivel: 'erro' });
    throw erro;
  }
}

export async function reprocessarRun(runId) {
  const run = await getById('hunterRuns', runId);
  if (!run) throw new Error('Execução não encontrada.');
  await registrarLog('territorio', 'Reprocessamento solicitado.', { entidadeId: runId });
  return executarCicloTerritorial(run.territorioId);
}

function inicioPeriodo(tipo, inicioCustom) {
  if (tipo === 'custom' && inicioCustom) return new Date(`${inicioCustom}T00:00:00`);
  const data = new Date();
  if (tipo === 'semana') data.setDate(data.getDate() - 6);
  else if (tipo === 'mes') data.setDate(data.getDate() - 29);
  else data.setHours(0, 0, 0, 0);
  return data;
}

export async function gerarRelatorio({ periodo = 'dia', inicio = '', fim = '' } = {}) {
  const [leads, territorios, runs, config] = await Promise.all([listarLeads(), listarTerritorios(), getAll('hunterRuns'), obterConfiguracao()]);
  const de = inicioPeriodo(periodo, inicio);
  const ate = periodo === 'custom' && fim ? new Date(`${fim}T23:59:59`) : new Date();
  const noPeriodo = leads.filter((lead) => {
    const data = new Date(lead.criadoEm);
    return data >= de && data <= ate;
  });
  const runsPeriodo = runs.filter((run) => { const data = new Date(run.iniciadoEm); return data >= de && data <= ate; });
  const qualificadas = leads.filter((lead) => lead.qualificadoEm && new Date(lead.qualificadoEm) >= de && new Date(lead.qualificadoEm) <= ate);
  const enviadas = leads.filter((lead) => lead.enviadoKeduEm && new Date(lead.enviadoKeduEm) >= de && new Date(lead.enviadoKeduEm) <= ate);
  const comContato = noPeriodo.filter((lead) => lead.telefone || lead.email).length;
  const comDecisor = noPeriodo.filter((lead) => lead.responsavel && lead.cargo).length;
  const descobertos = runsPeriodo.reduce((s, run) => s + Number(run.metricas?.encontrados || 0), 0);
  const existentes = runsPeriodo.reduce((s, run) => s + Number(run.metricas?.existentesInep || 0), 0);
  const coberturaAtiva = territorios.filter((t) => t.status !== 'na_fila');
  const coberturaMedia = coberturaAtiva.length ? coberturaAtiva.reduce((s, t) => s + Number(t.cobertura || 0), 0) / coberturaAtiva.length : 0;
  const porIcp = ['A', 'B', 'C', 'D'].map((tier) => ({ tier, total: noPeriodo.filter((lead) => lead.qualificacao?.tier === tier).length }));
  const porStatus = [...new Set(leads.map((lead) => lead.status))].map((status) => ({ status, total: leads.filter((lead) => lead.status === status).length }));
  return {
    periodo: { tipo: periodo, inicio: de.toISOString(), fim: ate.toISOString() }, metaDiaria: config.metaDiaria,
    metricas: {
      encontrados: descobertos, novos: noPeriodo.length, qualificadas: qualificadas.length, enviadas: enviadas.length,
      descartadas: noPeriodo.filter((lead) => lead.status === 'descartada').length,
      revisao: leads.filter((lead) => ['revisao', 'revisao_duplicidade'].includes(lead.status)).length,
      enriquecimentoPct: noPeriodo.length ? Math.round(comContato / noPeriodo.length * 100) : 0,
      decisorPct: noPeriodo.length ? Math.round(comDecisor / noPeriodo.length * 100) : 0,
      novidadePct: descobertos ? Math.round(noPeriodo.length / descobertos * 100) : 0,
      coberturaMedia: Math.round(coberturaMedia), existentes,
    },
    porIcp, porStatus, leads: noPeriodo, territorios, runs: runsPeriodo,
  };
}

export async function historicoLead(leadId) {
  const itens = await getByIndex('hunterReviews', 'leadId', leadId);
  return itens.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}
