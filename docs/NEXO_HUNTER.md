# Nexo Hunter

O Nexo Hunter é a área operacional de descoberta e qualificação territorial de
escolas privadas que não constam na base INEP/Nexo. O módulo foi incorporado ao
app existente sem misturar candidatos de prospecção com a base fria do Censo.

## Fluxo operacional

1. **Território** escolhe o município ativo na fila.
2. **Descoberta** geocodifica o município e consulta escolas mapeadas no
   OpenStreetMap, respeitando o raio configurado.
3. **Deduplicação** compara nome/localidade, CNPJ, telefone ou domínio com a
   base INEP/Nexo e com candidatos já encontrados.
4. **Classificação** rejeita sinais claros de escola pública, técnica, curso
   livre, faculdade, universidade e outras instituições fora do ensino regular.
5. **Investigação** reúne contato, site, Instagram, CNPJ, decisor e evidências
   públicas. A ficha oferece atalhos de pesquisa e exige que cada informação
   relevante tenha fonte registrada.
   O registro do **Colégio Professora Jemina Gois** é reconhecido como espelho:
   seus campos preenchidos e tipos de evidência viram a régua de cobertura das
   demais escolas. O espelho também pode ser trocado na ficha de qualquer lead.
   Quando a chave do Gemini está configurada, o agente investiga os novos leads
   em fontes públicas, preenche somente lacunas, guarda as URLs consultadas e
   valida CNPJ/contatos na BrasilAPI. Nenhum dado manual existente é sobrescrito.
6. **ICP e porte** calcula score, tier A–D, completude e porte estimado. Receita
   mensal só aparece como intervalo quando alunos e mensalidade estimados foram
   informados; nunca é tratada como faturamento confirmado.
7. **Revisão humana** qualifica ou descarta a escola.
8. **Cadastro kedu** valida os cinco campos obrigatórios e abre o formulário
   oficial da kedu. A pessoa copia os dados e confirma o envio no Nexo somente
   depois que o site da kedu aceitar o formulário.
9. **Relatórios** consolida produção, novidade, enriquecimento, decisor, ICP,
   envios e cobertura nos períodos diário, semanal, mensal ou personalizado.

## Por que o envio à kedu é assistido

O formulário público de `kedu.com.br` usa token e nonce de curta duração, além
de consentimento e controles antiautomação. Um front-end estático em outro
domínio não pode enviar esse formulário diretamente de forma confiável nem deve
simular o consentimento da pessoa. Por isso o agente de cadastro:

- valida responsável, escola, e-mail, cargo e telefone;
- converte o cargo para uma opção aceita pelo formulário;
- abre o formulário oficial;
- oferece cópia individual dos campos;
- só registra o status `enviada_kedu` após confirmação humana.
- permite tentar novamente registros qualificados, aguardando envio ou já
  marcados como enviados, sem esconder a ação nem desfazer a qualificação.
- quando o site não confirma o recebimento, registra a falha, mantém o
  histórico e devolve a escola para `qualificada`, pronta para nova tentativa.

Essa arquitetura preserva o caminho obrigatório que já alimenta o CRM interno
e evita registrar como concluído um envio que o site não aceitou. Se a kedu
disponibilizar futuramente um endpoint autenticado para outbound, o adaptador
pode ser trocado sem mudar a fila ou os relatórios.

## Meta e saturação territorial

- Meta padrão: **20 escolas qualificadas por dia** (configurável).
- Fila inicial: Fortaleza, Caucaia, Maracanaú, Eusébio, Aquiraz, Sobral,
  Juazeiro do Norte e Crato.
- Memória por município: ciclos, consultas, encontrados, novos, ciclos sem
  novidade, última busca e cobertura estimada.
- Avanço automático: cobertura estimada de 95% ou três ciclos consecutivos sem
  novas escolas.
- O indicador de cobertura é operacional, baseado na repetição e no rendimento
  das buscas; não representa um censo oficial de empresas do município.

## Execução automática

Abrir `pages/hunter.html?autorun=1` dispara, no máximo uma vez por dia e por
navegador, o ciclo do território ativo. A marca diária fica no `localStorage`,
enquanto os resultados e logs continuam no IndexedDB. O agendamento externo das
9h é responsável por iniciar o servidor local e abrir essa URL.

A etapa automática termina na fila de revisão. Qualificação humana e envio do
formulário da kedu não são realizados silenciosamente.

Para uso local no macOS:

- `INICIAR_NEXO.command` abre o Hunter normalmente;
- `TESTAR_AUTOMACAO_HOJE.command` abre o modo automático e executa o ciclo do
  território ativo uma vez naquele dia.

## Persistência

O schema do IndexedDB passou para a versão 6 e ganhou stores independentes:

| Store | Conteúdo |
|---|---|
| `hunterLeads` | Escolas candidatas, contatos, ICP, estimativas, status e fontes |
| `hunterTerritorios` | Fila, cobertura, memória de consultas e saturação |
| `hunterRuns` | Execuções concluídas ou com erro, com métricas e reprocessamento |
| `hunterLogs` | Atividade auditável por agente |
| `hunterReviews` | Histórico de decisões e alterações por escola |

Os dados continuam locais ao navegador, conforme a arquitetura atual do Nexo.
Para uma operação multiusuário e autônoma 24/7, a evolução seguinte é mover
essas cinco stores para um backend compartilhado com autenticação, agenda e
workers. O modelo atual já deixa as entidades separadas para essa migração.

## Relatórios e exportações

O dashboard oferece:

- meta e progresso;
- encontradas, novas, qualificadas e enviadas;
- taxa de novidade;
- taxa de enriquecimento;
- taxa com decisor;
- ICP A/B/C/D;
- cobertura territorial;
- fila de revisão;
- histórico de agentes e falhas.

CSV exporta a relação de escolas do período. XLSX cria três abas: `Resumo`,
`Escolas` e `Territórios`.

## Arquivos principais

- `pages/hunter.html`
- `js/pages/hunter.js`
- `js/services/hunterService.js`
- `js/services/db.js`
- `js/components/layout.js`
- `assets/css/components.css`
