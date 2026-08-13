"""
pipeline_renda_setor_censitario.py
===================================

Pré-processa os dados de renda do Censo Demográfico 2022 do IBGE, no nível
de SETOR CENSITÁRIO (o recorte mais fino que o IBGE publica — bairro/
quarteirão, não município), e gera um JSON agregado que o kedu Radar
consome no navegador.

POR QUE ISSO PRECISA RODAR OFFLINE, FORA DO APP
------------------------------------------------
O app é 100% client-side (GitHub Pages, sem backend). Os arquivos brutos do
IBGE pra essa camada são pesados (a malha de setores censitários do Brasil
inteiro tem ~452 mil setores, em arquivos de centenas de MB a poucos GB) e
exigem processamento geoespacial (relacionar cada setor a um ponto
lat/long) que não é viável fazer no navegador do usuário final. Este script
faz esse trabalho pesado uma vez, offline, e gera um JSON pequeno e
otimizado que o site carrega normalmente.

ATENÇÃO — ISSO NÃO FOI TESTADO CONTRA OS ARQUIVOS REAIS
---------------------------------------------------------
Este script foi escrito com base na documentação pública do IBGE, mas o
ambiente onde ele foi criado não tem acesso à internet pra baixar e testar
contra os arquivos de verdade. Os nomes de coluna de renda (`COLUNA_RENDA`
abaixo) quase certamente vão precisar de ajuste depois que você abrir o
arquivo real e conferir o dicionário de dados — isso está sinalizado no
código com comentários "AJUSTAR APÓS BAIXAR OS DADOS REAIS".

O QUE VOCÊ PRECISA BAIXAR MANUALMENTE ANTES DE RODAR
--------------------------------------------------------
1. Acessa: https://www.ibge.gov.br/estatisticas/sociais/populacao/22827-censo-demografico-2022.html
   → aba "Downloads" → "Agregados por Setores Censitários"
   → baixa os arquivos de "Rendimento" (ou "Trabalho e Rendimento") por UF,
     ou o arquivo consolidado Brasil, conforme disponibilizado. Cada UF vem
     como um .zip com um ou mais .csv dentro.
2. No mesmo painel de downloads do Censo 2022, procura "Malha de Setores
   Censitários" → baixa os shapefiles (.shp + arquivos associados: .dbf,
   .shx, .prj) por UF ou do Brasil inteiro.
3. Extrai tudo numa pasta local, ex: `./dados_ibge_brutos/`, mantendo CSV e
   shapefile separados (ou juntos, se o IBGE já entregar integrado — a
   divulgação mais recente do Censo 2022 passou a integrar agregados +
   malha num só pacote, conforme a nota oficial; se for esse o seu caso,
   pula o join manual e ajusta a leitura conforme o formato que vier).

COMO RODAR
----------
    pip install pandas geopandas shapely --break-system-packages
    python3 pipeline_renda_setor_censitario.py \\
        --pasta-csv ./dados_ibge_brutos/renda \\
        --pasta-shapefile ./dados_ibge_brutos/malha \\
        --saida ./renda_por_setor.json

O QUE O SCRIPT FAZ
-------------------
1. Lê os CSVs de renda por setor censitário (uma linha por setor, com o
   código do setor e o valor de renda domiciliar per capita).
2. Lê os shapefiles da malha de setores censitários (geometria de cada
   setor, mais o código do setor e o código do município).
3. Junta os dois pelo código do setor censitário.
4. Calcula o centroide de cada setor (ponto lat/long representativo).
5. Salva um JSON enxuto: [{ codigoSetor, codigoMunicipio, lat, lon, renda }, ...]
   — sem geometria completa (que seria pesada demais pro navegador), só o
   centroide. Isso é suficiente pro app fazer "quais setores caem dentro
   deste raio" comparando distância do centroide, do mesmo jeito que já
   faz com as escolas.

DEPOIS DE GERAR O JSON
------------------------
Manda esse arquivo (`renda_por_setor.json`) de volta — a integração no
front-end (carregar esse JSON e cruzar com o raio desenhado no mapa, e com
o ICP das escolas) é rápida de fazer uma vez que os dados existem de
verdade.
"""

