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
UFS_BRASIL = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
}


def valor(campo) -> str:
    return "" if campo is None or pd.isna(campo) else str(campo)


def normalizar(texto: str) -> str:
    texto = valor(texto)
    texto = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")
    texto = re.sub(r"\b(COLEGIO|ESCOLA|CENTRO|EDUCACIONAL|EDUCACAO|ENSINO|LTDA|EIRELI|SA)\b", " ", texto.upper())
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", texto).split())


def normalizar_uf(uf: str) -> str:
    texto = valor(uf).strip().upper()
    if texto in UFS_BRASIL:
        return texto
    final = re.search(r"(?:^|[ ,/-])([A-Z]{2})$", texto)
    return final.group(1) if final and final.group(1) in UFS_BRASIL else texto


def arquivos(pasta: Path, termo: str) -> list[Path]:
    return sorted(p for p in pasta.rglob("*") if p.is_file() and termo.lower() in p.name.lower())


def ler_municipios(pasta: Path) -> dict[str, str]:
    encontrados = arquivos(pasta, "MUNIC")
    if not encontrados:
        return {}
    df = pd.read_csv(encontrados[0], sep=";", encoding="latin1", header=None, names=COL_MUNICIPIO, dtype=str)
    return dict(zip(df.codigo.str.zfill(4), df.nome.fillna('').map(normalizar)))


def carregar_escolas(pasta_escolas: Path, arquivo_escolas: Path | None = None) -> list[dict]:
    resultado = []
    if arquivo_escolas:
        documento = json.loads(arquivo_escolas.read_text(encoding="utf-8"))
        registros = documento if isinstance(documento, list) else documento.get("escolas", [])
        for escola in registros:
            qualidade = escola.get("qualidadeIdentidade") or {}
            if escola.get("fonte") == "osm" and qualidade.get("incluirAnalise", True):
                escola = {**escola, "uf": normalizar_uf(escola.get("uf"))}
                resultado.append(escola)
        return resultado
    for caminho in pasta_escolas.glob("*.json"):
        for escola in json.loads(caminho.read_text(encoding="utf-8")):
            qualidade = escola.get("qualidadeIdentidade") or {}
            if escola.get("fonte") == "osm" and qualidade.get("incluirAnalise", True):
                escola = {**escola, "uf": normalizar_uf(escola.get("uf"))}
                resultado.append(escola)
    return resultado


def filtrar_estabelecimentos(pasta: Path, ufs: set[str]) -> pd.DataFrame:
    partes = []
    for caminho in arquivos(pasta, "ESTABELE"):
        print(f"Lendo estabelecimentos: {caminho.name}")
        for chunk in pd.read_csv(caminho, sep=";", encoding="latin1", header=None, names=COL_ESTAB, dtype=str, chunksize=250_000, low_memory=False):
            cnae = chunk.cnaePrincipal.fillna('')
            cnaes_secundarios = chunk.cnaesSecundarios.fillna('')
            tem_cnae_educacional = cnae.str.startswith(CNAES_EDUCACAO_BASICA) | cnaes_secundarios.str.contains(
                r"(?:^|,)(?:8511|8512|8513|8520)", regex=True
            )
            mask = chunk.uf.isin(ufs) & chunk.situacao.eq('02') & tem_cnae_educacional
            selecionados = chunk.loc[mask].copy()
            if not selecionados.empty:
                partes.append(selecionados)
    if not partes:
        return pd.DataFrame(columns=COL_ESTAB)
    return pd.concat(partes, ignore_index=True)


def carregar_empresas(pasta: Path, bases: set[str]) -> dict[str, dict]:
    empresas = {}
    for caminho in arquivos(pasta, "EMPRE"):
        print(f"Lendo empresas: {caminho.name}")
        for chunk in pd.read_csv(caminho, sep=";", encoding="latin1", header=None, names=COL_EMPRESA, dtype=str, chunksize=250_000, low_memory=False):
            trecho = chunk[chunk.cnpjBasico.isin(bases)]
            for row in trecho.to_dict("records"):
                empresas[row["cnpjBasico"]] = {
                    "razaoSocial": valor(row.get("razaoSocial")),
                    "capitalSocial": valor(row.get("capital")),
                    "porteJuridico": valor(row.get("porte")),
                    "naturezaJuridica": valor(row.get("natureza")),
                }
    return empresas


