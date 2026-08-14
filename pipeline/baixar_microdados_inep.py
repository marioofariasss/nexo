#!/usr/bin/env python3
"""Baixa os ZIPs oficiais do Censo Escolar usados pela camada longitudinal."""

from __future__ import annotations

import argparse
import shutil
import urllib.request
from pathlib import Path


BASE = "https://download.inep.gov.br/dados_abertos"


def url_ano(ano):
    sufixo = "_" if ano == 2025 else ""
    return f"{BASE}/microdados_censo_escolar_{ano}{sufixo}.zip"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--anos", nargs="+", type=int, default=list(range(2019, 2026)))
    parser.add_argument("--destino", type=Path, default=Path(".cache/inep"))
    parser.add_argument("--sobrescrever", action="store_true")
    args = parser.parse_args()
    args.destino.mkdir(parents=True, exist_ok=True)

    for ano in args.anos:
        destino = args.destino / f"microdados_censo_escolar_{ano}.zip"
        if destino.exists() and destino.stat().st_size and not args.sobrescrever:
            print(f"{ano}: já existe ({destino})")
            continue
        temporario = destino.with_suffix(".zip.part")
        print(f"{ano}: baixando {url_ano(ano)}")
        requisicao = urllib.request.Request(url_ano(ano), headers={"User-Agent": "NexoDados/1.0"})
        with urllib.request.urlopen(requisicao, timeout=120) as resposta, temporario.open("wb") as saida:
            shutil.copyfileobj(resposta, saida)
        temporario.replace(destino)
        print(f"{ano}: {destino.stat().st_size / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
