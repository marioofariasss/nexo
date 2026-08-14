#!/usr/bin/env python3
"""Valida os JSONs de candidatos antes de publicá-los."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def cnpj_valido(cnpj: str) -> bool:
    digitos = [int(x) for x in re.sub(r"\D", "", str(cnpj))]
    if len(digitos) != 14 or len(set(digitos)) == 1:
        return False
    for tamanho in (12, 13):
        pesos = list(range(tamanho - 7, 1, -1)) + list(range(9, 1, -1))
        resto = sum(a * b for a, b in zip(digitos[:tamanho], pesos)) % 11
        esperado = 0 if resto < 2 else 11 - resto
        if digitos[tamanho] != esperado:
            return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pasta", type=Path)
    args = parser.parse_args()

    arquivos = sorted(args.pasta.glob("*.json"))
    escolas = candidatos = alta = 0
    if not arquivos:
        raise RuntimeError("Nenhum arquivo de candidatos foi gerado.")
    for caminho in arquivos:
        documento = json.loads(
            caminho.read_text(encoding="utf-8"),
            parse_constant=lambda valor: (_ for _ in ()).throw(ValueError(f"Valor inválido: {valor}")),
        )
        if documento.get("uf") != caminho.stem or not isinstance(documento.get("escolas"), dict):
            raise ValueError(f"Estrutura territorial inválida em {caminho.name}")
        for id_escola, lista in documento["escolas"].items():
            if not id_escola or not 1 <= len(lista) <= 3:
                raise ValueError(f"Quantidade de candidatos inválida em {caminho.name}/{id_escola}")
            if any(lista[i]["score"] < lista[i + 1]["score"] for i in range(len(lista) - 1)):
                raise ValueError(f"Candidatos fora de ordem em {caminho.name}/{id_escola}")
            if any(not cnpj_valido(item.get("cnpj", "")) for item in lista):
                raise ValueError(f"CNPJ inválido em {caminho.name}/{id_escola}")
            escolas += 1
            candidatos += len(lista)
            alta += int(lista[0].get("score", 0) >= 95)
    print(f"Arquivos={len(arquivos)} escolas={escolas} candidatos={candidatos} alta_confianca={alta}")


if __name__ == "__main__":
    main()
