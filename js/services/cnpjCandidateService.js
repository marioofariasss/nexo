const DATA_BASE = new URL('../../data/', import.meta.url).href;
const cache = new Map();

async function carregarUF(uf) {
  if (cache.has(uf)) return cache.get(uf);
  const promessa = fetch(`${DATA_BASE}cnpj_candidatos/${uf}.json`).then(async (resposta) => {
    if (resposta.status === 404) return null;
    if (!resposta.ok) throw new Error(`Candidatos de CNPJ responderam ${resposta.status}`);
    return resposta.json();
  }).catch(() => null);
  cache.set(uf, promessa);
  return promessa;
}

export async function buscarCandidatosCnpj(escola) {
  if (!escola?.uf || escola.fonte !== 'osm' || escola.cnpj) return [];
  const documento = await carregarUF(escola.uf);
  const candidatos = [...(documento?.escolas?.[String(escola.id)] || [])];
  const digitosOsm = String(escola.cnpjOsm || '').replace(/\D/g, '');
  const cnpjOsm = digitosOsm ? digitosOsm.padStart(14, '0') : '';
  if (cnpjOsm.length === 14 && !candidatos.some((c) => String(c.cnpj).replace(/\D/g, '') === cnpjOsm)) {
    candidatos.unshift({
      cnpj: cnpjOsm,
      nomeFantasia: escola.nome,
      razaoSocial: '', cnae: '', cep: escola.cep || '',
      score: 65,
      evidencias: ['CNPJ informado no próprio cadastro do OpenStreetMap; validar na Receita antes de confirmar'],
      status: 'candidato_revisao',
    });
  }
  return candidatos;
}
