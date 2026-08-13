/**
 * Gera o relatório executivo em PDF do Mapear Mercado — capa, sumário,
 * cenário, matriz SWOT, benchmarking, go-to-market e plano de ação.
 *
 * Princípio mantido do "Relatório da região" original: todo o TEXTO vem de
 * `gerarAnaliseCritica`/`gerarPlanoAcao`/`gerarGoToMarket`
 * (js/services/mercadoAnaliseService.js) — regras determinísticas sobre
 * números já calculados, nunca IA. Este arquivo só cuida do DESENHO
 * (layout, cores, posicionamento) — não decide o conteúdo.
 *
 * Paleta usada é a mesma do app (assets/css/tokens.css): navy #003F59,
 * accent #0B5C7D, verde #0F8A5F (positivo), âmbar #C08A1E (atenção),
 * cinza #93A5AD (neutro).
 */

const COR = {
  navy: [0, 63, 89],
  navy2: [6, 58, 80],
  accent: [11, 92, 125],
  verde: [15, 138, 95],
  ambar: [192, 138, 30],
  vermelho: [178, 58, 58],
  cinza: [147, 165, 173],
  textoClaro: [255, 255, 255],
  textoEscuro: [26, 42, 51],
  textoMuted: [100, 116, 124],
  fundoClaro: [244, 247, 249],
};

const MARGEM = 16;

export function gerarRelatorioPdf({ jsPDF, dados }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const larguraUtil = larguraPagina - MARGEM * 2;

  const ctx = { doc, larguraPagina, alturaPagina, larguraUtil, y: MARGEM, pagina: 1 };

  desenharCapa(ctx, dados);
  novaPagina(ctx, dados, 'Sumário Executivo');
  desenharSumarioExecutivo(ctx, dados);

  novaPagina(ctx, dados, 'Cenário de Mercado');
  desenharCenarioMercado(ctx, dados);

  novaPagina(ctx, dados, 'Matriz SWOT');
  desenharSwot(ctx, dados);

  novaPagina(ctx, dados, 'Mapeamento Competitivo');
  desenharRanking(ctx, dados);

  novaPagina(ctx, dados, 'Estratégia de Entrada (Go-to-Market)');
  desenharGoToMarket(ctx, dados);

  novaPagina(ctx, dados, 'Plano de Ação');
  desenharPlanoAcao(ctx, dados);
  desenharLimitacoes(ctx, dados);

  return doc;
}

// ---------------------------------------------------------------------
// Utilitários de desenho
// ---------------------------------------------------------------------

function checarQuebra(ctx, alturaNecessaria) {
  if (ctx.y + alturaNecessaria > ctx.alturaPagina - 18) {
    ctx.doc.addPage();
    ctx.pagina += 1;
    ctx.y = MARGEM;
    desenharRodape(ctx);
  }
}

function desenharRodape(ctx) {
  const { doc, alturaPagina, larguraPagina } = ctx;
  doc.setFontSize(8);
  doc.setTextColor(...COR.textoMuted);
  doc.setFont(undefined, 'bold');
  doc.text('NEXO', MARGEM, alturaPagina - 10);
  doc.setFont(undefined, 'normal');
  doc.text(' — Inteligência de mercado para escolas', MARGEM + doc.getTextWidth('NEXO'), alturaPagina - 10);
  doc.text(`Página ${ctx.pagina}`, larguraPagina - MARGEM, alturaPagina - 10, { align: 'right' });
}

/**
 * Marca d'água diagonal, bem clara, atravessando o conteúdo — presente em
 * toda página de conteúdo (não só capa/rodapé), pra deixar a origem do
 * relatório evidente mesmo se alguém repassar só uma página solta ou um
 * print de uma seção específica.
 */
function desenharMarcaDagua(ctx) {
  const { doc, larguraPagina, alturaPagina } = ctx;
  doc.setFontSize(60);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(230, 236, 239);
  doc.text('NEXO', larguraPagina / 2, alturaPagina / 2, { align: 'center', angle: 35 });
  doc.setTextColor(...COR.textoEscuro);
}

