#!/usr/bin/env python3
"""Resolve candidatos de CNPJ usando o dump aberto mensal da Receita.

O script nunca confirma um CNPJ sozinho. Ele filtra estabelecimentos ativos
de educação básica, compara nome, município, CEP e endereço e publica até três
candidatos por escola para revisão humana no Nexo.

Entrada esperada: pasta com os CSVs extraídos de Empresas*.zip,
Estabelecimentos*.zip e Municipios.zip do snapshot oficial da Receita.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd


COL_EMPRESA = ["cnpjBasico", "razaoSocial", "natureza", "qualificacao", "capital", "porte", "enteFederativo"]
COL_ESTAB = [
    "cnpjBasico", "ordem", "dv", "matrizFilial", "nomeFantasia", "situacao", "dataSituacao",
    "motivoSituacao", "cidadeExterior", "pais", "inicioAtividade", "cnaePrincipal", "cnaesSecundarios",
    "tipoLogradouro", "logradouro", "numero", "complemento", "bairro", "cep", "uf", "municipioReceita",
    "ddd1", "telefone1", "ddd2", "telefone2", "dddFax", "fax", "email", "situacaoEspecial", "dataSituacaoEspecial",
]
COL_MUNICIPIO = ["codigo", "nome"]
CNAES_EDUCACAO_BASICA = ("8511", "8512", "8513", "8520")


def normalizar(texto: str) -> str:
    texto = "".join(c for c in unicodedata.normalize("NFD", str(texto or "")) if unicodedata.category(c) != "Mn")
    texto = re.sub(r"\b(COLEGIO|ESCOLA|CENTRO|EDUCACIONAL|EDUCACAO|ENSINO|LTDA|EIRELI|SA)\b", " ", texto.upper())
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", texto).split())


def arquivos(pasta: Path, termo: str) -> list[Path]:
    return sorted(p for p in pasta.rglob("*") if p.is_file() and termo.lower() in p.name.lower())


def ler_municipios(pasta: Path) -> dict[str, str]:
    encontrados = arquivos(pasta, "MUNIC")
    if not encontrados:
        return {}
    df = pd.read_csv(encontrados[0], sep=";", encoding="latin1", header=None, names=COL_MUNICIPIO, dtype=str)
    return dict(zip(df.codigo.str.zfill(4), df.nome.fillna('').map(normalizar)))


def carregar_escolas(pasta_escolas: Path) -> list[dict]:
    resultado = []
    for caminho in pasta_escolas.glob("*.json"):
        for escola in json.loads(caminho.read_text(encoding="utf-8")):
            if escola.get("fonte") == "osm" and escola.get("qualidadeIdentidade", {}).get("status") == "candidata_privada_revisao":
                resultado.append(escola)
    return resultado


def filtrar_estabelecimentos(pasta: Path, ufs: set[str]) -> pd.DataFrame:
    partes = []
    for caminho in arquivos(pasta, "ESTABELE"):
        print(f"Lendo estabelecimentos: {caminho.name}")
        for chunk in pd.read_csv(caminho, sep=";", encoding="latin1", header=None, names=COL_ESTAB, dtype=str, chunksize=250_000, low_memory=False):
            cnae = chunk.cnaePrincipal.fillna('')
            mask = chunk.uf.isin(ufs) & chunk.situacao.eq('02') & cnae.str.startswith(CNAES_EDUCACAO_BASICA)
            selecionados = chunk.loc[mask].copy()
            if not selecionados.empty:
                partes.append(selecionados)
    if not partes:
        return pd.DataFrame(columns=COL_ESTAB)
    return pd.concat(partes, ignore_index=True)


def carregar_razoes(pasta: Path, bases: set[str]) -> dict[str, str]:
    razoes = {}
    for caminho in arquivos(pasta, "EMPRE"):
        print(f"Lendo empresas: {caminho.name}")
        for chunk in pd.read_csv(caminho, sep=";", encoding="latin1", header=None, names=COL_EMPRESA, dtype=str, chunksize=250_000, low_memory=False):
            trecho = chunk[chunk.cnpjBasico.isin(bases)]
            razoes.update(zip(trecho.cnpjBasico, trecho.razaoSocial.fillna('')))
    return razoes


def pontuar(escola: dict, candidato: dict) -> tuple[float, list[str]]:
    nome_escola = normalizar(escola.get("nome"))
    nomes = [normalizar(candidato.get("nomeFantasia")), normalizar(candidato.get("razaoSocial"))]
    similaridade = max([SequenceMatcher(None, nome_escola, n).ratio() for n in nomes if n] or [0])
    score = similaridade * 70
    evidencias = [f"similaridade de nome {similaridade:.0%}"]
    cep_a = re.sub(r"\D", "", str(escola.get("cep") or ""))
    cep_b = re.sub(r"\D", "", str(candidato.get("cep") or ""))
    if cep_a and cep_a == cep_b:
        score += 20
        evidencias.append("CEP idêntico")
    bairro_a = normalizar(escola.get("bairro"))
    bairro_b = normalizar(candidato.get("bairro"))
    if bairro_a and bairro_a == bairro_b:
        score += 10
        evidencias.append("bairro idêntico")
    return min(100, score), evidencias


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pasta-receita", type=Path, required=True)
    parser.add_argument("--pasta-escolas", type=Path, default=Path("data/escolas"))
    parser.add_argument("--saida", type=Path, default=Path("data/cnpj_candidatos"))
    args = parser.parse_args()

    escolas = carregar_escolas(args.pasta_escolas)
    ufs = {e.get("uf") for e in escolas if e.get("uf")}
    municipios = ler_municipios(args.pasta_receita)
    estabelecimentos = filtrar_estabelecimentos(args.pasta_receita, ufs)
    razoes = carregar_razoes(args.pasta_receita, set(estabelecimentos.cnpjBasico.dropna()))
    estabelecimentos["razaoSocial"] = estabelecimentos.cnpjBasico.map(razoes).fillna('')
    estabelecimentos["municipioNome"] = estabelecimentos.municipioReceita.str.zfill(4).map(municipios).fillna('')

    saida_por_uf = defaultdict(dict)
    for escola in escolas:
        municipio = normalizar(escola.get("municipio"))
        candidatos = estabelecimentos[(estabelecimentos.uf == escola.get("uf")) & (estabelecimentos.municipioNome == municipio)]
        encontrados = []
        for row in candidatos.to_dict("records"):
            score, evidencias = pontuar(escola, row)
            if score < 55:
                continue
            cnpj = f"{row['cnpjBasico']}{row['ordem']}{row['dv']}"
            encontrados.append({
                "cnpj": cnpj,
                "nomeFantasia": row.get("nomeFantasia") or "",
                "razaoSocial": row.get("razaoSocial") or "",
                "cnae": row.get("cnaePrincipal") or "",
                "cep": row.get("cep") or "",
                "bairro": row.get("bairro") or "",
                "logradouro": " ".join(str(row.get(k) or "") for k in ["tipoLogradouro", "logradouro", "numero"]).strip(),
                "score": round(score),
                "evidencias": evidencias,
                "status": "candidato_revisao",
            })
        encontrados.sort(key=lambda x: x["score"], reverse=True)
        if encontrados:
            saida_por_uf[escola["uf"]][str(escola["id"])] = encontrados[:3]

    args.saida.mkdir(parents=True, exist_ok=True)
    for uf in ufs:
        documento = {
            "versao": "Receita Federal - snapshot informado pelo operador",
            "uf": uf,
            "regra": "candidatos; requer confirmacao humana",
            "escolas": saida_por_uf.get(uf, {}),
        }
        (args.saida / f"{uf}.json").write_text(json.dumps(documento, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(uf, len(documento["escolas"]), "escolas com candidatos")


if __name__ == "__main__":
    main()
