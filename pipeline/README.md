# Pipelines públicos sem custo de API

Instale as dependências em um ambiente Python isolado:

```bash
python3 -m venv .venv-dados
.venv-dados/bin/pip install -r pipeline/requirements-dados.txt
```

## Atualizar a série longitudinal do Censo Escolar

A camada publicada cobre 2019–2025 e harmoniza a mudança de layout de 2025,
quando o Inep separou escolas, matrículas, turmas e docentes em tabelas
distintas. Os ZIPs brutos ficam em `.cache/` e nunca são versionados:

```bash
python3 pipeline/baixar_microdados_inep.py
python3 pipeline/pipeline_inep_longitudinal.py
python3 pipeline/validar_inteligencia.py
```

O resultado é `data/inteligencia/resumo.json` mais um arquivo por UF em
`data/inteligencia/escolas/`. O navegador recebe somente agregados e séries
compactas; nenhuma tabela bruta do Inep é publicada.

## Atualizar a camada territorial

O comando baixa os arquivos oficiais do IBGE, processa as 27 UFs e sobrescreve
somente `data/territorio/{UF}.json`:

```bash
.venv-dados/bin/python pipeline/pipeline_renda_setor_censitario.py \
  --ufs all --saida data/territorio
```

## Auditar escolas descobertas

```bash
.venv-dados/bin/python pipeline/auditar_escolas_descobertas.py
```

A rotina preserva os registros e adiciona `qualidadeIdentidade`, separando
candidatas privadas dos itens fora do escopo comercial.

## Gerar candidatos de CNPJ

Para esta rotina basta o pandas; não é preciso instalar o conjunto geográfico:

```bash
python3 -m venv .venv-cnpj
.venv-cnpj/bin/pip install -r pipeline/requirements-cnpj.txt
```

Na Central de Enriquecimento, clique em **Exportar fila para o pipeline da
Receita**. O baixador descobre o snapshot mensal mais recente no repositório
oficial e baixa somente Empresas, Estabelecimentos e Municípios. Os ZIPs são
lidos diretamente, sem extração:

```bash
.venv-cnpj/bin/python pipeline/baixar_base_cnpj_receita.py \
  --snapshot latest \
  --destino .cache/receita-cnpj
```

O comando informa o mês encontrado e o volume antes de baixar. Em seguida:

```bash
.venv-cnpj/bin/python pipeline/pipeline_cnpj_escolas_descobertas.py \
  --pasta-receita .cache/receita-cnpj/AAAA-MM \
  --arquivo-escolas /caminho/nexo_fila_enriquecimento_AAAA-MM-DD.json \
  --saida data/cnpj_candidatos
```

O resultado contém no máximo três sugestões por escola, incluindo telefone,
e-mail, capital e porte jurídico públicos quando disponíveis. Selecione os
arquivos `{UF}.json` em **Importar resultados da Receita**. O Nexo não confirma
automaticamente: um operador precisa escolher a correspondência na ficha.

O filtro considera estabelecimentos ativos com CNAE principal **ou secundário**
de educação básica (`8511`, `8512`, `8513`, `8520`). A pontuação compara nome
fantasia e razão social, município, CEP, bairro, logradouro/número, telefone e
e-mail. O dump fica em `.cache/` e nunca deve ser versionado.

## Automação sem armazenamento local

O workflow `.github/workflows/enriquecer-cnpj.yml` executa no dia 5 de cada
mês e também pode ser iniciado manualmente na aba **Actions** do GitHub. Ele:

1. lê `data/enriquecimento/fila_cnpj.json`;
2. baixa o snapshot oficial no disco temporário do runner;
3. gera e valida os candidatos;
4. publica somente `data/cnpj_candidatos/{UF}.json`;
5. descarta a máquina e todo o dump bruto.

Para substituir a fila usando uma exportação antiga ou completa, reduza-a com
`pipeline/preparar_fila_cnpj.py`. A Central agora já exporta diretamente o
formato compacto.