function novaPagina(ctx, dados, tituloSecao) {
  ctx.doc.addPage();
  ctx.pagina += 1;
  ctx.y = MARGEM;
  desenharMarcaDagua(ctx);
  desenharCabecalhoSecao(ctx, dados, tituloSecao);
  desenharRodape(ctx);
}

function desenharSeloNexo(ctx, x, y, escala = 1) {
  const { doc } = ctx;
  doc.setFillColor(...COR.accent);
  doc.roundedRect(x, y, 8 * escala, 8 * escala, 1.5 * escala, 1.5 * escala, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9 * escala);
  doc.setFont(undefined, 'bold');
  doc.text('N', x + 4 * escala, y + 5.6 * escala, { align: 'center' });
}

function desenharCabecalhoSecao(ctx, dados, titulo) {
  const { doc, larguraPagina } = ctx;
  doc.setFillColor(...COR.navy);
  doc.rect(0, 0, larguraPagina, 22, 'F');
  desenharSeloNexo(ctx, MARGEM, 4.5);
  doc.setTextColor(...COR.textoClaro);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text(titulo, MARGEM + 11, 14);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...COR.cinza);
  doc.text(dados.tituloRegiao, larguraPagina - MARGEM, 14, { align: 'right' });
  ctx.y = 30;
  doc.setTextColor(...COR.textoEscuro);
}

function tituloBloco(ctx, texto, tamanho = 12) {
  checarQuebra(ctx, 10);
  const { doc } = ctx;
  doc.setFontSize(tamanho);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...COR.navy);
  doc.text(texto, MARGEM, ctx.y);
  ctx.y += tamanho === 12 ? 6 : 5;
  doc.setTextColor(...COR.textoEscuro);
}

function paragrafo(ctx, texto, { tamanho = 9.5, cor = COR.textoEscuro, alturaLinha = 4.6 } = {}) {
  const { doc, larguraUtil } = ctx;
  doc.setFontSize(tamanho);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...cor);
  const linhas = doc.splitTextToSize(texto, larguraUtil);
  checarQuebra(ctx, linhas.length * alturaLinha);
  doc.text(linhas, MARGEM, ctx.y);
  ctx.y += linhas.length * alturaLinha;
}

function listaComMarcador(ctx, itens, { corMarcador = COR.accent, tamanho = 9, alturaLinha = 4.3 } = {}) {
  const { doc, larguraUtil } = ctx;
  itens.forEach((item) => {
    doc.setFontSize(tamanho);
    doc.setFont(undefined, 'normal');
    const linhas = doc.splitTextToSize(item, larguraUtil - 6);
    checarQuebra(ctx, linhas.length * alturaLinha + 1);
    doc.setFillColor(...corMarcador);
    doc.circle(MARGEM + 1.2, ctx.y - 1.3, 0.9, 'F');
    doc.setTextColor(...COR.textoEscuro);
    doc.text(linhas, MARGEM + 5, ctx.y);
    ctx.y += linhas.length * alturaLinha + 1.5;
  });
}

function kpiRow(ctx, itens) {
  const { doc, larguraUtil } = ctx;
  const larguraCard = (larguraUtil - (itens.length - 1) * 4) / itens.length;
  const alturaCard = 20;
  checarQuebra(ctx, alturaCard + 4);
  itens.forEach((item, i) => {
    const x = MARGEM + i * (larguraCard + 4);
    doc.setFillColor(...COR.fundoClaro);
    doc.roundedRect(x, ctx.y, larguraCard, alturaCard, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...COR.textoMuted);
    doc.text(item.label, x + 3, ctx.y + 6, { maxWidth: larguraCard - 6 });
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...COR.navy);
    doc.text(String(item.valor), x + 3, ctx.y + 15, { maxWidth: larguraCard - 6 });
  });
  ctx.y += alturaCard + 6;
}

// ---------------------------------------------------------------------
// Capa
// ---------------------------------------------------------------------

