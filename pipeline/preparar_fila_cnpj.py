#!/usr/bin/env python3
"""Reduz a exportação do navegador à fila mínima necessária ao CNPJ."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


CAMPOS = ("id", "nome", "uf", "municipio", "bairro", "endereco", "cep", "tel", "email", "fonte")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entrada", type=Path, help="Exportação JSON da Central de Enriquecimento")
    parser.add_argument("saida", type=Path, help="Fila compacta que pode ser versionada")
    args = parser.parse_args()

    documento = json.loads(args.entrada.read_text(encoding="utf-8"))
    registros = documento if isinstance(documento, list) else documento.get("escolas", [])
    escolas = []
    for registro in registros:
        qualidade = registro.get("qualidadeIdentidade") or {}
        if registro.get("fonte") != "osm" or registro.get("cnpj") or qualidade.get("incluirAnalise", True) is False:
            continue
        escola = {campo: registro.get(campo) for campo in CAMPOS}
        escola["qualidadeIdentidade"] = {"incluirAnalise": True}
        escolas.append(escola)

    saida = {
        "tipo": "nexo_fila_cnpj_compacta",
        "versao": 1,
        "origemExportadaEm": documento.get("exportadoEm") if isinstance(documento, dict) else None,
        "total": len(escolas),
        "escolas": escolas,
    }
    args.saida.parent.mkdir(parents=True, exist_ok=True)
    args.saida.write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Fila compacta: {len(escolas)} escolas em {args.saida}")


if __name__ == "__main__":
    main()
