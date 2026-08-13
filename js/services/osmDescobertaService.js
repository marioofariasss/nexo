/**
 * Descoberta de escolas fora do Censo, via OpenStreetMap:
 * - Nominatim (geocodificação por endereço): https://nominatim.openstreetmap.org
 * - Overpass (busca de elementos mapeados, ex: escolas): https://overpass-api.de
 *
 * As duas são APIs públicas, gratuitas, sem chave — mas com regras de uso
 * que precisam ser respeitadas (rate limit do lado do usuário, já que não
 * há chave pra controlar isso do lado do servidor):
 * - Nominatim: no máximo 1 requisição por segundo.
 * - Overpass: evitar rajadas de requisições; usamos um mirror de fallback
 *   se o servidor principal falhar ou responder 429.
 *
 * ATENÇÃO: não testado ao vivo neste ambiente de desenvolvimento (a rede
 * daqui não alcança domínios externos) — validação real acontece no
 * navegador do usuário. Erros são tratados de forma defensiva (nunca
 * travam a página).
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

let ultimaBuscaNominatim = 0;

export async function geocodificarEndereco(endereco) {
  const agora = Date.now();
  const espera = Math.max(0, 1000 - (agora - ultimaBuscaNominatim));
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaBuscaNominatim = Date.now();

  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(endereco)}&countrycodes=br&limit=1`;
  const resp = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
  if (!resp.ok) throw new Error(`Nominatim respondeu ${resp.status}`);
  const dados = await resp.json();
  if (!dados.length) throw new Error('Endereço não encontrado. Tente ser mais específico (ex: "Rua X, Cidade, UF").');
  return { lat: parseFloat(dados[0].lat), lon: parseFloat(dados[0].lon), nomeExibicao: dados[0].display_name };
}

function montarQueryOverpass(lat, lon, raioKm) {
  const raioMetros = Math.round(raioKm * 1000);
  return `[out:json][timeout:25];
(
  node["amenity"="school"](around:${raioMetros},${lat},${lon});
  way["amenity"="school"](around:${raioMetros},${lat},${lon});
  node["amenity"="kindergarten"](around:${raioMetros},${lat},${lon});
  way["amenity"="kindergarten"](around:${raioMetros},${lat},${lon});
);
out center tags;`;
}

async function chamarOverpass(query) {
  let ultimoErro = null;
  for (const url of OVERPASS_URLS) {
    try {
      const resp = await fetch(url, { method: 'POST', body: query });
      if (resp.status === 429) { ultimoErro = new Error('Muitas buscas em sequência no OpenStreetMap. Aguarde um pouco e tente de novo.'); continue; }
      if (!resp.ok) { ultimoErro = new Error(`Overpass respondeu ${resp.status}`); continue; }
      return await resp.json();
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro || new Error('Não foi possível consultar o OpenStreetMap agora.');
}

export function normalizarNome(nome) {
  return (nome || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca escolas via Overpass num raio, e devolve já no formato usado pelo
 * resto do app (mesmos nomes de campo de `escolaService.js`), marcando
 * `fonte: 'osm'` pra distinguir de `fonte: 'censo'`.
 */
/**
 * Filtra escolas que parecem ser da rede PÚBLICA — o Radar é focado em
 * escolas privadas de propósito (é o que faz sentido pra prospecção
 * comercial). O OpenStreetMap não tem um jeito confiável e universal de
 * marcar "é pública" (a tag `operator:type` existe mas raramente é
 * preenchida) — então combina esse sinal, quando existe, com padrões de
 * nome bem conhecidos da nomenclatura pública brasileira. É conservador
 * de propósito: só exclui quando o sinal é claro, pra não arriscar
 * descartar uma escola privada de verdade por engano.
 */
