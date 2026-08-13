/**
 * Dados demográficos do IBGE — APIs públicas oficiais, sem chave, sem custo:
 * - Localidades (servicodados.ibge.gov.br/api/v1/localidades): lista de
 *   municípios por UF, com o código numérico IBGE de cada um.
 * - Agregados/SIDRA (servicodados.ibge.gov.br/api/v3/agregados): dados do
 *   Censo Demográfico 2022 por município, usando esse código.
 *
 * ATENÇÃO: estas chamadas não foram testadas ao vivo neste ambiente de
 * desenvolvimento (a rede daqui não alcança domínios externos como o do
 * IBGE) — a validação real acontece no seu navegador. O código trata erros
 * de forma defensiva (nunca quebra a página; mostra "não disponível" se
 * uma tabela específica não retornar dado pra aquele município), mas se
 * algum código de tabela/variável precisar de ajuste, é aqui que se mexe.
 *
 * Tabelas usadas (Censo Demográfico 2022, nível município = N6):
 * - 4714: População residente, área territorial e densidade demográfica
 * - 9514: População residente, por sexo e grupos de idade
 */

const BASE_LOCALIDADES = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const BASE_AGREGADOS = 'https://servicodados.ibge.gov.br/api/v3/agregados';

const cacheMunicipios = new Map(); // uf -> lista de municípios
const cacheDemografico = new Map(); // codigoIbge -> dados

const ANOS_NATALIDADE = [2020, 2021, 2022, 2023, 2024];
const CATEGORIAS_ANO_NASCIMENTO = {
  2020: 56680,
  2021: 58297,
  2022: 71500,
  2023: 77792,
  2024: 82135,
};

// Categorias de idade simples da tabela SIDRA 9514. O Censo 2022 permite
// consultar idade ano a ano no nível municipal; portanto não precisamos
// aproximar as etapas escolares com blocos de cinco anos.
const CATEGORIAS_IDADE = [
  { id: 6557, idade: 0, faixa: 'Menos de 1 ano' },
  { id: 6558, idade: 1, faixa: '1 ano' },
  { id: 6559, idade: 2, faixa: '2 anos' },
  { id: 6560, idade: 3, faixa: '3 anos' },
  { id: 6561, idade: 4, faixa: '4 anos' },
  { id: 6562, idade: 5, faixa: '5 anos' },
  { id: 6563, idade: 6, faixa: '6 anos' },
  { id: 6564, idade: 7, faixa: '7 anos' },
  { id: 6565, idade: 8, faixa: '8 anos' },
  { id: 6566, idade: 9, faixa: '9 anos' },
  { id: 6567, idade: 10, faixa: '10 anos' },
  { id: 6568, idade: 11, faixa: '11 anos' },
  { id: 6569, idade: 12, faixa: '12 anos' },
  { id: 6570, idade: 13, faixa: '13 anos' },
  { id: 6571, idade: 14, faixa: '14 anos' },
  { id: 6572, idade: 15, faixa: '15 anos' },
  { id: 6573, idade: 16, faixa: '16 anos' },
  { id: 6574, idade: 17, faixa: '17 anos' },
];

const IDADE_POR_CATEGORIA = new Map(CATEGORIAS_IDADE.map((item) => [String(item.id), item]));

