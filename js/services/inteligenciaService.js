const DATA_BASE = new URL('../../data/inteligencia/', import.meta.url).href;

let resumoPromise = null;
const cacheUf = new Map();

async function buscarJson(caminho) {
  const resposta = await fetch(`${DATA_BASE}${caminho}`);
  if (!resposta.ok) throw new Error(`Camada de inteligência indisponível (${resposta.status})`);
  return resposta.json();
}

export function carregarResumoInteligencia() {
  if (!resumoPromise) resumoPromise = buscarJson('resumo.json');
  return resumoPromise;
}

export function carregarInteligenciaUF(uf) {
  if (!cacheUf.has(uf)) cacheUf.set(uf, buscarJson(`escolas/${uf}.json`));
  return cacheUf.get(uf);
}

export async function buscarSerieEscola(uf, escolaId) {
  if (!uf || !escolaId) return null;
  const documento = await carregarInteligenciaUF(uf);
  const valores = documento.escolas?.[String(escolaId)] || null;
  if (!valores) return null;
  const campos = documento.metadados.schemaSerieEscola;
  return {
    campos,
    valores,
    registros: valores.map((linha) => Object.fromEntries(campos.map((campo, i) => [campo, linha[i]]))),
    fonte: documento.metadados.fonte,
  };
}

export async function buscarSerieMunicipio(uf, municipio) {
  const documento = await carregarInteligenciaUF(uf);
  const alvo = (municipio || '').localeCompare ? municipio : String(municipio || '');
  return (documento.municipios || [])
    .filter((r) => r.municipio.localeCompare(alvo, 'pt-BR', { sensitivity: 'base' }) === 0)
    .sort((a, b) => a.ano - b.ano);
}

export async function buscarDiagnosticoMunicipio(uf, municipio) {
  const resumo = await carregarResumoInteligencia();
  return resumo.diagnosticosMunicipais.find((r) => r.uf === uf
    && r.municipio.localeCompare(municipio, 'pt-BR', { sensitivity: 'base' }) === 0) || null;
}

const CAMPOS_SOMAVEIS = ['escolasTotal', 'escolasPrivadas', 'matriculasTotal', 'matriculasPrivadas', 'turmasPrivadas', 'docentesPrivados'];
const ETAPAS = ['infantil', 'creche', 'preEscola', 'fundamentalI', 'fundamentalII', 'medio'];

function finalizarRegistro(registro) {
  const privado = registro.matriculasPrivadas || 0;
  return {
    ...registro,
    participacaoPrivadaPct: registro.matriculasTotal ? (privado / registro.matriculasTotal) * 100 : null,
    alunosPorEscolaPrivada: registro.escolasPrivadas ? privado / registro.escolasPrivadas : null,
    alunosPorTurmaPrivada: registro.turmasPrivadas ? privado / registro.turmasPrivadas : null,
    alunosPorDocentePrivado: registro.docentesPrivados ? privado / registro.docentesPrivados : null,
  };
}

export async function agregarSeriesUfs(ufs) {
  const resumo = await carregarResumoInteligencia();
  const permitidas = new Set(ufs);
  const porAno = new Map();
  resumo.ufs.filter((r) => permitidas.has(r.uf)).forEach((r) => {
    if (!porAno.has(r.ano)) {
      porAno.set(r.ano, {
        ano: r.ano, escolasTotal: 0, escolasPrivadas: 0, matriculasTotal: 0,
        matriculasPrivadas: 0, turmasPrivadas: 0, docentesPrivados: 0,
        etapasPrivadas: Object.fromEntries(ETAPAS.map((etapa) => [etapa, 0])),
      });
    }
    const destino = porAno.get(r.ano);
    CAMPOS_SOMAVEIS.forEach((campo) => { destino[campo] += Number(r[campo]) || 0; });
    ETAPAS.forEach((etapa) => { destino.etapasPrivadas[etapa] += Number(r.etapasPrivadas?.[etapa]) || 0; });
  });
  return [...porAno.values()].sort((a, b) => a.ano - b.ano).map(finalizarRegistro);
}

export async function agregarSeriesEscolas(escolas) {
  const porUf = new Map();
  escolas.filter((e) => e.id && e.uf && e.fonte !== 'osm').forEach((e) => {
    if (!porUf.has(e.uf)) porUf.set(e.uf, new Set());
    porUf.get(e.uf).add(String(e.id));
  });
  const documentos = await Promise.all([...porUf.keys()].map(async (uf) => [uf, await carregarInteligenciaUF(uf)]));
  const porAno = new Map();
  let escolasComHistorico = 0;
  documentos.forEach(([uf, documento]) => {
    porUf.get(uf).forEach((id) => {
      const linhas = documento.escolas?.[id];
      if (!linhas?.length) return;
      escolasComHistorico += 1;
      const campos = documento.metadados.schemaSerieEscola;
      linhas.forEach((linha) => {
        const r = Object.fromEntries(campos.map((campo, i) => [campo, linha[i]]));
        if (!porAno.has(r.ano)) porAno.set(r.ano, { ano: r.ano, escolasPrivadas: 0, matriculasPrivadas: 0, turmasPrivadas: 0, docentesPrivados: 0, etapasPrivadas: { infantil: 0, fundamentalI: 0, fundamentalII: 0, medio: 0 } });
        const destino = porAno.get(r.ano);
        destino.escolasPrivadas += 1;
        destino.matriculasPrivadas += Number(r.matriculas) || 0;
        destino.turmasPrivadas += Number(r.turmas) || 0;
        destino.docentesPrivados += Number(r.docentes) || 0;
        destino.etapasPrivadas.infantil += Number(r.infantil) || 0;
        destino.etapasPrivadas.fundamentalI += Number(r.fundamental) || 0;
        destino.etapasPrivadas.medio += Number(r.medio) || 0;
      });
    });
  });
  return {
    serie: [...porAno.values()].sort((a, b) => a.ano - b.ano).map(finalizarRegistro),
    escolasComHistorico,
    escolasSolicitadas: [...porUf.values()].reduce((s, ids) => s + ids.size, 0),
  };
}

function cagr(inicial, final, anos) {
  if (!(inicial > 0) || !(final >= 0) || anos <= 0) return null;
  return ((final / inicial) ** (1 / anos) - 1) * 100;
}

export function diagnosticarSerie(serie) {
  if (!serie?.length) return null;
  const inicial = serie[0];
  const final = serie.at(-1);
  const anos = final.ano - inicial.ano;
  const crescimentoMatriculasCagrPct = cagr(inicial.matriculasPrivadas, final.matriculasPrivadas, anos);
  const crescimentoEscolasCagrPct = cagr(inicial.escolasPrivadas, final.escolasPrivadas, anos);
  const pressaoOfertaPp = crescimentoMatriculasCagrPct == null || crescimentoEscolasCagrPct == null
    ? null : crescimentoEscolasCagrPct - crescimentoMatriculasCagrPct;
  let riscoSaturacao = 'Dados insuficientes';
  if (pressaoOfertaPp != null) riscoSaturacao = pressaoOfertaPp >= 2 ? 'Alto' : pressaoOfertaPp >= 0.5 ? 'Moderado' : 'Baixo';
  return { inicial, final, crescimentoMatriculasCagrPct, crescimentoEscolasCagrPct, pressaoOfertaPp, riscoSaturacao };
}
