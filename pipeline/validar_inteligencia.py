#!/usr/bin/env python3
"""Valida invariantes da camada analítica antes da publicação."""

from __future__ import annotations

import json
from pathlib import Path


RAIZ = Path(__file__).resolve().parents[1]
UFS = {"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"}


def carregar(caminho):
    return json.loads(caminho.read_text(encoding="utf-8"))


def main():
    resumo = carregar(RAIZ / "data/inteligencia/resumo.json")
    anos = resumo["metadados"]["anos"]
    assert anos == list(range(2019, 2026)), f"anos inesperados: {anos}"
    assert [r["ano"] for r in resumo["nacional"]] == anos
    assert len(resumo["ufs"]) == len(UFS) * len(anos)
    assert {r["uf"] for r in resumo["ufs"]} == UFS
    assert len(resumo["diagnosticosMunicipais"]) >= 5500

    atual = resumo["nacional"][-1]
    escolas_atuais = []
    for caminho in (RAIZ / "data/escolas").glob("*.json"):
        escolas_atuais.extend(r for r in carregar(caminho) if r.get("fonte") != "osm")
    assert atual["escolasPrivadas"] == len(escolas_atuais)
    assert atual["matriculasPrivadas"] == sum(int(r.get("mat25") or 0) for r in escolas_atuais)

    total_series = 0
    for uf in sorted(UFS):
        documento = carregar(RAIZ / f"data/inteligencia/escolas/{uf}.json")
        assert documento["metadados"]["anos"] == anos
        for escola_id, serie in documento["escolas"].items():
            assert escola_id.isdigit()
            anos_serie = [linha[0] for linha in serie]
            assert anos_serie == sorted(set(anos_serie))
            assert all(all((isinstance(v, (int, float)) and v >= 0) for v in linha) for linha in serie)
            total_series += 1
    assert total_series >= 55000
    print(f"OK: {len(anos)} anos, {len(resumo['diagnosticosMunicipais'])} municípios e {total_series} séries escolares")


if __name__ == "__main__":
    main()
