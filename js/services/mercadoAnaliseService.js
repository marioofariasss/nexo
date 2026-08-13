import { distanciaKm } from '../utils/geo.js';

/**
 * Redes/franquias educacionais conhecidas, identificadas por padrão de
 * nome no Censo Escolar. NÃO é uma base oficial de franquias — é uma
 * aproximação por palavra-chave no nome da escola, então pode ter falsos
 * negativos (rede não reconhecida) e, raramente, falsos positivos (nome
 * coincidente). Isso é avisado na interface, não escondido.
 */
const REDES_CONHECIDAS = [
  'MAPLE BEAR', 'OBJETIVO', 'ANGLO', 'COC', 'POLIEDRO', 'SEB ', 'POSITIVO',
  'ADVENTISTA', 'LA SALLE', 'SALESIANO', 'MARISTA', 'BATISTA', 'DOM BOSCO',
  'PENTAGONO', 'MOTIVO', 'ELITE', 'PH ', 'BERNOULLI', 'DECISAO', 'FARIAS BRITO',
  'ARI DE SA', 'CHRISTUS', 'UNIVERSO', 'PIO XII', 'SAGRADO CORACAO',
  'MONTESSORI', 'WALDORF', 'CENTRO EDUCACIONAL SESI', 'SESI', 'SENAI',
];

export function identificarRede(nomeEscola) {
  const nome = (nomeEscola || '').toUpperCase();
  return REDES_CONHECIDAS.find((rede) => nome.includes(rede)) || null;
}

export function agruparPorRede(escolas) {
  const grupos = new Map();
  let semRede = 0;
  escolas.forEach((e) => {
    const rede = identificarRede(e.nome);
    if (!rede) { semRede += 1; return; }
    if (!grupos.has(rede)) grupos.set(rede, []);
    grupos.get(rede).push(e);
  });
  const lista = Array.from(grupos.entries())
    .map(([rede, escs]) => ({ rede: rede.trim(), quantidade: escs.length, escolas: escs }))
    .sort((a, b) => b.quantidade - a.quantidade);
  return { redes: lista, semRedeIdentificada: semRede, totalEscolas: escolas.length };
}

/**
 * Score de Atratividade Regional (0-100). Antes usava o ICP médio das
 * escolas — removido de propósito: o ICP mede o perfil do RESPONSÁVEL de
 * uma escola específica, não a atratividade de uma região como praça de
 * mercado, que é uma pergunta diferente. Combina 6 fatores normalizados,
 * com pesos documentados aqui (não escondidos) — cada fator é mostrado
 * separadamente na UI, não só o número final, pra não virar caixa-preta.
 */
const PESOS_SCORE = {
  densidade: 0.20,        // habitantes por escola na região (mais alto = mais espaço de mercado)
  crescimento: 0.20,       // variação média de matrículas 2024 para 2025 da região
  ticketMedio: 0.20,        // mensalidade média da região (mercado de ticket mais alto = mais atrativo)
  fatPotencialPerCapita: 0.20, // faturamento potencial da região / população do município
  capacidadeOciosa: 0.10,    // ociosidade média (peso menor, sinal ambíguo — documentado na UI)
  presencaRedes: 0.10,        // % de escolas de rede conhecida (mercado validado, mas também mais disputado — peso menor, ambíguo)
};

function normalizar(valor, min, max) {
  if (valor == null || Number.isNaN(valor)) return 50; // neutro quando não há dado
  const clamped = Math.max(min, Math.min(max, valor));
  return ((clamped - min) / (max - min)) * 100;
}

