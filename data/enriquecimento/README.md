# Fila compacta de enriquecimento

`fila_cnpj.json` contém somente os campos necessários para cruzar escolas OSM
sem CNPJ com a Receita. Ela não contém o dump da Receita. Para atualizar a
fila, exporte a Central de Enriquecimento e execute:

```bash
python3 pipeline/preparar_fila_cnpj.py \
  /caminho/nexo_fila_enriquecimento_AAAA-MM-DD.json \
  data/enriquecimento/fila_cnpj.json
```

O workflow **Atualizar candidatos de CNPJ** usa essa fila, baixa o snapshot
oficial em um runner temporário e publica somente os candidatos compactos.
