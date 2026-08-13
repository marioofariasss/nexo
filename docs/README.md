# Nexo — inteligência de mercado para escolas

Aplicação 100% front-end (HTML + CSS + JavaScript ES6, sem build step) para o
time comercial da kedu (agência de marketing educacional) pesquisar, analisar
e priorizar escolas privadas em todo o Brasil, usando dados enriquecidos do
Censo Escolar INEP (porte, faturamento potencial, evasão, capacidade ociosa)
cruzados com um sistema de **marcadores (tags)** para organizar a
prospecção, rodando localmente no navegador (IndexedDB). Não é uma
plataforma de CRM com funil/pipeline — é uma ferramenta de pesquisa e
análise ativa de mercado, com marcadores simples para acompanhar quem já foi
prospectado.

**Nota de nome**: o produto se chamava "kedu Radar" até esta rodada —
renomeado pra **Nexo** porque nomes descritivos como esse (ou "Radar
Escolar", "EdukDados") já são comuns demais no mercado de inteligência
educacional. "kedu" continua sendo a agência (Kedu Marketing) que usa a
ferramenta — isso não muda, só o nome do produto em si.

## Como rodar localmente

Não precisa de instalação. Como o app usa `fetch()` para carregar os arquivos
de `/data`, alguns navegadores bloqueiam isso ao abrir o `index.html`
diretamente do disco (`file://`). Sirva a pasta com um servidor simples:

```bash
# Python (já vem em qualquer Mac/Linux)
python3 -m http.server 8080
# depois abra http://localhost:8080
```

Ou instale a extensão "Live Server" no VS Code e clique em "Go Live".

## Como publicar no GitHub Pages

1. Crie um repositório novo no GitHub e suba todo o conteúdo desta pasta.
2. Em **Settings → Pages**, selecione a branch `main` e a pasta raiz (`/`).
3. Em alguns minutos o app estará em `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

Não é necessário nenhum passo de build — é tudo estático.

## Arquitetura

Ver [`ARQUITETURA.md`](./ARQUITETURA.md) para o detalhamento completo de
pastas, camadas de dados e como estender o sistema (novos filtros, novas
colunas, novas fontes de dados).

## Dashboard redesenhado, endereço completo de verdade e link de Maps

- **Endereço, segunda tentativa**: a primeira correção só tinha resolvido
  metade do problema (rua + número, mas sem bairro/município/UF/CEP juntos
  num endereço só). Agora o campo `endereco` de cada escola é o endereço
  completo pronto pra copiar, ex: `AV MINAS GERAIS ESQUINA COM A FORTALEZA,
  4405, Alta Floresta D'Oeste - RO, CEP 76954-000`.
- **Botão "Abrir no Maps"** na aba Resumo: usa as coordenadas exatas quando
  a escola tem lat/long (mapa preciso), ou o endereço completo como busca
  textual quando não tem. Com o endereço certo, uma busca básica ali já
  costuma trazer o perfil no Google Business e as redes sociais da escola.
- **Dashboard redesenhado**: cabeçalho com título e ícone, seções com
  identificação visual clara ("Onde estão as escolas", "Perfil das escolas
  e dos responsáveis", "Prioridades de prospecção", "Evolução 2024→2025"),
  ícones em cada card de KPI, e os cards de marcador da seção Prospecção
  ganharam uma barra colorida no topo na cor de cada tag. A lógica de dados
  e os gráficos não mudaram — só a organização visual e a navegação.

## Endereço completo e ICP redefinido (perfil do responsável)

- **Endereço**: até esta rodada, o campo de endereço só tinha o nome da rua,
  sem número (`NU_ENDERECO` nunca tinha sido puxado do Censo) — inútil pra
  achar a escola no Google Maps. Corrigido: o endereço agora inclui número
  e complemento quando existentes (ex: `RUA DJALMA DUTRA, 500 (ESCOLA)`).
  Com o endereço completo, uma busca básica no Google já costuma trazer o
  perfil no Google Business e as redes sociais da escola diretamente.
- **ICP redefinido**: antes o ICP media características da escola (porte,
  infraestrutura, qualificação docente) — o que fazia sentido, mas não era
  o que fazia sentido chamar de "ICP" (perfil do cliente ideal é sobre
  *quem decide*, não sobre o prédio). Agora o ICP mede o **perfil do
  responsável/dono**: se o gestor tem pós-graduação, se o gestor é o
  próprio dono (indicando contato direto, sem hierarquia corporativa no
  meio) e se a mantenedora é uma empresa formal (indicando estrutura de
  gestão mais profissionalizada). As métricas sobre a escola em si
  (faturamento potencial, capacidade ociosa, infraestrutura) continuam
  todas disponíveis na aba Comercial — só não fazem mais parte do score de
  ICP.

## Reposicionamento: de "CRM" para "kedu Radar"

O produto deixou de se apresentar como um CRM (isso sugeria funil/pipeline
de vendas, que já não existe aqui desde a remoção do Kanban) e passou a se
chamar **kedu Radar** — uma ferramenta de pesquisa e análise ativa de
mercado, com marcadores simples para acompanhar prospecção. Nomes de
variáveis e chaves internas (banco IndexedDB, preferência de tema salva)
continuam com o nome antigo internamente de propósito — trocar isso
apagaria os dados já salvos no navegador de quem já estava usando o app.

Duas correções também entraram nesta rodada, ambas no Dashboard:

- O card "Distribuição por prioridade de ICP" (um gráfico de rosca só com
  contagens) foi trocado por **"Top 10 escolas por Score ICP"** — um
  gráfico de barras com as 10 escolas de maior potencial do Brasil,
  identificadas pelo nome, clicável (abre a ficha da escola direto).
- As tabelas do Dashboard (Top oportunidades, Maiores ganhos de matrícula,
  Maior capacidade ociosa) não abriam a ficha da escola ao clicar — só a
  tabela da Consulta de escolas tinha esse comportamento. Corrigido: clicar
  em qualquer linha de qualquer tabela do Dashboard agora importa a UF
  daquela escola (se ainda não estiver carregada) e abre o painel lateral
  completo, igual à Consulta de escolas.

## Refinamento de UX/UI e navegação

Numa terceira rodada, o sistema recebeu uma identidade visual baseada na
marca real da kedu (`#003F59`, extraído do `theme-color` oficial de
kedu.com.br) e ficou mais navegável:

- **Dashboard clicável**: todo KPI e todo gráfico (barras por UF, por porte,
  rosca de ICP) leva direto para a Consulta de escolas já filtrada. Uma nova
  seção "Prospecção" mostra contagens ao vivo por marcador (com/sem
  marcador, e um card por tag existente), também clicáveis.
- **Filtros ativos visíveis e removíveis**: a Consulta de escolas mostra
  chips de cada filtro aplicado (inclusive vindos de um link do Dashboard),
  com botão de remover individual ou "Limpar tudo".
- **Busca global** no topo de qualquer página: digite nome, CNPJ (parcial) ou
  cidade e abra a ficha da escola direto, sem passar pela Consulta.
- **Canais clicáveis**: a aba Marketing Digital mostra um grid de ícones
  (Font Awesome, via CDN) para WhatsApp, site, Instagram, Facebook, LinkedIn,
  YouTube, Google Business e Google Maps — cada um clicável quando há um
  link salvo, e visualmente marcado como indisponível quando não há.
  Telefone (Resumo) e e-mail institucional (quando vier da BrasilAPI) também
  viraram links `tel:`/`mailto:` clicáveis.
- Sombras mais suaves, cantos mais arredondados, microanimações (painel
  lateral desliza ao abrir, abas têm fade, cards de KPI "elevam" ao passar o
  mouse quando são clicáveis).

**Sobre a arquitetura SPA (fase não implementada nesta rodada):** o
briefing pediu transições instantâneas sem recarregar a página, no estilo
Power BI/HubSpot. O que foi entregue acima (deep-linking com filtros
aplicados automaticamente, busca global, painel lateral sem navegação) cobre
a maior parte dessa sensação — e como o site é pequeno e estático, a
navegação entre páginas já é praticamente instantânea mesmo com reload
completo. Converter para uma SPA de verdade (um roteador único, todas as
"páginas" como estados de uma mesma aplicação) é uma mudança de arquitetura
maior, não uma extensão do que já existe — vale ser uma decisão separada e
deliberada, não algo decidido nos bastidores. Se depois de usar essa versão
ainda parecer necessário, é um próximo passo natural.

## Escopo atual do produto

Numa refatoração posterior às 9 fases originais do roadmap, o sistema foi
simplificado para focar em três pilares, substituindo o Kanban, a Agenda e o
"Meu painel" (perfil de vendedor com metas/ranking) por um sistema único de
**marcadores (tags)**:

1. **Pesquisa inteligente de escolas** — busca avançada com filtro por
   marcadores
2. **Enriquecimento de dados** — dados institucionais e sócios via CNPJ
   (fonte pública, gratuita), perfil comercial, presença digital
3. **Gestão de prospecção via marcadores** — cada escola pode ter vários
   marcadores; cada vendedor tem o seu próprio marcador pessoal (aplicado
   quando assume uma escola)

## Guia rápido de cada tela

- **Dashboard** (`index.html`) — visão consolidada do mercado (todas as
  42.454 escolas), filtrável por UF. Não depende da base estar carregada no
  IndexedDB. O card no fim da página carrega a base completa para uso na
  Consulta de escolas.
- **Consulta de escolas** (`pages/busca.html`) — busca com filtros
  combinados, incluindo **marcadores** (múltipla seleção) e "sem marcador".
  Selecionar uma UF importa automaticamente os dados dela para o IndexedDB,
  se ainda não estiverem lá. A tabela mostra uma coluna com os marcadores de
  cada escola. Clique em uma linha para abrir o painel lateral completo.
- **Painel lateral da escola** — ocupa ~45% da tela, organizado em abas:
  - **Resumo** — contato do Censo + dados institucionais via CNPJ (botão
    "Buscar dados institucionais") + resumo com IA (se configurada)
  - **Comercial** — ICP, faturamento potencial, capacidade ociosa, variação
    de matrículas, mudança de porte, informações acadêmicas
  - **Responsáveis** — sócios/administradores (quadro societário via CNPJ)
  - **Marketing Digital** — site, redes sociais, Google Business (preenchimento manual — ver observação abaixo)
  - **Histórico** — linha do tempo de interações + mudanças de marcadores
  - **Marcadores** — aplicar/remover tags, com histórico de quem alterou o quê
  - **Observações** — texto livre
  - **Documentos** — anexar/baixar arquivos (ficam só neste navegador)
- **Configurações** (`pages/config.html`) — seu nome (para atribuição no
  histórico), tema, **módulo de Marcadores** (criar/editar/excluir tags, cor,
  tipo, ordem), chave de API de IA, backup/restauração, filtros salvos.

## Sistema de marcadores (tags)

Substituiu o antigo modelo de status/vendedor/kanban. Cada escola pode ter
qualquer combinação de marcadores (ex: "Prospectando" + "João" + "Prioridade
Alta"). Marcadores do tipo **vendedor** funcionam como responsável: aplique o
seu para indicar que você assumiu aquela escola. O catálogo completo (criar,
editar, cor, tipo, ordem de exibição) fica em **Configurações → Marcadores**.
Toda alteração fica registrada no histórico da escola (quem, quando, o quê).

## Busca automática de redes sociais, contato do responsável e análise de IA ao abrir

Pedido do time comercial: ter site/Instagram/Facebook, o WhatsApp de quem
decide, e uma análise de marketing + sugestão de abordagem já visíveis ao
abrir a ficha de qualquer escola. Como isso foi resolvido:

- **Redes sociais**: em Configurações, cole uma chave da API do Gemini
  (Google AI Studio). Tentamos primeiro o Google Custom Search API, mas o
  Google fechou esse serviço para clientes novos no início de 2026 (retorna
  403 permanente mesmo com tudo configurado certo). Trocamos para o
  **Gemini com Grounding com Google Search** — o modelo Gemini decide
  quando buscar e devolve tanto uma resposta quanto os links das fontes
  usadas, o que é mais confiável do que tentar extrair links de texto
  livre. Com uma conta paga do Gemini (nível 1+), os modelos Gemini 3.x dão
  5.000 buscas com grounding grátis por mês — para o uso deste app
  (enriquecimento gradual, não em massa), isso tende a ficar todo dentro da
  cota gratuita; acima disso, ~US$ 14 a cada 1.000. Não precisa criar
  projeto no Google Cloud, ativar API, configurar faturamento nem criar um
  "mecanismo de busca" — só uma chave em aistudio.google.com/apikey. Na aba
  Marketing Digital de cada escola, o botão "Buscar automaticamente" sugere
  Instagram/Facebook/LinkedIn/YouTube/Google Maps — são **sugestões**, não
  confirmadas automaticamente: revise antes de clicar em Salvar, porque
  nomes de escola parecidos podem confundir a busca. Não foi feito (e não
  será) um processo que pesquisa e salva isso para as 42 mil escolas de uma
  vez sozinho — a necessidade de conferência humana torna isso um processo
  progressivo, não um botão único.
- **WhatsApp de quem decide**: a aba Responsáveis tem um campo manual para
  nome e WhatsApp do diretor/mantenedor/dono. **Isso é preenchido pelo time,
  não pesquisado automaticamente** — encontrar e salvar o número de celular
  pessoal de milhares de pessoas identificadas via busca automatizada é uma
  linha que não foi cruzada aqui, diferente do CNPJ (que é registro público
  oficial da empresa, não da pessoa). O quadro de sócios/administradores
  (nomes públicos, sem telefone) continua vindo da Receita Federal via
  BrasilAPI, na mesma aba.
- **Análise de marketing e sugestão de abordagem automáticas**: com uma
  chave de IA configurada, a aba Resumo já mostra essas duas análises
  assim que o painel abre — sem precisar clicar em nada. Os prompts foram
  ajustados para o contexto real: um analista/vendedor da kedu avaliando o
  potencial da escola como cliente dos planos de marketing e captação de
  matrículas da kedu.

## Fase 8: segunda rodada com o Codex — cenário vivo, coordenadas inválidas, busca unificada de identidade

Segunda vez que o usuário trouxe trabalho feito pelo Codex fora desta
sessão (dessa vez o zip veio **com a pasta `.git`**, o que ajudou muito —
deu pra confirmar direto pelo `git log` que ele partiu exatamente do
último commit desta sessão, não de uma versão antiga como da primeira vez).
Mesmo assim, cada alegação foi auditada contra os dados reais antes de
aceitar, e a integração passou por teste de verdade no navegador — não só
leitura de código.

**Verificado como real, com número exato batendo**:
- `calcularCenarioAtual()` (`importService.js`): pra cada UF já importada
  localmente, usa a contagem real do IndexedDB; pra UF ainda não
  carregada, usa a contagem da semente + descobertas locais dela. Testado
  o cenário exato descrito: carregar só o Ceará não derruba mais o total
  nacional (continua 43.068), e injetando 475 escolas de teste o total
  sobe pra exatamente 43.543, com "+475 no cenário local" aparecendo.
- **3.002 coordenadas incompatíveis com a UF** — contei de verdade contra
  os 24.574 registros com coordenada em todas as 27 UFs, bate exato.
  `geo.js` ganhou `coordenadaValidaBrasil()`, com uma caixa delimitadora
  aproximada por UF; essas coordenadas saem de mapas, heatmap e cálculo de
  distância (mas a ficha continua acessível).
- Funil (Grande Região → estado → município → capital → endereço → raio)
  permanece navegável depois de uma análise estadual/regional — antes,
  essas duas análises "zeravam" o centro no final, o que desabilitava a
  busca de novas escolas via OSM logo depois. Removida essa limpeza —
  testado o fluxo completo (analisar Ceará inteiro → "Usar capital" →
  botão de buscar no OpenStreetMap disponível).
- **"Buscar informações desta escola"** (nova, em `painelEscola.js`):
  botão único que cruza a ficha com o Censo (nome + município + CEP +
  telefone + distância) e com candidatos de CNPJ, tudo sem custo. Testado
  com um cenário real de duplicata (a mesma escola existindo como registro
  do Censo E como descoberta do OSM, nomes/coordenadas ligeiramente
  diferentes): achou a correspondência com 90% de aderência, e confirmar o
  vínculo copiou os dados oficiais (matrículas, porte) pro registro OSM
  **e** marcou esse registro como fora da análise agregada — evitando
  contar a mesma escola duas vezes nos indicadores.
- Correção do CNPJ sem zero à esquerda (`enriquecimentoService.js`) — bug
  clássico de número armazenado sem preservar zeros, corrigido antes de
  consultar a BrasilAPI.

**Bug real encontrado e corrigido nesta integração** (não do Codex — meu
próprio, das sessões anteriores): `uf_index.json` ainda dizia que o
`CE.json` tinha 2.083 registros, resíduo esquecido de quando eu tinha
apagado 270 escolas destrutivamente (duas sessões atrás) — mas o arquivo
real, desde a Fase 6, já tinha 2.353 (versão não-destrutiva, adotada do
Codex). O Codex achou e corrigiu essa inconsistência que eu mesmo tinha
deixado passar.

**Bug real encontrado nesta rodada, no próprio trabalho do Codex**: a
função que sugere "CNPJ informado no próprio OpenStreetMap" como candidato
não checava se a escola realmente TINHA esse dado antes de preencher com
zeros à esquerda — resultado, qualquer escola OSM **sem** CNPJ nenhum
ganhava uma sugestão de candidato "00000000000000" com 65% de confiança,
o que é lixo. Corrigido adicionando a checagem que faltava (mesmo padrão
que o próprio Codex já tinha usado corretamente na correção do CNPJ com
zero perdido, só não replicou aqui). Testado os dois casos (sem CNPJ no
OSM → lista vazia; com CNPJ no OSM → aparece certo).

**Ajuste de consistência que apliquei por conta própria**: o comparativo
"região vs. média estadual" (`renderComparativoRegiao`) não tinha ganhado
a nova flag `somenteAnalise: true` que todas as outras análises passaram
a usar — deixei consistente, pra "média estadual" não incluir registros
que a auditoria já sinalizou como fora de escopo.

**Mudança de filosofia que vale destacar**: `buscarEscolas()` (usada pela
Base de Escolas) passou a mostrar, por padrão, o inventário inteiro
(inclusive descobertas ainda não confirmadas) — antes escondia isso por
padrão. As telas analíticas (Mapear Mercado) pedem explicitamente
`somenteAnalise: true` pra excluir o que não foi confirmado. Ou seja: a
Base de Escolas agora é "tudo que existe", e o Mapear Mercado continua
"só o que é confiável pra decisão comercial" — dois objetivos diferentes,
cada tela com o filtro certo pro que ela faz.

## Fase 7: análise por estado inteiro ou região (ponto 1 da lista de 6 melhorias)

Até aqui o Mapear Mercado só analisava um raio geográfico ao redor de um
ponto marcado no mapa. Pedido: poder analisar um **estado inteiro** ou uma
**região** (Nordeste, Sul etc — vários estados de uma vez), pra uma leitura
mais macro além do raio local.

**Como foi construído**: um seletor "Escopo da análise" (raio / estado
inteiro / região) no topo do Mapear Mercado. Escolhendo estado ou região,
os campos que só fazem sentido pro raio (o slider de km, clicar no mapa
pra marcar centro, "Buscar escolas novas via OpenStreetMap" — que
tecnicamente não dá pra rodar num estado inteiro de uma vez, o Overpass
precisa de um ponto+raio pequeno) somem da tela.

- **Estado inteiro**: usa todas as escolas já carregadas da UF
  (`buscarEscolas({ uf })`, sem filtro de raio) e todos os setores
  censitários dela (`socioeconomicoService.analisarTerritorioAgregado`,
  nova função — mesma agregação ponderada de renda/população já usada na
  análise por raio, só que sem o filtro de distância).
- **Região**: mesma ideia, somando várias UFs de uma vez — nova função
  `ufsDaRegiao('Nordeste')` retorna as 9 UFs da região (mapeamento
  Norte/Nordeste/Sudeste/Sul/Centro-Oeste já existia dentro do
  `socioeconomicoService.js`, feito pelo Codex pro cálculo do perfil de
  consumo por região — só precisei exportar). Carrega a base de escolas e
  a camada territorial de cada UF da região e agrega tudo junto.
- Todas as seções de análise que já existiam pro raio (Score de
  Atratividade, matriz de análise crítica, concentração de mercado,
  ranking de concorrentes, clusters por rede, comparativo vs. médias,
  funil, PDF) continuam funcionando sem modificação nenhuma — a maioria
  delas já operava só sobre o array de escolas, sem depender de
  centro/raio diretamente. Só os textos que diziam "raio de Xkm" foram
  trocados por um rótulo de escopo (`escopoLabel`) que se adapta: "raio de
  8km", "estado inteiro (CE)", "região Nordeste (9 estados)".

**Testado com dados reais**, incluindo o caso mais pesado (Nordeste
inteiro, 9 estados): 10.781 escolas, 2.395.613 matrículas, 122.907 setores
censitários, 54.538.780 moradores — número plausível e consistente com a
população real da região. Também testado o estado inteiro (CE: 1.739
escolas, batendo com a base do Censo) e reconfirmado que o modo raio
original não teve nenhuma regressão.

**Achado no processo de teste, não um bug de verdade**: a primeira
tentativa de testar a análise regional deu resultado vazio na camada
territorial — mas era só o teste não esperando tempo suficiente (carregar
9 UFs de escolas + 9 arquivos de território é bem mais pesado que uma
análise por raio). Confirmado testando a função isoladamente (funcionava
perfeitamente) e depois esperando a operação terminar de verdade em vez
de um tempo fixo — sem bug real, só timing do teste.

## Fase 6: camadas de dados públicos (renda por setor censitário, natalidade, auditoria de escolas) — integração de trabalho feito fora desta sessão

O usuário usou outra ferramenta (Codex/OpenAI) num ambiente local separado
pra evoluir o projeto, e trouxe o resultado de volta pra integrar aqui.
Antes de aceitar qualquer coisa, o trabalho foi auditado a fundo — não só
lido, testado de verdade — porque havia um risco concreto: aquele
ambiente local tinha partido de uma versão do repositório **anterior** à
sessão passada, então alguns dos meus consertos mais recentes
(contador ao vivo do Dashboard, conversor de markdown na pesquisa de IA)
não estavam presentes na cópia dele.

### O que foi verificado como real antes de confiar

- **472.780 setores censitários, cobrindo as 27 UFs** — contei o número de
  verdade a partir dos arquivos (`data/territorio/{UF}.json`), bate exato
  com o que foi reportado. Essa é a peça de "renda por setor censitário"
  que ficou bloqueada o projeto inteiro (documentado desde a Fase 1) —
  agora existe de fato, com metodologia e limitações explícitas no próprio
  dado (ex: "ponto representativo do setor, não fração de área").
- **Auditoria das 614 escolas de Fortaleza** (`pipeline/auditar_escolas_descobertas.py`):
  números batem exatos (121 candidatas + 333 públicas + 148 fora do
  escopo INEP + 12 fora do ensino regular = 614). Abordagem **melhor** que
  o filtro que eu tinha construído na sessão passada: em vez de apagar a
  escola pública/técnica da base (destrutivo, perde informação), o
  registro continua existindo mas ganha um campo `qualidadeIdentidade`
  (`status`, `confiança`, `evidências`, `incluirAnalise`) — escolas com
  `incluirAnalise: false` somem das buscas e análises por padrão, mas
  continuam visíveis/revisáveis na Central de Enriquecimento. Nada se
  perde, dá pra reverter uma classificação errada depois.
- **Perfil de consumo via POF 2017-2018**: rotulado corretamente como
  `tipo: 'proxy_agregado'` no próprio dado, com a mesma ressalva halted
  que documentei anteriormente sobre não confundir médias regionais com
  comportamento individual.
- **Candidatos de CNPJ a partir do dump da Receita Federal**
  (`pipeline/pipeline_cnpj_escolas_descobertas.py`): o arquivo completo da
  Receita é grande demais pra publicar no GitHub Pages — o pipeline gera
  só os candidatos por escola (nome + CNPJ + score de aderência), com
  confirmação humana obrigatória na própria ficha antes de qualquer coisa
  contar nos indicadores. Testado o fluxo completo (candidato → clique em
  "Confirmar e aplicar" → CNPJ aplicado + status vira
  `identidade_confirmada_cnpj` + `incluirAnalise: true`).

### Bug real encontrado e corrigido na integração

`js/services/ibgeService.js` ganhou funções novas (`projetarCoortesEscolares`,
busca de nascimentos 2020-2024, renda domiciliar per capita) — mas na
primeira tentativa de mesclagem esse arquivo específico foi esquecido
(copiei os outros 5 arquivos que dependiam dele, mas não o arquivo em si).
Resultado: a página inteira do Mapear Mercado quebrava com "does not
provide an export named 'projetarCoortesEscolares'" — só descoberto
testando de verdade no navegador, não na checagem de sintaxe (que não
pega import de export inexistente entre módulos). Corrigido copiando o
arquivo certo.

**Segunda inconsistência encontrada**: os agregados nacionais do Dashboard
(`dashboard_kpis.json`, `agg_municipio.json`, `medias_nacionais.json`)
não tinham sido recalculados pra refletir a nova auditoria — ainda
contavam as 614 escolas de Fortaleza como se todas fossem válidas.
Recalculado usando só as **efetivas** (`incluirAnalise !== false`): CE
passa a mostrar 1.860 em vez de 2.353, nacional passa a 42.575. E o meu
próprio fix do contador ao vivo do Dashboard (sessão passada) também
precisou de ajuste — ele contava tudo que estava no IndexedDB, sem saber
da nova flag; agora filtra pelo mesmo critério que `buscarEscolas()`
usa, pra não mostrar um número diferente do que a Base de Escolas
realmente exibe.

### O que foi mantido vs. descartado na mesclagem

- `dashboard.js` e `painelEscola.js`: usei a versão nova como base
  (tinha as adições da triagem/CNPJ candidato), e reapliquei manualmente
  meus dois consertos da sessão passada por cima.
- `mercado.js`, `enriquecimento.js`, `escolaService.js`,
  `importService.js`, `osmDescobertaService.js`, `ibgeService.js`: usados
  diretamente, já continham meus consertos anteriores preservados.
- `data/escolas/CE.json`: adotada a versão não-destrutiva (614 escolas
  preservadas, com a flag de auditoria) no lugar da minha versão anterior
  que tinha apagado 270 delas.
- `docs/ARQUITETURA.md`: adotada a versão nova (só atualizou a seção que
  antes dizia "pendente" pra "implementada", resto idêntico).
- `docs/README.md` (este arquivo): mantida a versão desta sessão como
  base, porque a versão trazida não tinha as Fases 4 e 5 daqui.

Testado de ponta a ponta no navegador depois da mesclagem completa:
Dashboard (contador correto), Mapear Mercado com raio em Fortaleza
(setores censitários reais, perfil de consumo, candidatas descobertas,
tudo renderizando), Central de Enriquecimento, e o fluxo completo de
confirmação de CNPJ candidato.

## Fase 5: lista de 6 melhorias (pós-rebranding) — parte 1 (pontos 2, 3, 4, 5)

Usuário trouxe uma nova lista de 6 pontos já usando o Nexo publicado.
Nesta rodada, os 4 mais concretos/contidos (pontos 1 e 6 — análise por
estado/região e a aba de tráfego pago — ficaram pra próxima rodada, por
serem os maiores).

**Ponto 2 — filtro de escolas públicas/técnicas reforçado de verdade**:
o filtro anterior (`osmDescobertaService.pareceSerPublica`) deixava
passar vários padrões reais — confirmado testando contra os próprios
dados de Fortaleza já incorporados: **270 das 614 escolas** (44%) eram
públicas ou técnicas (EEEP, "Escola de Tempo Parcial/Integral" — convenção
municipal de Fortaleza, EMTI, EM sem sufixo, "Escola de Ensino Fundamental
e Médio" genérico sem "municipal/estadual" explícito, sistema S —
SENAI/SENAC/SENAT). Filtro reescrito com base nesses padrões reais, testado
com 25 casos (14 que deveriam ser bloqueados, 11 que deveriam continuar
passando) — 0 erros. As 270 já incorporadas foram removidas de
`data/escolas/CE.json` e todos os agregados dependentes atualizados.

**Ponto 3 — resposta da pesquisa de mercado (IA) chegava com markdown
cru**: o texto vinha com `**negrito**`, `## título` etc. literalmente na
tela (só `white-space:pre-wrap`, sem interpretar nada). Adicionado um
conversor leve de markdown→HTML em `painelEscola.js`
(`markdownParaHtml`) — escapa HTML primeiro (nunca confia cegamente no
que a IA devolve), depois converte só o que o modelo realmente usa nesse
tipo de resposta: negrito, cabeçalhos, listas numeradas/com marcador,
parágrafos. Testado com uma resposta simulada realista — confirmado que
não sobra nenhum `**` ou `##` solto na tela. Também adicionado, pedido
explícito do usuário ("ter fluidez... já partir pra um estudo de mercado
a partir daí"): um botão "Aprofundar num estudo de mercado completo" que
abre o Mapear Mercado já centralizado nas coordenadas da escola —
reaproveita os mesmos parâmetros de URL (`uf`, `municipio`, `lat`, `lon`)
já usados pelo mapa interativo do Dashboard. Testado o link a partir de
duas profundidades diferentes (raiz e dentro de `pages/`), caminho relativo
correto nos dois casos.

**Ponto 4 — barra lateral não ficava fixa**: `.sidebar` era só um item
flex normal, sem `position: sticky` — rolava junto com o conteúdo.
Corrigido com `position: sticky; top: 0; height: 100vh; overflow-y: auto`
(fora da media query mobile, que já tinha seu próprio comportamento de
menu deslizante). Testado rolando a página 800px e confirmando que a
sidebar não se move.

**Ponto 5 — contador de escolas do Dashboard não crescia com novas
descobertas**: mesma classe de bug já corrigida antes no botão "Carregar
base completa" — o KPI principal "Escolas privadas ativas" e o subtítulo
do topo vinham inteiramente do arquivo estático pré-calculado
(`dashboard_kpis.json`), nunca do banco local (IndexedDB), que é onde as
escolas descobertas via Mapear Mercado realmente ficam salvas. Corrigido
pra usar a contagem ao vivo (`countStore('escolas')`, ou por UF via
`getByIndex`) quando o banco local tiver dados, com o número estático como
fallback só enquanto nada foi carregado ainda. Testado: injetei 50 escolas
de teste no banco e confirmei que o Dashboard passou a mostrar exatamente
50, não mais o número estático antigo.

## Fase 4: rebranding — kedu Radar virou Nexo

Nome do produto trocado: **kedu Radar → Nexo — Inteligência de mercado
para escolas**. Motivo do usuário: nomes descritivos como "kedu Radar" ou
"Radar Escolar" (e concorrentes como "EdukDados") já são comuns demais no
mercado de inteligência educacional — precisava de um nome com
identidade própria.

**Distinção importante que guiou o que mudou e o que não mudou**: "kedu"
aparece no código em dois sentidos diferentes —
1. Como **nome do produto** (títulos de página, logo da barra lateral,
   marca d'água do PDF, nome de arquivos exportados) → trocado pra Nexo.
2. Como **nome da agência real** (Kedu Marketing, empregadora do usuário —
   aparece nos prompts de IA que descrevem o contexto comercial, e em
   comentários sobre o padrão de pesquisas de mercado que a Kedu já
   produziu, como o relatório Legatum usado de referência) → **mantido**,
   porque continua sendo um fato real sobre quem usa a ferramenta, não
   sobre o nome dela.

**O que foi trocado**: título de todas as 5 páginas, bloco de marca da
barra lateral (`js/components/layout.js`), variável CSS `--kedu-ciano` →
`--nexo-ciano`, mensagens e nome de arquivo do backup
(`backupService.js`), nome de arquivo do PDF exportado
(`nexo-{município}-{raio}km.pdf`), e a marca no PDF em si (ver abaixo).
Título e introdução do próprio README também atualizados.

**O que foi decidido deliberadamente NÃO trocar**: o nome interno do banco
de dados local (`DB_NAME = 'kedu_crm'` em `js/services/db.js`) e a chave
de preferência de tema no localStorage (`kedu_crm_tema`). São
identificadores técnicos, invisíveis na interface — mas se eu tivesse
renomeado o banco de dados, qualquer pessoa que já usa o site em produção
veria os próprios dados (marcadores, observações, CNPJs corrigidos)
"sumirem" da hora pra outra, porque o IndexedDB usa esse nome como a
própria identidade do armazenamento. Risco real demais pra um ganho que é
só estético (ninguém vê esse nome fora do DevTools do navegador).

### Marca d'água e branding nos arquivos exportados/baixados

Pedido específico do usuário: tudo que sai do site (baixado ou exportado)
precisa ter a marca bem presente.

- **PDF** (`js/services/pdfReportService.js`): selo "N" azul + "NEXO" em
  destaque na capa (com a tagline completa), o mesmo selo menor repetido
  no cabeçalho de toda página de conteúdo, rodapé com "NEXO — Inteligência
  de mercado para escolas" em toda página, e uma **marca d'água diagonal**
  ("NEXO", cinza bem claro, atravessando o meio da página) em todo
  conteúdo — pensada especificamente pra manter a origem identificável
  mesmo se alguém repassar só uma página solta ou um print de uma seção.
  Testado gerando um PDF de verdade e convertendo em imagem pra conferir
  visualmente — confirmado que a marca d'água aparece, mas não atrapalha
  a leitura do conteúdo por cima dela.
- **CSV** (`js/utils/csv.js`): toda exportação agora tem duas linhas de
  cabeçalho antes da tabela de dados ("Nexo — Inteligência de mercado
  para escolas" + data/hora da exportação) — visível na hora de abrir o
  arquivo no Excel/Planilhas, sem quebrar a leitura da tabela em si (é só
  um preâmbulo, a tabela de dados continua íntegra logo abaixo).
- **JSON** (backup, região exportada): ganhou um campo `marca` no topo do
  objeto exportado.

## Fase 3.7: lista de 9 melhorias — parte 1 (pontos 1, 2, 3, 5, 6, 8, 9)

Usuário trouxe uma lista de 9 pontos de melhoria de uma vez. Trabalhados
nesta rodada os que não dependiam de reestruturar a ficha da escola
(pontos 4 e 7 ficaram pra próxima rodada, por serem os mais trabalhosos).

**Ponto 9/8 — bug real, causa raiz de dois problemas ao mesmo tempo**: o
botão "Carregar base completa agora" (Dashboard e Central de
Enriquecimento) desabilitava permanentemente assim que **qualquer**
escola existisse no IndexedDB (`status.totalEscolas > 0`), em vez de
checar se **todas as 27 UFs** estavam de fato carregadas. Se o usuário já
tinha testado buscas em algumas UFs individualmente, o botão travava
mostrando "Base já carregada" pra sempre — exatamente por isso só
apareciam ~18 mil de 43 mil escolas. `importService.statusBaseCarregada`
agora retorna `todasCarregadas` e `ufsFaltando` de verdade (checando cada
UF, não só a contagem total). Testado o cenário exato: simulei 3 UFs
carregadas, confirmei que o botão continuava ativo mostrando "faltam 25 de
27 UFs", cliquei, esperei a importação real terminar, e bateu em
**43.068** — o número certo.

**Ponto 1 — removida a seção "Prospecção"** do Dashboard (contagem de
escolas com/sem marcador) — não fazia mais sentido no fluxo atual.

**Ponto 6 — filtro de escolas públicas na descoberta via OSM**
(`osmDescobertaService.pareceSerPublica`): combina a tag `operator:type`
do OpenStreetMap (quando preenchida, raramente é) com padrões de nome da
nomenclatura pública brasileira (E.E.M, EMEIF, "Escola Municipal",
"Instituto Federal", CIEP, CAIC, Corpo de Bombeiros, Polícia Militar).
Conservador de propósito — só exclui quando o sinal é claro, pra não
arriscar descartar uma escola privada de verdade. Testado com 13 casos
reais (7 públicas, 6 privadas), todos classificados certo.

**Ponto 2 — mapa interativo de verdade no lugar do gráfico de bolhas**:
trocado o Chart.js `bubble` (achado "poluído visualmente" pelo usuário)
por um mapa Leaflet real no Dashboard (`mapa-brasil`), com um marcador por
município, clicável, com popup mostrando os números e um link "Abrir
Mapear Mercado aqui" que já leva pra `pages/mercado.html` com UF,
município e coordenadas pré-preenchidos via parâmetros de URL — `mercado.js`
ganhou `aplicarParametrosUrl()` pra ler isso e centralizar automaticamente.
Testado o fluxo completo, ponta a ponta: 2.663 municípios desenhados no
mapa, clique abre popup com dados corretos, link leva pro Mapear Mercado
já centralizado em Fortaleza/CE, e "Mapear região" roda direto encontrando
212 escolas reais na área.

**Ponto 3 — o gráfico radar "Região vs. média estadual vs. média
nacional" virou uma tabela-scorecard**: usuário reportou que o radar não
passava uma leitura clara. Substituído por uma tabela simples (4 métricas
genuinamente comparáveis nas 3 escalas: ticket médio, faturamento
potencial médio/escola, crescimento de matrículas, capacidade ociosa),
com seta e cor (verde/vermelho) indicando se a região está favorável ou
desfavorável em cada uma — capacidade ociosa tem a lógica invertida (menos
é melhor). Testado com dado real de Fortaleza: ticket abaixo da média
(vermelho), faturamento potencial acima (verde), crescimento negativo
(vermelho), tudo consistente com os números reais da região.

**Ponto 5 — concentração de mercado no nível da região**
(`mercadoAnaliseService.calcularConcentracaoMercado`, novo): quanto do
volume total de matrículas da região está concentrado nas escolas
maiores — % das top 3/5/10 escolas, ranking com market share individual.
Mesma lógica de market share já usada por escola (Fase 3.5), agora
agregada pra região inteira. Testado com dado sintético (concentração
correta: 95% nas top 3) e com dado real de Fortaleza (mercado genuinamente
pulverizado: top 3 só 15%, top 10 apenas 31%, entre 125 escolas com dado —
achado real, não só a funcionalidade rodando).

**Bug real encontrado e corrigido durante o desenvolvimento do ponto 5**:
a seção de concentração de mercado acabou entrando, por engano, dentro de
um bloco condicional que só aparecia quando o usuário selecionava um
"porte de referência" — testando SEM selecionar esse filtro, a seção
simplesmente não aparecia. Corrigido movendo a seção pra fora desse
bloco condicional, e reconfirmado que aparece sempre.

## Fase 3.6: regra de duplicidade mais rigorosa + verificação na base inteira

Regra definida pelo usuário, aplicada em `osmDescobertaService.cruzarComCenso`:

- **Nome idêntico** (não só parecido) **+ muito muito perto** (raio de
  150m, `raioConfirmadoKm`): duplicata confirmada — descarta, não
  incorpora. Vale pra qualquer combinação de fonte (Censo×Censo, OSM×OSM,
  Censo×OSM), não só nas descobertas mais recentes de uma busca.
- **Nome idêntico mas bem distante** (fora do raio de dúvida, 1km): NÃO é
  duplicata — são unidades/filiais diferentes que só coincidem no nome.
  Incorpora normalmente.
- **Nome só parecido** (não idêntico) e perto, ou nome idêntico numa
  distância intermediária (entre 150m e 1km): fica pra revisão manual, não
  decide sozinho pra nenhum lado.

Testado com 4 cenários sintéticos cobrindo exatamente essas combinações —
todos se comportaram como especificado.

**Extensão importante**: antes, a checagem de duplicidade só rodava
durante uma busca no OpenStreetMap (comparando o que foi descoberto contra
o Censo já carregado). Agora existe também
`escolaService.encontrarDuplicidadesNaBase`, que varre a base inteira já
carregada localmente (qualquer fonte, qualquer UF) procurando pares com a
mesma regra — acessível na Central de Enriquecimento, botão "Possíveis
duplicidades". Mostra os dois registros lado a lado (nome, matrículas,
fonte, distância) com botão de excluir um deles
(`escolaService.deletarEscola`, novo).

**Achado real ao testar**: rodando esse scanner pela primeira vez contra a
base de produção (Ceará), ele encontrou duplicatas genuínas já existentes
no Censo — "MASTER COLEGIO" e "DAULIA BRINGEL COLEGIO" aparecem cada um
duas vezes, a ~0m de distância um do outro, com contagens de matrícula
diferentes (resíduo real de como o INEP processa/atualiza registros entre
anos do Censo). Não foi preciso simular nada pra achar isso — a
funcionalidade já se provou útil no primeiro teste.

## Fase 3.5: posição de mercado na ficha da escola (inspirado num anúncio da EdukDados)

Usuário mandou um print de anúncio de um concorrente (EdukDados) mostrando
um card de "ranking local, market share, segmento mais forte" por escola,
cruzado com renda por setor censitário. Pedido: incorporar isso, tanto no
Mapear Mercado quanto como prévia na ficha da escola.

**O que foi implementado** (`escolaService.calcularPosicaoNaRegiao`, novo,
usado na aba Inteligência da ficha): pra uma escola específica, calcula
dentro de um raio de 3km ao redor dela mesma — **ranking por matrículas**
(ex: "1ª de 23 escolas"), **matrículas privadas totais na região**,
**market share** (matrículas da escola ÷ matrículas totais do raio), e o
**segmento mais forte** (Educação Infantil / Fundamental / Médio — qual
etapa tem a maior fatia de mercado desta escola especificamente). Tudo
calculado só com o Censo já carregado — sem custo, sem fonte externa nova.
Testado com dado real (Escola SESI Euzébio, Fortaleza): 1ª de 23 escolas
no raio, 29,6% de market share, segmento mais forte "Médio" com 40,6%.

**O que NÃO foi implementado, e por quê**: a tabela do anúncio (renda por
faixa de salário mínimo × faixa etária, por setor censitário) continua
bloqueada pela mesma razão documentada na Fase 1 do pipeline
(`pipeline/pipeline_renda_setor_censitario.py`) — exige baixar e processar
arquivos pesados do IBGE (malha de setores censitários + agregados de
renda), que este ambiente de desenvolvimento não consegue fazer (sem
acesso à internet externa). Ver que um concorrente já tem isso funcionando
não muda essa limitação técnica — só confirma que vale a pena rodar aquele
pipeline em algum momento, numa máquina com internet.

## Fase 3.4: PDF executivo (capa, SWOT, go-to-market, plano de ação)

O PDF da Fase 3.3 era "simplório" (texto corrido, sem estrutura visual) —
pedido do usuário pra virar um relatório executivo de verdade, no nível do
relatório "Projeto Legatum" usado como referência inicial do produto.
Reconstruído do zero em `js/services/pdfReportService.js` (separado de
`mercadoAnaliseService.js`, que continua só com a lógica/conteúdo — este
arquivo novo só cuida do desenho).

**7 seções, uma por página**: capa (fundo navy, KPIs em destaque),
sumário executivo, cenário de mercado (com os gráficos da tela capturados
como imagem), **matriz SWOT** (grid 2x2 colorido: Forças/Fraquezas/
Oportunidades/Ameaças), mapeamento competitivo (tabela com cabeçalho navy
e listras alternadas), **go-to-market em 3 fases** (adaptado do padrão do
relatório Legatum, mas genérico — o conteúdo de cada fase muda conforme as
características reais da região, não é texto fixo), e **plano de ação**
(checklist com passos concretos).

**A lógica de conteúdo continua 100% determinística** (`gerarAnaliseCritica`
em `mercadoAnaliseService.js`, estendida): cada achado agora nasce já
classificado num quadrante SWOT (S/W/O/T) numa única fonte de verdade, em
vez de duas listas soltas que podiam divergir. Duas funções novas:
`gerarPlanoAcao` (passos derivados dos achados reais, não uma lista fixa) e
`gerarGoToMarket` (fases adaptadas à concentração/fragmentação do mercado
encontrado). Nada disso usa IA — mesmo princípio de sempre.

**Dois bugs reais encontrados testando visualmente** (não só validação de
sintaxe/dados — converti o PDF gerado em imagem e olhei cada página):

1. O caractere seta "→" (usado em "2024→2025") quebrava na fonte padrão do
   jsPDF, virando "!'" ilegível — a fonte base do jsPDF (Helvetica/base14)
   não cobre esse Unicode. Trocado por "2024 para 2025" em todo texto que
   alimenta o PDF.
2. Nos títulos dos quadrantes da Matriz SWOT, o subtítulo (ex: "(interno ·
   positivo)") colava sem espaço no título quando o título era longo
   ("FRAQUEZAS", "OPORTUNIDADES") — a largura do título estava sendo
   medida DEPOIS de já ter trocado o tamanho/peso da fonte pro subtítulo,
   subestimando o espaço necessário. Corrigido medindo a largura antes de
   trocar a fonte.

## Fase 3.3: exportar PDF com análise crítica e construtiva

Pedido do usuário: um botão em Mapear Mercado que exporta a análise da
região em PDF, com uma leitura crítica dos números — não só os dados crus.

**Como foi feito, e por quê**: a análise crítica (`gerarAnaliseCritica` em
`js/services/mercadoAnaliseService.js`) é **regras determinísticas sobre
números já calculados na tela — nunca texto gerado por IA**, mesmo
princípio já usado no "Relatório da região". Cada frase é rastreável a um
dado real e a um limiar documentado no código (ex: "ticket médio 15% acima
da média nacional = ponto forte"). Avalia: crescimento de matrículas,
ticket médio vs. média nacional, capacidade ociosa (mostrando os dois
lados — risco E oportunidade, de propósito), concentração de mercado por
rede, gap entre demanda (IBGE) e oferta (matrículas), e — importante —
**limitações da própria análise**: quantas escolas da região não têm dado
comercial (por serem descobertas via mapeamento, fora do Censo), e avisos
quando o raio é pequeno demais pra generalizar ou quando a comparação
demanda/oferta pode estar distorcida (população é do MUNICÍPIO, matrículas
são só do RAIO).

**Bug real encontrado e corrigido nesta rodada**: a primeira versão da
recomendação-síntese contava só pontos fortes vs. pontos de atenção pra
decidir o tom ("favorável"/"cautela") — só que isso podia contradizer o
Score de Atratividade calculado ao lado (ex: dizer "cenário favorável"
junto de um score de 34/100 "Baixa"). Corrigido pra usar a classificação
do score como critério principal do tom, com os pontos fortes/atenção
entrando só como contexto complementar, nunca contradizendo o número
ao lado.

**PDF em si**: gerado 100% no navegador com jsPDF (CDN, sem backend) —
título, números-chave, os três blocos da análise crítica, os gráficos de
porte/ticket/radar capturados como imagem (se já estiverem renderizados na
tela), e as 20 escolas mais relevantes do ranking. Testado de ponta a
ponta: gerei um PDF de verdade com dados reais de Fortaleza e li o
conteúdo de volta (não só confirmei que um arquivo foi criado) pra
confirmar que os números e o texto batiam com o que estava na tela.

## Fase 3.2: versão mobile

Mesmo tratamento já validado no Radar Escolar (projeto irmão), adaptado
pras páginas específicas deste app — que são mais complexas (5 itens de
menu em vez de 4, ficha da escola com 9 abas em vez de 8, e uma página com
mapa Leaflet interativo). Em telas até 860px:

- Barra lateral vira menu deslizante (ícone de hambúrguer), com fundo
  escurecido que fecha ao tocar fora — mesmo padrão de sempre
  (`js/components/layout.js`, `ligarMenuMobile`)
- **Barra de abas da ficha da escola**: com 9 abas, não cabem numa linha
  só nem espremendo — em vez de quebrar o texto, a barra ganha rolagem
  horizontal (`overflow-x: auto`), então dá pra deslizar o dedo pra ver
  todas
- **Mapa do Mapear Mercado**: reduz a altura (420px → 280px) no mobile,
  pra não dominar a tela inteira e deixar espaço pros filtros/resultados
  abaixo
- Filtros empilham verticalmente, tabelas rolam horizontalmente dentro
  delas mesmas, painel da escola ocupa a tela inteira, KPIs reorganizam em
  grade menor

Testado visualmente (capturas de tela) nas páginas mais complexas —
Dashboard, Base de Escolas + ficha da escola aberta, Mapear Mercado, e
Central de Enriquecimento — em viewport de 390×844 (tamanho de iPhone).
Sem estouro horizontal em nenhuma, confirmado por medição direta da
largura da página vs. viewport, não só inspeção visual.

## Fase 3.1: CNPJ editável na ficha da escola

Pedido do usuário: muitas escolas (principalmente as descobertas via
mapeamento OSM) não têm CNPJ na fonte original — precisa dar pra digitar
manualmente depois de uma pesquisa própria, "enriquecendo" a base aos poucos.

Na aba Institucional, o campo CNPJ agora é editável, com um botão "Salvar
CNPJ" — salva **direto na escola** (store `escolas` do IndexedDB, não só
numa camada de CRM separada), então o valor aparece imediatamente em
qualquer lugar que já lia esse campo: Base de Escolas, Central de
Enriquecimento (some do filtro "sem CNPJ" assim que salvo), exportação
CSV. Testado: salvei um CNPJ numa escola sem CNPJ, recarreguei a página do
zero (nova sessão de verdade, não só estado em memória) e confirmei que
continuava lá.

**Bug real encontrado e corrigido nesse processo** (pré-existente, não
introduzido agora): a função que busca dados institucionais por CNPJ tinha
um bloco `finally` que sempre reabilitava o botão e escrevia "Atualizar
dados institucionais" — mesmo quando a busca falhava (ex: por a escola não
ter CNPJ nenhum). Resultado: o botão parecia "já ter buscado com sucesso"
mesmo depois de um erro. Corrigido pra só ajustar o texto/estado do botão
com base no que realmente aconteceu (tem CNPJ salvo? já tem enriquecimento
buscado?), não um valor fixo.

## Fase 3: reestruturação em 4 pilares — base viva, sem ICP

Mudança de arquitetura conceitual: o Radar deixou de ser "consulta uma base
fechada do Censo + faz buscas de mercado temporárias" para ser uma **base
que cresce continuamente** — escolas descobertas (via mapeamento OSM ou
upload de dados) passam a existir permanentemente na base, não só durante
a análise que as encontrou. O menu passou a refletir 4 pilares: **Dashboard**
(visão de mercado), **Base de Escolas** (antiga Consulta), **Mapear Mercado**
(antiga Pesquisa de Mercado, renomeada porque agora incorpora, não só
analisa), **Enriquecimento** (novo), **Configurações**.

### ICP removido — não só escondido, a dependência lógica também saiu

O ICP (score de perfil do responsável/gestor) foi removido de toda a
aplicação: badges da ficha, filtro e coluna da Base de Escolas, KPI e
gráficos do Dashboard (trocados por faturamento potencial e ticket médio),
Score Regional (agora "Score de Atratividade Regional", sem ICP como
insumo), ranking de concorrentes, funil de mercado, radar chart comparativo
(eixo "ICP médio" virou "Ticket médio", com `data/medias_nacionais.json`
regenerado). O motivo: ICP mede o perfil de quem decide numa escola
específica — não é a pergunta certa pra "essa região é atrativa pra
prospecção?". Ficou só como texto explicativo, num lugar, dizendo por que
não é mais usado.

**Bug real encontrado nesse processo**: depois de reescrever
`mercadoAnaliseService.js` sem ICP, várias partes de `mercado.js` ainda
referenciavam os nomes antigos dos campos (`scoreOportunidade.entradas.icpMedio`,
etc.) — não dava erro de sintaxe, só mostrava `undefined`/`NaN` na tela.
Achado testando com dados reais de Fortaleza depois da mudança, não só
validação de sintaxe. Lição: mudar a forma que um serviço devolve dados
exige caçar TODOS os lugares que consomem esse formato, não só o serviço em si.

### Ficha da escola reorganizada em 4+ blocos

Trocou de 8 abas meio soltas para uma estrutura mais objetiva:
**Visão Geral** (identificação, CNPJ, origem do registro, localização,
barra de completude), **Contato** (telefone, WhatsApp institucional,
e-mail, site, Instagram — Marketing Digital foi descontinuado como aba
própria, e Facebook/LinkedIn/YouTube saíram de vez, só ficou site +
Instagram), **Institucional** (dados da Receita Federal via CNPJ, sócios/
administradores, contato manual do responsável), **Escola** (matrículas
por etapa, porte, evolução, capacidade — sem os campos de ICP que
existiam aqui), **Inteligência** (concorrentes na região sem custo + IA
sob demanda, reaproveitando uma função que tinha ficado órfã numa rodada
anterior). Marcadores, Observações, Histórico e Documentos continuam
como antes.

### Qualidade de dados — completude por escola

Novo conceito (`js/services/dataQualityService.js`): cada escola tem uma
**completude** (0-100%) e um **nível** (Inicial / Parcial / Completa),
calculados a partir de quais campos-chave estão preenchidos em 4 estágios
(descoberta → identificação → institucional → análise). Aparece como
badge no topo da ficha e como barra visual na aba Visão Geral.

**O que ficou mais simples do que a proposta original pedia**: não há
rastreamento de fonte por campo individual (ex: "este telefone específico
veio do OSM, este outro CNPJ veio da Receita Federal") — isso exigiria
reestruturar como cada campo é armazenado, é um projeto à parte. O que
existe é fonte no nível da escola inteira (`fonte: 'censo'` ou `'osm'`).

### Escolas descobertas entram de vez na base — "Mapear Mercado"

A página (antes "Pesquisa de Mercado", `pages/mercado.html`) foi renomeada
e o botão de busca no OpenStreetMap agora **incorpora as escolas novas
direto na store `escolas` do IndexedDB** (`escolaService.incorporarEscolasNaBase`),
não fica preso à análise de raio que as encontrou. A partir daí, essas
escolas existem na Base de Escolas, no Dashboard, em qualquer lugar do
app — igual uma escola do Censo, só que com `fonte: 'osm'`.

Duas correções técnicas importantes nesse processo:

1. **ID numérico dedicado**: escolas do OSM ganham um ID sintético (900
   bilhões + o ID numérico real do elemento no OpenStreetMap) em vez de um
   ID string tipo `osm-node-123` — isso evita que qualquer lugar do app que
   faça `Number(id)` quebre silenciosamente (era um risco real, dado que
   isso acontece em vários pontos: cliques em tabela, navegação entre
   fichas). O mesmo ID sempre resulta da mesma escola do OSM, então
   mapeamentos futuros da mesma região não duplicam.
2. **Classificação em 3 níveis** (match confiável / possível duplicidade /
   nova) em vez de só "achou" ou "não achou": a primeira versão marcava
   qualquer escola fisicamente perto como suspeita de duplicidade mesmo com
   nome completamente diferente — corrigido pra só considerar "duplicidade"
   quando o *nome* já dá algum sinal de parecido (não só proximidade
   física, que é normal entre escolas vizinhas).

**Regiões salvas → histórico de mapeamentos**: como as escolas persistem
de qualquer forma, "salvar uma região" deixou de ser o mecanismo de
persistência e virou só um registro de quando/onde cada mapeamento foi
feito (`js/services/regiaoService.js`, sem mudança de schema).

### Central de Enriquecimento (página nova)

`pages/enriquecimento.html` — estatísticas de completude sobre a base já
carregada localmente (% com CNPJ, telefone, site) e filtros pra achar
lacunas específicas: sem CNPJ, sem telefone, dados iniciais (pouco
enriquecidas), descobertas via mapeamento. Exporta CSV. Não tenta agregar
site/Instagram cadastrados manualmente na aba Contato de cada escola —
isso fica só por escola, agregar isso globalmente é mais trabalho e não
entrou nesta rodada.

### 614 escolas de Fortaleza incorporadas via upload de CSV

O usuário mandou um CSV com 640 escolas mapeadas de Fortaleza/CE (mesmo
formato desta nova arquitetura: `kedu_id`, `codigo_inep`, `status_validacao`,
proveniência do OpenStreetMap). Processado e incorporado direto em
`data/escolas/CE.json` (não só no IndexedDB de quem rodou a busca) — assim
qualquer pessoa que carregar o Ceará já recebe essas escolas, sem precisar
rodar o mapeamento de novo. 614 de 640 foram novas de verdade (26 já
existiam ou eram duplicadas dentro do próprio CSV); 174 delas tinham
código INEP real mas são **escolas públicas** (Colégio Estadual, Corpo de
Bombeiros) — corretamente fora do escopo do projeto (só privadas), mas o
vínculo do código INEP foi mantido mesmo assim. `VERSAO_BASE` em
`importService.js` foi incrementada (`2025-v1` → `2025-v2`) pra forçar
reimportação em quem já tinha o CE carregado — sem isso, o `bulkPut` só
rodaria de novo se a store estivesse vazia, e as escolas novas nunca
apareceriam pra quem já tinha usado o app antes.

## Fase 2.4: descoberta de escolas via OpenStreetMap + regiões salvas

Feature pedida com uma especificação técnica bem detalhada — mas essa
especificação assumia uma estrutura de dados e de arquivos diferente da
real deste projeto (campos com nomes diferentes, `localStorage` em vez de
IndexedDB, um arquivo `mercado-analytics.js` que não existe, um padrão de
módulo IIFE em vez de ES modules). Provavelmente foi gerada sem acesso
direto ao código atual. A funcionalidade foi implementada de verdade, mas
usando a arquitetura real do projeto — não o esqueleto de código do
prompt original.

**Busca por endereço** (`js/services/osmDescobertaService.js`,
`geocodificarEndereco`): usa a API pública do Nominatim (OpenStreetMap),
gratuita, sem chave — com limite de 1 requisição/segundo respeitado no
código.

**Descoberta de escolas via Overpass** (`buscarEscolasOSM`): consulta a
API pública Overpass (`amenity=school` e `amenity=kindergarten` num raio),
com um servidor mirror de fallback caso o principal falhe ou responda 429.
Escolas descobertas vêm marcadas com `fonte: 'osm'` e sem os campos que só
existem no Censo (matrículas, ICP, ticket, etc. ficam `null`).

**Cruzamento com o Censo** (`cruzarComCenso`): compara por nome
normalizado (maiúsculas, sem acento) + proximidade (300m) contra as
escolas do Censo já carregadas — evita mostrar a mesma escola duas vezes.
Só as que não têm correspondência aparecem como "novas".

**Visualização**: pins laranja no mapa pras escolas novas (distintos dos
pins azuis/verdes do Censo), com popup próprio (nome, endereço, telefone,
site, badge "ESCOLA NOVA"). Filtro Todas/Só Censo/Só novas, ao lado do
toggle Pins/Calor já existente.

**Regiões salvas** (`js/services/regiaoService.js`, store `regioesSalvas`
no IndexedDB — não `localStorage`, pra ficar consistente com o resto do
app): salva centro, raio, UF e a lista completa de escolas (Censo + OSM)
de uma análise, pra carregar depois **sem refazer nenhuma chamada de
API**. Limite de 50 regiões salvas. Suporta carregar, excluir e exportar
(JSON).

**Testado**: geocodificação, busca Overpass e cruzamento com dados
simulados (mesma limitação de sempre — sem acesso à internet externa neste
ambiente de desenvolvimento); persistência de região salva confirmada
sobrevivendo a um reload de página inteiro (efetivamente uma nova sessão).

## Fase 2.3: 8 visualizações/análises adicionais

Pedido do usuário, com uma lista específica de 8 análises organizadas em 4
grupos. Implementadas todas, com o que os dados reais permitem sustentar:

**Grupo 1 — Oportunidade de Mercado**
1. **Demanda vs. oferta por faixa etária**: população do IBGE (por faixa,
   nível de município) comparada com matrículas por etapa (`matInf`,
   `matFund`, `matMed`) das escolas na região — gráfico de barras duplas.
2. **Score de Oportunidade Regional (0-100)**: combina densidade
   populacional, crescimento de matrículas, ICP médio, faturamento
   potencial per capita e capacidade ociosa, com pesos documentados e
   visíveis na tela (não é caixa-preta) — `js/services/mercadoAnaliseService.js`.
3. **Projeção de demanda**: **não é uma projeção do IBGE** (isso foi
   verificado e não existe de forma simples via API pra nível de
   município) — é a tendência de matrículas 2024→2025 já observada no
   Censo, projetada linearmente pra 1/3/5 anos, com uma faixa ilustrativa
   de cenário otimista/pessimista. Isso está dito explicitamente na tela.

**Grupo 2 — Visualização Avançada no Mapa**
4. **Heatmap de faturamento potencial**: via Leaflet.heat (CDN), alternável
   com a visualização de pins normais por um botão.
5. **Clusters de concorrentes por rede/franquia**: identificação por
   palavra-chave no nome da escola (Maple Bear, Objetivo, Adventista, La
   Salle, SESI, etc.) — **não é uma base oficial de franquias**, é
   aproximação por padrão de nome no Censo, avisado na tela.

**Grupo 3 — Análise Competitiva**
6. **Radar chart multidimensional**: região selecionada vs. média estadual
   (calculada ao vivo, a partir da UF carregada) vs. média nacional
   (pré-calculada uma vez a partir da base completa e salva em
   `data/medias_nacionais.json` — evita ter que carregar as 27 UFs toda vez
   só pra uma comparação).
7. **Ranking de concorrentes diretos**: tabela com relevância (ICP × porte
   × proximidade do centro marcado), distância em km, sinal de matrículas,
   e botão de exportar CSV (reaproveitando `js/utils/csv.js`).

**Grupo 4 — Dimensionamento Comercial**
8. **Funil de mercado regional**: população total → população em idade
   escolar → matrículas existentes → escolas com ICP alvo → top
   oportunidades — barras horizontais proporcionais.

### Bug real encontrado (de novo) e uma lição sobre como validar sintaxe

Ao inserir uma função nova no meio do arquivo, `str_replace` apagou sem
querer a linha `function ligarFiltros() {`, deixando o corpo da função
solto no arquivo. **`node --check arquivo.js` não detectou isso** — só foi
pego testando de verdade no navegador. Descobri por quê: `node --check`
com um argumento de arquivo nem sempre força o parser a tratar o arquivo
como módulo ES (que é sempre modo estrito); `node --input-type=module
--check < arquivo.js` (lendo por stdin, forçando o tipo) é rigoroso do
mesmo jeito que o navegador é. A partir desta rodada, essa é a forma correta
de checar sintaxe antes de testar no navegador — documentado aqui pra não
repetir o mesmo susto.

## Fase 2.2: camadas de inteligência de mercado (demanda, benchmarking, relatório)

Em cima da página de Pesquisa de Mercado da fase anterior, quatro camadas
novas:

- **Demanda potencial por faixa etária**: além da população total do
  município, agora mostra população por faixa etária (IBGE, blocos de 5
  anos) como proxy de demanda pra Educação Infantil e Fundamental I.
- **Benchmarking direto/indireto**: escolha um porte de referência, e as
  escolas da região são separadas em concorrentes diretos (mesmo porte) e
  indiretos, com ticket médio calculado pra cada grupo.
- **Relatório automático da região**: um resumo em texto, mas gerado por
  **template determinístico** a partir dos números já calculados na tela —
  não usa IA aqui de propósito, pra não ter risco nenhum de inventar dado.
- **Cruzamento ICP × renda por setor censitário**: pedido pelo usuário,
  mas **ainda não implementado de verdade** — depende de processar dados
  pesados do IBGE (malha de setores censitários + agregados de renda) que
  não dá pra baixar de dentro deste ambiente de desenvolvimento (sem acesso
  à internet externa). O script do pipeline já está pronto em
  `pipeline/pipeline_renda_setor_censitario.py`, documentado em
  `docs/ARQUITETURA.md` — falta rodar contra os arquivos reais numa máquina
  com internet e integrar o resultado.

**Bug real encontrado e corrigido nesta rodada**: ao centralizar o mapa num
município grande (testado com São Paulo), a média das coordenadas das
escolas jogava o centro pra um lugar completamente errado — porque ~10% das
escolas têm coordenada corrompida (resíduo de um bug de escala herdado do
processamento original do Censo). Trocado por mediana, que é resistente a
esse tipo de outlier. Sem essa correção, qualquer análise de raio numa
cidade grande sairia baseada num centro errado, silenciosamente.

## Fase 2.1: página própria de Pesquisa de Mercado (raio + IBGE)

A "Pesquisa de Mercado" deixou de ser uma aba dentro da ficha da escola e
virou uma **página própria**, no mesmo nível de Dashboard/Consulta/Configurações
(`pages/mercado.html`) — porque análise de mercado é sobre uma região, não
sobre uma escola só.

**O que essa página faz:**

1. **Mapa com raio** (Leaflet + OpenStreetMap, gratuito, sem chave): clique
   em qualquer ponto do mapa pra marcar o centro da análise, ou selecione um
   município (busca automaticamente o centro aproximado, calculado pela
   média das coordenadas das escolas já carregadas daquele município).
   Ajuste o raio (1-30km) e clique em "Analisar região".
2. **Escolas concorrentes no raio** — filtra a base do Censo já carregada
   por distância real (fórmula de haversine) a partir do ponto marcado, sem
   depender de nenhuma API externa. Mostra KPIs (nº de escolas, matrículas
   totais, ticket médio da região), gráfico de distribuição por porte,
   gráfico de faixas de ticket médio, e uma tabela clicável.
3. **Dados demográficos do IBGE** (opcional, quando um município é
   selecionado): população total e população por faixa etária, via API
   pública do IBGE (Censo Demográfico 2022) — gratuita, sem chave. O dado é
   sempre no nível de **município inteiro**, não recortado pelo raio exato
   (o IBGE não publica assim) — é referência de escala, não número exato da
   área marcada. Isso está avisado na própria tela.

**Importante — o que ainda precisa de validação real:** o ambiente onde
este app foi desenvolvido não tem acesso à internet externa, então as
chamadas ao IBGE e o carregamento visual dos mapas (tiles do OpenStreetMap)
**não foram testados ao vivo** — só a lógica interna (cálculo de raio,
filtro de escolas, gráficos) foi validada de ponta a ponta, injetando
coordenadas reais diretamente. O código foi escrito de forma defensiva
(nunca trava a página se o IBGE ou o mapa falharem — mostra uma mensagem
em vez de quebrar), mas **teste com uma UF e um município reais no seu
navegador antes de confiar nos números do IBGE** — se algum código de
tabela/variável do SIDRA precisar de ajuste, é em `js/services/ibgeService.js`
que se mexe (os códigos de tabela usados estão documentados no topo do
arquivo).

**Renda per capita por município**: pesquisei, mas o IBGE não publica um
valor confiável de renda per capita *por município* de forma simples via
API (a série mais consistente do Censo 2022, PNAD Contínua, é por UF/Brasil,
não por município) — por isso não entrou nesta rodada. Se precisar disso
especificamente, vale investigar as tabelas de amostra do Censo 2022 com
mais calma (ex: 3424, 3261, 7435 no SIDRA), com boa margem de tempo pra
testar contra municípios reais.

## Fase 2: pesquisa de mercado sob demanda (padrão kedu, não IDEB/SAEB)

A ideia desta fase é transformar o kedu Radar num mapa de mercado mais rico,
sem pagar o custo de compilar dados adicionais pras 42 mil escolas de uma
vez. A aba **"Pesquisa de Mercado"** na ficha de cada escola tem duas partes,
pensadas a partir do padrão real das pesquisas de inteligência de mercado da
kedu (o modelo visto no relatório "Projeto Legatum": inteligência
geográfica, mapeamento competitivo, ICP, arquitetura de preço,
go-to-market) — não IDEB/SAEB, que não é o tipo de dado que entra nesse
tipo de relatório.

### Parte 1 — Concorrentes na região (grátis, instantâneo)

Usa dados que **já estão na base** (Censo Escolar): lista outras escolas do
mesmo município, ordenadas pela proximidade de ticket (mensalidade
estimada) com a escola aberta — o equivalente automático do bloco
"Mapeamento de Entrega dos Concorrentes" das pesquisas da kedu. Sem custo,
sem IA, carrega na hora (importa a UF sob demanda se ainda não estiver
carregada). Clicar num concorrente abre a ficha dele direto.

### Parte 2 — Pesquisa com IA (paga, sob demanda)

Para o que **não** está no Censo — perfil socioeconômico do bairro/região,
como a escola se posiciona e o que entrega, canais locais de indicação —
um botão dispara uma pesquisa pontual com a IA e busca na web, organizada
nesses 3 tópicos, com as fontes citadas no resultado.

**Por que não "integrar o QEdu" direto**: o QEdu bloqueia acesso
automatizado (robots.txt) — não dá pra consultar a página deles
programaticamente. A pesquisa com IA + busca na web contorna isso puxando o
que houver de público sobre a escola (que pode incluir o próprio QEdu,
indiretamente, como uma das fontes que a busca encontra).

**Custo**: cada clique é uma pesquisa paga (pela mesma chave de API da
Anthropic já configurada em Configurações — sem cadastro novo), na faixa
de centavos por consulta. Nada roda automaticamente — só quando alguém
clica em "Pesquisar agora" numa escola específica. O resultado fica salvo
no IndexedDB (`pesquisaMercado`), então reabrir a mesma escola depois não
gera custo de novo — só clicando em "Pesquisar de novo" explicitamente.

**Se um dia fizer sentido enriquecer em lote** (não sob demanda): o caminho
certo pra dados oficiais de aprendizado (IDEB/SAEB) é baixar direto do INEP
(inep.gov.br/dados/indicadores-educacionais) e integrar no pipeline de ETL,
igual foi feito com o Censo Escolar — mas isso é uma tarefa separada, maior,
e não foi feita nesta rodada (e não é prioridade, já que não é o tipo de
dado que entra nas pesquisas de mercado da kedu).

## Enriquecimento de dados institucionais

O botão "Buscar dados institucionais" na aba Resumo consulta a
[BrasilAPI](https://brasilapi.com.br) usando o CNPJ da escola — um espelho
público e gratuito do Cadastro Nacional da Pessoa Jurídica da Receita
Federal, sem necessidade de chave de API. Traz razão social, situação
cadastral, natureza jurídica, CNAE, e o quadro de sócios/administradores
(CPF sempre mascarado pela própria fonte). O resultado fica em cache local
(não busca de novo, a menos que você clique em "Atualizar").

**Marketing Digital é preenchimento manual.** Não existe hoje uma API
pública, gratuita e legal para descobrir automaticamente perfis de redes
sociais ou o Google Business Profile de uma empresa a partir do CNPJ —
scraping de sites como Google/Instagram a partir do navegador do usuário
violaria os termos de uso dessas plataformas e não é confiável. Se isso virar
uma necessidade real, o caminho é integrar uma API paga (Google Custom Search
API, SerpAPI) seguindo o mesmo padrão de "cole sua própria chave" usado para
IA.

## Importante sobre os dados

Este app roda **sem backend**. Isso significa que os marcadores, as
observações, o histórico e os documentos anexados ficam salvos **apenas no
navegador onde foram criados** — não são compartilhados automaticamente
entre computadores ou membros do time. Para consolidar a visão do time, use
**Configurações → Backup e restauração** para trocar snapshots em JSON entre
os vendedores (documentos anexados não entram no backup — ficam só locais),
ou peça para cada um exportar a lista filtrada em CSV na tela de Busca.

Os números de **faturamento potencial** e **capacidade ociosa** são
estimativas calculadas a partir de premissas de mercado (ver
`ARQUITETURA.md#modelos-e-premissas`) — ainda não calibradas com benchmarks
reais de clientes da Kedu.

## Recursos de IA — leia antes de ativar

O painel da escola pode chamar a API da Anthropic **diretamente do
navegador**, usando uma chave que você cola em Configurações. Isso só é
possível porque este app não tem backend — e tem uma consequência real: **a
chave fica salva neste navegador e é visível a quem tiver acesso ao DevTools
dele.** Recomendações:

- Use uma chave de API dedicada a este uso, com limite de gasto configurado
  no [console da Anthropic](https://console.anthropic.com).
- Não compartilhe a mesma chave entre vários vendedores no mesmo computador
  público — cada instalação/navegador deveria ter a sua.
- Se isso virar um uso pesado do time todo, vale migrar essa chamada para um
  backend simples (ver limitação de arquitetura abaixo) em vez de manter a
  chave no cliente.

## Limitação conhecida de arquitetura

Por ser 100% front-end (decisão tomada no início do projeto, em vez de usar
Supabase), não existem perfis de Admin/Gestor/Vendedor com permissões
diferentes, nem sincronização automática entre computadores do time. Cada
navegador é uma instância isolada. Isso foi um trade-off consciente pela
simplicidade e custo zero — o caminho de evolução, se algum dia for
necessário, está descrito em `ARQUITETURA.md`.

## Migração automática de dados antigos

Se você usou uma versão anterior do app (com Kanban, Agenda e status de
vendedor soltos), ao abrir esta versão o IndexedDB é migrado automaticamente:
cada combinação de status/vendedor vira uma tag equivalente, aplicada à
escola correspondente, com o histórico preservado. Nada é perdido — Kanban e
Agenda simplesmente não têm mais tela própria, mas os dados viraram
marcadores comuns, editáveis como qualquer outro.