const PADROES_NOME_PUBLICA = [
  /^E\.?\s?E\.?\s?[EMF]\b/i, // E.E.M / E.E.F / E.E. — sigla clássica de escola estadual
  /^EMEI?F?\b/i, // EMEI / EMEIF / EMEF — sigla clássica de escola municipal
  /\bESCOLA\s+(MUNICIPAL|ESTADUAL)\b/i,
  /\bCOL[ÉE]GIO\s+(MUNICIPAL|ESTADUAL)\b/i,
  /\bCENTRO\s+DE\s+ENSINO\s+(MUNICIPAL|ESTADUAL)\b/i,
  /\bINSTITUTO\s+FEDERAL\b/i,
  /\bCIEP\b/i, // Centro Integrado de Educação Pública
  /\bCAIC\b/i,
  /\bCORPO\s+DE\s+BOMBEIROS\b/i, // colégios militares/de corporação, fora do escopo comercial
  /\bPOL[ÍI]CIA\s+MILITAR\b/i,
  /\bEEEP\b/i,
  /\bEEFM\b/i,
  /\bEMEIF\b/i,
  /\bEMEIEF\b/i,
  /\bEMEF\b/i,
  /\bCEJA\b/i,
  /\bEEMTI\b/i,
  /\bEMTI\b/i,
  /^E\.?\s*T\.?\s*I\b/i,
  /^EM\b/i,
  /^CEI\b/i,
  /^CENTRO\s+DE\s+EDUCA[ÇC][ÃA]O\s+INFANTIL\b/i,
  /^CENTRO\s+DE\s+EDUCA[ÇC][ÃA]O\s+DE\s+JOVENS\s+E\s+ADULTOS\b/i,
  /^ESCOLA\s+DE\s+ENSINO\s+(FUNDAMENTAL|M[ÉE]DIO)/i,
  /^ESCOLA\s+ENSINO\s+M[ÉE]DIO\b/i,
  /^ESCOLA\s+DE\s+TIPO\s+INTEGRAL\b/i,
  /^ESCOLA\s+ARENINHA\b/i,
  /^COL[ÉE]GIO\s+MILITAR\s+DE\s+FORTALEZA\b/i,
  /\bESCOLA\s+(DE\s+TEMPO|EM\s+TEMPO)\s+(PARCIAL|INTEGRAL)\b/i,
  /\bCRECHE\s+MUNICIPAL\b/i,
];

export function pareceSerPublica(nome, tags) {
  const tipoOperador = (tags['operator:type'] || '').toLowerCase();
  if (['public', 'government', 'municipal', 'state'].includes(tipoOperador)) return true;
  if ((tags.operator || '').match(/\b(prefeitura|secretaria de educa[cç][aã]o|governo do estado)\b/i)) return true;
  return PADROES_NOME_PUBLICA.some((padrao) => padrao.test(nome || ''));
}

export async function buscarEscolasOSM(lat, lon, raioKm) {
  const query = montarQueryOverpass(lat, lon, raioKm);
  const dados = await chamarOverpass(query);
  const elementos = dados.elements || [];

  return elementos
    .filter((el) => !pareceSerPublica(el.tags?.name, el.tags || {}))
    .map((el, i) => {
      const tags = el.tags || {};
      const latEl = el.lat ?? el.center?.lat;
      const lonEl = el.lon ?? el.center?.lon;
      if (latEl == null || lonEl == null) return null;
      const partesEndereco = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
      return {
        // ID numérico numa faixa dedicada (900 bilhões +), derivado do ID
        // real do OpenStreetMap — garante que a mesma escola sempre caia
        // no mesmo ID em buscas futuras, e nunca colide com o código INEP
        // (CO_ENTIDADE, números bem menores). Mesmo padrão usado pro
        // mapeamento via Google Places no Radar Escolar.
        id: 900000000000 + Number(el.id),
        osmId: `${el.type}/${el.id}`,
        fonte: 'osm',
        nome: tags.name || 'Escola sem nome (OpenStreetMap)',
        nomeNormalizado: normalizarNome(tags.name),
        lat: latEl,
        lon: lonEl,
        endereco: [partesEndereco, tags['addr:suburb']].filter(Boolean).join(' - ') || null,
        bairro: tags['addr:suburb'] || null,
        municipio: tags['addr:city'] || null,
        uf: tags['addr:state'] || null,
        cep: tags['addr:postcode'] || null,
        tel: tags.phone || null,
        site: tags.website || null,
        email: tags.email || tags['contact:email'] || null,
        operador: tags.operator || null,
        cnpjOsm: tags['ref:vatin'] || tags['contact:vat'] || null,
        codigoInepOsm: tags['ref:inep'] || null,
        tipo: tags.amenity === 'kindergarten' ? 'creche' : 'escola',
        qualidadeIdentidade: {
          status: 'candidata_privada_revisao',
          incluirAnalise: true,
          confianca: 'baixa',
          evidencias: [
            'descoberta no OpenStreetMap; requer confirmação de identidade',
            ...(tags['ref:vatin'] || tags['contact:vat'] ? ['CNPJ informado no OSM, ainda não validado'] : []),
          ],
        },
        // campos do Censo ficam nulos pra escolas só encontradas no OSM
        porte: null, mat25: null, icp: null, icpTier: null, mensalidade: null,
        fatPotencial: null, capOciosa: null, varMatPct: null, sinalMat: null,
      };
    })
    .filter(Boolean);
}

