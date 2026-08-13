import { getById, put } from './db.js';

/**
 * Busca dados públicos de CNPJ na BrasilAPI (espelha o Cadastro Nacional da
 * Pessoa Jurídica da Receita Federal — fonte pública, gratuita, sem
 * necessidade de chave de API). Inclui razão social, situação cadastral,
 * natureza jurídica, CNAE, endereço e o quadro de sócios e administradores
 * (QSA) quando disponível, com CPF já mascarado pela própria fonte.
 *
 * IMPORTANTE (LGPD): usamos apenas esta fonte pública oficial. Não fazemos
 * scraping de sites, redes sociais ou qualquer base privada/restrita. Se a
 * BrasilAPI não retornar um dado (ex: e-mail, sócios), o campo fica vazio —
 * o app nunca tenta adivinhar ou completar com outra fonte não pública.
 */
const BRASILAPI_BASE = 'https://brasilapi.com.br/api/cnpj/v1/';

function limparCnpj(cnpj) {
  const digitos = String(cnpj || '').replace(/\D/g, '');
  // O JSON semente preserva alguns CNPJs como número; nesse formato o zero
  // inicial desaparece. Recompõe os 14 dígitos antes da consulta pública.
  return digitos && digitos.length < 14 ? digitos.padStart(14, '0') : digitos;
}

export async function getEnriquecimentoCache(cnpj) {
  return getById('enriquecimentoCnpj', limparCnpj(cnpj));
}

export async function buscarDadosCnpj(cnpj, { forcarAtualizacao = false } = {}) {
  const cnpjLimpo = limparCnpj(cnpj);
  if (!cnpjLimpo || cnpjLimpo.length !== 14) {
    throw new Error('CNPJ inválido ou não informado pelo Censo para esta escola.');
  }

  if (!forcarAtualizacao) {
    const cache = await getEnriquecimentoCache(cnpjLimpo);
    if (cache) return cache;
  }

  let resposta;
  try {
    resposta = await fetch(`${BRASILAPI_BASE}${cnpjLimpo}`);
  } catch (erroRede) {
    throw new Error('Não foi possível conectar à base pública de CNPJ agora. Verifique sua conexão e tente novamente.');
  }
  if (!resposta.ok) {
    if (resposta.status === 404) throw new Error('CNPJ não encontrado na base pública da Receita Federal.');
    throw new Error(`Erro ao consultar CNPJ (status ${resposta.status}). Tente novamente em alguns instantes.`);
  }
  const dados = await resposta.json();

  const registro = {
    cnpj: cnpjLimpo,
    buscadoEm: new Date().toISOString(),
    razaoSocial: dados.razao_social || '',
    nomeFantasia: dados.nome_fantasia || '',
    situacaoCadastral: dados.descricao_situacao_cadastral || '',
    dataAbertura: dados.data_inicio_atividade || '',
    naturezaJuridica: dados.natureza_juridica || (dados.qsa && dados.qsa.length ? '' : ''),
    capitalSocial: dados.capital_social ?? null,
    cnaeFiscal: dados.cnae_fiscal_descricao || '',
    cnaesSecundarios: (dados.cnaes_secundarios || []).map((c) => c.descricao),
    endereco: [dados.descricao_tipo_de_logradouro, dados.logradouro, dados.numero, dados.bairro].filter(Boolean).join(', '),
    municipio: dados.municipio || '',
    uf: dados.uf || '',
    cep: dados.cep || '',
    telefone: [dados.ddd_telefone_1, dados.ddd_telefone_2].filter(Boolean).join(' / '),
    email: dados.email || '',
    socios: (dados.qsa || []).map((s) => ({
      nome: s.nome_socio || '',
      qualificacao: s.qualificacao_socio || '',
      dataEntrada: s.data_entrada_sociedade || '',
      cpfMascarado: s.cnpj_cpf_do_socio || '',
    })),
  };

  await put('enriquecimentoCnpj', registro);
  return registro;
}
