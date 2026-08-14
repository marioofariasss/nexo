# Arquitetura

## Estrutura de pastas

```
/
├── index.html                  Dashboard (página inicial)
├── /pages                      Demais páginas (busca, kanban, vendedor, agenda, config)
├── /assets/css                 tokens.css (variáveis), base.css (reset), components.css (UI)
├── /assets/icons, /images       Ícones e imagens estáticas
├── /js/components               Componentes reutilizáveis (ex: layout.js = sidebar + topbar)
├── /js/services                 Acesso a dados: db.js (IndexedDB), importService.js
├── /js/utils                    Funções puras: formatters.js, theme.js
├── /js/pages                     Um arquivo por página, com a lógica específica dela
├── /data                        JSONs "semente" do Censo INEP (ver abaixo)
└── /docs                        Esta documentação
```

Não há build step (webpack/vite/etc): todo JS é carregado via
`<script type="module">`, usando `import`/`export` nativos do navegador. Isso
mantém o deploy no GitHub Pages trivial (é só arquivo estático), ao custo de
não ter bundling/minificação — aceitável para o tamanho deste projeto.

## Camadas de dados

Há duas camadas de dados completamente separadas, ligadas pela chave `id`
(= `CO_ENTIDADE` do Censo Escolar):

### 1. Base fria (`escolas`) — dados do Censo, somente leitura pelo app

Vem de `/data/escolas/{UF}.json` (um arquivo por estado, ~30 KB a ~14 MB
dependendo do estado) mais o índice `/data/uf_index.json`. Ela é importada
para o object store `escolas` do IndexedDB.

**Por que dividir por UF em vez de um arquivo único de 32 MB?** Performance
(lazy loading): a maior parte das telas só precisa de um estado por vez (ex:
um vendedor filtrando por "SP"). Carregar tudo de uma vez tornaria o primeiro
acesso lento. `importService.js` importa cada UF sob demanda e marca em
`meta` que aquela UF já foi importada, para não buscar de novo.

Quando uma nova base do Censo sair (ex: 2026), gere novos arquivos e mude a
constante `VERSAO_BASE` em `importService.js` — isso faz o app reimportar
tudo automaticamente, sem apagar a camada comercial.

**Nota de arquitetura:** os serviços que buscam arquivos de `/data`
(`importService.js`, `dashboardDataService.js`) resolvem o caminho a partir
da localização do próprio módulo (`new URL('../../data/', import.meta.url)`),
não a partir da página que os importou. Isso é necessário porque o mesmo
serviço é usado tanto por `index.html` (na raiz) quanto por páginas dentro de
`/pages/` — um caminho relativo simples (`fetch('data/algo.json')`) funciona
na raiz mas quebra dentro de `/pages/`. Qualquer novo serviço que busque algo
em `/data` deve seguir o mesmo padrão.

### 2. Camada local legada (`crm`, `interacoes`)

- Essas stores pertencem a versões anteriores e não aparecem mais na
  experiência principal. Permanecem no schema para que uma atualização não
  apague silenciosamente dados locais existentes.

Essas duas stores **nunca são apagadas** por uma reimportação da base fria.

### 3. Camada analítica longitudinal

`data/inteligencia/resumo.json` contém séries Brasil/UF e diagnósticos
municipais. `data/inteligencia/escolas/{UF}.json` contém séries 2019–2025 por
escola e município. Tudo é gerado por
`pipeline/pipeline_inep_longitudinal.py` a partir dos ZIPs oficiais do Inep.
O pipeline harmoniza a tabela única de 2019–2024 com as tabelas separadas de
escola, matrícula, turma e docente publicadas em 2025.

### Schema do IndexedDB (`js/services/db.js`)

| Store | Chave | Índices | Uso |
|---|---|---|---|
| `escolas` | `id` | `uf`, `porte`, `icpTier`, `municipio`, `nome` | Base fria, busca indexada |
| `crm` | `id` | — | Tags aplicadas (`tags: [id,...]`), observações, marketing digital manual |
| `tags` | `id` (auto) | `tipo` | Catálogo de marcadores: nome, cor, ícone, ordem, tipo (status/vendedor/outro) |
| `tagHistorico` | `historicoId` (auto) | `escolaId` | Quem adicionou/removeu qual tag, e quando |
| `interacoes` | `interacaoId` (auto) | `escolaId` | Histórico de CRM (ligações, e-mails, reuniões) |
| `documentos` | `documentoId` (auto) | `escolaId` | Arquivos anexados (Blob), não entram no backup JSON |
| `enriquecimentoCnpj` | `cnpj` | — | Cache dos dados públicos de CNPJ já buscados (BrasilAPI) |
| `meta` | `chave` | — | Controle interno (versão da base, nome do usuário, filtros salvos, chave de API) |