/**
 * Cruza escolas do OSM com escolas já carregadas do Censo (mesma UF), em
 * 3 níveis — regra definida pelo usuário:
 * - DUPLICATA CONFIRMADA (descarta, não incorpora): nome normalizado
 *   IDÊNTICO + distância muito pequena (até `raioConfirmadoKm`, "muito
 *   muito próximo"). Vale independente da escola já existente ser do
 *   Censo ou do próprio OSM.
 * - Nome idêntico mas BEM DISTANTE (fora de `raioDuvidaKm`): NÃO é
 *   duplicata — são unidades/campi diferentes que só coincidem no nome
 *   (ex: duas filiais de uma rede). Incorpora normalmente como nova.
 * - Nome parecido (não idêntico) e perto, ou nome idêntico numa distância
 *   intermediária: fica como "possível duplicidade" pra revisão manual —
 *   não descarta sozinho, não incorpora sozinho.
 */
export function cruzarComCenso(escolasOSM, escolasCenso, distanciaKmFn, raioConfirmadoKm = 0.15, raioDuvidaKm = 1) {
  const censoNormalizado = escolasCenso.map((e) => ({ ...e, nomeNormalizado: normalizarNome(e.nome) }));
  let matches = 0;
  const novas = [];
  const duplicidades = [];

  escolasOSM.forEach((osm) => {
    let melhorDuvida = null;
    const matchConfiavel = censoNormalizado.find((c) => {
      if (!osm.nomeNormalizado || !c.nomeNormalizado) return false;
      const nomeIdentico = c.nomeNormalizado === osm.nomeNormalizado;
      const nomeParecido = nomeIdentico || c.nomeNormalizado.includes(osm.nomeNormalizado) || osm.nomeNormalizado.includes(c.nomeNormalizado);
      const dist = (c.lat != null && c.lon != null) ? distanciaKmFn(osm.lat, osm.lon, c.lat, c.lon) : null;

      // duplicata confirmada: nome IDÊNTICO + muito muito perto (ou Censo
      // sem coordenada pra comparar, aceita só pelo nome idêntico)
      if (nomeIdentico && (dist == null ? c.lat == null : dist <= raioConfirmadoKm)) return true;

      // nome idêntico mas longe = unidades diferentes, não é duplicata —
      // nem entra na fila de dúvida, segue como se não tivesse achado nada
      if (nomeIdentico && dist != null && dist > raioDuvidaKm) return false;

      // nome só parecido (não idêntico) e perto, ou nome idêntico numa
      // distância intermediária: fica pra revisão manual
      if (nomeParecido && dist != null && dist <= raioDuvidaKm) {
        if (!melhorDuvida || dist < melhorDuvida.dist) melhorDuvida = { escola: c, dist };
      }
      return false;
    });
    if (matchConfiavel) {
      matches += 1;
    } else if (melhorDuvida) {
      duplicidades.push({ ...osm, possivelCorrespondencia: melhorDuvida.escola.nome, distanciaCorrespondencia: melhorDuvida.dist });
    } else {
      novas.push(osm);
    }
  });

  return { novas, duplicidades, totalOsm: escolasOSM.length, totalCenso: escolasCenso.length, matches };
}