import argparse
import glob
import json
import os
import sys

import pandas as pd

try:
    import geopandas as gpd
except ImportError:
    gpd = None


# AJUSTAR APÓS BAIXAR OS DADOS REAIS: o nome exato da coluna de renda no
# CSV do IBGE varia conforme o arquivo específico baixado (ex: pode vir
# como "V07018", "RENDA_PC", "rendimento_domiciliar_per_capita" — confere
# o dicionário de dados que acompanha o download). Ajusta essa constante
# depois de abrir um dos CSVs reais.
COLUNA_RENDA = "V07018"

# AJUSTAR: coluna com o código do setor censitário no CSV de renda —
# geralmente algo como "CD_SETOR" ou "Cod_setor".
COLUNA_CODIGO_SETOR_CSV = "CD_SETOR"

# AJUSTAR: coluna com o código do setor censitário no shapefile da malha —
# costuma ser "CD_SETOR" também, mas confere.
COLUNA_CODIGO_SETOR_SHP = "CD_SETOR"

# AJUSTAR: coluna com o código do município no shapefile — geralmente
# "CD_MUN" (7 dígitos, o mesmo padrão usado pela API de localidades do IBGE
# que o app já consome em js/services/ibgeService.js).
COLUNA_CODIGO_MUNICIPIO_SHP = "CD_MUN"


def carregar_renda(pasta_csv: str) -> pd.DataFrame:
    """Lê e concatena todos os CSVs de renda por setor censitário da pasta."""
    arquivos = glob.glob(os.path.join(pasta_csv, "**", "*.csv"), recursive=True)
    if not arquivos:
        sys.exit(f"Nenhum .csv encontrado em {pasta_csv} — confere o caminho.")
    print(f"Encontrados {len(arquivos)} arquivos CSV de renda.")

    partes = []
    for caminho in arquivos:
        try:
            df = pd.read_csv(caminho, sep=";", encoding="latin1", low_memory=False)
        except Exception:
            df = pd.read_csv(caminho, sep=",", encoding="utf-8", low_memory=False)
        if COLUNA_CODIGO_SETOR_CSV not in df.columns or COLUNA_RENDA not in df.columns:
            print(f"  AVISO: {caminho} não tem as colunas esperadas "
                  f"({COLUNA_CODIGO_SETOR_CSV}, {COLUNA_RENDA}) — colunas "
                  f"disponíveis: {list(df.columns)[:15]}... — pulando este arquivo.")
            continue
        partes.append(df[[COLUNA_CODIGO_SETOR_CSV, COLUNA_RENDA]])

    if not partes:
        sys.exit(
            "Nenhum CSV tinha as colunas esperadas. Abre um dos arquivos "
            "reais, confere o dicionário de dados, e ajusta COLUNA_RENDA / "
            "COLUNA_CODIGO_SETOR_CSV no topo deste script."
        )

    renda = pd.concat(partes, ignore_index=True)
    renda = renda.rename(columns={COLUNA_CODIGO_SETOR_CSV: "codigoSetor", COLUNA_RENDA: "renda"})
    renda["codigoSetor"] = renda["codigoSetor"].astype(str)
    renda["renda"] = pd.to_numeric(renda["renda"], errors="coerce")
    renda = renda.dropna(subset=["renda"])
    print(f"Renda carregada para {len(renda)} setores censitários.")
    return renda