export function calcularScoreOportunidade({ escolas, populacaoMunicipio }) {
  const n = escolas.length;
  const comCrescimento = escolas.filter((e) => e.varMatPct != null);
  const crescimentoMedio = comCrescimento.length ? comCrescimento.reduce((s, e) => s + e.varMatPct, 0) / comCrescimento.length : null;
  const comOciosa = escolas.filter((e) => e.capOciosa != null);
  const ociosaMedia = comOciosa.length ? comOciosa.reduce((s, e) => s + e.capOciosa, 0) / comOciosa.length : null;
  const comTicket = escolas.filter((e) => e.mensalidade != null);
  const ticketMedio = comTicket.length ? comTicket.reduce((s, e) => s + e.mensalidade, 0) / comTicket.length : null;
  const fatPotencialTotal = escolas.reduce((s, e) => s + (e.fatPotencial || 0), 0);
  const fatPerCapita = populacaoMunicipio ? fatPotencialTotal / populacaoMunicipio : null;
  const densidade = n && populacaoMunicipio ? populacaoMunicipio / n : null;
  const clusters = agruparPorRede(escolas);
  const pctRedes = n ? ((n - clusters.semRedeIdentificada) / n) * 100 : null;

  const componentes = {
    densidade: normalizar(densidade, 500, 15000),
    crescimento: normalizar(crescimentoMedio, -15, 15),
    ticketMedio: normalizar(ticketMedio, 200, 3000),
    fatPotencialPerCapita: normalizar(fatPerCapita, 0, 200),
    // ociosidade baixa = mercado mais aquecido -> inverte a escala
    capacidadeOciosa: 100 - normalizar(ociosaMedia, 0, 60),
    presencaRedes: normalizar(pctRedes, 0, 100),
  };

  const score = Object.entries(PESOS_SCORE).reduce((soma, [chave, peso]) => soma + componentes[chave] * peso, 0);
  const scoreArredondado = Math.round(score);
  const classificacao = scoreArredondado >= 70 ? 'Alta' : scoreArredondado >= 40 ? 'Média' : 'Baixa';

  return {
    score: scoreArredondado, classificacao, componentes,
    entradas: { crescimentoMedio, ociosaMedia, ticketMedio, fatPerCapita, densidade, pctRedes },
  };
}

/**
 * Ranking de concorrentes por relevância: combina porte (proxy de
 * capacidade/porte), ticket médio e proximidade do centro marcado (mais
 * perto = mais relevante pra decisão de entrada na região). Não usa mais
 * ICP — a mesma razão do Score de Atratividade acima.
 */
const PESO_PORTE = { '1-Micro (ate 50)': 1, '2-Pequeno (51-200)': 2, '3-Medio (201-500)': 3, '4-Grande (501-1000)': 4, '5-Muito Grande (1000+)': 5 };

export function calcularRanking(escolas, centro, raioKm) {
  return escolas
    .map((e) => {
      const distancia = centro ? distanciaKm(centro.lat, centro.lon, e.lat, e.lon) : null;
      const proximidadeScore = distancia != null && raioKm ? Math.max(0, 100 - (distancia / raioKm) * 100) : 50;
      const porteScore = ((PESO_PORTE[e.porte] || 0) / 5) * 100;
      const ticketScore = e.mensalidade != null ? normalizar(e.mensalidade, 200, 3000) : 50;
      const relevancia = ticketScore * 0.45 + porteScore * 0.3 + proximidadeScore * 0.25;
      return { ...e, distanciaKm: distancia, relevancia: Math.round(relevancia) };
    })
    .sort((a, b) => b.relevancia - a.relevancia);
}

/**
 * Funil de mercado: do endereçável total até as oportunidades qualificadas.
 * "Escolas alvo" e "top oportunidades" agora usam ticket + capacidade
 * ociosa (não mais ICP) pra qualificar.
 */
export function montarFunil({ populacaoMunicipio, populacaoIdadeEscolar, matriculasRegiao, escolasAlvo, topOportunidades }) {
  return [
    { label: 'População total do município (IBGE)', valor: populacaoMunicipio },
    { label: 'População em idade escolar (0-19, IBGE)', valor: populacaoIdadeEscolar },
    { label: 'Matrículas existentes na região (Censo)', valor: matriculasRegiao },
    { label: 'Escolas com ticket acima da média regional', valor: escolasAlvo },
    { label: 'Top oportunidades (ticket alto + capacidade ociosa)', valor: topOportunidades },
  ].filter((etapa) => etapa.valor != null);
}

/**
 * Análise crítica e construtiva da região — 100% regras determinísticas
 * sobre números já calculados (nunca texto de IA aqui, mesmo princípio do
 * "Relatório da região"): cada frase é rastreável a um dado específico já
 * mostrado na tela, com o limiar (threshold) usado documentado no código,
 * não escondido. "Crítica" no sentido duplo: aponta riscos do mercado E
 * limitações da própria base de dados usada — não só elogia.
 */