function desenharCapa(ctx, dados) {
  const { doc, larguraPagina, alturaPagina } = ctx;
  doc.setFillColor(...COR.navy);
  doc.rect(0, 0, larguraPagina, alturaPagina, 'F');
  doc.setFillColor(...COR.navy2);
  doc.rect(0, alturaPagina - 60, larguraPagina, 60, 'F');

  // wordmark grande no topo — a primeira coisa que se vê ao abrir o PDF
  desenharSeloNexo(ctx, MARGEM, 22, 1.6);
  doc.setTextColor(...COR.textoClaro);
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('NEXO', MARGEM + 17, 22 + 9.5);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...COR.cinza);
  doc.text('Inteligência de mercado para escolas', MARGEM + 17, 22 + 16);

  doc.setTextColor(...COR.cinza);
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text('RELATÓRIO DE INTELIGÊNCIA DE MERCADO', MARGEM, 60);

  doc.setTextColor(...COR.textoClaro);
  doc.setFontSize(28);
  doc.setFont(undefined, 'bold');
  const linhasTitulo = doc.splitTextToSize(dados.tituloRegiao, larguraPagina - MARGEM * 2);
  doc.text(linhasTitulo, MARGEM, 78);

  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...COR.cinza);
  doc.text(`Raio de ${dados.raioKm}km · Gerado em ${new Date().toLocaleDateString('pt-BR')}`, MARGEM, 78 + linhasTitulo.length * 10 + 6);

  const kpis = [
    { label: 'ESCOLAS NO RAIO', valor: dados.fmtInt(dados.escolas.length) },
    { label: 'MATRÍCULAS', valor: dados.fmtInt(dados.totalMat) },
    { label: 'TICKET MÉDIO', valor: dados.ticketMedio != null ? dados.fmtMoedaCompacta(dados.ticketMedio) : '-' },
    { label: 'SCORE ATRATIVIDADE', valor: `${dados.scoreOportunidade.score}/100` },
  ];
  const larguraCard = (larguraPagina - MARGEM * 2 - 3 * 6) / 4;
  kpis.forEach((k, i) => {
    const x = MARGEM + i * (larguraCard + 6);
    doc.setFontSize(8);
    doc.setTextColor(...COR.cinza);
    doc.text(k.label, x, alturaPagina - 38);
    doc.setFontSize(17);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...COR.textoClaro);
    doc.text(k.valor, x, alturaPagina - 27);
    doc.setFont(undefined, 'normal');
  });

  doc.setFontSize(8);
  doc.setTextColor(...COR.cinza);
  doc.text('Fonte: Censo Escolar INEP · OpenStreetMap · IBGE (Censo Demográfico 2022) · gerado pelo Nexo', MARGEM, alturaPagina - 12);
}

// ---------------------------------------------------------------------
// Sumário executivo
// ---------------------------------------------------------------------

function desenharSumarioExecutivo(ctx, dados) {
  const { fmtInt, fmtMoedaCompacta } = dados;
  kpiRow(ctx, [
    { label: 'Escolas no raio', valor: fmtInt(dados.escolas.length) },
    { label: 'Matrículas', valor: fmtInt(dados.totalMat) },
    { label: 'Ticket médio', valor: dados.ticketMedio != null ? fmtMoedaCompacta(dados.ticketMedio) : '-' },
    { label: 'Score Atratividade', valor: `${dados.scoreOportunidade.score}/100` },
  ]);

  tituloBloco(ctx, 'Síntese');
  paragrafo(ctx, dados.analiseCritica.recomendacao, { tamanho: 10.5 });
  ctx.y += 3;

  const { swot } = dados.analiseCritica;
  paragrafo(ctx, `Identificados ${swot.forcas.length} pontos fortes, ${swot.oportunidades.length} oportunidades, ${swot.fraquezas.length} fraquezas e ${swot.ameacas.length} ameaças nesta região — ver Matriz SWOT completa adiante.`, { cor: COR.textoMuted });
  ctx.y += 4;

  tituloBloco(ctx, 'O que este relatório cobre');
  listaComMarcador(ctx, [
    'Cenário de mercado: números da região e comparação com a média nacional.',
    'Matriz SWOT: forças, fraquezas, oportunidades e ameaças específicas desta região.',
    'Mapeamento competitivo: ranking das escolas mais relevantes pra prospecção.',
    'Go-to-market: estratégia de entrada em 3 fases.',
    'Plano de ação: próximos passos concretos, derivados dos achados desta análise.',
  ]);
}

