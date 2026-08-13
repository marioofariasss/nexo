/**
 * Distância em km entre duas coordenadas (fórmula de haversine).
 * Usado para filtrar escolas dentro de um raio a partir de um ponto central.
 */
export function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Limites territoriais aproximados, com uma pequena margem, usados apenas
// como guarda de qualidade. Eles impedem que resíduos de escala (ex.: -0.3
// em vez de -30.3) sejam desenhados/analisados como se fossem coordenadas
// reais. Não servem para decidir município nem para geocodificação.
const LIMITES_UF = {
  AC: [-11.4, -6.9, -74.1, -66.3], AL: [-10.7, -8.6, -38.5, -34.8], AP: [-1.5, 4.6, -55.1, -49.6],
  AM: [-10.1, 2.5, -74.0, -55.8], BA: [-18.6, -8.3, -46.9, -37.0], CE: [-8.1, -2.6, -41.7, -37.0],
  DF: [-16.2, -15.4, -48.4, -47.2], ES: [-21.5, -17.6, -42.1, -39.4], GO: [-19.7, -12.7, -53.5, -45.7],
  MA: [-10.5, -0.8, -49.0, -41.6], MT: [-18.3, -7.1, -61.8, -50.0], MS: [-24.4, -16.9, -58.4, -50.7],
  MG: [-23.1, -14.0, -51.2, -39.6], PA: [-10.0, 2.8, -59.1, -45.8], PB: [-8.5, -5.8, -39.0, -34.5],
  PR: [-27.0, -22.3, -54.9, -47.8], PE: [-9.7, -7.0, -41.6, -34.6], PI: [-11.1, -2.5, -46.1, -40.1],
  RJ: [-23.6, -20.5, -45.1, -40.7], RN: [-7.2, -4.6, -38.8, -34.7], RS: [-34.0, -26.8, -57.9, -49.5],
  RO: [-13.9, -7.7, -66.2, -59.5], RR: [-1.8, 5.5, -65.1, -58.6], SC: [-29.6, -25.7, -54.1, -48.1],
  SP: [-25.5, -19.5, -53.4, -43.8], SE: [-11.8, -9.3, -38.5, -36.1], TO: [-13.7, -4.9, -51.0, -45.5],
};

export function coordenadaValidaBrasil(lat, lon, uf = null) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -34.2 || latitude > 5.7 || longitude < -74.3 || longitude > -34.3) return false;
  const limite = LIMITES_UF[String(uf || '').toUpperCase()];
  if (!limite) return true;
  return latitude >= limite[0] && latitude <= limite[1] && longitude >= limite[2] && longitude <= limite[3];
}