export function gerarAnaliseCritica({ escolas, scoreOportunidade, demandaEscolar, populacaoIdadeEscolar, matriculasRegiao, clusters, ticketMedioNacional, raioKm }) {
  // cada achado nasce com um quadrante SWOT já atribuído — uma única fonte
  // de verdade, em vez de manter listas separadas que podem divergir.
  // S = Força (interno, positivo) · W = Fraqueza (interno, negativo)
  // O = Oportunidade (externo, positivo) · T = Ameaça (externo, negativo)
  const achados = [];
  const limitacoesDados = [];
  const { entradas } = scoreOportunidade;

  if (entradas.crescimentoMedio != null) {
    if (entradas.crescimentoMedio >= 5) {
      achados.push({ q: 'S', t: `Matrículas em alta na região (${entradas.crescimentoMedio.toFixed(1)}% em média, 2024 para 2025) — mercado em expansão, não estagnado.` });
    } else if (entradas.crescimentoMedio <= -5) {
      achados.push({ q: 'T', t: `Matrículas em queda na região (${entradas.crescimentoMedio.toFixed(1)}% em média, 2024 para 2025) — vale entender se é retração de demanda geral ou perda pra concorrentes específicos antes de investir aqui.` });
    }
  } else {
    limitacoesDados.push('Sem dado de variação de matrículas suficiente pra avaliar tendência de crescimento da região.');
  }

  if (entradas.ticketMedio != null && ticketMedioNacional) {
    const razao = entradas.ticketMedio / ticketMedioNacional;
    if (razao >= 1.15) {
      achados.push({ q: 'S', t: `Ticket médio da região (${Math.round(entradas.ticketMedio)}) está ${Math.round((razao - 1) * 100)}% acima da média nacional — mercado com maior capacidade de pagamento.` });
    } else if (razao <= 0.85) {
      achados.push({ q: 'W', t: `Ticket médio da região (${Math.round(entradas.ticketMedio)}) está ${Math.round((1 - razao) * 100)}% abaixo da média nacional — orçamento comercial das famílias pode ser mais limitado aqui.` });
    }
  }

  if (entradas.ociosaMedia != null) {
    if (entradas.ociosaMedia >= 35) {
      achados.push({ q: 'W', t: `Capacidade ociosa média alta (${Math.round(entradas.ociosaMedia)}%) — pode indicar mercado com dificuldade recente de captação, ou seja, mais resistência a um produto/serviço novo.` });
      achados.push({ q: 'O', t: `A mesma ociosidade alta (${Math.round(entradas.ociosaMedia)}%) significa espaço pra crescer nas escolas já existentes sem precisar de infraestrutura nova — argumento de venda pra elas.` });
    } else if (entradas.ociosaMedia <= 10) {
      achados.push({ q: 'S', t: `Capacidade ociosa baixa (${Math.round(entradas.ociosaMedia)}%) — escolas da região majoritariamente cheias, sinal de demanda aquecida.` });
    }
  }

  let maiorRedeInfo = null;
  if (clusters && clusters.totalEscolas > 0) {
    const maiorRede = clusters.redes[0];
    const pctMaiorRede = maiorRede ? (maiorRede.quantidade / clusters.totalEscolas) * 100 : 0;
    if (pctMaiorRede >= 25) {
      maiorRedeInfo = { rede: maiorRede.rede, pct: pctMaiorRede };
      achados.push({ q: 'T', t: `Mercado concentrado: a rede ${maiorRede.rede} sozinha responde por ${Math.round(pctMaiorRede)}% das escolas identificadas na região — barreira de entrada mais alta, marca já consolidada localmente.` });
    } else if (clusters.semRedeIdentificada / clusters.totalEscolas >= 0.7) {
      achados.push({ q: 'O', t: `Mercado fragmentado: ${Math.round((clusters.semRedeIdentificada / clusters.totalEscolas) * 100)}% das escolas são independentes ou de rede não identificada — menos concorrência de marca consolidada, mais espaço de diferenciação.` });
    }
  }

  let pctAtendido = null;
  if (populacaoIdadeEscolar != null && matriculasRegiao != null) {
    pctAtendido = populacaoIdadeEscolar > 0 ? (matriculasRegiao / populacaoIdadeEscolar) * 100 : null;
    if (pctAtendido != null && pctAtendido < 40) {
      achados.push({ q: 'O', t: `Só cerca de ${Math.round(pctAtendido)}% da população em idade escolar do município está matriculada em escola particular na região mapeada — gap grande de demanda potencial (mas repara: essa população inclui quem já estuda em escola pública, então não é tudo endereçável pro privado).` });
    } else if (pctAtendido != null && pctAtendido > 90) {
      limitacoesDados.push(`A comparação demanda/oferta deu ${Math.round(pctAtendido)}% — próximo ou acima de 100% geralmente indica erro de escala entre o dado do IBGE (população do MUNICÍPIO inteiro) e o do Censo (matrículas só no RAIO marcado, que pode ser menor que o município) — trate esse número com cautela, não como um "mercado praticamente saturado" de verdade.`);
    }
  }

  const semDadosComerciais = escolas.filter((e) => e.mensalidade == null).length;
  const pctSemDados = escolas.length ? Math.round((semDadosComerciais / escolas.length) * 100) : 0;
  if (semDadosComerciais > 0) {
    limitacoesDados.push(`${fmtIntLocal(semDadosComerciais)} de ${fmtIntLocal(escolas.length)} escolas na região (${pctSemDados}%) não têm ticket médio nem matrículas conhecidas (descobertas via mapeamento, fora do Censo) — os números de ticket médio e faturamento potencial desta análise são calculados só sobre as que têm dado, não sobre a região inteira.`);
  }
  if (raioKm <= 2) {
    limitacoesDados.push(`Raio de ${raioKm}km é pequeno — bom pra um bairro específico, mas a amostra de escolas pode ser pequena demais pra generalizar sobre a região toda. Considera repetir com um raio maior pra comparar.`);
  }

  const porQuadrante = (q) => achados.filter((a) => a.q === q).map((a) => a.t);
  const swot = { forcas: porQuadrante('S'), fraquezas: porQuadrante('W'), oportunidades: porQuadrante('O'), ameacas: porQuadrante('T') };

  // recomendação-síntese: o Score de Atratividade manda no tom (resumo
  // quantitativo de tudo), os achados entram só como contexto — nunca
  // contradizendo o score, que já pesa os mesmos fatores
  const contexto = swot.ameacas.length + swot.fraquezas.length > swot.forcas.length + swot.oportunidades.length
    ? ' Os pontos negativos superam os positivos nesta análise.'
    : swot.forcas.length + swot.oportunidades.length > swot.ameacas.length + swot.fraquezas.length
      ? ' Os pontos positivos superam os negativos nesta análise.'
      : '';
  let recomendacao;
  if (scoreOportunidade.classificacao === 'Alta') {
    recomendacao = `Score de Atratividade ${scoreOportunidade.score}/100 (Alta) — cenário favorável pra prospecção nesta região.${contexto}`;
  } else if (scoreOportunidade.classificacao === 'Baixa') {
    recomendacao = `Score de Atratividade ${scoreOportunidade.score}/100 (Baixa) — região exige mais cautela; vale cruzar com conhecimento local antes de decidir investir aqui.${contexto}`;
  } else {
    recomendacao = `Score de Atratividade ${scoreOportunidade.score}/100 (Média) — cenário misto, nem claramente favorável nem desfavorável.${contexto}`;
  }

  return {
    pontosFortes: [...swot.forcas, ...swot.oportunidades],
    pontosAtencao: [...swot.fraquezas, ...swot.ameacas],
    limitacoesDados,
    recomendacao,
    swot,
    contextoInterno: { pctAtendido, semDadosComerciais, pctSemDados, maiorRedeInfo },
  };
}