// ---------------------------------------------------------------------
// Cenário de mercado
// ---------------------------------------------------------------------

function desenharCenarioMercado(ctx, dados) {
  const { fmtInt, fmtMoedaCompacta } = dados;
  tituloBloco(ctx, 'Números da região');
  const linhasInfo = [
    `População do município (IBGE): ${dados.demografia?.populacaoTotal != null ? fmtInt(dados.demografia.populacaoTotal) : 'não disponível — selecione um município na busca pra trazer este dado'}`,
    `Densidade (habitantes por escola): ${dados.scoreOportunidade.entradas.densidade != null ? fmtInt(dados.scoreOportunidade.entradas.densidade) : '-'}`,
    `Crescimento médio de matrículas (2024 para 2025): ${dados.scoreOportunidade.entradas.crescimentoMedio != null ? dados.scoreOportunidade.entradas.crescimentoMedio.toFixed(1) + '%' : 'sem dado suficiente'}`,
    `Capacidade ociosa média: ${dados.scoreOportunidade.entradas.ociosaMedia != null ? Math.round(dados.scoreOportunidade.entradas.ociosaMedia) + '%' : 'sem dado suficiente'}`,
    `Ticket médio nacional (referência): ${dados.ticketMedioNacional ? fmtMoedaCompacta(dados.ticketMedioNacional) : '-'}`,
  ];
  listaComMarcador(ctx, linhasInfo, { corMarcador: COR.accent });
  ctx.y += 2;

  tituloBloco(ctx, 'Composição do Score de Atratividade Regional');
  paragrafo(ctx, 'Combina densidade populacional, crescimento de matrículas, ticket médio, faturamento potencial per capita, capacidade ociosa e presença de redes conhecidas — pesos abaixo, sem caixa-preta:', { cor: COR.textoMuted });
  const componentes = dados.scoreOportunidade.componentes;
  const linhasComp = [
    ['Densidade', componentes.densidade], ['Crescimento', componentes.crescimento], ['Ticket médio', componentes.ticketMedio],
    ['Faturamento/capita', componentes.fatPotencialPerCapita], ['Ociosidade', componentes.capacidadeOciosa], ['Presença de redes', componentes.presencaRedes],
  ];
  desenharBarrasComponentes(ctx, linhasComp);

  const imagens = [dados.imagens?.porte, dados.imagens?.ticket].filter(Boolean);
  if (imagens.length) {
    ctx.y += 4;
    tituloBloco(ctx, 'Perfil das escolas na região');
    const larguraImg = (ctx.larguraUtil - 6) / 2;
    checarQuebra(ctx, larguraImg * 0.6 + 4);
    imagens.forEach((img, i) => {
      ctx.doc.addImage(img, 'PNG', MARGEM + i * (larguraImg + 6), ctx.y, larguraImg, larguraImg * 0.6);
    });
    ctx.y += larguraImg * 0.6 + 4;
  }
}

function desenharBarrasComponentes(ctx, linhas) {
  const { doc, larguraUtil } = ctx;
  const alturaBarra = 5;
  linhas.forEach(([label, valor]) => {
    checarQuebra(ctx, alturaBarra + 3);
    doc.setFontSize(8);
    doc.setTextColor(...COR.textoEscuro);
    doc.text(label, MARGEM, ctx.y + 3.5);
    const xBarra = MARGEM + 38;
    const larguraBarraMax = larguraUtil - 38 - 12;
    doc.setFillColor(...COR.fundoClaro);
    doc.rect(xBarra, ctx.y, larguraBarraMax, alturaBarra, 'F');
    const pct = Math.max(0, Math.min(100, valor || 0));
    doc.setFillColor(...(pct >= 60 ? COR.verde : pct >= 35 ? COR.ambar : COR.cinza));
    doc.rect(xBarra, ctx.y, (larguraBarraMax * pct) / 100, alturaBarra, 'F');
    doc.setFontSize(7.5);
    doc.text(`${Math.round(pct)}`, xBarra + larguraBarraMax + 2, ctx.y + 3.8);
    ctx.y += alturaBarra + 2.5;
  });
}

