#!/usr/bin/env python3
"""Classifica registros descobertos sem apagar nenhuma escola.

Adiciona ``qualidadeIdentidade`` aos registros OSM. Casos claramente fora do
mercado privado ficam disponíveis para revisão na Central de Enriquecimento,
mas deixam de contaminar análises regionais.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


PUBLICA = [
    r"\bE\s*\.?\s*E\s*\.?\s*[EFM]\b", r"\bE\s*\.?\s*M\s*\.?\s*E?\s*\.?\s*I?\s*\.?\s*F\b",
    r"\bEEEP\b", r"\bEEFM\b", r"\bEMEIF\b", r"\bEMEIEF\b", r"\bEMEF\b", r"\bCEJA\b",
    r"\bESCOLA (?:DE TEMPO |EM TEMPO )?(?:PARCIAL|INTEGRAL)\b",
    r"\bESCOLA (?:MUNICIPAL|ESTADUAL)\b", r"\bCRECHE MUNICIPAL\b",
    r"\bCOLEGIO DA POLICIA MILITAR\b", r"\bINSTITUTO FEDERAL\b",
    r"\bEEMTI\b", r"\bEMTI\b", r"\bE\s*T\s*I\b", r"^EM\b", r"^E M\b",
    r"^CEI\b", r"^CENTRO DE EDUCACAO INFANTIL\b",
    r"^CENTRO DE EDUCACAO DE JOVENS E ADULTOS\b",
    r"^ESCOLA DE ENSINO (?:FUNDAMENTAL|MEDIO)", r"^ESCOLA ENSINO MEDIO\b",
    r"^ESCOLA DE TIPO INTEGRAL\b", r"^ESCOLA ARENINHA\b",
    r"^CENTROS DE ATENCAO INTEGRAL A CRIANCA E AO ADOLESCENTE\b",
    r"^COLEGIO MILITAR DE FORTALEZA\b",
    r"^LICEU (?:DE MESSEJANA|PROFESSOR DOMINGOS BRASILEIRO)\b",
    r"^INSTITUTO DE EDUCACAO DO CEARA\b",
]
FORA_REGULAR = [
    r"\bUNIVERSIDADE\b", r"\bFACULDADE\b", r"\bCURSO DE IDIOMAS\b", r"\bAUTOESCOLA\b",
    r"\bACADEMIA\b", r"\bCENTRO DE FORMACAO\b", r"\bESCOLA DE MUSICA\b", r"\bSEMINARIO\b",
    r"^CENTRO DE LINGUAS ESTRANGEIRAS\b", r"^CENTRO SOCIAL URBANO\b",
    r"^ESCOLA DE (?:GASTRONOMIA SOCIAL|SAUDE PUBLICA|TRABALHO)\b",
    r"^EDIFICIO\b", r"^EDUCACAO FUNDAMENTAL II$", r"^MENDES SURF HOUSE$",
    r"^QI EDUCACAO PROFISSIONAL$", r"^WIZARD$",
]


def normalizar(texto: str) -> str:
    base = unicodedata.normalize("NFD", texto or "")
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", "".join(c for c in base if unicodedata.category(c) != "Mn").upper()).split())


def classificar(escola: dict) -> dict:
    nome = normalizar(escola.get("nome", ""))
    evidencias = []
    # IDs INEP têm poucos dígitos. Um código INEP que não entrou na base de
    # privadas do Nexo é forte indício de rede pública, escola inativa ou
    # etapa fora do recorte; não afirmamos automaticamente qual das três.
    if isinstance(escola.get("id"), int) and escola["id"] < 900_000_000_000:
        evidencias.append("codigo INEP ausente da base privada ativa do Nexo")
        return {"status": "fora_escopo_inep", "incluirAnalise": False, "confianca": "alta", "evidencias": evidencias}
    if any(re.search(p, nome) for p in PUBLICA):
        evidencias.append("padrao de nome tipico de rede publica")
        return {"status": "fora_escopo_publica", "incluirAnalise": False, "confianca": "alta", "evidencias": evidencias}
    if any(re.search(p, nome) for p in FORA_REGULAR):
        evidencias.append("atividade aparentemente fora da educacao basica regular")
        return {"status": "fora_escopo_nao_regular", "incluirAnalise": False, "confianca": "media", "evidencias": evidencias}
    sinais = [termo for termo in ["COLEGIO", "ESCOLA", "CENTRO EDUCACIONAL", "BERCARIO", "CRECHE"] if termo in nome]
    if sinais:
        evidencias.append("nome compativel com educacao basica")
    return {
        "status": "candidata_privada_revisao",
        "incluirAnalise": True,
        "confianca": "baixa",
        "evidencias": evidencias or ["sem sinal suficiente para decisao automatica"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pasta", type=Path, default=Path("data/escolas"))
    parser.add_argument("--relatorio", type=Path, default=Path("data/auditoria_escolas_descobertas.json"))
    args = parser.parse_args()
    contagem = Counter()
    amostras = {}
    alterados = 0
    for caminho in sorted(args.pasta.glob("*.json")):
        escolas = json.loads(caminho.read_text(encoding="utf-8"))
        mudou = False
        for escola in escolas:
            if escola.get("fonte") != "osm":
                continue
            qualidade = classificar(escola)
            escola["qualidadeIdentidade"] = qualidade
            contagem[qualidade["status"]] += 1
            amostras.setdefault(qualidade["status"], []).append({"id": escola.get("id"), "nome": escola.get("nome")})
            alterados += 1
            mudou = True
        if mudou:
            caminho.write_text(json.dumps(escolas, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    relatorio = {
        "totalAuditado": alterados,
        "contagem": dict(contagem),
        "amostras": {k: v[:20] for k, v in amostras.items()},
        "regra": "triagem conservadora; nenhum registro foi apagado",
    }
    args.relatorio.write_text(json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(relatorio["contagem"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