def carregar_malha(pasta_shapefile: str) -> "gpd.GeoDataFrame":
    """Lê e concatena os shapefiles da malha de setores censitários."""
    if gpd is None:
        sys.exit("geopandas não está instalado. Roda: pip install geopandas --break-system-packages")

    arquivos = glob.glob(os.path.join(pasta_shapefile, "**", "*.shp"), recursive=True)
    if not arquivos:
        sys.exit(f"Nenhum .shp encontrado em {pasta_shapefile} — confere o caminho.")
    print(f"Encontrados {len(arquivos)} shapefiles de malha.")

    partes = []
    for caminho in arquivos:
        gdf = gpd.read_file(caminho)
        colunas_necessarias = {COLUNA_CODIGO_SETOR_SHP, COLUNA_CODIGO_MUNICIPIO_SHP, "geometry"}
        if not colunas_necessarias.issubset(gdf.columns):
            print(f"  AVISO: {caminho} não tem as colunas esperadas — "
                  f"colunas disponíveis: {list(gdf.columns)} — pulando.")
            continue
        partes.append(gdf[[COLUNA_CODIGO_SETOR_SHP, COLUNA_CODIGO_MUNICIPIO_SHP, "geometry"]])

    if not partes:
        sys.exit(
            "Nenhum shapefile tinha as colunas esperadas. Confere os nomes "
            "reais das colunas (ex: abrindo o .dbf associado) e ajusta "
            "COLUNA_CODIGO_SETOR_SHP / COLUNA_CODIGO_MUNICIPIO_SHP."
        )

    malha = pd.concat(partes, ignore_index=True)
    malha = gpd.GeoDataFrame(malha, geometry="geometry")
    malha = malha.rename(columns={
        COLUNA_CODIGO_SETOR_SHP: "codigoSetor",
        COLUNA_CODIGO_MUNICIPIO_SHP: "codigoMunicipio",
    })
    malha["codigoSetor"] = malha["codigoSetor"].astype(str)
    malha["codigoMunicipio"] = malha["codigoMunicipio"].astype(str)

    # garante que a geometria está em coordenadas geográficas (lat/long,
    # WGS84) — a malha do IBGE normalmente já vem assim (EPSG:4674/SIRGAS
    # 2000, compatível na prática com WGS84 pra este uso), mas confere.
    if malha.crs is not None and malha.crs.to_epsg() not in (4326, 4674):
        malha = malha.to_crs(epsg=4674)

    print(f"Malha carregada com {len(malha)} setores censitários.")
    return malha


def gerar_json(renda: pd.DataFrame, malha: "gpd.GeoDataFrame", caminho_saida: str):
    unido = malha.merge(renda, on="codigoSetor", how="inner")
    print(f"Setores com renda E geometria (join bem-sucedido): {len(unido)} de {len(malha)}")

    if len(unido) == 0:
        sys.exit(
            "O join entre renda e malha não encontrou nenhum setor em comum. "
            "Os códigos de setor censitário provavelmente estão em formatos "
            "diferentes entre os dois arquivos (ex: com/sem zeros à "
            "esquerda) — confere um exemplo de cada lado e ajusta antes de "
            "rodar de novo."
        )

    centroides = unido.geometry.centroid
    registros = [
        {
            "codigoSetor": row.codigoSetor,
            "codigoMunicipio": row.codigoMunicipio,
            "lat": round(centroide.y, 6),
            "lon": round(centroide.x, 6),
            "renda": round(float(row.renda), 2),
        }
        for row, centroide in zip(unido.itertuples(index=False), centroides)
    ]

    with open(caminho_saida, "w", encoding="utf-8") as f:
        json.dump(registros, f, ensure_ascii=False, separators=(",", ":"))

    tamanho_mb = os.path.getsize(caminho_saida) / 1e6
    print(f"\nSalvo: {caminho_saida} ({len(registros)} setores, {tamanho_mb:.1f} MB)")
    if tamanho_mb > 30:
        print(
            "Aviso: arquivo grande pro navegador carregar de uma vez. "
            "Considera dividir por UF (mesmo padrão já usado pra "
            "data/escolas/{UF}.json no app) antes de integrar."
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pasta-csv", required=True, help="Pasta com os CSVs de renda por setor censitário baixados do IBGE")
    parser.add_argument("--pasta-shapefile", required=True, help="Pasta com os shapefiles da malha de setores censitários")
    parser.add_argument("--saida", default="renda_por_setor.json", help="Caminho do JSON de saída")
    args = parser.parse_args()

    renda = carregar_renda(args.pasta_csv)
    malha = carregar_malha(args.pasta_shapefile)
    gerar_json(renda, malha, args.saida)


if __name__ == "__main__":
    main()
