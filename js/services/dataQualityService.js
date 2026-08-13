/**
 * Qualidade de dados por escola — quanto da ficha está preenchida, e em
 * que estágio de enriquecimento ela está. Não depende de nenhuma fonte
 * externa, é calculado a partir dos campos já presentes no registro.
 *
 * Os campos considerados espelham os 4 estágios descritos no produto:
 * descoberta (nome, local, endereço) → identificação (telefone, site,
 * CNPJ provável) → enriquecimento institucional (CNPJ validado, sócios,
 * etc — hoje limitado ao que vem do Censo + BrasilAPI) → análise
 * (matrículas, porte, ticket).
 */

const CAMPOS_POR_ESTAGIO = {
  descoberta: ['nome', 'municipio', 'endereco'],
  identificacao: ['tel', 'site', 'cnpj'],
  institucional: ['cnpjMant', 'gestorPos', 'mantEmpresa'],
  analise: ['mat25', 'porte', 'mensalidade'],
};

const TODOS_OS_CAMPOS = Object.values(CAMPOS_POR_ESTAGIO).flat();

export function calcularCompletude(escola) {
  const preenchidos = TODOS_OS_CAMPOS.filter((campo) => escola[campo] != null && escola[campo] !== '');
  const percentual = Math.round((preenchidos.length / TODOS_OS_CAMPOS.length) * 100);

  let nivel;
  if (percentual >= 70) nivel = 'Completa';
  else if (percentual >= 35) nivel = 'Parcial';
  else nivel = 'Inicial';

  const estagios = {};
  Object.entries(CAMPOS_POR_ESTAGIO).forEach(([estagio, campos]) => {
    const preenchidosEstagio = campos.filter((c) => escola[c] != null && escola[c] !== '');
    estagios[estagio] = Math.round((preenchidosEstagio.length / campos.length) * 100);
  });

  return { percentual, nivel, estagios };
}

export function corNivel(nivel) {
  if (nivel === 'Completa') return 'var(--icp-alta)'; // reaproveita a variável de cor existente (verde) — não tem relação com ICP
  if (nivel === 'Parcial') return 'var(--icp-media)'; // amarelo/laranja
  return 'var(--text-muted)'; // cinza
}

/**
 * Estatísticas de completude pra um conjunto de escolas (usado na Central
 * de Enriquecimento) — quantas têm cada campo-chave preenchido.
 */
export function estatisticasCompletude(escolas) {
  const total = escolas.length || 1;
  const contar = (campo) => escolas.filter((e) => e[campo] != null && e[campo] !== '').length;
  return {
    total: escolas.length,
    comCnpj: { quantidade: contar('cnpj'), percentual: Math.round((contar('cnpj') / total) * 100) },
    comTelefone: { quantidade: contar('tel'), percentual: Math.round((contar('tel') / total) * 100) },
    comSite: { quantidade: contar('site'), percentual: Math.round((contar('site') / total) * 100) },
    comInstagram: { quantidade: contar('instagram'), percentual: Math.round((contar('instagram') / total) * 100) },
    somenteBasico: escolas.filter((e) => calcularCompletude(e).nivel === 'Inicial').length,
  };
}