def pontuar(escola: dict, candidato: dict) -> tuple[float, list[str]]:
    nome_escola = normalizar(escola.get("nome"))
    nomes = [normalizar(candidato.get("nomeFantasia")), normalizar(candidato.get("razaoSocial"))]
    similaridade = max([SequenceMatcher(None, nome_escola, n).ratio() for n in nomes if n] or [0])
    score = similaridade * 55
    evidencias = [f"similaridade de nome {similaridade:.0%}"]
    municipio_a = normalizar(escola.get("municipio"))
    municipio_b = normalizar(candidato.get("municipioNome"))
    if municipio_a and municipio_a == municipio_b:
        score += 10
        evidencias.append("município idêntico")
    cep_a = re.sub(r"\D", "", str(escola.get("cep") or ""))
    cep_b = re.sub(r"\D", "", str(candidato.get("cep") or ""))
    if cep_a and cep_a == cep_b:
        score += 20
        evidencias.append("CEP idêntico")
    bairro_a = normalizar(escola.get("bairro"))
    bairro_b = normalizar(candidato.get("bairro"))
    if bairro_a and bairro_a == bairro_b:
        score += 8
        evidencias.append("bairro idêntico")
    endereco_a = normalizar(escola.get("endereco"))
    endereco_b = normalizar(" ".join(valor(candidato.get(k)) for k in ["tipoLogradouro", "logradouro", "numero"]))
    sim_endereco = SequenceMatcher(None, endereco_a, endereco_b).ratio() if endereco_a and endereco_b else 0
    if sim_endereco >= 0.75:
        score += 12
        evidencias.append(f"endereço semelhante {sim_endereco:.0%}")
    telefone_a = re.sub(r"\D", "", str(escola.get("tel") or ""))[-8:]
    telefones_b = [re.sub(r"\D", "", valor(candidato.get(campo)))[-8:] for campo in ["telefone1", "telefone2"]]
    if len(telefone_a) == 8 and telefone_a in telefones_b:
        score += 25
        evidencias.append("telefone idêntico")
    email_a = str(escola.get("email") or "").strip().lower()
    email_b = valor(candidato.get("email")).strip().lower()
    if email_a and email_a == email_b:
        score += 25
        evidencias.append("e-mail idêntico")
    return min(100, score), evidencias


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pasta-receita", type=Path, required=True)
    parser.add_argument("--pasta-escolas", type=Path, default=Path("data/escolas"))
    parser.add_argument("--arquivo-escolas", type=Path, help="JSON exportado pela Central de Enriquecimento do Nexo")
    parser.add_argument("--saida", type=Path, default=Path("data/cnpj_candidatos"))
    parser.add_argument("--snapshot", default="informado pelo operador", help="Identificação AAAA-MM da fonte")
    args = parser.parse_args()

    escolas = carregar_escolas(args.pasta_escolas, args.arquivo_escolas)
    ufs = {e.get("uf") for e in escolas if e.get("uf")}
    municipios = ler_municipios(args.pasta_receita)
    estabelecimentos = filtrar_estabelecimentos(args.pasta_receita, ufs)
    empresas = carregar_empresas(args.pasta_receita, set(estabelecimentos.cnpjBasico.dropna()))
    estabelecimentos["razaoSocial"] = estabelecimentos.cnpjBasico.map(lambda c: empresas.get(c, {}).get("razaoSocial", ""))
    estabelecimentos["municipioNome"] = estabelecimentos.municipioReceita.str.zfill(4).map(municipios).fillna('')

    saida_por_uf = defaultdict(dict)
    for escola in escolas:
        municipio = normalizar(escola.get("municipio"))
        candidatos_uf = estabelecimentos[estabelecimentos.uf == escola.get("uf")]
        candidatos = candidatos_uf[candidatos_uf.municipioNome == municipio] if municipio else candidatos_uf.iloc[0:0]
        # Registros OSM nem sempre têm addr:city. CEP e telefone permitem
        # recuperar um conjunto pequeno de candidatos sem comparar a escola
        # contra todas as PJs educacionais do estado.
        if candidatos.empty:
            cep_escola = re.sub(r"\D", "", str(escola.get("cep") or ""))
            tel_escola = re.sub(r"\D", "", str(escola.get("tel") or ""))[-8:]
            if len(cep_escola) == 8:
                candidatos = candidatos_uf[candidatos_uf.cep.fillna('').eq(cep_escola)]
            elif len(tel_escola) == 8:
                tel1 = candidatos_uf.telefone1.fillna('').str.replace(r"\D", "", regex=True).str[-8:]
                tel2 = candidatos_uf.telefone2.fillna('').str.replace(r"\D", "", regex=True).str[-8:]
                candidatos = candidatos_uf[tel1.eq(tel_escola) | tel2.eq(tel_escola)]
        encontrados = []
        for row in candidatos.to_dict("records"):
            score, evidencias = pontuar(escola, row)
            if score < 55:
                continue
            cnpj = f"{row['cnpjBasico']}{row['ordem']}{row['dv']}"
            encontrados.append({
                "cnpj": cnpj,
                "nomeFantasia": valor(row.get("nomeFantasia")),
                "razaoSocial": valor(row.get("razaoSocial")),
                "cnae": valor(row.get("cnaePrincipal")),
                "cnaesSecundarios": valor(row.get("cnaesSecundarios")),
                "cep": valor(row.get("cep")),
                "bairro": valor(row.get("bairro")),
                "logradouro": " ".join(
                    valor(row.get(k)) for k in ["tipoLogradouro", "logradouro", "numero"]
                ).strip(),
                "telefone": " / ".join(filter(None, [
                    f"({valor(row.get('ddd1'))}) {valor(row.get('telefone1'))}" if valor(row.get('telefone1')) else "",
                    f"({valor(row.get('ddd2'))}) {valor(row.get('telefone2'))}" if valor(row.get('telefone2')) else "",
                ])),
                "email": valor(row.get("email")),
                "dataInicioAtividade": valor(row.get("inicioAtividade")),
                "capitalSocial": empresas.get(row["cnpjBasico"], {}).get("capitalSocial", ""),
                "porteJuridico": empresas.get(row["cnpjBasico"], {}).get("porteJuridico", ""),
                "naturezaJuridica": empresas.get(row["cnpjBasico"], {}).get("naturezaJuridica", ""),
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
            "versao": f"Receita Federal - snapshot {args.snapshot}",
            "uf": uf,
            "regra": "candidatos; requer confirmacao humana",
            "escolas": saida_por_uf.get(uf, {}),
        }
        (args.saida / f"{uf}.json").write_text(json.dumps(documento, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(uf, len(documento["escolas"]), "escolas com candidatos")


if __name__ == "__main__":
    main()
