import { bulkPut } from './db.js';
import { normalizarNome } from './osmDescobertaService.js';
import { distanciaKm, coordenadaValidaBrasil } from '../utils/geo.js';
import { buscarCandidatosCnpj } from './cnpjCandidateService.js';
import { buscarDadosCnpj } from './enriquecimentoService.js';

const CAMPOS_INEP = [
  'cnpj','cnpjMant','porte','mat25','mat24','matInf','matFund','matMed','matEja','matTec',
  'mensalidade','fatPotencial','capOciosa','varMatPct','sinalMat','mudancaPorte',
  'temRegular','temEja','temProf','temEad','ddd','tel','endereco','bairro','cep',
];

function tokens(nome) {
  return new Set(normalizarNome(nome || '').split(' ').filter((p) => p.length > 2));
}

function similaridade(a, b) {
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  const intersecao = [...aa].filter((p) => bb.has(p)).length;
  return intersecao / new Set([...aa, ...bb]).size;
}

function pontuar(descoberta, oficial) {
  const evidencias = [];
  const sim = similaridade(descoberta.nome, oficial.nome);
  let score = Math.round(sim * 55);
  if (sim >= 0.7) evidencias.push('nome muito semelhante');
  else if (sim >= 0.45) evidencias.push('nome parcialmente semelhante');
  const mesmoMunicipio = normalizarNome(descoberta.municipio || '') === normalizarNome(oficial.municipio || '');
  if (mesmoMunicipio) { score += 15; evidencias.push('mesmo município'); }
  const cepA = String(descoberta.cep || '').replace(/\D/g, '');
  const cepB = String(oficial.cep || '').replace(/\D/g, '');
  if (cepA.length === 8 && cepA === cepB) { score += 15; evidencias.push('mesmo CEP'); }
  const telA = String(descoberta.tel || '').replace(/\D/g, '').slice(-8);
  const telB = String(oficial.tel || '').replace(/\D/g, '').slice(-8);
  if (telA.length === 8 && telA === telB) { score += 20; evidencias.push('mesmo telefone'); }
  if (coordenadaValidaBrasil(descoberta.lat, descoberta.lon, descoberta.uf) && coordenadaValidaBrasil(oficial.lat, oficial.lon, oficial.uf)) {
    const distancia = distanciaKm(descoberta.lat, descoberta.lon, oficial.lat, oficial.lon);
    if (distancia <= 0.2) { score += 20; evidencias.push('a até 200 m'); }
    else if (distancia <= 1) { score += 14; evidencias.push('a até 1 km'); }
    else if (distancia <= 5) { score += 6; evidencias.push('a até 5 km'); }
  }
  return { score: Math.min(100, score), evidencias };
}

function resumoOficial(escola, score, evidencias) {
  return {
    id: escola.id, nome: escola.nome, municipio: escola.municipio, uf: escola.uf,
    cnpj: escola.cnpj || null, mat25: escola.mat25 ?? null, porte: escola.porte || null,
    score, evidencias,
  };
}

function vincularPorCodigo(descoberta, oficial) {
  CAMPOS_INEP.forEach((campo) => { if (oficial[campo] != null && descoberta[campo] == null) descoberta[campo] = oficial[campo]; });
  descoberta.codigoInepVinculado = oficial.id;
  descoberta.qualidadeIdentidade = {
    status: 'vinculada_ao_censo_inep', confianca: 'alta', incluirAnalise: false,
    evidencias: [...new Set([...(descoberta.qualidadeIdentidade?.evidencias || []), `Código INEP ${oficial.id} informado na fonte e confirmado automaticamente`])],
  };
}

/** Analisa todas as descobertas de uma vez e persiste a próxima ação. */
export async function processarFilaEnriquecimento(escolas, onProgress = null) {
  const oficiais = escolas.filter((e) => e.fonte !== 'osm');
  const descobertas = escolas.filter((e) => e.fonte === 'osm');
  const oficialPorId = new Map(oficiais.map((e) => [String(e.id), e]));
  const oficiaisPorLocal = new Map();
  oficiais.forEach((e) => {
    const chave = `${e.uf}|${normalizarNome(e.municipio || '')}`;
    if (!oficiaisPorLocal.has(chave)) oficiaisPorLocal.set(chave, []);
    oficiaisPorLocal.get(chave).push(e);
  });

  const contagem = {};
  for (let i = 0; i < descobertas.length; i += 1) {
    const escola = descobertas[i];
    let etapa = 'aguardando_pesquisa';
    let candidatosInep = [];
    let candidatosCnpj = [];

    if (escola.codigoInepVinculado) etapa = 'vinculada_inep';
    else if (escola.qualidadeIdentidade?.incluirAnalise === false) etapa = 'fora_escopo';
    else {
      const codigoInformado = escola.codigoInepOsm ? String(escola.codigoInepOsm).replace(/\D/g, '') : '';
      const oficialExata = codigoInformado ? oficialPorId.get(codigoInformado) : null;
      if (oficialExata) {
        vincularPorCodigo(escola, oficialExata);
        etapa = 'vinculada_inep';
      } else {
        const chave = `${escola.uf}|${normalizarNome(escola.municipio || '')}`;
        candidatosInep = (oficiaisPorLocal.get(chave) || [])
          .map((oficial) => ({ oficial, ...pontuar(escola, oficial) }))
          .filter((r) => r.score >= 48)
          .sort((a, b) => b.score - a.score).slice(0, 3)
          .map((r) => resumoOficial(r.oficial, r.score, r.evidencias));
        candidatosCnpj = await buscarCandidatosCnpj(escola);
        if (escola.cnpj) etapa = 'cnpj_identificado';
        else if (candidatosInep.length) etapa = 'revisar_inep';
        else if (candidatosCnpj.length) etapa = 'revisar_cnpj';
      }
    }

    escola.enriquecimentoFila = {
      etapa, atualizadoEm: new Date().toISOString(),
      candidatosInep, candidatosCnpj: candidatosCnpj.slice(0, 3),
    };
    contagem[etapa] = (contagem[etapa] || 0) + 1;
    if (onProgress && (i % 25 === 0 || i === descobertas.length - 1)) onProgress({ atual: i + 1, total: descobertas.length, contagem });
  }
  await bulkPut('escolas', descobertas);
  return { total: descobertas.length, contagem };
}