/**
 * Plano de ação: passos concretos derivados diretamente dos achados acima
 * (não uma lista genérica fixa) — cada item existe porque um dado
 * específico da análise apontou pra ele.
 */
export function gerarPlanoAcao({ analiseCritica, escolas, raioKm, porteReferencia }) {
  const passos = [];
  const { swot, contextoInterno } = analiseCritica;

  if (contextoInterno.semDadosComerciais > 0) {
    passos.push(`Completar CNPJ/ticket das ${fmtIntLocal(contextoInterno.semDadosComerciais)} escolas descobertas via mapeamento (fora do Censo) na aba Institucional de cada ficha — hoje ${contextoInterno.pctSemDados}% da região está sem esse dado, o que limita a precisão desta análise.`);
  }
  if (raioKm <= 2) {
    passos.push('Repetir esta análise com um raio maior (ex: 5-10km) pra confirmar se o padrão se sustenta numa amostra maior antes de decidir com base só neste recorte.');
  }
  if (swot.oportunidades.some((t) => t.includes('fragmentado'))) {
    passos.push('Priorizar contato com as escolas independentes/sem rede identificada no ranking — é onde a diferenciação tem mais chance de funcionar, com menos resistência de marca já estabelecida.');
  }
  if (contextoInterno.maiorRedeInfo) {
    passos.push(`Mapear especificamente o posicionamento da rede ${contextoInterno.maiorRedeInfo.rede} nesta região antes de definir a abordagem — ela domina ${Math.round(contextoInterno.maiorRedeInfo.pct)}% do mercado local, então a proposta precisa deixar claro o que oferece de diferente.`);
  }
  if (swot.ameacas.some((t) => t.includes('queda'))) {
    passos.push('Investigar a causa da queda de matrículas antes de investir na região — conversar com 2-3 escolas da lista de ranking pra entender se é problema pontual delas ou tendência regional.');
  }
  if (swot.forcas.some((t) => t.includes('Ticket médio')) || swot.oportunidades.length) {
    passos.push('Selecionar as 10-15 escolas de maior relevância no ranking (já ordenadas) pra iniciar o primeiro ciclo de contato/prospecção.');
  }
  passos.push('Salvar este mapeamento no histórico e repetir a análise em 60-90 dias pra comparar a evolução dos indicadores (crescimento, ociosidade, ticket) da mesma região.');

  return passos;
}

