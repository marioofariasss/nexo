# Plano de dados públicos — evolução do Nexo sem custo de API

## Diagnóstico em 13/08/2026

A base estática publicada contém 43.068 registros: 42.454 vindos do Censo
Escolar e 614 descobertos via OpenStreetMap. Os 42.454 registros do Censo têm
CNPJ; o déficit está concentrado nos registros descobertos. Há coordenadas em
24.574 registros, telefone em 39.870 e site em apenas 13. Esses números medem
os JSONs distribuídos com a aplicação; dados salvos no IndexedDB de cada
usuário podem ser diferentes.

Não é recomendável juntar todos os indicadores em um único “score mágico”. O
produto deve guardar valor, ano de referência, granularidade geográfica,
fonte e se o campo é observado, estimado ou proxy. Assim, o vendedor consegue
distinguir fato oficial de hipótese comercial.

## Estado da implementação

- População por idade simples de 0 a 17 anos, renda domiciliar per capita
  média/mediana e nascimentos 2020–2024 são consultados nas tabelas oficiais
  do SIDRA e exibidos por município.
- A camada territorial foi processada para as 27 UFs em
  `data/territorio/{UF}.json`, com renda do responsável pelo domicílio e
  faixas de 0–19 anos por setor censitário.
- Penetração privada por etapa e projeções de entrada das coortes são
  calculadas com premissas e anos de referência visíveis.
- O benchmark de consumo usa a POF 2017–2018 por Grande Região e é rotulado
  como proxy agregado, não comportamento individual.
- Os 614 registros OSM foram auditados: 121 ficaram como candidatas privadas
  para revisão e 493 foram retirados dos indicadores por serem públicos,
  não regulares ou fora do escopo do INEP.
- O pipeline de candidatos de CNPJ usa o dump aberto da Receita e exige
  confirmação humana antes de promover uma escola descoberta aos indicadores.

## Camadas propostas

| Camada | Indicador | Fonte gratuita | Recorte | Atualização | Tratamento no Nexo |
|---|---|---|---|---|---|
| Público escolar | População 0–3, 4–5, 6–10, 11–14 e 15–17 | SIDRA/IBGE, tabela 9514 | Município | Censo | Implementado via API; idade simples, não proxy de 5 anos |
| Poder de compra | Rendimento do responsável/domicílio e distribuição por classes | Agregados por Setores Censitários do Censo 2022 | Setor, bairro e município | Censo | ETL offline por UF; publicar JSON simplificado |
| Demanda futura | Nascidos vivos por município de residência e coorte | SINASC/OpenDataSUS | Município | Anual | ETL anual; projetar entrada em creche/pré-escola com cenários, sem chamar de previsão oficial |
| Penetração privada | Matrículas privadas / população da idade correspondente | INEP + IBGE | Município | Anual | Calcular por etapa; exibir numerador, denominador e cobertura |
| Consumo | Participação de despesas com educação por faixa de renda | POF/IBGE 2017–2018 | Brasil/Grandes Regiões | Por edição da POF | Usar como benchmark regional, nunca como comportamento individual ou do bairro |
| Concorrência | Escolas, matrículas, abertura/desaparecimento, porte e etapa | Microdados do Censo Escolar/INEP | Escola e município | Anual | Já é a espinha dorsal; manter histórico por ano |
| Descoberta | Escola possivelmente ausente do Censo | OpenStreetMap/Overpass | Ponto | Contínua | Tratar como candidato não verificado até validar dependência e natureza privada |
| Empresa | Situação, CNAE, endereço, telefone e QSA a partir do CNPJ conhecido | Receita/BrasilAPI | Estabelecimento | Consulta | Já implementado sob demanda |

## Ordem de implementação

### 1. Indicadores municipais leves

Gerar um arquivo estático por UF, versionado junto ao site, contendo:

```json
{
  "codigoMunicipio": "2304400",
  "anoPopulacao": 2022,
  "populacaoPorEtapa": { "creche": 0, "preEscola": 0, "fundI": 0, "fundII": 0, "medio": 0 },
  "nascidosVivos": { "2021": 0, "2022": 0, "2023": 0, "2024": 0 },
  "matriculasPrivadasPorEtapa": {},
  "penetracaoPrivadaPorEtapa": {}
}
```

O navegador apenas lê o JSON. Download, limpeza e agregação rodam fora do
site uma vez por atualização. Isso evita depender de disponibilidade e CORS
das APIs durante uma reunião comercial.