**Nota sobre a migração v1/v2 → v3:** versões anteriores tinham `status`,
`vendedor` e `etapaKanban` como campos soltos em `crm`, além das stores
`compromissos` (Agenda). A função `migrarStatusVendedorParaTags()` em
`db.js` roda automaticamente dentro do `onupgradeneeded`, convertendo cada
valor distinto de status/vendedor em uma tag equivalente. Ponto importante:
os `add()` de tag são assíncronos, então a função primeiro descobre TODOS os
nomes de tag distintos entre todos os registros, cria cada um exatamente uma
vez (em sequência), e só então atualiza os registros de `crm` — fazer isso
registro-por-registro duplicaria tags toda vez que dois registros
compartilhassem o mesmo vendedor.

## Como adicionar um novo filtro na busca (Fase 2 em diante)

1. Se o filtro precisa ser rápido em milhares de registros, adicione um
   índice novo no `onupgradeneeded` de `db.js` (lembre de incrementar
   `DB_VERSION`).
2. Adicione o campo correspondente nos scripts de ETL que geram os JSONs em
   `/data/escolas` (fora deste repositório — ver seção seguinte).
3. Use `getByIndex('escolas', 'nomeDoIndice', valor)` em vez de filtrar um
   array em memória.

## Como adicionar uma nova coluna / enriquecer os dados

Os arquivos em `/data` são gerados por um pipeline Python (pandas) fora deste
repositório, a partir dos microdados do Censo Escolar INEP. Para adicionar um
campo novo:

1. Calcule o campo no pipeline de ETL (mesmo processo já usado para ICP,
   faturamento potencial, capacidade ociosa, evasão).
2. Adicione a coluna ao `rename` do script de exportação para nomes curtos
   (reduz o tamanho dos JSONs).
3. Regenere os arquivos de `/data/escolas/{UF}.json` e `/data/uf_index.json`.
4. Se o campo precisar ser buscável rapidamente, adicione um índice (ver
   seção anterior).

## Como importar uma nova fonte de dados / API

Todo import passa por `importService.js`. Para uma fonte nova (ex: uma API de
enriquecimento de CNPJ):

1. Escreva uma função `importarDeAPI()` que busca os dados e os transforma no
   mesmo formato de registro usado em `escolas` (mesma chave `id`).
2. Chame `bulkPut('escolas', registros)` — os registros existentes com o
   mesmo `id` são atualizados (merge manual de campos, se necessário, antes do
   `bulkPut`).

## Modelos e premissas

- **ICP (`icp`, 0–100):** mede o **perfil do responsável/dono** da escola
  (não o tamanho ou a estrutura da escola em si) — gestor com pós-graduação
  (40%), gestor é o próprio dono/acesso ao cargo próprio (35%) e mantenedora
  como empresa formal (25%). Baseado só em campos do Censo (`gestorPos`,
  `gestorDono`, `mantEmpresa`); quando a aba Responsáveis busca o quadro
  societário via CNPJ, isso complementa mas não altera o score agregado.
- **Faturamento potencial (`fatPotencial`):** mensalidade média estimada por
  porte × multiplicador regional × matrículas × 12 meses. Estimativa, não
  dado real — calibrar com benchmarks de clientes.
- **Capacidade ociosa (`capOciosa`):** compara a média de alunos/turma da
  escola com a mediana de escolas do mesmo porte/UF. Proxy, não a capacidade
  física real declarada.
- **Dados institucionais e sócios (aba Responsáveis):** vêm exclusivamente da
  BrasilAPI (espelho público do Cadastro Nacional da Pessoa Jurídica). Nunca
  inventados, nunca de scraping — se a fonte não tiver o dado, o campo fica
  vazio.