/**
 * Estratégia de entrada em fases (Go-to-Market), adaptada do padrão visto
 * em pesquisas de mercado de referência da kedu — mas genérica o
 * suficiente pra qualquer produto/serviço vendido pra escolas, já que o
 * Radar não é específico de um segmento. O conteúdo de cada fase varia
 * conforme as características reais da região (concentração de mercado,
 * fragmentação, tamanho da amostra), não é texto fixo.
 */
export function gerarGoToMarket({ analiseCritica, escolas, raioKm, ranking }) {
  const { swot } = analiseCritica;
  const fragmentado = swot.oportunidades.some((t) => t.includes('fragmentado'));
  const concentrado = swot.ameacas.some((t) => t.includes('concentrado'));
  const topNomes = ranking.slice(0, 5).map((e) => e.nome);

  const fase1 = {
    titulo: 'Fase 1 — Validação silenciosa',
    itens: [
      `Contato inicial com as ${Math.min(5, topNomes.length)} escolas de maior relevância no ranking desta região (${topNomes.join(', ')}${ranking.length > 5 ? '...' : ''}), sem campanha aberta — objetivo é validar a proposta com o mercado real antes de escalar.`,
      fragmentado
        ? 'Aproveitar a fragmentação do mercado: cada escola independente decide sozinha, sem precisar de aprovação de rede — ciclo de venda tende a ser mais rápido.'
        : concentrado
          ? 'Priorizar as escolas fora da rede dominante primeiro — decisão mais rápida, sem precisar convencer uma estrutura corporativa maior.'
          : 'Mapear quem decide em cada escola-alvo (diretor, mantenedor) antes do primeiro contato.',
    ],
  };
  const fase2 = {
    titulo: 'Fase 2 — Expansão dentro da região',
    itens: [
      'Com 2-3 casos de sucesso validados na Fase 1, usar como prova social pra abordar o restante das escolas do ranking desta região.',
      'Reavaliar o Score de Atratividade e os indicadores (crescimento, ociosidade) depois de 60-90 dias pra confirmar se a região continua valendo o investimento de expansão.',
    ],
  };
  const fase3 = {
    titulo: 'Fase 3 — Escala e replicação',
    itens: [
      'Documentar o que funcionou nesta região (tipo de escola que converteu, argumento que ressoou) pra reaplicar em regiões com Score de Atratividade parecido.',
      `Repetir o mapeamento (Mapear Mercado) em raio maior ou em municípios vizinhos com características parecidas (ticket médio, fragmentação) às desta região.`,
    ],
  };
  return [fase1, fase2, fase3];
}

/**
 * Concentração de mercado da região: quem são as escolas que mais pesam
 * no volume total de matrículas, e o quanto o mercado depende de poucas
 * escolas grandes (ou está pulverizado entre muitas pequenas). Mesma
 * lógica de market share já usada por escola individual
 * (`escolaService.calcularPosicaoNaRegiao`), aqui agregada pra região
 * inteira — não depende de nenhuma fonte nova, só do que já foi
 * carregado nesta análise.
 */
export function calcularConcentracaoMercado(escolas) {
  const comMatriculas = escolas.filter((e) => e.mat25 != null).sort((a, b) => b.mat25 - a.mat25);
  const totalMatriculas = comMatriculas.reduce((s, e) => s + e.mat25, 0);
  if (!comMatriculas.length || !totalMatriculas) {
    return { top: [], totalMatriculas: 0, concentracaoTop3: null, concentracaoTop5: null, concentracaoTop10: null, totalComDado: 0 };
  }

  const somaTop = (n) => comMatriculas.slice(0, n).reduce((s, e) => s + e.mat25, 0);
  const top = comMatriculas.slice(0, 10).map((e) => ({ ...e, marketShare: (e.mat25 / totalMatriculas) * 100 }));

  return {
    top,
    totalMatriculas,
    totalComDado: comMatriculas.length,
    concentracaoTop3: comMatriculas.length >= 1 ? (somaTop(3) / totalMatriculas) * 100 : null,
    concentracaoTop5: comMatriculas.length >= 1 ? (somaTop(5) / totalMatriculas) * 100 : null,
    concentracaoTop10: comMatriculas.length >= 1 ? (somaTop(10) / totalMatriculas) * 100 : null,
  };
}

function fmtIntLocal(n) {
  return Math.round(n || 0).toLocaleString('pt-BR');
}