function candidatoCnpjAltaConfianca(escola) {
  const candidato = escola.enriquecimentoFila?.candidatosCnpj?.[0];
  if (!candidato || Number(candidato.score) < 95) return null;
  const evidencias = (candidato.evidencias || []).join(' ').toLowerCase();
  const nomeForte = /similaridade de nome (9\d|100)%/.test(evidencias);
  const enderecoForte = evidencias.includes('cep idêntico') || evidencias.includes('bairro idêntico')
    || evidencias.includes('endereço semelhante') || evidencias.includes('telefone idêntico') || evidencias.includes('e-mail idêntico');
  return nomeForte && enderecoForte ? candidato : null;
}

/** Valida na BrasilAPI e aplica apenas candidatos com nome+endereço fortes. */
export async function aplicarCnpjsAltaConfianca(escolas, onProgress = null) {
  const elegiveis = escolas.filter((e) => e.fonte === 'osm' && !e.cnpj && candidatoCnpjAltaConfianca(e));
  const ocorrenciasCnpj = new Map();
  elegiveis.forEach((escola) => {
    const cnpj = String(candidatoCnpjAltaConfianca(escola)?.cnpj || '').replace(/\D/g, '');
    ocorrenciasCnpj.set(cnpj, (ocorrenciasCnpj.get(cnpj) || 0) + 1);
  });
  // Um mesmo CNPJ sugerido para mais de um pin OSM normalmente indica
  // cadastro duplicado ou unidade/mantenedora ambígua. Esses casos ficam
  // para revisão humana em vez de criarem escolas enriquecidas duplicadas.
  const alvos = elegiveis.filter((escola) => {
    const cnpj = String(candidatoCnpjAltaConfianca(escola)?.cnpj || '').replace(/\D/g, '');
    return ocorrenciasCnpj.get(cnpj) === 1;
  });
  const alteradas = [];
  const falhas = [];
  for (let i = 0; i < alvos.length; i += 1) {
    const escola = alvos[i];
    const candidato = candidatoCnpjAltaConfianca(escola);
    try {
      const pj = await buscarDadosCnpj(candidato.cnpj);
      const mesmaUf = !escola.uf || !pj.uf || escola.uf === pj.uf;
      const mesmoMunicipio = !escola.municipio || !pj.municipio || normalizarNome(escola.municipio) === normalizarNome(pj.municipio);
      if (!mesmaUf || !mesmoMunicipio || !String(pj.situacaoCadastral).toUpperCase().includes('ATIVA')) {
        throw new Error('PJ não confirmou município/UF e situação ativa');
      }
      escola.cnpj = pj.cnpj;
      escola.email = escola.email || pj.email || null;
      if (!escola.tel && pj.telefone) escola.tel = pj.telefone;
      escola.dadosPJ = {
        razaoSocial: pj.razaoSocial, nomeFantasia: pj.nomeFantasia,
        situacaoCadastral: pj.situacaoCadastral, capitalSocial: pj.capitalSocial,
        naturezaJuridica: pj.naturezaJuridica, fonte: 'Receita Federal/BrasilAPI',
      };
      escola.qualidadeIdentidade = {
        status: 'identidade_confirmada_cnpj', confianca: 'alta', incluirAnalise: true,
        evidencias: [...new Set([...(escola.qualidadeIdentidade?.evidencias || []), 'CNPJ validado automaticamente por nome, localização e cadastro ativo'])],
      };
      escola.enriquecimentoFila.etapa = 'cnpj_identificado';
      alteradas.push(escola);
    } catch (err) { falhas.push({ id: escola.id, erro: err.message }); }
    if (onProgress) onProgress({ atual: i + 1, total: alvos.length, aplicadas: alteradas.length, falhas: falhas.length });
  }
  if (alteradas.length) await bulkPut('escolas', alteradas);
  return {
    candidatas: alvos.length,
    aplicadas: alteradas.length,
    falhas,
    duplicadasIgnoradas: elegiveis.length - alvos.length,
  };
}