Para natalidade, usar município de **residência da mãe**, não município onde
ocorreu o parto. Mostrar três cenários de conversão para educação privada
(conservador, base e otimista), com taxas configuráveis e explicitamente
rotuladas como premissas. Não somar nascimentos e população atual como se
fossem grandezas do mesmo ano.

### 2. Renda e público dentro do raio

Usar os agregados definitivos por setor censitário do Censo 2022, incluindo o
arquivo específico de rendimento atualizado pelo IBGE em maio de 2026. Fazer
o ponto da escola cair no polígono do setor (`spatial join`) e gerar, por UF:

```json
{
  "codigoSetor": "...",
  "codigoMunicipio": "...",
  "centroide": [-3.0, -38.0],
  "populacao0a17": 0,
  "rendimento": 0,
  "faixaRendimentoDominante": "..."
}
```

Para análises por raio, somar setores com ponderação de interseção quando a
geometria estiver disponível. Usar apenas o centroide é aceitável para mapa
exploratório, mas não para declarar uma população exata dentro do raio.

### 3. Enriquecimento das 614 escolas descobertas

O fluxo deve ser de resolução de identidade, não de preenchimento automático
sem evidência:

1. Revalidar se parece privada e se é realmente uma escola de educação
   básica; separar curso de idiomas, faculdade e equipamento público.
2. Tentar correspondência com o Censo/INEP por nome normalizado, distância,
   endereço e telefone. Se casar, absorver o registro no código INEP em vez
   de manter uma escola paralela.
3. Procurar CNPJ somente em fonte empresarial pública, comparando nome
   fantasia/razão social, município, CEP e endereço. Nome isolado não basta.
4. Classificar o resultado como `confirmado`, `provável`, `ambíguo` ou `sem
   correspondência`, guardando evidências e data da verificação.
5. Só o CNPJ confirmado habilita o enriquecimento já existente pela
   BrasilAPI. O campo manual atual continua sendo a saída para revisão humana.

Para lote nacional, a base aberta de CNPJ da Receita é grande demais para o
navegador. A alternativa sem mensalidade é uma rotina offline que filtra os
CNAEs educacionais, normaliza nome/endereço e publica apenas candidatos de
correspondência. O arquivo completo da Receita não deve ir para o GitHub
Pages.

## Métricas que a interface deve mostrar

- População por etapa e participação no total municipal.
- Nascimentos por coorte, variação de 3 e 5 anos e demanda potencial no ano
  em que a coorte atinge cada etapa.
- Matrículas privadas por etapa, penetração privada e tendência anual.
- Rendimento mediano/médio, distribuição por classes e população 0–17 nos
  setores que formam a área analisada.
- Escolas por 10 mil pessoas em idade escolar, matrículas por escola,
  concentração das top 3/5/10 e capacidade ociosa estimada.
- Cobertura/qualidade: percentual das escolas com CNPJ, coordenada, telefone,
  site e correspondência confirmada.

## Limites que precisam aparecer no produto

- Censo 2022 descreve uma fotografia, não renda corrente de 2026.
- POF descreve padrão médio por região/classe, não intenção de consumo de uma
  família ou bairro específico.
- Nascimento registrado não equivale a futura matrícula privada; migração,
  mortalidade, escolha da rede e deslocamento alteram a coorte.
- População municipal não pode ser comparada diretamente com matrículas de um
  raio sem indicar a diferença de recorte.
- Dados do OpenStreetMap têm cobertura colaborativa e não comprovam natureza
  privada, atividade ou CNPJ.

## Fontes oficiais

- IBGE, Censo 2022 — agregados por setores censitários e malhas:
  https://www.ibge.gov.br/estatisticas/sociais/populacao/22827-censo-demografico-2022.html
- IBGE/SIDRA — tabela 9514, população por sexo e idade:
  https://sidra.ibge.gov.br/tabela/9514
- INEP — microdados do Censo Escolar:
  https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-escolar
- Ministério da Saúde/OpenDataSUS — SINASC:
  https://dadosabertos.saude.gov.br/dataset/sistema-de-informacao-sobre-nascidos-vivos-sinasc
- IBGE — POF 2017–2018:
  https://www.ibge.gov.br/estatisticas/sociais/populacao/24786-pesquisa-de-orcamentos-familiares-2.html
