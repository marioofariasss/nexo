#!/usr/bin/env python3
"""Gera a camada longitudinal do Nexo a partir dos microdados oficiais do Inep.

Os ZIPs brutos ficam fora da aplicação. O site recebe apenas agregados compactos
e séries por escola, particionadas por UF. O pipeline aceita as edições
simplificadas de 2019 a 2024 e a edição de 2025 sem depender da ordem das colunas.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path


ANOS_PADRAO = range(2019, 2026)
ETAPAS = {
    "infantil": "QT_MAT_INF",
    "creche": "QT_MAT_INF_CRE",
    "preEscola": "QT_MAT_INF_PRE",
    "fundamentalI": "QT_MAT_FUND_AI",
    "fundamentalII": "QT_MAT_FUND_AF",
    "medio": "QT_MAT_MED",
}


def numero(valor):
    if valor in (None, "", " "):
        return 0
    try:
        return int(float(str(valor).replace(",", ".")))
    except (TypeError, ValueError):
        return 0


def percentual(novo, antigo):
    if antigo in (None, 0) or novo is None:
        return None
    return round((novo - antigo) / antigo * 100, 1)


def cagr(novo, antigo, periodos):
    if not antigo or novo is None or periodos <= 0:
        return None
    return round(((novo / antigo) ** (1 / periodos) - 1) * 100, 1)


def chave_municipio(uf, codigo, nome):
    return f"{uf}|{codigo or normalizar(nome)}"


def normalizar(texto):
    base = unicodedata.normalize("NFKD", str(texto or ""))
    return " ".join("".join(c for c in base if not unicodedata.combining(c)).upper().split())


def localizar_csv(zf, ano):
    candidatos = [
        n for n in zf.namelist()
        if re.search(r"dados/.+\.csv$", n, re.I) and "suplemento" not in n.lower()
    ]
    preferidos = [n for n in candidatos if str(ano) in n]
    lista = preferidos or candidatos
    if not lista:
        raise RuntimeError(f"CSV principal não encontrado no ZIP de {ano}")
    return max(lista, key=lambda n: zf.getinfo(n).file_size)


def localizar_tabela(zf, nome):
    candidatos = [n for n in zf.namelist() if re.search(rf"dados/Tabela_{nome}_.+\.csv$", n, re.I)]
    if not candidatos:
        raise RuntimeError(f"Tabela {nome} não encontrada")
    return candidatos[0]


def abrir_leitor(zf, membro):
    bruto = zf.open(membro)
    cabecalho = bruto.read(4)
    bruto.close()
    encoding = "utf-8-sig" if cabecalho.startswith(b"\xef\xbb\xbf") else "latin-1"
    texto = io.TextIOWrapper(zf.open(membro), encoding=encoding, newline="")
    return texto, csv.DictReader(texto, delimiter=";")


def registro_vazio(ano, uf, municipio, codigo):
    return {
        "ano": ano,
        "uf": uf,
        "municipio": municipio,
        "codigoMunicipio": codigo,
        "escolasTotal": 0,
        "escolasPrivadas": 0,
        "matriculasTotal": 0,
        "matriculasPrivadas": 0,
        "turmasPrivadas": 0,
        "docentesPrivados": 0,
        "etapasPrivadas": {k: 0 for k in ETAPAS},
        "sharesPrivadas": [],
    }


def processar_ano(caminho, ano, nacional, por_uf, municipios, escolas):
    with zipfile.ZipFile(caminho) as zf:
        membro = localizar_csv(zf, ano)
        texto, leitor = abrir_leitor(zf, membro)
        for linha in leitor:
            if numero(linha.get("TP_SITUACAO_FUNCIONAMENTO")) != 1:
                continue
            uf = (linha.get("SG_UF") or "").strip()
            municipio = (linha.get("NO_MUNICIPIO") or "").strip()
            codigo = str(linha.get("CO_MUNICIPIO") or "").split(".")[0]
            if not uf or not municipio:
                continue
            privada = numero(linha.get("TP_DEPENDENCIA")) == 4
            mat = numero(linha.get("QT_MAT_BAS"))
            turmas = numero(linha.get("QT_TUR_BAS"))
            docentes = numero(linha.get("QT_DOC_BAS"))

            for alvo in (nacional[ano], por_uf[(ano, uf)]):
                alvo["escolasTotal"] += 1
                alvo["matriculasTotal"] += mat

            chave = (ano, chave_municipio(uf, codigo, municipio))
            if chave not in municipios:
                municipios[chave] = registro_vazio(ano, uf, municipio, codigo)
            mun = municipios[chave]
            mun["escolasTotal"] += 1
            mun["matriculasTotal"] += mat

            if not privada:
                continue

            etapa = {nome: numero(linha.get(campo)) for nome, campo in ETAPAS.items()}
            for alvo in (nacional[ano], por_uf[(ano, uf)], mun):
                alvo["escolasPrivadas"] += 1
                alvo["matriculasPrivadas"] += mat
                alvo["turmasPrivadas"] += turmas
                alvo["docentesPrivados"] += docentes
                for nome, valor in etapa.items():
                    alvo["etapasPrivadas"][nome] += valor
            mun["sharesPrivadas"].append(mat)

            escola_id = str(linha.get("CO_ENTIDADE") or "").split(".")[0]
            if escola_id:
                escolas[(uf, escola_id)].append([
                    ano, mat, etapa["infantil"],
                    etapa["fundamentalI"] + etapa["fundamentalII"], etapa["medio"],
                    turmas, docentes,
                ])
        texto.close()
    print(f"{ano}: processado {caminho.name}")


def processar_2025(caminho, ano, nacional, por_uf, municipios, escolas):
    """A edição 2025 separou escola, matrícula, turma e docente em tabelas."""
    with zipfile.ZipFile(caminho) as zf:
        ativos = {}
        texto, leitor = abrir_leitor(zf, localizar_tabela(zf, "Escola"))
        for linha in leitor:
            if numero(linha.get("TP_SITUACAO_FUNCIONAMENTO")) != 1:
                continue
            escola_id = str(linha.get("CO_ENTIDADE") or "").split(".")[0]
            uf = (linha.get("SG_UF") or "").strip()
            municipio = (linha.get("NO_MUNICIPIO") or "").strip()
            codigo = str(linha.get("CO_MUNICIPIO") or "").split(".")[0]
            if not escola_id or not uf or not municipio:
                continue
            privada = numero(linha.get("TP_DEPENDENCIA")) == 4
            ativos[escola_id] = (uf, municipio, codigo, privada)
            for alvo in (nacional[ano], por_uf[(ano, uf)]):
                alvo["escolasTotal"] += 1
            chave = (ano, chave_municipio(uf, codigo, municipio))
            if chave not in municipios:
                municipios[chave] = registro_vazio(ano, uf, municipio, codigo)
            municipios[chave]["escolasTotal"] += 1
            if privada:
                nacional[ano]["escolasPrivadas"] += 1
                por_uf[(ano, uf)]["escolasPrivadas"] += 1
                municipios[chave]["escolasPrivadas"] += 1
        texto.close()

        linhas_serie = {}
        texto, leitor = abrir_leitor(zf, localizar_tabela(zf, "Matricula"))
        for linha in leitor:
            escola_id = str(linha.get("CO_ENTIDADE") or "").split(".")[0]
            meta = ativos.get(escola_id)
            if not meta:
                continue
            uf, municipio, codigo, privada = meta
            mat = numero(linha.get("QT_MAT_BAS"))
            nacional[ano]["matriculasTotal"] += mat
            por_uf[(ano, uf)]["matriculasTotal"] += mat
            chave = (ano, chave_municipio(uf, codigo, municipio))
            municipios[chave]["matriculasTotal"] += mat
            if not privada:
                continue
            etapa = {nome: numero(linha.get(campo)) for nome, campo in ETAPAS.items()}
            for alvo in (nacional[ano], por_uf[(ano, uf)], municipios[chave]):
                alvo["matriculasPrivadas"] += mat
                for nome, valor in etapa.items():
                    alvo["etapasPrivadas"][nome] += valor
            municipios[chave]["sharesPrivadas"].append(mat)
            registro = [ano, mat, etapa["infantil"], etapa["fundamentalI"] + etapa["fundamentalII"], etapa["medio"], 0, 0]
            escolas[(uf, escola_id)].append(registro)
            linhas_serie[escola_id] = registro
        texto.close()

        for tabela, campo, indice, agregado in (("Turma", "QT_TUR_BAS", 5, "turmasPrivadas"), ("Docente", "QT_DOC_BAS", 6, "docentesPrivados")):
            texto, leitor = abrir_leitor(zf, localizar_tabela(zf, tabela))
            for linha in leitor:
                escola_id = str(linha.get("CO_ENTIDADE") or "").split(".")[0]
                meta = ativos.get(escola_id)
                if not meta or not meta[3]:
                    continue
                uf, municipio, codigo, _ = meta
                valor = numero(linha.get(campo))
                chave = (ano, chave_municipio(uf, codigo, municipio))
                for alvo in (nacional[ano], por_uf[(ano, uf)], municipios[chave]):
                    alvo[agregado] += valor
                if escola_id in linhas_serie:
                    linhas_serie[escola_id][indice] = valor
            texto.close()
    print(f"{ano}: processadas tabelas separadas de escola, matrícula, turma e docente")


def finalizar(registro):
    total = registro["matriculasTotal"]
    privadas = registro["matriculasPrivadas"]
    mats = registro.pop("sharesPrivadas", None)
    registro["participacaoPrivadaPct"] = round(privadas / total * 100, 1) if total else None
    registro["alunosPorEscolaPrivada"] = round(privadas / registro["escolasPrivadas"], 1) if registro["escolasPrivadas"] else None
    registro["alunosPorTurmaPrivada"] = round(privadas / registro["turmasPrivadas"], 1) if registro["turmasPrivadas"] else None
    registro["alunosPorDocentePrivado"] = round(privadas / registro["docentesPrivados"], 1) if registro["docentesPrivados"] else None
    if mats is not None:
        soma = sum(mats)
        shares = sorted((m / soma for m in mats if soma), reverse=True)
        registro["concentracaoTop3Pct"] = round(sum(shares[:3]) * 100, 1) if shares else None
        registro["hhiMatriculas"] = round(sum(s * s for s in shares) * 10000) if shares else None
    return registro


def diagnostico_municipal(series):
    series = sorted(series, key=lambda r: r["ano"])
    atual = series[-1]
    base = next((r for r in series if r["ano"] >= atual["ano"] - 5), series[0])
    periodos = atual["ano"] - base["ano"]
    cresc_mat = cagr(atual["matriculasPrivadas"], base["matriculasPrivadas"], periodos)
    cresc_esc = cagr(atual["escolasPrivadas"], base["escolasPrivadas"], periodos)
    pressao = round(cresc_esc - cresc_mat, 1) if cresc_mat is not None and cresc_esc is not None else None
    risco = "Dados insuficientes"
    if pressao is not None:
        if atual["matriculasPrivadas"] < 500 or atual["escolasPrivadas"] < 3:
            risco = "Amostra pequena"
        elif cresc_mat < -2 and pressao >= 2:
            risco = "Alto"
        elif pressao >= 3:
            risco = "Alto"
        elif pressao >= 0.8 or cresc_mat < 0:
            risco = "Moderado"
        else:
            risco = "Baixo"
    return {
        "uf": atual["uf"], "municipio": atual["municipio"],
        "codigoMunicipio": atual["codigoMunicipio"],
        "anoInicial": base["ano"], "anoFinal": atual["ano"],
        "escolasPrivadas": atual["escolasPrivadas"],
        "matriculasPrivadas": atual["matriculasPrivadas"],
        "participacaoPrivadaPct": atual["participacaoPrivadaPct"],
        "crescimentoMatriculasCagrPct": cresc_mat,
        "crescimentoEscolasCagrPct": cresc_esc,
        "pressaoOfertaPp": pressao,
        "concentracaoTop3Pct": atual.get("concentracaoTop3Pct"),
        "hhiMatriculas": atual.get("hhiMatriculas"),
        "riscoSaturacao": risco,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--entrada", type=Path, default=Path(".cache/inep"))
    parser.add_argument("--saida", type=Path, default=Path("data/inteligencia"))
    parser.add_argument("--anos", nargs="+", type=int, default=list(ANOS_PADRAO))
    args = parser.parse_args()

    nacional = defaultdict(lambda: registro_vazio(0, "BR", "Brasil", "BR"))
    por_uf = defaultdict(lambda: registro_vazio(0, "", "", ""))
    municipios = {}
    escolas = defaultdict(list)

    for ano in args.anos:
        caminho = args.entrada / f"microdados_censo_escolar_{ano}.zip"
        if not caminho.exists():
            raise SystemExit(f"Arquivo ausente: {caminho}")
        nacional[ano].update({"ano": ano})
        # A UF é preenchida na primeira linha encontrada.
        if ano >= 2025:
            processar_2025(caminho, ano, nacional, por_uf, municipios, escolas)
        else:
            processar_ano(caminho, ano, nacional, por_uf, municipios, escolas)

    for (ano, uf), registro in por_uf.items():
        registro.update({"ano": ano, "uf": uf, "municipio": None, "codigoMunicipio": None})

    nacional_final = [finalizar(nacional[a]) for a in sorted(nacional)]
    uf_final = [finalizar(r) for _, r in sorted(por_uf.items())]
    municipios_final = [finalizar(r) for _, r in sorted(municipios.items())]
    por_municipio = defaultdict(list)
    for r in municipios_final:
        por_municipio[chave_municipio(r["uf"], r["codigoMunicipio"], r["municipio"])].append(r)
    diagnosticos = [diagnostico_municipal(s) for s in por_municipio.values()]

    args.saida.mkdir(parents=True, exist_ok=True)
    (args.saida / "escolas").mkdir(exist_ok=True)
    metadados = {
        "versao": "2026-08-13",
        "anos": sorted(args.anos),
        "fonte": "Inep, Microdados do Censo Escolar da Educação Básica",
        "metodologia": "Escolas em funcionamento; rede privada = TP_DEPENDENCIA 4. Risco de saturação compara o CAGR da oferta de escolas com o CAGR de matrículas privadas; é sinal estatístico, não capacidade física observada.",
        "schemaSerieEscola": ["ano", "matriculas", "infantil", "fundamental", "medio", "turmas", "docentes"],
    }
    resumo = {
        "metadados": metadados,
        "nacional": nacional_final,
        "ufs": uf_final,
        "diagnosticosMunicipais": sorted(diagnosticos, key=lambda r: (r["uf"], r["municipio"])),
    }
    (args.saida / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    municipios_por_uf = defaultdict(list)
    for r in municipios_final:
        municipios_por_uf[r["uf"]].append(r)
    escolas_por_uf = defaultdict(dict)
    for (uf, escola_id), serie in escolas.items():
        escolas_por_uf[uf][escola_id] = sorted(serie)
    for uf in sorted(set(municipios_por_uf) | set(escolas_por_uf)):
        documento = {
            "metadados": metadados,
            "municipios": municipios_por_uf[uf],
            "escolas": escolas_por_uf[uf],
        }
        (args.saida / "escolas" / f"{uf}.json").write_text(
            json.dumps(documento, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    print(f"Gerados {len(nacional_final)} anos, {len(uf_final)} linhas UF/ano, {len(diagnosticos)} municípios e {len(escolas)} séries de escolas")


if __name__ == "__main__":
    main()
