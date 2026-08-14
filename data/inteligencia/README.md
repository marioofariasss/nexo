# Camada de inteligência educacional

Arquivos derivados dos microdados oficiais do Censo Escolar/Inep, edições
2019–2025. `resumo.json` contém séries Brasil/UF e diagnósticos municipais;
`escolas/{UF}.json` contém séries por escola e município.

Os dados brutos não são versionados. Para reproduzir esta camada:

```bash
python3 pipeline/baixar_microdados_inep.py
python3 pipeline/pipeline_inep_longitudinal.py
python3 pipeline/validar_inteligencia.py
```

O risco de saturação é um sinal estatístico baseado na diferença entre o
crescimento anual da quantidade de escolas e o crescimento anual das matrículas
privadas. Não representa capacidade física observada nem previsão oficial.