export async function listarMunicipiosPorUF(uf) {
  if (cacheMunicipios.has(uf)) return cacheMunicipios.get(uf);
  const resp = await fetch(`${BASE_LOCALIDADES}/estados/${uf}/municipios`);
  if (!resp.ok) throw new Error(`Não foi possível carregar municípios do IBGE (status ${resp.status})`);
  const dados = await resp.json();
  const lista = dados.map((m) => ({ id: m.id, nome: m.nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  cacheMunicipios.set(uf, lista);
  return lista;
}

async function buscarValorAgregado(tabela, periodo, variavel, codigoIbge, classificacao) {
  let url = `${BASE_AGREGADOS}/${tabela}/periodos/${periodo}/variaveis/${variavel}?localidades=N6[${codigoIbge}]`;
  if (classificacao) url += `&classificacao=${classificacao}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`status ${resp.status}`);
  return resp.json();
}

function primeiroValorSerie(bloco) {
  const serie = bloco?.resultados?.[0]?.series?.[0]?.serie;
  if (!serie) return null;
  const valor = Object.values(serie)[0];
  return valor == null || valor === '-' || valor === '...' ? null : Number(valor);
}

async function buscarRendaDomiciliarPerCapita(codigoIbge) {
  const classificacao = '2[6794]|86[95251]|58[95253]';
  const dados = await buscarValorAgregado(10295, 2022, '13431|13534', codigoIbge, classificacao);
  const porVariavel = new Map((dados || []).map((item) => [String(item.id), item]));
  return {
    media: primeiroValorSerie(porVariavel.get('13431')),
    mediana: primeiroValorSerie(porVariavel.get('13534')),
    ano: 2022,
    fonte: 'IBGE/SIDRA, tabela 10295',
    granularidade: 'municipio',
  };
}

async function buscarSerieNascimentos(codigoIbge) {
  const periodos = ANOS_NATALIDADE.join(',');
  const categorias = ANOS_NATALIDADE.map((ano) => CATEGORIAS_ANO_NASCIMENTO[ano]).join(',');
  const classificacao = `232[${categorias}]|240[0]|2[0]`;
  const dados = await buscarValorAgregado(2609, periodos, 217, codigoIbge, classificacao);
  const resultados = dados?.[0]?.resultados || [];
  const serie = {};

  resultados.forEach((resultado) => {
    const classeAno = resultado.classificacoes?.find((c) => String(c.id) === '232');
    const rotuloAno = classeAno?.categoria ? Object.values(classeAno.categoria)[0] : null;
    const ano = Number(rotuloAno);
    const valor = resultado.series?.[0]?.serie?.[String(ano)];
    if (ANOS_NATALIDADE.includes(ano) && valor != null && valor !== '-' && valor !== '...') {
      serie[ano] = Number(valor);
    }
  });

  const anosDisponiveis = Object.keys(serie).map(Number).sort();
  const primeiro = anosDisponiveis.length ? serie[anosDisponiveis[0]] : null;
  const ultimo = anosDisponiveis.length ? serie[anosDisponiveis.at(-1)] : null;
  return {
    serie,
    variacaoPeriodoPct: primeiro > 0 && ultimo != null ? ((ultimo - primeiro) / primeiro) * 100 : null,
    fonte: 'IBGE, Estatisticas do Registro Civil/SIDRA, tabela 2609',
    criterio: 'ano de nascimento e municipio de residencia da mae',
    granularidade: 'municipio',
  };
}

/**
 * Retorna { populacaoTotal, faixasEtarias: [{ faixa, populacao }], erro }
 * para um município, a partir do Censo 2022. `erro` vem preenchido (e o
 * resto null) se a consulta falhar — a UI deve checar isso e mostrar uma
 * mensagem, nunca travar.
 */
export async function buscarDadosDemograficos(codigoIbge) {
  if (cacheDemografico.has(codigoIbge)) return cacheDemografico.get(codigoIbge);

  const resultado = {
    populacaoTotal: null,
    faixasEtarias: [],
    rendaDomiciliarPerCapita: null,
    natalidade: null,
    avisos: [],
    erro: null,
  };
  try {
    const pop = await buscarValorAgregado(4714, 2022, 93, codigoIbge);
    const serie = pop?.[0]?.resultados?.[0]?.series?.[0]?.serie;
    if (serie) {
      const valores = Object.values(serie);
      resultado.populacaoTotal = valores.length ? Number(valores[0]) : null;
    }
  } catch (err) {
    resultado.erro = `População total: ${err.message}`;
  }


  const [renda, natalidade] = await Promise.allSettled([
    buscarRendaDomiciliarPerCapita(codigoIbge),
    buscarSerieNascimentos(codigoIbge),
  ]);
  if (renda.status === 'fulfilled') resultado.rendaDomiciliarPerCapita = renda.value;
  else resultado.avisos.push(`Renda domiciliar per capita indisponivel: ${renda.reason?.message || renda.reason}`);
  if (natalidade.status === 'fulfilled') resultado.natalidade = natalidade.value;
  else resultado.avisos.push(`Serie de nascimentos indisponivel: ${natalidade.reason?.message || natalidade.reason}`);

  try {
    // 287 = idade, 2 = sexo (total), 286 = forma de declaração (total).
    // Pedimos somente 0 a 17 anos, idade por idade, que é o público da
    // educação básica regular. Isso reduz a resposta e evita dupla contagem
    // entre categorias agregadas (ex.: "5 a 9") e idades simples.
    const idsIdade = CATEGORIAS_IDADE.map((item) => item.id).join(',');
    const classificacao = `287[${idsIdade}]|2[6794]|286[113635]`;
    const idade = await buscarValorAgregado(9514, 2022, 93, codigoIbge, classificacao);
    const resultados = idade?.[0]?.resultados || idade || [];
    if (Array.isArray(resultados)) {
      resultados.forEach((r) => {
        const classificacaoIdade = r.classificacoes?.find((c) => String(c.id) === '287');
        const categoriaId = classificacaoIdade?.categoria ? Object.keys(classificacaoIdade.categoria)[0] : null;
        const categoria = IDADE_POR_CATEGORIA.get(String(categoriaId));
        const serie = r.series?.[0]?.serie;
        if (categoria && serie) {
          const valor = Object.values(serie)[0];
          if (valor != null && valor !== '-' && valor !== '...') {
            resultado.faixasEtarias.push({ idade: categoria.idade, faixa: categoria.faixa, populacao: Number(valor) });
          }
        }
      });
      resultado.faixasEtarias.sort((a, b) => a.idade - b.idade);
    }
  } catch (err) {
    // não sobrescreve erro de população total se já tiver um; concatena
    resultado.erro = resultado.erro ? `${resultado.erro} · Faixas etárias: ${err.message}` : `Faixas etárias: ${err.message}`;
  }

  cacheDemografico.set(codigoIbge, resultado);
  return resultado;
}

/**
 * Monta coortes futuras diretamente dos nascimentos observados. Não aplica
 * sobrevivência, migração nem preferência pela rede privada; esses fatores
 * entram separadamente como cenários e permanecem visíveis na interface.
 */
export function projetarCoortesEscolares(natalidade, penetracaoPrivada = null) {
  const serie = natalidade?.serie || {};
  const taxaBase = penetracaoPrivada != null ? Math.max(0, Math.min(1, penetracaoPrivada)) : 0.2;
  const cenarios = {
    conservador: Math.max(0, taxaBase * 0.75),
    base: taxaBase,
    otimista: Math.min(1, taxaBase * 1.25),
  };
  const coortes = Object.entries(serie).map(([anoTexto, nascimentos]) => {
    const ano = Number(anoTexto);
    const converter = (taxa) => Math.round(nascimentos * taxa);
    return {
      anoNascimento: ano,
      nascimentos,
      entradaCreche: ano,
      entradaPreEscola: ano + 4,
      entradaFundamentalI: ano + 6,
      entradaFundamentalII: ano + 11,
      entradaMedio: ano + 15,
      demandaPrivada: Object.fromEntries(Object.entries(cenarios).map(([nome, taxa]) => [nome, converter(taxa)])),
    };
  });
  return { coortes, cenarios, premissas: ['Sem ajuste de sobrevivencia', 'Sem ajuste de migracao', 'Conversao privada baseada na penetracao atual ou em 20% quando indisponivel'] };
}

/**
 * Agrupa as idades simples do Censo 2022 nas faixas etárias usuais das
 * etapas da educação básica. É população potencial, não estimativa de
 * procura por escola privada nem população efetivamente matriculada.
 */
export function resumirDemandaEscolar(faixasEtarias) {
  const somar = (idadeInicial, idadeFinal) => {
    const valores = faixasEtarias.filter((f) => f.idade >= idadeInicial && f.idade <= idadeFinal);
    return valores.length ? valores.reduce((total, f) => total + (Number(f.populacao) || 0), 0) : null;
  };
  const creche = somar(0, 3);
  const preEscola = somar(4, 5);
  const fundamentalI = somar(6, 10);
  const fundamentalII = somar(11, 14);
  const medio = somar(15, 17);
  return {
    creche,
    preEscola,
    educacaoInfantil: creche != null || preEscola != null ? (creche || 0) + (preEscola || 0) : null,
    fundamentalI,
    fundamentalII,
    // Alias temporário para manter compatibilidade com relatórios salvos e
    // chamadas de versões anteriores do front-end.
    fundamentalIIEMedio: fundamentalII,
    medio,
  };
}