## Inventário vivo e enriquecimento de escolas descobertas

- O total principal não é a contagem bruta do IndexedDB. `calcularCenarioAtual()`
  combina a contagem semente das UFs ainda não carregadas com a contagem real
  das UFs já carregadas. Assim uma importação parcial nunca reduz artificialmente
  o total nacional e escolas OSM incorporadas aparecem imediatamente.
- A ação “Buscar informações desta escola” cruza uma descoberta OSM com o Censo
  INEP por nome, município, CEP, telefone e distância. Só a confirmação humana
  aplica o vínculo. O registro OSM vinculado fica fora das análises agregadas para
  não duplicar a escola oficial.
- CNPJ conhecido é consultado na BrasilAPI. Busca de CNPJ por nome usa candidatos
  produzidos offline pelo dump mensal aberto da Receita com
  `pipeline/pipeline_cnpj_escolas_descobertas.py`; o navegador não raspa QEdu,
  buscadores ou sites privados.
- Matrículas e porte vêm do INEP. Porte jurídico, capital social e situação vêm da
  Receita. Ticket e faturamento são sempre identificados como estimativas; não há
  fonte pública nacional confiável que publique esses valores reais por escola.

### Esteira operacional das descobertas

1. A Central processa todas as escolas `fonte=osm` e separa fora de escopo,
   vínculo INEP, revisão INEP, revisão CNPJ e pesquisa pendente.
2. Código INEP exato informado pela fonte pode ser vinculado automaticamente.
   Correspondência por similaridade fica para revisão.
3. A exportação `nexo_fila_enriquecimento_*.json` é a ponte entre o IndexedDB
   e o pipeline offline; isso inclui as descobertas feitas depois do deploy e
   que não existem nos JSONs versionados.
4. O pipeline da Receita devolve arquivos `{UF}.json`, importados pela Central
   e armazenados localmente. Candidatos com nome ≥90%, endereço coincidente,
   município/UF compatíveis e PJ ativa podem ser validados em lote; os demais
   exigem confirmação individual.
5. Depois do CNPJ, a consulta pública preenche razão social, situação, capital,
   natureza, telefone, e-mail e QSA disponíveis. Presença digital vem do OSM,
   site oficial, preenchimento do time ou busca opcional configurada — nunca é
   inferida apenas pelo nome.

`baixar_base_cnpj_receita.py` consulta o compartilhamento público WebDAV da
Receita, descobre o snapshot mensal mais recente e baixa somente as 10 partes
de Empresas, as 10 de Estabelecimentos e Municípios. O pipeline lê os ZIPs
diretamente e considera CNAE educacional principal ou secundário. A evidência
de correspondência combina nome fantasia/razão social, município, CEP, bairro,
logradouro/número, telefone e e-mail.

## Qualidade geográfica

`coordenadaValidaBrasil()` valida latitude/longitude contra o território esperado
da UF. Coordenadas ausentes ou incompatíveis não entram em mapas, distâncias,
heatmaps ou rankings por raio. A ficha continua acessível e usa busca textual no
Maps até que a coordenada seja corrigida. A auditoria de agosto/2026 encontrou
3.002 coordenadas inconsistentes entre as 24.574 preenchidas na semente atual.

## Publicar no GitHub Pages

Ver a seção correspondente em [`README.md`](./README.md).

## Evoluindo o sistema

Cada fase do roadmap (ver README) deve:

1. Criar sua própria página em `/pages` (ou usar `index.html` se for o
   dashboard) + seu próprio arquivo em `/js/pages`.
2. Reaproveitar `montarLayout()` de `js/components/layout.js` para manter a
   sidebar/topbar consistentes.
3. Usar as funções de `js/services/db.js` para qualquer leitura/escrita —
   nunca acessar o IndexedDB diretamente de dentro de uma página.

## Pesquisa de Mercado (página própria) — arquitetura e fontes de dados

`pages/mercado.html` + `js/pages/mercado.js` — análise por raio geográfico,
independente da ficha de qualquer escola específica.

**Componentes:**
- **Mapa** (Leaflet + tiles do OpenStreetMap, via CDN — gratuito, sem
  chave). Clique define o centro da análise; um slider define o raio
  (1-30km); um círculo visual mostra a área coberta.