// ---------------------------------------------------------------------
// Matriz SWOT
// ---------------------------------------------------------------------

function desenharSwot(ctx, dados) {
  const { swot } = dados.analiseCritica;
  const { doc, larguraUtil } = ctx;
  const larguraQuadrante = (larguraUtil - 6) / 2;
  const alturaQuadrante = 48;
  checarQuebra(ctx, alturaQuadrante * 2 + 10);

  const quadrantes = [
    { titulo: 'FORÇAS', sub: '(interno · positivo)', itens: swot.forcas, cor: COR.verde },
    { titulo: 'FRAQUEZAS', sub: '(interno · negativo)', itens: swot.fraquezas, cor: COR.vermelho },
    { titulo: 'OPORTUNIDADES', sub: '(externo · positivo)', itens: swot.oportunidades, cor: COR.accent },
    { titulo: 'AMEAÇAS', sub: '(externo · negativo)', itens: swot.ameacas, cor: COR.ambar },
  ];

  const yInicio = ctx.y;
  quadrantes.forEach((q, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = MARGEM + col * (larguraQuadrante + 6);
    const y = yInicio + row * (alturaQuadrante + 6);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...q.cor);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, y, larguraQuadrante, alturaQuadrante, 2, 2, 'FD');
    doc.setFillColor(...q.cor);
    doc.rect(x, y, larguraQuadrante, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont(undefined, 'bold');
    doc.text(q.titulo, x + 3, y + 5.5);
    const larguraTitulo = doc.getTextWidth(q.titulo); // medida ANTES de trocar tamanho/peso da fonte
    doc.setFontSize(6.5);
    doc.setFont(undefined, 'normal');
    doc.text(q.sub, x + 3 + larguraTitulo + 3, y + 5.5);

    doc.setTextColor(...COR.textoEscuro);
    doc.setFontSize(7.3);
    let yTexto = y + 12;
    if (!q.itens.length) {
      doc.setTextColor(...COR.textoMuted);
      doc.text('Nada identificado nesta categoria pra esta região.', x + 3, yTexto);
    } else {
      q.itens.slice(0, 4).forEach((item) => {
        const linhas = doc.splitTextToSize(`• ${item}`, larguraQuadrante - 6);
        const linhasLimitadas = linhas.slice(0, 3);
        doc.text(linhasLimitadas, x + 3, yTexto);
        yTexto += linhasLimitadas.length * 3.3 + 1.5;
      });
    }
  });
  ctx.y = yInicio + alturaQuadrante * 2 + 12;
}

// ---------------------------------------------------------------------
// Ranking / mapeamento competitivo
// ---------------------------------------------------------------------

function desenharRanking(ctx, dados) {
  const { larguraUtil } = ctx;
  const { fmtInt, fmtMoedaCompacta, labelPorte } = dados;
  tituloBloco(ctx, `Top ${Math.min(20, dados.ranking.length)} escolas por relevância`);
  paragrafo(ctx, 'Relevância combina ticket médio, porte e proximidade do centro marcado no mapa.', { cor: COR.textoMuted });
  ctx.y += 1;

  const colunas = [
    { label: '#', w: 8 }, { label: 'Escola', w: larguraUtil - 8 - 22 - 20 - 22 - 20 },
    { label: 'Porte', w: 22 }, { label: 'Matr.', w: 20 }, { label: 'Ticket', w: 22 }, { label: 'Dist.', w: 20 },
  ];
  desenharCabecalhoTabela(ctx, colunas);

  dados.ranking.slice(0, 20).forEach((e, i) => {
    const linha = [
      String(i + 1), e.nome, labelPorte(e.porte) || '-',
      e.mat25 != null ? fmtInt(e.mat25) : '-',
      e.mensalidade != null ? fmtMoedaCompacta(e.mensalidade) : '-',
      e.distanciaKm != null ? e.distanciaKm.toFixed(1) + 'km' : '-',
    ];
    desenharLinhaTabela(ctx, colunas, linha, i % 2 === 0);
  });
}

