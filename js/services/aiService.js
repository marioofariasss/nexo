import { getChaveApiIA } from './crmService.js';

/**
 * Chama a API da Anthropic diretamente do navegador.
 *
 * IMPORTANTE (leia antes de usar em produção com o time todo): como este
 * app não tem backend, a chave de API fica salva no IndexedDB deste
 * navegador e é enviada em toda chamada. Qualquer pessoa com acesso ao
 * DevTools deste navegador pode ver essa chave. Isso é aceitável para uso
 * pessoal/individual, mas NÃO é recomendado para distribuir a chave da
 * empresa entre vários vendedores — considere criar uma chave de API restrita
 * (com limite de gasto) exclusiva para este uso, caso ative este recurso.
 */
const MODELO = 'claude-sonnet-4-5';

export async function chaveConfigurada() {
  const chave = await getChaveApiIA();
  return Boolean(chave);
}

export async function gerarComIA(promptTexto) {
  const chave = await getChaveApiIA();
  if (!chave) {
    throw new Error('Configure sua chave de API da Anthropic em Configurações para usar os recursos de IA.');
  }
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
      max_tokens: 500,
      messages: [{ role: 'user', content: promptTexto }],
    }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Erro da API (${resposta.status}): ${corpo.slice(0, 200)}`);
  }
  const dados = await resposta.json();
  return dados.content.map((bloco) => bloco.text || '').join('\n').trim();
}

export const TIPOS_ANALISE_IA = {
  resumo: (ctx) => `Resuma em até 4 frases o perfil comercial desta escola para um vendedor da kedu que vai ligar agora, em português do Brasil: ${ctx}`,
  potencial: (ctx) => `Você é analista comercial da kedu, agência de marketing educacional que vende planos de captação de matrículas e marketing digital para escolas particulares. Analise o potencial desta escola como cliente da kedu, listando 3 pontos fortes e 3 riscos/desafios, em português do Brasil: ${ctx}`,
  abordagem: (ctx) => `Você é vendedor da kedu (agência de marketing educacional, planos de matrículas e marketing digital para escolas). Sugira uma abordagem inicial (2-3 frases) para o primeiro contato com esta escola, destacando qual dor específica dela a kedu resolveria primeiro, em português do Brasil: ${ctx}`,
  objecoes: (ctx) => `Liste as 3 objeções mais prováveis que o responsável desta escola pode ter ao contratar a kedu (marketing/captação de matrículas), e uma resposta curta para cada, em português do Brasil: ${ctx}`,
  proximoPasso: (ctx) => `Com base no histórico abaixo, qual é o próximo melhor passo comercial a tomar com esta escola para avançar a venda dos planos da kedu? Responda em 2-3 frases, em português do Brasil: ${ctx}`,
};
