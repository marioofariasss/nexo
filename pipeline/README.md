# Pipelines públicos sem custo de API

Instale as dependências em um ambiente Python isolado:

```bash
python3 -m venv .venv-dados
.venv-dados/bin/pip install -r pipeline/requirements-dados.txt
```

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

Baixe e extraia localmente o snapshot aberto da Receita Federal. Não publique
o dump bruto no GitHub. Depois execute:

```bash
.venv-dados/bin/python pipeline/pipeline_cnpj_escolas_descobertas.py \
  --pasta-receita /caminho/para/csvs-extraidos \
  --saida data/cnpj_candidatos
```

O resultado contém no máximo três sugestões por escola. O Nexo não confirma
automaticamente: um operador precisa escolher a correspondência na ficha.