function desenharCabecalhoTabela(ctx, colunas) {
  const { doc } = ctx;
  checarQuebra(ctx, 8);
  doc.setFillColor(...COR.navy);
  doc.rect(MARGEM, ctx.y, ctx.larguraUtil, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'bold');
  let x = MARGEM + 2;
  colunas.forEach((c) => { doc.text(c.label, x, ctx.y + 4.8); x += c.w; });
  ctx.y += 7;
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...COR.textoEscuro);
}

function desenharLinhaTabela(ctx, colunas, valores, parLinha) {
  const { doc } = ctx;
  checarQuebra(ctx, 7);
  if (parLinha) { doc.setFillColor(...COR.fundoClaro); doc.rect(MARGEM, ctx.y, ctx.larguraUtil, 6.2, 'F'); }
  doc.setFontSize(7.3);
  let x = MARGEM + 2;
  colunas.forEach((c, i) => {
    const val = String(valores[i] ?? '-');
    const truncado = doc.getTextWidth(val) > c.w - 3 ? val.slice(0, Math.floor((c.w - 3) / 1.6)) + '…' : val;
    doc.text(truncado, x, ctx.y + 4.3);
    x += c.w;
  });
  ctx.y += 6.2;
}

// ---------------------------------------------------------------------
// Go-to-Market
// ---------------------------------------------------------------------

function desenharGoToMarket(ctx, dados) {
  paragrafo(ctx, 'Estratégia de entrada em 3 fases, adaptada às características desta região específica — não é um roteiro genérico.', { cor: COR.textoMuted });
  ctx.y += 2;

  dados.goToMarket.forEach((fase, i) => {
    checarQuebra(ctx, 10);
    const { doc } = ctx;
    doc.setFillColor(...COR.accent);
    doc.circle(MARGEM + 3, ctx.y - 1, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(String(i + 1), MARGEM + 3, ctx.y + 0.8, { align: 'center' });
    doc.setTextColor(...COR.navy);
    doc.setFontSize(11);
    doc.text(fase.titulo, MARGEM + 9, ctx.y);
    ctx.y += 6;
    listaComMarcador(ctx, fase.itens, { corMarcador: COR.accent });
    ctx.y += 3;
  });
}

// ---------------------------------------------------------------------
// Plano de ação e limitações
// ---------------------------------------------------------------------

function desenharPlanoAcao(ctx, dados) {
  paragrafo(ctx, 'Passos concretos, derivados diretamente dos achados desta análise — cada item existe porque um dado específico apontou pra ele, não é uma lista genérica.', { cor: COR.textoMuted });
  ctx.y += 2;

  dados.planoAcao.forEach((passo) => {
    const { doc, larguraUtil } = ctx;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    const linhas = doc.splitTextToSize(passo, larguraUtil - 10);
    checarQuebra(ctx, linhas.length * 4.4 + 3);
    doc.setDrawColor(...COR.accent);
    doc.setLineWidth(0.5);
    doc.rect(MARGEM, ctx.y - 3.2, 3.2, 3.2);
    doc.setTextColor(...COR.textoEscuro);
    doc.text(linhas, MARGEM + 7, ctx.y);
    ctx.y += linhas.length * 4.4 + 3;
  });
}

function desenharLimitacoes(ctx, dados) {
  if (!dados.analiseCritica.limitacoesDados.length) return;
  ctx.y += 4;
  tituloBloco(ctx, 'Limitações desta análise', 10.5);
  paragrafo(ctx, 'Honestidade sobre a própria base usada — leia antes de tomar decisões só com base nos números acima.', { cor: COR.textoMuted, tamanho: 8.5 });
  listaComMarcador(ctx, dados.analiseCritica.limitacoesDados, { corMarcador: COR.cinza, tamanho: 8.3 });
}
