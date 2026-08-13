export function fmtInt(n) {
  return Math.round(n || 0).toLocaleString('pt-BR');
}

export function fmtMoedaCompacta(n) {
  n = n || 0;
  if (n >= 1e9) return 'R$ ' + (n / 1e9).toFixed(1) + ' bi';
  if (n >= 1e6) return 'R$ ' + (n / 1e6).toFixed(1) + ' mi';
  if (n >= 1e3) return 'R$ ' + (n / 1e3).toFixed(0) + ' mil';
  return 'R$ ' + Math.round(n);
}

export function labelPorte(porte) {
  return (porte || '').split('(')[0].replace(/^[0-9]-/, '').trim();
}
