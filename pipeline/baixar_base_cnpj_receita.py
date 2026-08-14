#!/usr/bin/env python3
"""Baixa do repositório oficial somente os arquivos necessários ao Nexo.

Descobre o snapshot mensal mais recente no compartilhamento público WebDAV da
Receita e baixa Empresas*, Estabelecimentos* e Municipios.zip. Os ZIPs são
lidos diretamente pelo pipeline seguinte; não é necessário extrair dezenas
de gigabytes em CSV.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "https://arquivos.receitafederal.gov.br/public.php/webdav/"
TOKEN_PUBLICO = "YggdBLfdninEJX9"
PADRAO_ARQUIVO = re.compile(r"^(?:Empresas\d+|Estabelecimentos\d+|Municipios)\.zip$", re.I)


def requisicao(url: str, token: str, method: str = "GET", depth: int | None = None, inicio: int | None = None):
    autenticacao = base64.b64encode(f"{token}:".encode()).decode()
    headers = {"Authorization": f"Basic {autenticacao}", "User-Agent": "Nexo-Dados-Publicos/1.0"}
    if depth is not None:
        headers["Depth"] = str(depth)
    if inicio:
        headers["Range"] = f"bytes={inicio}-"
    return urllib.request.Request(url, method=method, headers=headers)


def listar(url: str, token: str) -> list[tuple[str, int]]:
    with urllib.request.urlopen(requisicao(url, token, "PROPFIND", 1), timeout=60) as resposta:
        raiz = ET.fromstring(resposta.read())
    itens = []
    for resposta in raiz.findall("{DAV:}response"):
        href = urllib.parse.unquote(resposta.findtext("{DAV:}href") or "")
        tamanho = resposta.findtext(".//{DAV:}getcontentlength")
        itens.append((href.rstrip("/").split("/")[-1], int(tamanho or 0)))
    return itens


def snapshot_mais_recente(token: str) -> str:
    meses = [nome for nome, _ in listar(BASE, token) if re.fullmatch(r"20\d{2}-(?:0[1-9]|1[0-2])", nome)]
    if not meses:
        raise RuntimeError("Nenhum snapshot mensal foi encontrado no repositório oficial.")
    return max(meses)


def baixar(url: str, destino: Path, token: str, tamanho_esperado: int, sobrescrever: bool) -> None:
    if destino.exists() and not sobrescrever and (not tamanho_esperado or destino.stat().st_size == tamanho_esperado):
        print("Já existe:", destino.name)
        return
    temporario = destino.with_suffix(destino.suffix + ".part")
    if sobrescrever and temporario.exists():
        temporario.unlink()
    inicio = temporario.stat().st_size if temporario.exists() else 0
    if tamanho_esperado and inicio > tamanho_esperado:
        temporario.unlink()
        inicio = 0
    print(f"Baixando: {destino.name}{f' (retomando em {inicio / 1024**2:.1f} MiB)' if inicio else ''}")
    with urllib.request.urlopen(requisicao(url, token, inicio=inicio), timeout=180) as origem, temporario.open("ab" if inicio else "wb") as saida:
        while bloco := origem.read(1024 * 1024):
            saida.write(bloco)
    if tamanho_esperado and temporario.stat().st_size != tamanho_esperado:
        raise RuntimeError(f"Download incompleto de {destino.name}: {temporario.stat().st_size} de {tamanho_esperado} bytes")
    os.replace(temporario, destino)
    print("Concluído:", destino.name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", default="latest", help="Mês AAAA-MM ou 'latest'")
    parser.add_argument("--destino", type=Path, default=Path(".cache/receita-cnpj"))
    parser.add_argument("--share-token", default=TOKEN_PUBLICO, help="Token do compartilhamento público oficial")
    parser.add_argument("--sobrescrever", action="store_true")
    parser.add_argument("--listar", action="store_true", help="Apenas mostra snapshot/volume, sem baixar")
    parser.add_argument("--workers", type=int, default=4, help="Downloads paralelos (padrão: 4)")
    args = parser.parse_args()

    snapshot = snapshot_mais_recente(args.share_token) if args.snapshot == "latest" else args.snapshot
    pasta = args.destino / snapshot
    pasta.mkdir(parents=True, exist_ok=True)
    arquivos = [(nome, tamanho) for nome, tamanho in listar(f"{BASE}{snapshot}/", args.share_token) if PADRAO_ARQUIVO.match(nome)]
    if len([n for n, _ in arquivos if n.lower().startswith("estabelecimentos")]) < 10:
        raise RuntimeError(f"Snapshot {snapshot} parece incompleto: partes de estabelecimentos ausentes.")
    total = sum(t for _, t in arquivos)
    print(f"Snapshot oficial {snapshot}: {len(arquivos)} arquivos, {total / 1024**3:.1f} GiB compactados")
    if args.listar:
        for nome, tamanho in arquivos:
            print(f"- {nome}: {tamanho / 1024**2:.1f} MiB")
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        tarefas = [
            executor.submit(
                baixar, f"{BASE}{snapshot}/{urllib.parse.quote(nome)}", pasta / nome,
                args.share_token, tamanho, args.sobrescrever,
            )
            for nome, tamanho in arquivos
        ]
        for tarefa in concurrent.futures.as_completed(tarefas):
            tarefa.result()
    print("Pronto:", pasta)


if __name__ == "__main__":
    main()
