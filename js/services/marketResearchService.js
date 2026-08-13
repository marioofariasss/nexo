import { getChaveApiIA } from './crmService.js';
import { getById, put } from './db.js';

/**
 * Pesquisa de mercado sob demanda, usando a API da Anthropic com a
 * ferramenta de busca na web habilitada.
 *
 * Por que essa abordagem, e não "integrar o QEdu" diretamente: o QEdu
 * bloqueia acesso automatizado (robots.txt) — não dá pra consultar a
 * página deles programaticamente de forma confiável ou legítima. IDEB e
 * SAEB, as fontes originais por trás dos números que o QEdu mostra, são
 * publicados pelo INEP como arquivos abertos periódicos (não uma API de
 * consulta por escola) — bons para um enriquecimento em lote no futuro,
 * mas não para "pesquisar uma escola agora".
 *
 * O que este serviço faz: pede pra Claude buscar na web (Google) o tipo de
 * informação que entra de fato numa pesquisa de inteligência de mercado da
 * kedu (o padrão visto no relatório "Projeto Legatum"): perfil
 * socioeconômico da região/bairro, o que a escola entrega e como se
 * posiciona, e canais locais de indicação. Não pede IDEB/SAEB — isso não é
 * o que entra nesse tipo de relatório; o valor aqui é contexto de praça e
 * posicionamento, não indicador oficial de aprendizado.
 */

const MODELO = 'claude-sonnet-4-5';

export async function chaveConfiguradaParaPesquisa() {
  const chave = await getChaveApiIA();
  return Boolean(chave);
}

export async function getPesquisaSalva(escolaId) {
  return getById('pesquisaMercado', escolaId);
}

export async function pesquisarMercado(escola) {
  const chave = await getChaveApiIA();
  if (!chave) {
    throw new Error('Configure sua chave de API da Anthropic em Configurações para usar a pesquisa de mercado.');
  }

  const prompt = `Pesquise informações de mercado sobre a escola particular "${escola.nome}", em ${escola.municipio}/${escola.uf}, Brasil, no estilo de uma pesquisa de inteligência de mercado e go-to-market para o setor educacional. Procure especificamente e organize a resposta nestes tópicos:

1. Perfil da região/bairro: o que se sabe publicamente sobre o bairro ou microrregião onde a escola está (perfil socioeconômico, se é área de condomínios fechados, bairro tradicional, em expansão/adensamento vertical, público que mora ali).
2. Posicionamento e entrega: como a escola se apresenta publicamente — proposta pedagógica (bilíngue, confessional, tradicional, técnica, foco em vestibular, etc.), o que ela entrega pelo preço que cobra, e qualquer diferencial que ela mesma destaque.
3. Canais locais relevantes: associações, grupos, igrejas ou instituições de peso na região que apareçam associadas à escola ou ao público-alvo dela, se houver algo público a respeito.

Se não encontrar informação pública sobre algum tópico, diga que não encontrou — não invente. Responda em português do Brasil, direto ao ponto, organizado pelos 3 tópicos acima.`;

  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Erro da API (${resposta.status}): ${corpo.slice(0, 200)}`);
  }
  const dados = await resposta.json();

  const texto = dados.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
  const fontes = [];
  dados.content.forEach((bloco) => {
    (bloco.citations || []).forEach((c) => { if (c.url) fontes.push({ url: c.url, titulo: c.title || c.url }); });
  });
  const fontesUnicas = Array.from(new Map(fontes.map((f) => [f.url, f])).values());

  const registro = { escolaId: escola.id, texto, fontes: fontesUnicas, atualizadoEm: new Date().toISOString() };
  await put('pesquisaMercado', registro);
  return registro;
}
