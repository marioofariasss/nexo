import { getMeta, setMeta } from './db.js';

/**
 * Busca automática de redes sociais usando o Gemini API com a ferramenta
 * "Grounding com Google Search" (google_search).
 *
 * Por que trocamos do Google Custom Search API para isso: o Custom Search
 * JSON API foi fechado para novos clientes pelo Google no início de 2026
 * (mesmo configurando tudo certo, contas novas recebem 403 permanente). O
 * Grounding do Gemini é um caminho diferente dentro do próprio Google — o
 * modelo Gemini decide quando buscar, executa a busca e devolve tanto uma
 * resposta em texto quanto os links das fontes usadas (groundingChunks),
 * o que é mais confiável do que tentar extrair links de um texto livre.
 *
 * Custo: com uma conta paga do Gemini (nível 1+), os modelos da família
 * Gemini 3.x dão 5.000 buscas com grounding grátis por mês; acima disso,
 * cerca de US$ 14 a cada 1.000. Para o volume deste app (enriquecimento
 * gradual, não em massa), isso tende a ficar inteiro dentro da cota
 * gratuita mensal.
 *
 * IMPORTANTE: os resultados são SUGESTÕES, não fatos confirmados — o nome
 * de uma escola pode coincidir com outro perfil, outra cidade, etc. Por
 * isso o botão que usa este serviço preenche os campos mas não salva
 * sozinho; quem usa confirma e clica em Salvar.
 */

const MODELO_GEMINI = 'gemini-3.5-flash';

export async function getConfigBuscaSocial() {
  return (await getMeta('buscaSocialConfig')) || { chaveGemini: '' };
}

export async function salvarConfigBuscaSocial(config) {
  return setMeta('buscaSocialConfig', config);
}

export async function buscaSocialConfigurada() {
  const config = await getConfigBuscaSocial();
  return Boolean(config.chaveGemini);
}

export async function chamarGeminiComBusca(prompt, chave) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`;
  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    });
  } catch (erroRede) {
    throw new Error('Não foi possível conectar à API do Gemini. Verifique sua conexão.');
  }
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new Error(corpo.error?.message || `Erro na busca (status ${resposta.status})`);
  }
  const dados = await resposta.json();
  const candidato = dados.candidates?.[0];
  const texto = (candidato?.content?.parts || []).map((p) => p.text || '').join('\n');
  const fontes = (candidato?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web?.uri)
    .filter(Boolean);
  return { texto, fontes };
}

function escolherLinkPorDominio(fontes, dominio) {
  return fontes.find((url) => url.includes(dominio)) || '';
}

/**
 * Busca sugestões de links de redes sociais para uma escola, usando o
 * Gemini com busca na web. Retorna { instagram, facebook, linkedin,
 * youtube, googleMaps } — cada um com o primeiro link encontrado nas
 * fontes citadas pelo modelo (ou vazio, se nada relevante veio).
 */
export async function buscarRedesSociais(nomeEscola, cidade) {
  const config = await getConfigBuscaSocial();
  if (!config.chaveGemini) {
    throw new Error('Configure sua chave da API do Gemini em Configurações para usar a busca automática.');
  }

  const prompt = `Encontre o perfil do Instagram, a página do Facebook, o perfil do LinkedIn, o canal do YouTube e o Google Maps da escola particular "${nomeEscola}", localizada em ${cidade}, Brasil. Se não encontrar algum desses, não invente — apenas não mencione. Responda de forma breve, listando os links encontrados.`;

  const { fontes } = await chamarGeminiComBusca(prompt, config.chaveGemini);

  return {
    instagram: escolherLinkPorDominio(fontes, 'instagram.com'),
    facebook: escolherLinkPorDominio(fontes, 'facebook.com'),
    linkedin: escolherLinkPorDominio(fontes, 'linkedin.com'),
    youtube: escolherLinkPorDominio(fontes, 'youtube.com'),
    googleMaps: fontes.find((url) => url.includes('google.com/maps') || url.includes('maps.app.goo.gl')) || '',
  };
}