- **Escolas na região**: filtra a base do Censo (já carregada no
  IndexedDB) por distância real do centro, usando a fórmula de haversine
  (`js/utils/geo.js`). Sem custo, sem chamada externa — é cálculo local
  sobre dados que já existem.
- **Município (opcional)**: ao selecionar um município no dropdown (lista
  vinda da API de Localidades do IBGE), o app centraliza o mapa usando a
  **mediana** (não a média) das coordenadas das escolas daquele município
  já carregadas. Usa mediana de propósito — a base tem uma minoria de
  escolas com coordenada corrompida (resíduo do bug de escala do Censo
  original, corrigido só parcialmente na ETL), e a média é sensível a esses
  outliers; a mediana não. Isso foi um bug real encontrado durante o
  desenvolvimento desta página (testado com São Paulo: a média jogava o
  centro pra perto do Equador; a mediana acerta o centro real da cidade).
- **Demografia (IBGE)**: `js/services/ibgeService.js` consulta a API
  pública de Agregados/SIDRA do IBGE (Censo 2022) pelo código do município
  selecionado — população total e população por idade simples de 0 a 17
  anos. O front agrupa as idades nas faixas educacionais 0–3, 4–5, 6–10,
  11–14 e 15–17, sem a aproximação antiga por blocos de cinco anos. Sempre
  no nível de município — a API pública do IBGE não entrega população
  recortada por um raio livre.
- **Benchmarking direto/indireto**: o usuário escolhe um "porte de
  referência"; escolas do mesmo porte na região são classificadas como
  concorrentes diretos, o resto como indiretos, com ticket médio calculado
  separadamente pra cada grupo.
- **Relatório da região**: texto gerado por **template determinístico**
  (nunca por IA) a partir dos números já calculados na tela — não tem risco
  de inventar dado, porque só reformata o que já foi calculado.
- **Renda e população por setor censitário**: implementadas com os
  agregados definitivos do Censo 2022. O pipeline
  `pipeline/pipeline_renda_setor_censitario.py` baixa os GPKGs oficiais e
  produz `data/territorio/{UF}.json`. Os 27 arquivos publicados somam cerca
  de 39 MB e cobrem 472.780 setores.

### Camada territorial implementada

`js/services/socioeconomicoService.js` carrega somente a UF selecionada e
seleciona setores cujo ponto representativo cai no raio. A tela informa
moradores, população de 0–19 anos, renda média da pessoa responsável pelo
domicílio, mediana setorial ponderada e cobertura. Esta renda setorial não é
renda domiciliar per capita; a renda per capita municipal vem separadamente
da tabela SIDRA 10295.

O recorte espacial é exploratório: setores de borda não são fracionados.
Para estudos que exijam população exata dentro de uma geometria, o pipeline
deve calcular interseção proporcional entre polígonos em vez de usar o ponto
representativo.

## 8 análises adicionais da Pesquisa de Mercado

`js/services/mercadoAnaliseService.js` concentra a lógica pura (sem DOM,
fácil de testar isoladamente) das análises derivadas: `identificarRede`,
`agruparPorRede`, `calcularScoreOportunidade`, `calcularRanking`,
`montarFunil`. `js/pages/mercado.js` só orquestra: chama essas funções,
monta o HTML, desenha os gráficos.

**`data/medias_nacionais.json`**: pré-calculado uma vez a partir da base
nacional completa (não gerado em tempo real no navegador) — número de
escolas, faturamento potencial médio, ICP médio, capacidade ociosa média e
crescimento médio de matrículas, a nível Brasil. Usado só como uma das três
séries do radar chart comparativo. Se a base de escolas for reprocessada no
futuro (novo Censo, por exemplo), este arquivo precisa ser regenerado
junto — não é derivado automaticamente dos dados por município que o app
carrega.

**Nota de validação de sintaxe**: para arquivos `.js` usados como módulo ES
(`import`/`export`), valide com:
```bash
node --input-type=module --check < arquivo.js
```
em vez de `node --check arquivo.js` — o segundo formato nem sempre força
modo estrito/módulo, e pode deixar passar erros de sintaxe que o navegador
recusaria. Isso foi descoberto de forma dolorosa durante o desenvolvimento
desta seção (ver README para o caso específico).
