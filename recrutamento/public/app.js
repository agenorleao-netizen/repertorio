/* ------------------------------------------------------------------ *
 * Sistema de Recrutamento — app do navegador (sem frameworks).
 * Funciona de dois jeitos:
 *   1) servido por `node server.js`  -> grava em dados/base.json
 *   2) abrindo o index.html direto   -> grava no próprio navegador
 * ------------------------------------------------------------------ */

const ETAPAS_PADRAO = [
  'Mapeado', 'Abordado', 'Entrevista consultor', 'Short list',
  'Entrevista cliente', 'Proposta', 'Contratado'
];
const SITUACOES = ['Ativo', 'Stand-by', 'Declinou', 'Descartado', 'Contratado'];
const STATUS_ASSIGNMENT = ['Aberto', 'Stand-by', 'Concluído', 'Cancelado'];
const SENIORIDADES = ['Analista', 'Coordenação', 'Gerência', 'Diretoria', 'C-level', 'Conselho'];
const DIAS_PARADO = 14; // alerta de candidato parado na mesma etapa

let base = baseVazia();
let modoLocal = false;   // true = sem servidor, guardando no navegador
let salvando = null;

function baseVazia() {
  return {
    versao: 1, candidatos: [], clientes: [], assignments: [], atividades: [], usuarios: [],
    configuracao: null
  };
}

/** Processo de seleção que vem de fábrica; dá para editar e criar outros. */
function configuracaoPadrao() {
  return {
    moeda: 'R$',
    processos: [
      { id: 'padrao', nome: 'Executive search (padrão)', etapas: ETAPAS_PADRAO.slice() },
      { id: 'expresso', nome: 'Busca expressa (3 etapas)', etapas: ['Mapeado', 'Entrevista consultor', 'Entrevista cliente'] }
    ],
    processoPadraoId: 'padrao',
    beneficios: ['Plano de saúde', 'Plano odontológico', 'Previdência privada', 'Vale refeição',
      'Carro / auxílio combustível', 'Seguro de vida', 'PLR', 'Stock options', 'Bônus de contratação',
      'Auxílio moradia', 'Auxílio educação']
  };
}

const NIVEIS_IDIOMA = ['Básico', 'Intermediário', 'Avançado', 'Fluente', 'Nativo'];
const NIVEIS_FORMACAO = ['Técnico', 'Graduação', 'Pós-graduação', 'MBA', 'Mestrado', 'Doutorado'];

/**
 * Ajusta bases antigas ao formato atual: contatos do cliente viraram lista,
 * a faixa salarial virou pacote estruturado e o job spec ganhou campos.
 */
function migrarBase() {
  if (!base.configuracao) base.configuracao = configuracaoPadrao();
  const cfg = base.configuracao;
  if (!cfg.processos || !cfg.processos.length) Object.assign(cfg, configuracaoPadrao());
  if (!cfg.beneficios) cfg.beneficios = configuracaoPadrao().beneficios;
  if (!cfg.moeda) cfg.moeda = 'R$';

  (base.clientes || []).forEach((c) => {
    if (!Array.isArray(c.contatos)) {
      c.contatos = [];
      if (c.contatoNome || c.contatoEmail) {
        c.contatos.push({ id: uid(), nome: c.contatoNome || '', cargo: '', email: c.contatoEmail || '', telefone: '' });
      }
      delete c.contatoNome; delete c.contatoEmail;
    }
  });

  (base.assignments || []).forEach((a) => {
    if (!a.pacote) {
      a.pacote = pacoteVazio();
      if (a.faixaSalarial) a.pacote.observacao = a.faixaSalarial;
    }
    if (!a.jobSpec) {
      a.jobSpec = jobSpecVazio();
      if (a.descricao) a.jobSpec.missao = a.descricao;
      if (a.cargo) a.jobSpec.titulosAlvo = [a.cargo];
      if (a.localizacao) a.jobSpec.localizacoes = [a.localizacao];
    }
    if (!a.consultorId && a.consultor) {
      const achado = (base.usuarios || []).find((u) => u.nome === a.consultor);
      if (achado) a.consultorId = achado.id;
    }
    if (!a.processoId) a.processoId = cfg.processoPadraoId;
  });
}

function pacoteVazio() {
  return {
    fixoMensal: '', fixoAnual: '', bonusTipo: 'percentual', bonusValor: '', bonusDescricao: '',
    beneficios: [], outros: '', observacao: ''
  };
}

function jobSpecVazio() {
  return {
    missao: '', entregas: [], competencias: [], titulosAlvo: [], empresasAlvo: [], empresasEvitar: [],
    formacao: [], idiomas: [], localizacoes: [], observacoes: ''
  };
}

/* ---------------------------- utilidades ---------------------------- */

const $ = (s, raiz) => (raiz || document).querySelector(s);
const $$ = (s, raiz) => Array.from((raiz || document).querySelectorAll(s));

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hoje() { return new Date().toISOString(); }

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('pt-BR');
}

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function nl2br(t) { return esc(t).replace(/\n/g, '<br>'); }

function aviso(texto, ms) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.remove('escondido');
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => el.classList.add('escondido'), ms || 2600);
}

async function baixar(nomeArquivo, conteudo, tipo) {
  // Na versão online quem entrega o arquivo é o próprio visualizador; um
  // link de download comum é bloqueado lá.
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        try {
          await downloads.save({ filename: nomeArquivo, data: conteudo });
        } catch (e) {
          if (e && (e.code === 'extension_not_enabled' || e.code === 'rejected_extension')) {
            await downloads.save({ filename: nomeArquivo.replace(/\.[^.]+$/, '') + '.txt', data: conteudo });
            aviso('Salvei como .txt — renomeie para .csv para abrir no Excel.', 6000);
          } else if (e && e.code === 'declined') {
            return;
          } else { throw e; }
        }
        return;
      }
    } catch (e) {
      aviso('Não consegui salvar o arquivo aqui.', 4000);
      return;
    }
  }
  const blob = new Blob([conteudo], { type: (tipo || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function csv(linhas) {
  return linhas.map((l) => l.map((c) => {
    const v = c == null ? '' : String(c);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(';')).join('\n');
}

/* ---------------------------- persistência ---------------------------- */

function carregarLocal() {
  try { base = Object.assign(baseVazia(), JSON.parse(localStorage.getItem('recrut.base') || 'null') || {}); }
  catch (_) { base = baseVazia(); }
}

async function carregar() {
  if (modoLocal) { carregarLocal(); migrarBase(); marcarModo(); return; }
  const r = await fetch('api/base', { cache: 'no-store' });
  if (r.status === 401) { eu = null; mostrarAcesso(); throw new Error('sem sessão'); }
  if (!r.ok) throw new Error('não consegui ler a base');
  base = Object.assign(baseVazia(), await r.json());
  migrarBase();
  marcarModo();
}

function salvar() {
  if (!podeEditar()) { aviso('Seu acesso é somente leitura.'); return; }
  clearTimeout(salvando);
  salvando = setTimeout(async () => {
    if (modoLocal) {
      try { localStorage.setItem('recrut.base', JSON.stringify(base)); }
      catch (e) { aviso('Este navegador não deixou salvar. Use Backup → Exportar, ou rode com o servidor.', 6000); }
      return;
    }
    try {
      const r = await fetch('api/base', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base)
      });
      if (r.status === 409) {
        // Alguém gravou entre a leitura e agora. Não dá para perder o que a
        // pessoa acabou de fazer: reenvia por cima, avisando.
        const conflito = await r.json().catch(() => ({}));
        base.versao = conflito.versaoAtual || base.versao;
        const r2 = await fetch('api/base', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base)
        });
        const resp2 = await r2.json().catch(() => ({}));
        if (resp2 && resp2.versao) base.versao = resp2.versao;
        aviso('Outra pessoa gravou ao mesmo tempo — suas alterações foram aplicadas por cima.', 6000);
        return;
      }
      const resp = await r.json();
      if (resp && resp.versao) base.versao = resp.versao;
    } catch (e) {
      aviso('Não consegui gravar no servidor. Verifique se ele está rodando.', 5000);
    }
  }, 180);
}

function marcarModo() {
  const el = $('#aviso-modo');
  if (modoLocal) {
    el.textContent = window.RECRUTAMENTO_ONLINE ? 'versão online' : 'modo navegador';
    el.title = 'Sem servidor: os dados ficam salvos apenas neste navegador. Use "Backup" para exportar.';
  } else {
    el.textContent = 'servidor local';
    el.title = 'Os dados ficam em dados/base.json, na pasta do projeto.';
  }
}

function registrarAtividade(tipo, texto, extra) {
  base.atividades = base.atividades || [];
  base.atividades.unshift(Object.assign({ id: uid(), data: hoje(), tipo, texto }, extra || {}));
  base.atividades = base.atividades.slice(0, 500);
}

/* ---------------------------- acessores ---------------------------- */

const acharCandidato = (id) => base.candidatos.find((c) => c.id === id);
const acharCliente = (id) => base.clientes.find((c) => c.id === id);
const acharAssignment = (id) => base.assignments.find((a) => a.id === id);
const nomeCliente = (id) => (acharCliente(id) || {}).nome || '—';
const etapasDe = (a) => (a.etapas && a.etapas.length ? a.etapas : ETAPAS_PADRAO);

function processosDoCandidato(candidatoId) {
  const saida = [];
  base.assignments.forEach((a) => {
    (a.candidatos || []).forEach((v) => {
      if (v.candidatoId === candidatoId) saida.push({ assignment: a, vinculo: v });
    });
  });
  return saida;
}

/* ---------------------------- modal ---------------------------- */

function abrirModal(titulo, html, aoAbrir) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').classList.remove('escondido');
  ligarAcoes($('#modal-corpo'));
  if (aoAbrir) aoAbrir($('#modal-corpo'));
}
function fecharModal() {
  $('#modal').classList.add('escondido');
  $('#modal-corpo').innerHTML = '';
}

/* ---------------------------- importador do LinkedIn ---------------------------- */
/**
 * Lê o texto copiado de um perfil do LinkedIn (Ctrl+A / Ctrl+C na página do
 * perfil, ou o texto do PDF "Salvar como PDF") e devolve os campos separados.
 * É heurístico de propósito: o resultado sempre passa por uma tela de revisão
 * antes de virar cadastro.
 */
function importarLinkedIn(texto) {
  const bruto = String(texto || '').replace(/\r/g, '');
  const ruido = /^(ver perfil|status|logotipo|imagem de plano de fundo|foto de|conex|seguidores|mensagem|conectar|mais|salvar no pdf|entre para ver|carregar mais|·\s*3º|·\s*2º|·\s*1º)/i;

  const linhas = bruto.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !ruido.test(l))
    .filter((l, i, arr) => l !== arr[i - 1]); // LinkedIn duplica muita linha

  const perfil = {
    nome: '', headline: '', localizacao: '', linkedinUrl: '', resumo: '',
    experiencias: [], formacao: [], competencias: [], idiomas: [],
    empresaAtual: '', cargoAtual: ''
  };

  const mUrl = bruto.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%À-ÿ]+/i);
  if (mUrl) perfil.linkedinUrl = (mUrl[0].startsWith('http') ? '' : 'https://') + mUrl[0];

  const secoes = {
    sobre: /^(sobre|about)$/i,
    experiencia: /^(experiência|experiencia|experience)$/i,
    formacao: /^(formação acadêmica|formacao academica|educação|education)$/i,
    licencas: /^(licenças e certificados|licenses|certificações|certificacoes)$/i,
    competencias: /^(competências|competencias|skills|principais competências)$/i,
    idiomas: /^(idiomas|languages)$/i,
    fim: /^(recomendações|interesses|atividades|publicações|conquistas|cursos|voluntariado|pessoas que|outros perfis)/i
  };

  // 1) cabeçalho: nome, headline e localização (antes da 1ª seção conhecida)
  let i = 0;
  const ehSecao = (l) => Object.keys(secoes).some((k) => secoes[k].test(l));
  const cabeca = [];
  while (i < linhas.length && !ehSecao(linhas[i]) && cabeca.length < 8) { cabeca.push(linhas[i]); i++; }

  const semUrl = cabeca.filter((l) => !/linkedin\.com/i.test(l));
  perfil.nome = semUrl[0] || '';
  perfil.headline = semUrl[1] || '';
  const iLocal = semUrl.findIndex((l, idx) => idx > 0 &&
    (/(brasil|brazil|portugal|estados unidos)/i.test(l) || /^[^,]{2,30},\s*[^,]{2,30}(,\s*[^,]{2,30})?$/.test(l)) &&
    l.length < 70);
  if (iLocal > 0) perfil.localizacao = semUrl[iLocal].split('·')[0].trim();

  // 2) fatia o resto em blocos por seção
  const blocos = {};
  let atual = null;
  for (; i < linhas.length; i++) {
    const l = linhas[i];
    const chave = Object.keys(secoes).find((k) => secoes[k].test(l));
    if (chave) { atual = chave === 'fim' ? null : chave; if (!blocos[atual]) blocos[atual] = []; continue; }
    if (atual) blocos[atual].push(l);
  }

  if (blocos.sobre) perfil.resumo = blocos.sobre.join('\n');
  if (blocos.competencias) {
    perfil.competencias = blocos.competencias
      .flatMap((l) => l.split(/[•·,;|]/))
      .map((s) => s.trim())
      .filter((s) => s && s.length < 45 && !/^\d+$/.test(s))
      .slice(0, 40);
  }
  if (blocos.idiomas) {
    perfil.idiomas = blocos.idiomas.filter((l) => l.length < 60).slice(0, 12);
  }

  // 3) experiências: cada bloco termina numa linha de período
  const rePeriodo = /((jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s*(de\s*)?\d{4}|\b\d{4})\s*[-–—]\s*(o momento|atual|present|(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s*(de\s*)?\d{4}|\d{4})/i;
  const reDuracao = /^\s*(·\s*)?\d+\s*(ano|anos|mês|meses|mes|meses)/i;

  /**
   * Num perfil do LinkedIn cada entrada vem assim:
   *   Cargo / Empresa · tipo / Período / Local / descrição...
   * Então cada linha de período é uma âncora: o que vem logo antes dela é
   * cargo/empresa e o que vem depois é local/descrição, até a próxima entrada.
   */
  function entradasPorPeriodo(linhasSecao) {
    const uteis = linhasSecao.filter((l) => !reDuracao.test(l));
    const ancoras = [];
    uteis.forEach((l, i) => { if (rePeriodo.test(l)) ancoras.push(i); });
    if (!ancoras.length) return [];
    return ancoras.map((iPer, k) => {
      const inicio = k === 0 ? 0 : ancoras[k - 1] + 1;
      const antes = uteis.slice(inicio, iPer);
      const limite = k + 1 < ancoras.length ? Math.max(iPer + 1, ancoras[k + 1] - 2) : uteis.length;
      const depois = uteis.slice(iPer + 1, limite);
      return {
        titulo: (antes[antes.length - 2] || antes[0] || '').trim(),
        sub: (antes.length > 1 ? antes[antes.length - 1] : '').split('·')[0].trim(),
        periodo: uteis[iPer].split('·')[0].trim(),
        extra: depois
      };
    });
  }

  if (blocos.experiencia) {
    entradasPorPeriodo(blocos.experiencia).forEach((e) => {
      if (!e.titulo && !e.sub) return;
      const local = e.extra[0] && e.extra[0].length < 60 ? e.extra[0] : '';
      const descricao = (local ? e.extra.slice(1) : e.extra).join('\n');
      perfil.experiencias.push({ cargo: e.titulo, empresa: e.sub, periodo: e.periodo, local, descricao });
    });
  }

  if (blocos.formacao) {
    entradasPorPeriodo(blocos.formacao).forEach((e) => {
      if (!e.titulo && !e.sub) return;
      perfil.formacao.push({ instituicao: e.titulo, curso: e.sub, periodo: e.periodo });
    });
  }

  const atualExp = perfil.experiencias.find((e) => /(o momento|atual|present)/i.test(e.periodo)) || perfil.experiencias[0];
  if (atualExp) { perfil.cargoAtual = atualExp.cargo; perfil.empresaAtual = atualExp.empresa; }
  if (!perfil.cargoAtual && perfil.headline) {
    const p = perfil.headline.split(/\s+(?:na|no|em|@|\|)\s+/i);
    perfil.cargoAtual = (p[0] || '').trim();
    perfil.empresaAtual = (p[1] || '').trim();
  }

  const mEmail = bruto.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  const mTel = bruto.match(/(\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/);
  if (mEmail) perfil.email = mEmail[0];
  if (mTel) perfil.telefone = mTel[0];

  return perfil;
}

/* ---------------------------- roteamento ---------------------------- */

const acoes = {}; // nome -> função(elemento, dataset)

function ligarAcoes(raiz) {
  $$('[data-acao]', raiz || document).forEach((el) => {
    if (el._ligado) return;
    el._ligado = true;
    const evento = el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      ? 'change' : 'click';
    el.addEventListener(evento, (ev) => {
      const fn = acoes[el.dataset.acao];
      if (fn) { ev.preventDefault(); fn(el, el.dataset, ev); }
    });
  });
}

function ir(hash) { location.hash = hash; }

/** Cabeçalho padrão: eyebrow em mono, título em serifa, ações à direita. */
function cabecalho(eyebrow, titulo, sub, botoes) {
  return `<header class="pagina-topo">
    <div class="titulo-bloco">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1>${esc(titulo)}</h1>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>
    ${botoes ? `<div class="acoes nao-imprime">${botoes}</div>` : ''}
  </header>`;
}

/** Botão que some para quem tem acesso só de leitura. */
function seEdita(html) { return podeEditar() ? html : ''; }

function render() {
  const rota = (location.hash || '#/painel').slice(1);
  const partes = rota.split('/').filter(Boolean);
  const app = $('#app');
  let html = '';

  const tela = partes[0] || 'painel';
  const arg = partes[1];
  const arg2 = partes[2];

  if (tela === 'painel') html = telaPainel();
  else if (tela === 'assignments') html = telaAssignments();
  else if (tela === 'assignment') html = telaAssignment(arg);
  else if (tela === 'candidatos') html = telaCandidatos();
  else if (tela === 'candidato') html = telaCandidato(arg);
  else if (tela === 'clientes') html = telaClientes();
  else if (tela === 'relatorios') html = telaRelatorios();
  else if (tela === 'usuarios') html = telaUsuarios();
  else if (tela === 'configuracoes') html = telaConfiguracoes();
  else if (tela === 'relatorio') html = arg === 'assignment' ? relatorioAssignment(arg2) : relatorioCandidato(arg2);
  else html = telaPainel();

  app.innerHTML = html;
  ligarAcoes(app);
  ligarKanban();
  if ($('#rel-busca-cand')) ligarBuscaRelatorio();

  $$('.menu a').forEach((a) => {
    const r = a.dataset.rota;
    const ativo = tela === r || (tela === 'assignment' && r === 'assignments') ||
      (tela === 'candidato' && r === 'candidatos') || (tela === 'relatorio' && r === 'relatorios');
    a.classList.toggle('ativo', ativo);
  });
  window.scrollTo(0, 0);
}

/* ---------------------------- painel ---------------------------- */

function contagemPorEtapa(a) {
  const mapa = {};
  etapasDe(a).forEach((e) => { mapa[e] = 0; });
  (a.candidatos || []).forEach((v) => {
    if (v.situacao && v.situacao !== 'Ativo' && v.situacao !== 'Contratado') return;
    if (mapa[v.etapa] == null) mapa[v.etapa] = 0;
    mapa[v.etapa]++;
  });
  return mapa;
}

function barraFunil(a) {
  const mapa = contagemPorEtapa(a);
  const total = Object.values(mapa).reduce((s, n) => s + n, 0) || 1;
  const etapas = etapasDe(a);
  const pedacos = etapas.map((e, i) => {
    const n = mapa[e] || 0;
    if (!n) return '';
    // Mesma rampa das colunas do pipeline: a matiz mostra o quanto avançou.
    const matiz = Math.round(214 - (i / Math.max(1, etapas.length - 1)) * 66);
    return `<span title="${esc(e)}: ${n}" style="width:${(n / total) * 100}%;background:hsl(${matiz} var(--etapa-s) var(--etapa-l))"></span>`;
  }).join('');
  return `<div class="funil">${pedacos}</div>`;
}

function telaPainel() {
  const abertos = base.assignments.filter((a) => a.status === 'Aberto');
  const emProcesso = base.assignments.reduce((s, a) =>
    s + (a.candidatos || []).filter((v) => (v.situacao || 'Ativo') === 'Ativo').length, 0);
  const contratados = base.assignments.reduce((s, a) =>
    s + (a.candidatos || []).filter((v) => v.situacao === 'Contratado').length, 0);

  const parados = [];
  base.assignments.filter((a) => a.status === 'Aberto').forEach((a) => {
    (a.candidatos || []).forEach((v) => {
      const d = diasDesde(v.etapaDesde || v.entrouEm);
      if ((v.situacao || 'Ativo') === 'Ativo' && d != null && d >= DIAS_PARADO) {
        parados.push({ a, v, d });
      }
    });
  });
  parados.sort((x, y) => y.d - x.d);

  const linhasAssign = abertos.map((a) => {
    const total = (a.candidatos || []).length;
    const dias = diasDesde(a.abertoEm);
    return `<tr class="clicavel" data-acao="abrirAssignment" data-id="${a.id}">
      <td><strong>${esc(a.titulo)}</strong><div class="subtexto">${esc(nomeCliente(a.clienteId))}</div></td>
      <td>${esc(a.consultor || '—')}</td>
      <td style="min-width:150px">${total}${barraFunil(a)}</td>
      <td class="num">${dias == null ? '—' : dias + ' d'}</td>
      <td class="num">${a.prazoAlvo ? fmtData(a.prazoAlvo) : '—'}</td>
    </tr>`;
  }).join('');

  const atividades = (base.atividades || []).slice(0, 12).map((at) =>
    `<li><div>${esc(at.texto)}</div><div class="q">${fmtData(at.data)}</div></li>`).join('');

  const primeiraVez = !base.assignments.length && !base.candidatos.length && !base.clientes.length;

  const primeiroNome = (eu && eu.nome || '').split(' ')[0];

  return `
  ${cabecalho('Visão geral', 'Painel',
    `Bom trabalho, ${esc(primeiroNome)}. ${abertos.length} busca${abertos.length === 1 ? '' : 's'} em andamento.`,
    seEdita(`<button class="btn" data-acao="novoAssignment">+ Novo assignment</button>
      <button class="btn btn-sec" data-acao="novoCandidatoLinkedIn">+ Profissional</button>`))}

  ${primeiraVez ? `<div class="cartao" style="margin-bottom:16px">
    <div class="eyebrow" style="margin-bottom:8px">Primeira vez por aqui</div>
    <h2>Comece com um exemplo</h2>
    <p class="subtexto">Um cliente, um assignment e três profissionais fictícios, para você entender o
    fluxo antes de cadastrar os seus.</p>
    <div class="linha" style="margin-top:14px">
      <button class="btn" data-acao="carregarExemplo">Carregar dados de exemplo</button>
      <button class="btn btn-sec" data-acao="novoAssignment">Começar do zero</button>
    </div></div>` : ''}

  <div class="grade g4" style="margin-bottom:18px">
    <div class="kpi"><div class="n">${abertos.length}</div><div class="r">assignments abertos</div></div>
    <div class="kpi"><div class="n">${base.candidatos.length}</div><div class="r">profissionais no banco</div></div>
    <div class="kpi"><div class="n">${emProcesso}</div><div class="r">em processo ativo</div></div>
    <div class="kpi destaque"><div class="n">${contratados}</div><div class="r">contratados</div></div>
  </div>

  <div class="cartao">
    <h2>Assignments abertos</h2>
    ${abertos.length ? `<div class="rolagem"><table><thead><tr><th>Posição</th><th>Consultor</th><th>Pipeline</th><th>Em aberto</th><th>Prazo</th></tr></thead><tbody>${linhasAssign}</tbody></table></div>`
      : '<div class="vazio">Nenhum assignment aberto.</div>'}
  </div>

  <div class="grade g2" style="margin-top:16px">
    <div class="cartao">
      <h2>Precisa de atenção <span class="tag tag-amarela">${parados.length}</span></h2>
      <div class="subtexto" style="margin-bottom:8px">Candidatos parados há ${DIAS_PARADO} dias ou mais na mesma etapa.</div>
      ${parados.length ? `<table><tbody>${parados.slice(0, 10).map(({ a, v, d }) => {
        const c = acharCandidato(v.candidatoId) || {};
        return `<tr class="clicavel" data-acao="abrirAssignment" data-id="${a.id}">
          <td><strong>${esc(c.nome || '—')}</strong><div class="subtexto">${esc(a.titulo)} · ${esc(v.etapa)}</div></td>
          <td style="text-align:right"><span class="tag tag-amarela">${d} d</span></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="subtexto">Tudo em dia.</div>'}
    </div>
    <div class="cartao">
      <h2>Últimas movimentações</h2>
      ${atividades ? `<ul class="timeline">${atividades}</ul>` : '<div class="subtexto">Sem movimentações ainda.</div>'}
    </div>
  </div>`;
}

/* ---------------------------- repetidores (listas de linhas) ---------------------------- */

const REPETIDORES = {};   // id do container -> definição dos campos

function linhaRepetidor(campos, valores) {
  valores = valores || {};
  const celulas = campos.map((c) => {
    if (c.tipo === 'select') {
      return `<select data-campo="${c.campo}" title="${esc(c.rotulo || c.campo)}">
        ${(c.opcoes || []).map((o) => `<option ${o === valores[c.campo] ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    }
    return `<input data-campo="${c.campo}" placeholder="${esc(c.placeholder || c.rotulo || '')}"
      value="${esc(valores[c.campo] || '')}"${c.largura ? ` style="flex:${c.largura}"` : ''}>`;
  }).join('');
  return `<div class="repetidor-linha">${celulas}
    <button class="btn btn-fantasma btn-mini" data-acao="removerLinha" title="Remover">✕</button></div>`;
}

function repetidor(id, campos, itens, textoBotao) {
  REPETIDORES[id] = campos;
  const linhas = (itens && itens.length ? itens : [{}]).map((v) => linhaRepetidor(campos, v)).join('');
  return `<div class="repetidor" id="${id}">${linhas}</div>
    <button class="btn btn-sec btn-mini" style="margin-top:8px" data-acao="addLinha" data-alvo="${id}">${esc(textoBotao)}</button>`;
}

acoes.addLinha = (el, d) => {
  const caixa = $('#' + d.alvo);
  caixa.insertAdjacentHTML('beforeend', linhaRepetidor(REPETIDORES[d.alvo], {}));
  ligarAcoes(caixa);
  const novo = caixa.lastElementChild.querySelector('input,select');
  if (novo) novo.focus();
};

function lerRepetidor(id) {
  const campos = REPETIDORES[id] || [];
  return $$('#' + id + ' .repetidor-linha').map((linha) => {
    const item = {};
    campos.forEach((c) => {
      const el = linha.querySelector(`[data-campo="${c.campo}"]`);
      item[c.campo] = el ? el.value.trim() : '';
    });
    return item;
  }).filter((item) => Object.values(item).some((v) => v));
}

const porVirgula = (texto) => String(texto || '').split(',').map((t) => t.trim()).filter(Boolean);
const porLinha = (texto) => String(texto || '').split('\n').map((t) => t.trim()).filter(Boolean);

/* ---------------------------- job spec ---------------------------- */

const CAMPOS_COMPETENCIA = [
  { campo: 'nome', placeholder: 'Competência / experiência (ex.: canal indireto)', largura: '3' },
  { campo: 'tipo', tipo: 'select', opcoes: ['Obrigatória', 'Desejável'] },
  { campo: 'anos', placeholder: 'Anos', largura: '0 0 80px' }
];
const CAMPOS_FORMACAO = [
  { campo: 'curso', placeholder: 'Curso (ex.: Engenharia de Produção)', largura: '3' },
  { campo: 'instituicao', placeholder: 'Onde estudou (ex.: USP, FGV)', largura: '2' },
  { campo: 'nivel', tipo: 'select', opcoes: NIVEIS_FORMACAO },
  { campo: 'exigencia', tipo: 'select', opcoes: ['Obrigatória', 'Desejável'] }
];
const CAMPOS_IDIOMA = [
  { campo: 'idioma', placeholder: 'Idioma', largura: '2' },
  { campo: 'nivel', tipo: 'select', opcoes: NIVEIS_IDIOMA },
  { campo: 'exigencia', tipo: 'select', opcoes: ['Obrigatório', 'Desejável'] }
];

function camposJobSpec(js) {
  js = Object.assign(jobSpecVazio(), js || {});
  return `
  <div class="campo"><label>Missão da posição</label>
    <textarea id="js-missao" placeholder="Por que a posição existe, a quem reporta, que time lidera">${esc(js.missao || '')}</textarea></div>
  <div class="campo"><label>Entregas esperadas (uma por linha)</label>
    <textarea id="js-entregas" placeholder="Ex.: dobrar a receita do canal indireto em 24 meses">${esc((js.entregas || []).join('\n'))}</textarea></div>

  <div class="campo"><label>Competências e experiências</label>
    ${repetidor('js-competencias', CAMPOS_COMPETENCIA, js.competencias, '+ Competência')}
    <div class="dica">O que estiver como <strong>obrigatória</strong> entra na busca do LinkedIn como filtro
      obrigatório; as desejáveis entram como alternativas.</div></div>

  <div class="campo"><label>Formação</label>
    ${repetidor('js-formacao', CAMPOS_FORMACAO, js.formacao, '+ Formação')}</div>

  <div class="campo"><label>Idiomas</label>
    ${repetidor('js-idiomas', CAMPOS_IDIOMA, js.idiomas, '+ Idioma')}</div>

  <div class="grade g2">
    <div class="campo"><label>Títulos de cargo a procurar</label>
      <input id="js-titulos" value="${esc((js.titulosAlvo || []).join(', '))}"
        placeholder="Diretor Comercial, Head of Sales, VP Vendas">
      <div class="dica">Separe por vírgula. É o primeiro bloco da busca no LinkedIn.</div></div>
    <div class="campo"><label>Praças / localizações</label>
      <input id="js-locais" value="${esc((js.localizacoes || []).join(', '))}" placeholder="São Paulo, Campinas"></div>
    <div class="campo"><label>Empresas-alvo (de onde vir)</label>
      <input id="js-empresas" value="${esc((js.empresasAlvo || []).join(', '))}" placeholder="Concorrentes e referências do setor"></div>
    <div class="campo"><label>Empresas a evitar (off-limits)</label>
      <input id="js-evitar" value="${esc((js.empresasEvitar || []).join(', '))}" placeholder="O próprio cliente, parceiros"></div>
  </div>
  <div class="campo"><label>Outras observações do job spec</label>
    <textarea id="js-obs">${esc(js.observacoes || '')}</textarea></div>`;
}

function lerJobSpec() {
  return {
    missao: $('#js-missao').value,
    entregas: porLinha($('#js-entregas').value),
    competencias: lerRepetidor('js-competencias'),
    formacao: lerRepetidor('js-formacao'),
    idiomas: lerRepetidor('js-idiomas'),
    titulosAlvo: porVirgula($('#js-titulos').value),
    localizacoes: porVirgula($('#js-locais').value),
    empresasAlvo: porVirgula($('#js-empresas').value),
    empresasEvitar: porVirgula($('#js-evitar').value),
    observacoes: $('#js-obs').value
  };
}

/**
 * Monta a busca booleana para o LinkedIn a partir do job spec:
 * títulos e obrigatórias entram com E, desejáveis entram como um bloco OU,
 * e as empresas off-limits saem com NOT.
 */
function buscaBooleana(a) {
  const js = a.jobSpec || {};
  const grupo = (lista) => {
    const itens = (lista || []).map((t) => String(t).trim()).filter(Boolean)
      .map((t) => (/\s/.test(t) ? `"${t}"` : t));
    if (!itens.length) return '';
    return itens.length === 1 ? itens[0] : '(' + itens.join(' OR ') + ')';
  };
  const blocos = [];
  const titulos = grupo(js.titulosAlvo && js.titulosAlvo.length ? js.titulosAlvo : [a.cargo].filter(Boolean));
  if (titulos) blocos.push(titulos);
  (js.competencias || []).filter((c) => c.tipo !== 'Desejável' && c.nome).forEach((c) => {
    blocos.push(grupo([c.nome]));
  });
  const desejaveis = (js.competencias || []).filter((c) => c.tipo === 'Desejável' && c.nome).map((c) => c.nome);
  if (desejaveis.length) blocos.push(grupo(desejaveis));
  const empresas = grupo(js.empresasAlvo);
  if (empresas) blocos.push(empresas);
  let busca = blocos.filter(Boolean).join(' AND ');
  const evitar = (js.empresasEvitar || []).filter(Boolean);
  if (evitar.length && busca) busca += ' NOT ' + grupo(evitar);
  return busca;
}

function linkBuscaLinkedIn(a) {
  const busca = buscaBooleana(a);
  if (!busca) return '';
  return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(busca);
}

/* ---------------------------- pacote de remuneração ---------------------------- */

const TIPOS_BONUS = {
  nenhum: 'Sem bônus',
  percentual: '% do salário',
  valor: 'Valor fixo',
  meses: 'Salários (nº de meses)'
};

/** Campos do pacote. O prefixo permite ter dois formulários na mesma tela. */
function camposPacote(pacote, prefixo) {
  const p = Object.assign(pacoteVazio(), pacote || {});
  const moeda = (base.configuracao || {}).moeda || 'R$';
  const beneficios = ((base.configuracao || {}).beneficios || []);
  const marcados = new Set(p.beneficios || []);
  const extras = (p.beneficios || []).filter((b) => !beneficios.includes(b));
  return `
  <div class="grade g3">
    <div class="campo"><label>Fixo mensal (${esc(moeda)})</label>
      <input id="${prefixo}-fixo-mes" inputmode="decimal" value="${esc(p.fixoMensal || '')}" placeholder="ex.: 45.000"></div>
    <div class="campo"><label>Fixo anual (${esc(moeda)})</label>
      <input id="${prefixo}-fixo-ano" inputmode="decimal" value="${esc(p.fixoAnual || '')}" placeholder="ex.: 585.000"></div>
    <div class="campo"><label>Tipo de bônus</label>
      <select id="${prefixo}-bonus-tipo">
        ${Object.keys(TIPOS_BONUS).map((k) => `<option value="${k}" ${k === (p.bonusTipo || 'percentual') ? 'selected' : ''}>${esc(TIPOS_BONUS[k])}</option>`).join('')}
      </select></div>
    <div class="campo"><label>Bônus (valor / % / meses)</label>
      <input id="${prefixo}-bonus-valor" value="${esc(p.bonusValor || '')}" placeholder="ex.: 40"></div>
    <div class="campo" style="grid-column:span 2"><label>Regra do bônus</label>
      <input id="${prefixo}-bonus-desc" value="${esc(p.bonusDescricao || '')}" placeholder="ex.: 60% metas da companhia, 40% individuais, pago em março"></div>
  </div>
  <div class="campo">
    <label>Benefícios</label>
    <div class="caixa-marcas" id="${prefixo}-beneficios">
      ${beneficios.map((b) => `<label class="marcador"><input type="checkbox" value="${esc(b)}" ${marcados.has(b) ? 'checked' : ''}> ${esc(b)}</label>`).join('')}
    </div>
    <input id="${prefixo}-beneficios-extra" style="margin-top:8px" value="${esc(extras.join(', '))}"
      placeholder="Outros benefícios, separados por vírgula">
  </div>
  <div class="grade g2">
    <div class="campo"><label>Participação / long term (opcional)</label>
      <input id="${prefixo}-outros" value="${esc(p.outros || '')}" placeholder="ex.: stock options com vesting de 4 anos"></div>
    <div class="campo"><label>Observação sobre o pacote</label>
      <input id="${prefixo}-obs" value="${esc(p.observacao || '')}"></div>
  </div>`;
}

function lerPacote(prefixo) {
  const marcados = $$(`#${prefixo}-beneficios input:checked`).map((i) => i.value);
  const extras = ($(`#${prefixo}-beneficios-extra`).value || '').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    fixoMensal: $(`#${prefixo}-fixo-mes`).value.trim(),
    fixoAnual: $(`#${prefixo}-fixo-ano`).value.trim(),
    bonusTipo: $(`#${prefixo}-bonus-tipo`).value,
    bonusValor: $(`#${prefixo}-bonus-valor`).value.trim(),
    bonusDescricao: $(`#${prefixo}-bonus-desc`).value.trim(),
    beneficios: marcados.concat(extras),
    outros: $(`#${prefixo}-outros`).value.trim(),
    observacao: $(`#${prefixo}-obs`).value.trim()
  };
}

/** Pacote em uma linha, para listas e relatórios. */
function resumoPacote(p) {
  if (!p) return '';
  const moeda = (base.configuracao || {}).moeda || 'R$';
  const partes = [];
  if (p.fixoMensal) partes.push(`${moeda} ${p.fixoMensal}/mês`);
  else if (p.fixoAnual) partes.push(`${moeda} ${p.fixoAnual}/ano`);
  if (p.bonusValor && p.bonusTipo !== 'nenhum') {
    if (p.bonusTipo === 'percentual') partes.push(`bônus ${p.bonusValor}%`);
    else if (p.bonusTipo === 'meses') partes.push(`bônus ${p.bonusValor} salários`);
    else partes.push(`bônus ${moeda} ${p.bonusValor}`);
  }
  if ((p.beneficios || []).length) partes.push(`${p.beneficios.length} benefícios`);
  if (!partes.length && p.observacao) return p.observacao;
  return partes.join(' · ');
}

function pacotePreenchido(p) {
  if (!p) return false;
  return !!(p.fixoMensal || p.fixoAnual || p.bonusValor || (p.beneficios || []).length || p.outros || p.observacao);
}

/* ---------------------------- assignments ---------------------------- */

function telaAssignments() {
  const filtro = (telaAssignments.filtro || '').toLowerCase();
  const situacao = telaAssignments.situacao || 'Aberto';
  const lista = base.assignments.filter((a) => {
    if (situacao !== 'Todos' && a.status !== situacao) return false;
    if (!filtro) return true;
    return (a.titulo + ' ' + nomeCliente(a.clienteId) + ' ' + (a.cargo || '')).toLowerCase().includes(filtro);
  });

  const linhas = lista.map((a) => {
    const mapa = contagemPorEtapa(a);
    const ativos = (a.candidatos || []).filter((v) => (v.situacao || 'Ativo') === 'Ativo').length;
    return `<tr class="clicavel" data-acao="abrirAssignment" data-id="${a.id}">
      <td><strong>${esc(a.titulo)}</strong><div class="subtexto">${esc(a.cargo || '')} ${a.localizacao ? '· ' + esc(a.localizacao) : ''}</div></td>
      <td>${esc(nomeCliente(a.clienteId))}</td>
      <td><span class="tag ${a.status === 'Aberto' ? 'tag-azul' : a.status === 'Concluído' ? 'tag-verde' : 'tag-cinza'}">${esc(a.status)}</span></td>
      <td style="min-width:170px"><span class="num">${ativos}</span> ativos de <span class="num">${(a.candidatos || []).length}</span>${barraFunil(a)}</td>
      <td class="num">${fmtData(a.abertoEm)}</td>
    </tr>`;
  }).join('');

  return `
  ${cabecalho('Buscas', 'Assignments', 'Cada busca com o seu funil, do mapeamento à contratação.',
    seEdita('<button class="btn" data-acao="novoAssignment">+ Novo assignment</button>'))}
  <div class="cartao">
    <div class="linha" style="margin-bottom:14px">
      <input id="busca-assign" placeholder="Buscar por posição, cliente ou cargo" value="${esc(telaAssignments.filtro || '')}" style="max-width:340px" data-acao="filtrarAssignments">
      <select style="max-width:170px" data-acao="situacaoAssignments">
        ${['Aberto', 'Stand-by', 'Concluído', 'Cancelado', 'Todos'].map((s) =>
          `<option ${s === situacao ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    ${lista.length ? `<div class="rolagem"><table><thead><tr><th>Posição</th><th>Cliente</th><th>Status</th><th>Pipeline</th><th>Aberto em</th></tr></thead><tbody>${linhas}</tbody></table></div>`
      : '<div class="vazio">Nenhum assignment nesse filtro.</div>'}
  </div>`;
}

function formAssignment(a) {
  const novo = !a;
  a = a || {};
  const cfg = base.configuracao || configuracaoPadrao();
  const cliente = acharCliente(a.clienteId);
  const processoId = a.processoId || cfg.processoPadraoId;
  const etapas = a.etapas && a.etapas.length
    ? a.etapas
    : ((cfg.processos.find((pr) => pr.id === processoId) || cfg.processos[0]).etapas);
  const consultores = (base.usuarios || []).filter((u) => u.ativo !== false && u.papel !== 'leitura');

  return `
  <div class="abas" id="abas-assignment">
    <button class="ativo" data-acao="abaAssignment" data-aba="dados">Dados</button>
    <button data-acao="abaAssignment" data-aba="pacote">Pacote</button>
    <button data-acao="abaAssignment" data-aba="jobspec">Job spec</button>
    <button data-acao="abaAssignment" data-aba="processo">Processo</button>
  </div>

  <section data-painel="dados">
    <div class="grade g2">
      <div class="campo"><label>Posição / título do assignment *</label>
        <input id="f-titulo" value="${esc(a.titulo || '')}" placeholder="Ex.: Diretor Comercial LATAM"></div>
      <div class="campo"><label>Cliente</label>
        <select id="f-cliente" data-acao="trocouCliente">
          <option value="">— selecione —</option>
          ${base.clientes.map((c) => `<option value="${c.id}" ${c.id === a.clienteId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select></div>
      <div class="campo"><label>Ponto de contato no cliente</label>
        <select id="f-contato">${opcoesContato(cliente, a.contatoId)}</select>
        <div class="dica">Os contatos são cadastrados na ficha do cliente.</div></div>
      <div class="campo"><label>Consultor responsável</label>
        <select id="f-consultor">
          <option value="">— selecione —</option>
          ${consultores.map((u) => `<option value="${u.id}" ${u.id === (a.consultorId || (eu && novo ? eu.id : '')) ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}
        </select>
        <div class="dica">A lista vem dos usuários do sistema — quem trabalha a busca precisa ter acesso.</div></div>
      <div class="campo"><label>Cargo</label><input id="f-cargo" value="${esc(a.cargo || '')}"></div>
      <div class="campo"><label>Local</label><input id="f-local" value="${esc(a.localizacao || '')}"></div>
      <div class="campo"><label>Senioridade</label>
        <select id="f-senioridade"><option value="">—</option>
        ${SENIORIDADES.map((x) => `<option ${x === a.senioridade ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="campo"><label>Status</label>
        <select id="f-status">${STATUS_ASSIGNMENT.map((x) =>
          `<option ${x === (a.status || 'Aberto') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="campo"><label>Aberto em</label>
        <input id="f-abertura" type="date" value="${(a.abertoEm || hoje()).slice(0, 10)}"></div>
      <div class="campo"><label>Prazo alvo</label>
        <input id="f-prazo" type="date" value="${(a.prazoAlvo || '').slice(0, 10)}"></div>
    </div>
  </section>

  <section data-painel="pacote" class="escondido">
    ${cliente && pacotePreenchido(cliente.pacotePadrao) ? `<div class="linha" style="margin-bottom:14px">
      <button class="btn btn-sec btn-mini" data-acao="usarPacoteCliente" data-id="${cliente.id}">Usar o pacote padrão de ${esc(cliente.nome)}</button>
      <span class="dica">${esc(resumoPacote(cliente.pacotePadrao))}</span></div>` : ''}
    ${camposPacote(a.pacote, 'pk')}
    <label class="marcador" style="margin-top:6px"><input type="checkbox" id="f-salvar-pacote">
      Guardar este pacote como padrão do cliente</label>
  </section>

  <section data-painel="jobspec" class="escondido">
    ${camposJobSpec(a.jobSpec)}
  </section>

  <section data-painel="processo" class="escondido">
    <div class="campo"><label>Processo de seleção</label>
      <select id="f-processo" data-acao="trocouProcesso">
        ${cfg.processos.map((pr) => `<option value="${pr.id}" ${pr.id === processoId ? 'selected' : ''}>${esc(pr.nome)}</option>`).join('')}
        <option value="livre" ${processoId === 'livre' ? 'selected' : ''}>Etapas só desta busca</option>
      </select>
      <div class="dica">Escolher um processo preenche as etapas abaixo; a partir daí você ajusta o que quiser
        — a mudança vale só para este assignment.</div></div>
    <div class="campo"><label>Etapas, na ordem (uma por linha)</label>
      <textarea id="f-etapas" style="min-height:150px">${esc(etapas.join('\n'))}</textarea></div>
    <label class="marcador"><input type="checkbox" id="f-salvar-processo" data-acao="alternarNomeProcesso">
      Salvar estas etapas como um novo processo reutilizável</label>
    <div class="campo escondido" id="f-processo-nome-caixa" style="margin-top:10px">
      <label>Nome do novo processo</label><input id="f-processo-nome" placeholder="Ex.: Busca para conselho"></div>
    ${ehAdmin() ? '<div class="dica" style="margin-top:10px">Os processos padrão da consultoria ficam em <strong>Configurações</strong>.</div>' : ''}
  </section>

  <div class="linha" style="margin-top:18px">
    <button class="btn" data-acao="salvarAssignment" data-id="${a.id || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    ${a.id ? '<button class="btn btn-perigo espaco" data-acao="excluirAssignment" data-id="' + a.id + '">Excluir</button>' : ''}
  </div>`;
}

function opcoesContato(cliente, contatoId) {
  const contatos = (cliente && cliente.contatos) || [];
  if (!contatos.length) return '<option value="">— cliente sem contatos cadastrados —</option>';
  return '<option value="">— selecione —</option>' + contatos.map((k) =>
    `<option value="${k.id}" ${k.id === contatoId ? 'selected' : ''}>${esc(k.nome)}${k.cargo ? ' — ' + esc(k.cargo) : ''}</option>`).join('');
}

acoes.abaAssignment = (el, d) => {
  $$('#abas-assignment button').forEach((b) => b.classList.toggle('ativo', b === el));
  $$('#modal-corpo [data-painel]').forEach((p) => p.classList.toggle('escondido', p.dataset.painel !== d.aba));
};

acoes.trocouCliente = (el) => {
  const cliente = acharCliente(el.value);
  $('#f-contato').innerHTML = opcoesContato(cliente, '');
};

acoes.alternarNomeProcesso = (el) => {
  $('#f-processo-nome-caixa').classList.toggle('escondido', !el.checked);
};

acoes.trocouProcesso = (el) => {
  const cfg = base.configuracao || configuracaoPadrao();
  const processo = cfg.processos.find((pr) => pr.id === el.value);
  if (processo) $('#f-etapas').value = processo.etapas.join('\n');
};

acoes.usarPacoteCliente = (el, d) => {
  const cliente = acharCliente(d.id);
  if (!cliente || !cliente.pacotePadrao) return;
  const p = cliente.pacotePadrao;
  $('#pk-fixo-mes').value = p.fixoMensal || '';
  $('#pk-fixo-ano').value = p.fixoAnual || '';
  $('#pk-bonus-tipo').value = p.bonusTipo || 'percentual';
  $('#pk-bonus-valor').value = p.bonusValor || '';
  $('#pk-bonus-desc').value = p.bonusDescricao || '';
  $('#pk-outros').value = p.outros || '';
  $('#pk-obs').value = p.observacao || '';
  const marcados = new Set(p.beneficios || []);
  $$('#pk-beneficios input').forEach((i) => { i.checked = marcados.has(i.value); });
  const conhecidos = new Set(((base.configuracao || {}).beneficios) || []);
  $('#pk-beneficios-extra').value = (p.beneficios || []).filter((b) => !conhecidos.has(b)).join(', ');
  aviso('Pacote do cliente aplicado — ajuste o que for diferente nesta posição.');
};

acoes.novoAssignment = () => abrirModal('Novo assignment', formAssignment(null));
acoes.editarAssignment = (el, d) => abrirModal('Editar assignment', formAssignment(acharAssignment(d.id)));
acoes.fecharModal = () => fecharModal();
acoes.abrirAssignment = (el, d) => ir('#/assignment/' + d.id);

acoes.salvarAssignment = (el, d) => {
  const titulo = $('#f-titulo').value.trim();
  if (!titulo) { aviso('Dê um título para o assignment.'); return; }
  let a = d.id ? acharAssignment(d.id) : null;
  const novo = !a;
  if (novo) { a = { id: uid(), candidatos: [], criadoEm: hoje() }; base.assignments.push(a); }

  a.titulo = titulo;
  a.clienteId = $('#f-cliente').value;
  a.contatoId = $('#f-contato').value;
  a.consultorId = $('#f-consultor').value;
  const consultor = (base.usuarios || []).find((u) => u.id === a.consultorId);
  a.consultor = consultor ? consultor.nome : '';
  a.cargo = $('#f-cargo').value.trim();
  a.localizacao = $('#f-local').value.trim();
  a.senioridade = $('#f-senioridade').value;
  a.status = $('#f-status').value;
  a.abertoEm = $('#f-abertura').value || hoje();
  a.prazoAlvo = $('#f-prazo').value;
  a.pacote = lerPacote('pk');
  a.jobSpec = lerJobSpec();
  a.descricao = a.jobSpec.missao;          // compatível com o formato antigo
  a.etapas = porLinha($('#f-etapas').value);
  a.processoId = $('#f-processo').value;

  if ($('#f-salvar-pacote').checked && a.clienteId) {
    const cliente = acharCliente(a.clienteId);
    if (cliente) cliente.pacotePadrao = JSON.parse(JSON.stringify(a.pacote));
  }
  if ($('#f-salvar-processo').checked) {
    const nome = ($('#f-processo-nome').value || '').trim() || `Processo de ${titulo}`;
    base.configuracao.processos.push({ id: uid(), nome, etapas: a.etapas.slice() });
    aviso(`Processo "${nome}" guardado para reutilizar.`);
  }

  registrarAtividade('assignment', `${novo ? 'Assignment criado' : 'Assignment atualizado'}: ${a.titulo}`, { assignmentId: a.id });
  salvar(); fecharModal();
  if (novo) ir('#/assignment/' + a.id); else render();
};

acoes.excluirAssignment = (el, d) => {
  if (!confirm('Excluir este assignment e todo o pipeline dele?')) return;
  base.assignments = base.assignments.filter((a) => a.id !== d.id);
  salvar(); fecharModal(); ir('#/assignments'); render();
};

acoes.filtrarAssignments = (el) => { telaAssignments.filtro = el.value; render(); setTimeout(() => { const b = $('#busca-assign'); if (b) { b.focus(); b.selectionStart = b.value.length; } }, 0); };
acoes.situacaoAssignments = (el) => { telaAssignments.situacao = el.value; render(); };

/* ---------------------------- assignment: pipeline ---------------------------- */

function pontosFit(fit) {
  const n = Number(fit) || 0;
  if (!n) return '';
  return `<span class="fit" title="Aderência ${n} de 5">` +
    [1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('') + '</span>';
}

function fichaCandidato(a, v) {
  const c = acharCandidato(v.candidatoId) || { nome: '(removido)' };
  const d = diasDesde(v.etapaDesde || v.entrouEm);
  const parado = (v.situacao || 'Ativo') === 'Ativo' && d != null && d >= DIAS_PARADO;
  return `<article class="ficha ${parado ? 'parado' : ''}" draggable="true"
      data-candidato="${v.candidatoId}" data-assignment="${a.id}"
      data-acao="abrirVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">
    <div class="quem">
      <div class="avatar avatar-p">${esc(iniciais(c.nome))}</div>
      <div style="min-width:0">
        <strong>${esc(c.nome)}</strong>
        <div class="cargo">${esc(c.cargoAtual || c.headline || '')}${c.empresaAtual ? ' · ' + esc(c.empresaAtual) : ''}</div>
      </div>
    </div>
    <div class="rodape">
      ${pontosFit(v.fit)}
      ${v.situacao && v.situacao !== 'Ativo' ? `<span class="tag ${v.situacao === 'Contratado' ? 'tag-verde' : 'tag-vermelha'}">${esc(v.situacao)}</span>` : ''}
      ${d != null ? `<span class="dias" title="há ${d} dias nesta etapa">${d}d</span>` : ''}
    </div>
  </article>`;
}

function telaAssignment(id) {
  const a = acharAssignment(id);
  if (!a) return '<div class="vazio">Assignment não encontrado.</div>';
  const etapas = etapasDe(a);
  const ativos = (a.candidatos || []).filter((v) => ['Ativo', 'Contratado'].includes(v.situacao || 'Ativo'));
  const fora = (a.candidatos || []).filter((v) => !['Ativo', 'Contratado'].includes(v.situacao || 'Ativo'));

  // A cor da coluna caminha do azul frio ao verde: a matiz codifica o avanço.
  const colunas = etapas.map((e, i) => {
    const naEtapa = ativos.filter((v) => v.etapa === e);
    const matiz = Math.round(214 - (i / Math.max(1, etapas.length - 1)) * 66);
    return `<div class="coluna" data-etapa="${esc(e)}" data-assignment="${a.id}" style="--etapa-h:${matiz}">
      <h4><span>${esc(e)}</span><span class="qtd">${naEtapa.length}</span></h4>
      ${naEtapa.map((v) => fichaCandidato(a, v)).join('') || '<div class="nada">—</div>'}
    </div>`;
  }).join('');

  return `
  ${cabecalho(nomeCliente(a.clienteId), a.titulo,
    `<span class="tag ${a.status === 'Aberto' ? 'tag-azul' : 'tag-cinza'}">${esc(a.status)}</span>
     ${a.localizacao ? '<span class="tag">' + esc(a.localizacao) + '</span>' : ''}
     ${a.consultor ? '<span class="tag">' + esc(a.consultor) + '</span>' : ''}`,
    `${seEdita(`<button class="btn" data-acao="adicionarAoAssignment" data-id="${a.id}">+ Profissional</button>`)}
     <button class="btn btn-sec" data-acao="verRelatorioAssignment" data-id="${a.id}">Relatório</button>
     ${seEdita(`<button class="btn btn-fantasma" data-acao="editarAssignment" data-id="${a.id}">Editar</button>`)}`)}

  <div class="grade g4" style="margin-bottom:18px">
    <div class="kpi"><div class="n">${(a.candidatos || []).length}</div><div class="r">mapeados no total</div></div>
    <div class="kpi"><div class="n">${ativos.filter((v) => (v.situacao || 'Ativo') === 'Ativo').length}</div><div class="r">ativos no funil</div></div>
    <div class="kpi destaque"><div class="n">${(a.candidatos || []).filter((v) => v.etapa === 'Short list').length}</div><div class="r">na short list</div></div>
    <div class="kpi"><div class="n">${diasDesde(a.abertoEm) == null ? '—' : diasDesde(a.abertoEm)}</div><div class="r">dias em aberto</div></div>
  </div>

  ${blocoJobSpec(a)}

  <div class="linha" style="margin-bottom:10px">
    <h2>Pipeline</h2>
    <span class="subtexto">arraste as fichas entre as etapas</span>
  </div>
  <div class="kanban">${colunas}</div>

  ${fora.length ? `<div class="cartao"><h3>Fora do processo (${fora.length})</h3>
    <div class="rolagem"><table><tbody>${fora.map((v) => {
      const c = acharCandidato(v.candidatoId) || {};
      return `<tr class="clicavel" data-acao="abrirVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">
        <td><strong>${esc(c.nome || '—')}</strong><div class="subtexto">${esc(c.cargoAtual || '')}</div></td>
        <td><span class="tag tag-vermelha">${esc(v.situacao)}</span></td>
        <td class="subtexto">${esc(v.motivo || '')}</td></tr>`;
    }).join('')}</tbody></table></div></div>` : ''}`;
}

/** Job spec, pacote e busca no LinkedIn, na tela do assignment. */
function blocoJobSpec(a) {
  const js = a.jobSpec || {};
  const cliente = acharCliente(a.clienteId);
  const contato = ((cliente || {}).contatos || []).find((k) => k.id === a.contatoId);
  const busca = buscaBooleana(a);
  const obrig = (js.competencias || []).filter((c) => c.tipo !== 'Desejável');
  const desej = (js.competencias || []).filter((c) => c.tipo === 'Desejável');
  const listaComp = (lista) => lista.map((c) =>
    `<span class="tag">${esc(c.nome)}${c.anos ? ' · ' + esc(c.anos) + ' anos' : ''}</span>`).join(' ');

  const temSpec = js.missao || (js.entregas || []).length || (js.competencias || []).length ||
    (js.formacao || []).length || (js.idiomas || []).length;

  return `
  <div class="grade g2" style="margin-bottom:16px">
    <div class="cartao">
      <h3>Job spec</h3>
      ${js.missao ? `<p class="subtexto">${nl2br(js.missao)}</p>` : ''}
      ${(js.entregas || []).length ? `<h4 style="margin-top:14px">Entregas esperadas</h4>
        <ul class="lista-simples">${js.entregas.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      ${obrig.length ? `<h4 style="margin-top:14px">Obrigatórias</h4><div class="tags">${listaComp(obrig)}</div>` : ''}
      ${desej.length ? `<h4 style="margin-top:12px">Desejáveis</h4><div class="tags">${listaComp(desej)}</div>` : ''}
      ${(js.formacao || []).length ? `<h4 style="margin-top:14px">Formação</h4>
        <div class="tags">${js.formacao.map((f) => `<span class="tag">${esc([f.nivel, f.curso].filter(Boolean).join(' em '))}${f.instituicao ? ' · ' + esc(f.instituicao) : ''}</span>`).join(' ')}</div>` : ''}
      ${(js.idiomas || []).length ? `<h4 style="margin-top:12px">Idiomas</h4>
        <div class="tags">${js.idiomas.map((i) => `<span class="tag">${esc(i.idioma)} · ${esc(i.nivel || '')}</span>`).join(' ')}</div>` : ''}
      ${!temSpec ? `<div class="subtexto">Job spec ainda não detalhado.
        ${seEdita(`<a href="#" data-acao="editarAssignment" data-id="${a.id}">Preencher agora</a>`)}</div>` : ''}
    </div>

    <div class="pilha">
      <div class="cartao">
        <h3>Pacote</h3>
        ${pacotePreenchido(a.pacote) ? tabelaPacote(a.pacote) : '<div class="subtexto">Pacote não definido.</div>'}
      </div>
      <div class="cartao">
        <h3>Cliente e time</h3>
        <table><tbody>
          <tr><th>Cliente</th><td>${esc((cliente || {}).nome || '—')}</td></tr>
          <tr><th>Contato</th><td>${contato
            ? `<strong>${esc(contato.nome)}</strong>${contato.cargo ? ' — ' + esc(contato.cargo) : ''}
               <div class="subtexto">${esc(contato.email || '')}${contato.telefone ? ' · ' + esc(contato.telefone) : ''}</div>`
            : '<span class="subtexto">nenhum contato definido</span>'}</td></tr>
          <tr><th>Consultor</th><td>${esc(a.consultor || '—')}</td></tr>
          <tr><th>Processo</th><td>${esc(nomeProcesso(a))} · ${etapasDe(a).length} etapas</td></tr>
        </tbody></table>
      </div>
    </div>
  </div>

  ${busca ? `<div class="cartao" style="margin-bottom:16px">
    <div class="linha" style="margin-bottom:10px">
      <h3 style="margin:0">Busca no LinkedIn</h3>
      <span class="subtexto">gerada a partir do job spec</span>
      <div class="espaco"></div>
      <button class="btn btn-sec btn-mini" data-acao="copiarBusca" data-id="${a.id}">Copiar</button>
      <a class="btn btn-mini" href="${esc(linkBuscaLinkedIn(a))}" target="_blank" rel="noopener">Abrir no LinkedIn</a>
    </div>
    <code class="busca" id="busca-${a.id}">${esc(busca)}</code>
    <div class="dica">Cole na busca de pessoas do LinkedIn (ou clique em abrir). Depois de achar o perfil,
      use <strong>+ Profissional</strong> para trazer os dados para cá.</div>
  </div>` : ''}`;
}

function tabelaPacote(p) {
  const moeda = (base.configuracao || {}).moeda || 'R$';
  const linhas = [];
  if (p.fixoMensal) linhas.push(['Fixo mensal', `${moeda} ${p.fixoMensal}`]);
  if (p.fixoAnual) linhas.push(['Fixo anual', `${moeda} ${p.fixoAnual}`]);
  if (p.bonusValor && p.bonusTipo !== 'nenhum') {
    const valor = p.bonusTipo === 'percentual' ? p.bonusValor + '%'
      : p.bonusTipo === 'meses' ? p.bonusValor + ' salários' : moeda + ' ' + p.bonusValor;
    linhas.push(['Bônus', valor + (p.bonusDescricao ? ` <span class="subtexto">— ${esc(p.bonusDescricao)}</span>` : '')]);
  }
  if (p.outros) linhas.push(['Longo prazo', esc(p.outros)]);
  if (p.observacao) linhas.push(['Observação', esc(p.observacao)]);
  return `<table><tbody>${linhas.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>
    ${(p.beneficios || []).length ? `<div class="tags" style="margin-top:12px">${p.beneficios.map((b) => `<span class="tag">${esc(b)}</span>`).join(' ')}</div>` : ''}`;
}

function nomeProcesso(a) {
  const cfg = base.configuracao || configuracaoPadrao();
  const pr = cfg.processos.find((x) => x.id === a.processoId);
  return pr ? pr.nome : 'Etapas próprias desta busca';
}

acoes.copiarBusca = (el, d) => copiar($('#busca-' + d.id).textContent);

function ligarKanban() {
  let arrastando = null;
  $$('.ficha').forEach((f) => {
    f.addEventListener('dragstart', (e) => {
      arrastando = { cid: f.dataset.candidato, aid: f.dataset.assignment };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', f.dataset.candidato); } catch (_) {}
    });
  });
  $$('.coluna').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('destino'); });
    col.addEventListener('dragleave', () => col.classList.remove('destino'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('destino');
      if (!arrastando) return;
      moverEtapa(arrastando.aid, arrastando.cid, col.dataset.etapa);
      arrastando = null;
    });
  });
}

function moverEtapa(assignmentId, candidatoId, etapa, obs) {
  const a = acharAssignment(assignmentId);
  if (!a) return;
  const v = (a.candidatos || []).find((x) => x.candidatoId === candidatoId);
  if (!v || v.etapa === etapa) return;
  const c = acharCandidato(candidatoId) || {};
  v.historico = v.historico || [];
  v.historico.push({ etapa, data: hoje(), de: v.etapa, obs: obs || '' });
  v.etapa = etapa;
  v.etapaDesde = hoje();
  if (etapa === 'Contratado') v.situacao = 'Contratado';
  registrarAtividade('etapa', `${c.nome || 'Candidato'} → ${etapa} (${a.titulo})`, { assignmentId: a.id, candidatoId });
  salvar();
  render();
}

acoes.verRelatorioAssignment = (el, d) => ir('#/relatorio/assignment/' + d.id);

/* ---- vínculo candidato x assignment ---- */

function formVinculo(a, v) {
  const c = acharCandidato(v.candidatoId) || {};
  const etapas = etapasDe(a);
  const hist = (v.historico || []).slice().reverse().map((h) =>
    `<li><div>${esc(h.de || '—')} → <strong>${esc(h.etapa)}</strong>${h.obs ? ' — ' + esc(h.obs) : ''}</div><div class="q">${fmtData(h.data)}</div></li>`).join('');
  const notas = (v.notas || []).slice().reverse().map((n) =>
    `<li><div>${nl2br(n.texto)}</div><div class="q">${fmtData(n.data)}${n.autor ? ' · ' + esc(n.autor) : ''}</div></li>`).join('');

  return `
  <div class="linha" style="margin-bottom:10px">
    <div><strong style="font-size:16px">${esc(c.nome || '—')}</strong>
      <div class="subtexto">${esc(c.cargoAtual || '')}${c.empresaAtual ? ' · ' + esc(c.empresaAtual) : ''}</div></div>
    <div class="espaco"></div>
    <button class="btn btn-fantasma" data-acao="abrirCandidato" data-cid="${v.candidatoId}">Ver perfil completo</button>
  </div>
  <div class="grade g3">
    <div class="campo"><label>Etapa</label>
      <select id="v-etapa">${etapas.map((e) => `<option ${e === v.etapa ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
    <div class="campo"><label>Situação</label>
      <select id="v-situacao">${SITUACOES.map((s) => `<option ${s === (v.situacao || 'Ativo') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="campo"><label>Aderência (fit)</label>
      <select id="v-fit"><option value="">—</option>${[1, 2, 3, 4, 5].map((n) =>
        `<option ${String(n) === String(v.fit) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  </div>
  <div class="campo"><label>Motivo / observação da situação (ex.: por que saiu do processo)</label>
    <input id="v-motivo" value="${esc(v.motivo || '')}"></div>
  <div class="campo"><label>Parecer do consultor sobre este candidato para esta posição</label>
    <textarea id="v-parecer">${esc(v.parecer || '')}</textarea></div>
  <div class="linha" style="margin-bottom:14px">
    <button class="btn" data-acao="salvarVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    <button class="btn btn-perigo espaco" data-acao="removerVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">Tirar do processo</button>
  </div>
  <div class="campo"><label>Nova anotação (contato, entrevista, feedback do cliente…)</label>
    <textarea id="v-nota" placeholder="Ex.: Falei por telefone. Aberto a conversar, pretensão R$ ..."></textarea>
    <button class="btn btn-sec btn-mini" style="margin-top:6px" data-acao="addNotaVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">Adicionar anotação</button></div>
  ${notas ? `<h4>Anotações</h4><ul class="timeline">${notas}</ul>` : ''}
  ${hist ? `<h4>Histórico de etapas</h4><ul class="timeline">${hist}</ul>` : ''}`;
}

acoes.abrirVinculo = (el, d) => {
  const a = acharAssignment(d.id);
  const v = (a.candidatos || []).find((x) => x.candidatoId === d.cid);
  if (!a || !v) return;
  abrirModal('Candidato no processo', formVinculo(a, v));
};

acoes.salvarVinculo = (el, d) => {
  const a = acharAssignment(d.id);
  const v = (a.candidatos || []).find((x) => x.candidatoId === d.cid);
  const novaEtapa = $('#v-etapa').value;
  if (novaEtapa !== v.etapa) {
    v.historico = v.historico || [];
    v.historico.push({ etapa: novaEtapa, de: v.etapa, data: hoje() });
    v.etapa = novaEtapa;
    v.etapaDesde = hoje();
  }
  v.situacao = $('#v-situacao').value;
  v.fit = $('#v-fit').value;
  v.motivo = $('#v-motivo').value.trim();
  v.parecer = $('#v-parecer').value;
  const c = acharCandidato(v.candidatoId) || {};
  registrarAtividade('pipeline', `${c.nome || 'Candidato'} · ${v.etapa} · ${v.situacao} (${a.titulo})`, { assignmentId: a.id, candidatoId: v.candidatoId });
  salvar(); fecharModal(); render();
};

acoes.addNotaVinculo = (el, d) => {
  const a = acharAssignment(d.id);
  const v = (a.candidatos || []).find((x) => x.candidatoId === d.cid);
  const texto = $('#v-nota').value.trim();
  if (!texto) return;
  v.notas = v.notas || [];
  v.notas.push({ data: hoje(), texto });
  const c = acharCandidato(v.candidatoId) || {};
  registrarAtividade('nota', `Anotação sobre ${c.nome || 'candidato'} em ${a.titulo}`, { assignmentId: a.id, candidatoId: v.candidatoId });
  salvar();
  abrirModal('Candidato no processo', formVinculo(a, v));
  aviso('Anotação registrada.');
};

acoes.removerVinculo = (el, d) => {
  if (!confirm('Tirar este candidato do processo? O perfil continua no banco.')) return;
  const a = acharAssignment(d.id);
  a.candidatos = (a.candidatos || []).filter((x) => x.candidatoId !== d.cid);
  salvar(); fecharModal(); render();
};

acoes.adicionarAoAssignment = (el, d) => {
  const a = acharAssignment(d.id);
  const jaTem = new Set((a.candidatos || []).map((v) => v.candidatoId));
  const html = `
    <div class="campo"><input id="busca-cand-modal" placeholder="Buscar no banco por nome, empresa, cargo ou competência" autofocus></div>
    <div id="resultado-busca"></div>
    <div class="linha" style="margin-top:12px">
      <button class="btn btn-sec" data-acao="novoCandidatoLinkedIn" data-id="${a.id}">Importar do LinkedIn</button>
      <button class="btn btn-fantasma" data-acao="novoCandidatoManual" data-id="${a.id}">Cadastrar manualmente</button>
    </div>`;
  abrirModal('Adicionar candidato ao assignment', html, () => {
    const campo = $('#busca-cand-modal');
    const pinta = () => {
      const q = campo.value.trim().toLowerCase();
      const achados = base.candidatos.filter((c) => {
        if (jaTem.has(c.id)) return false;
        if (!q) return true;
        return textoDoCandidato(c).includes(q);
      }).slice(0, 40);
      $('#resultado-busca').innerHTML = achados.length ? `<table><tbody>${achados.map((c) =>
        `<tr class="clicavel" data-acao="vincularCandidato" data-id="${a.id}" data-cid="${c.id}">
          <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.cargoAtual || c.headline || '')}${c.empresaAtual ? ' · ' + esc(c.empresaAtual) : ''}</div></td>
          <td style="text-align:right"><span class="tag tag-azul">adicionar</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="vazio">Nenhum profissional encontrado. Importe do LinkedIn ou cadastre manualmente.</div>';
      ligarAcoes($('#resultado-busca'));
    };
    campo.addEventListener('input', pinta);
    pinta();
  });
};

acoes.vincularCandidato = (el, d) => {
  const a = acharAssignment(d.id);
  const c = acharCandidato(d.cid);
  if (!a || !c) return;
  a.candidatos = a.candidatos || [];
  if (a.candidatos.some((v) => v.candidatoId === c.id)) { aviso('Já está no processo.'); return; }
  const etapa = etapasDe(a)[0];
  a.candidatos.push({
    candidatoId: c.id, etapa, entrouEm: hoje(), etapaDesde: hoje(),
    situacao: 'Ativo', historico: [{ etapa, data: hoje() }], notas: []
  });
  registrarAtividade('pipeline', `${c.nome} entrou em ${a.titulo} (${etapa})`, { assignmentId: a.id, candidatoId: c.id });
  salvar(); fecharModal(); render();
  aviso(`${c.nome} adicionado.`);
};

/* ---------------------------- candidatos ---------------------------- */

function textoDoCandidato(c) {
  return [c.nome, c.headline, c.cargoAtual, c.empresaAtual, c.localizacao, c.senioridade,
    (c.competencias || []).join(' '), (c.tags || []).join(' '), c.resumo,
    (c.experiencias || []).map((e) => e.cargo + ' ' + e.empresa).join(' ')]
    .join(' ').toLowerCase();
}

function telaCandidatos() {
  const q = (telaCandidatos.filtro || '').toLowerCase();
  const sen = telaCandidatos.senioridade || '';
  const lista = base.candidatos.filter((c) => {
    if (sen && c.senioridade !== sen) return false;
    return !q || textoDoCandidato(c).includes(q);
  }).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const linhas = lista.slice(0, 300).map((c) => {
    const procs = processosDoCandidato(c.id);
    const cons = (c.consentimento || {}).status;
    return `<tr class="clicavel" data-acao="abrirCandidato" data-cid="${c.id}">
      <td><div class="linha" style="gap:10px;flex-wrap:nowrap">
        <div class="avatar avatar-p">${esc(iniciais(c.nome))}</div>
        <div style="min-width:0"><strong>${esc(c.nome)}</strong>
          <div class="subtexto">${esc(c.headline || '')}</div></div>
      </div></td>
      <td>${esc(c.cargoAtual || '')}<div class="subtexto">${esc(c.empresaAtual || '')}</div></td>
      <td>${esc(c.localizacao || '—')}</td>
      <td>${procs.length ? procs.map((p) => `<span class="tag tag-azul">${esc(p.assignment.titulo)}</span>`).join(' ') : '<span class="subtexto">—</span>'}</td>
      <td>${cons === 'concedido' ? '<span class="tag tag-verde">consentimento ok</span>' :
        cons === 'negado' ? '<span class="tag tag-vermelha">recusou</span>' : '<span class="tag tag-amarela">pendente</span>'}</td>
      <td class="num subtexto">${fmtData(c.atualizadoEm || c.criadoEm)}</td>
    </tr>`;
  }).join('');

  return `
  ${cabecalho('Acervo', 'Profissionais', 'O banco que se reaproveita de uma busca para a outra.',
    `${seEdita('<button class="btn" data-acao="novoCandidatoLinkedIn">+ Importar do LinkedIn</button>')}
     ${seEdita('<button class="btn btn-sec" data-acao="novoCandidatoManual">+ Manual</button>')}
     <button class="btn btn-fantasma" data-acao="exportarCandidatosCSV">CSV</button>`)}
  <div class="cartao">
    <div class="linha" style="margin-bottom:14px">
      <input id="busca-cand" placeholder="Buscar por nome, empresa, cargo, competência…" value="${esc(telaCandidatos.filtro || '')}" style="max-width:380px" data-acao="filtrarCandidatos">
      <select style="max-width:180px" data-acao="filtrarSenioridade">
        <option value="">Toda senioridade</option>
        ${SENIORIDADES.map((s) => `<option ${s === sen ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <span class="subtexto espaco">${lista.length} profissiona${lista.length === 1 ? 'l' : 'is'}</span>
    </div>
    ${lista.length ? `<div class="rolagem"><table><thead><tr><th>Nome</th><th>Posição atual</th><th>Local</th><th>Processos</th><th>LGPD</th><th>Atualizado</th></tr></thead><tbody>${linhas}</tbody></table></div>`
      : '<div class="vazio">Banco vazio. Importe um perfil do LinkedIn para começar.</div>'}
  </div>`;
}

acoes.filtrarCandidatos = (el) => {
  telaCandidatos.filtro = el.value; render();
  setTimeout(() => { const b = $('#busca-cand'); if (b) { b.focus(); b.selectionStart = b.value.length; } }, 0);
};
acoes.filtrarSenioridade = (el) => { telaCandidatos.senioridade = el.value; render(); };
acoes.abrirCandidato = (el, d) => { fecharModal(); ir('#/candidato/' + d.cid); };

function telaCandidato(id) {
  const c = acharCandidato(id);
  if (!c) return '<div class="vazio">Profissional não encontrado.</div>';
  const procs = processosDoCandidato(c.id);
  const cons = c.consentimento || {};

  const exp = (c.experiencias || []).map((e) => `<li>
    <div><strong>${esc(e.cargo || '')}</strong>${e.empresa ? ' — ' + esc(e.empresa) : ''}</div>
    <div class="q">${esc(e.periodo || '')}</div>
    ${e.descricao ? `<div class="subtexto">${nl2br(e.descricao)}</div>` : ''}</li>`).join('');
  const form = (c.formacao || []).map((f) => `<li>
    <div><strong>${esc(f.instituicao || '')}</strong></div>
    <div class="subtexto">${esc(f.curso || '')}</div><div class="q">${esc(f.periodo || '')}</div></li>`).join('');
  const notas = (c.notas || []).slice().reverse().map((n) =>
    `<li><div>${nl2br(n.texto)}</div><div class="q">${fmtData(n.data)}</div></li>`).join('');

  return `
  ${cabecalho(c.empresaAtual || 'Profissional', c.nome, esc(c.headline || c.cargoAtual || ''),
    `${seEdita(`<button class="btn" data-acao="editarCandidato" data-cid="${c.id}">Editar</button>`)}
     ${seEdita(`<button class="btn btn-sec" data-acao="atualizarPeloLinkedIn" data-cid="${c.id}">Atualizar pelo LinkedIn</button>`)}
     ${seEdita(`<button class="btn btn-sec" data-acao="linkAtualizacao" data-cid="${c.id}">Link de atualização</button>`)}
     <button class="btn btn-fantasma" data-acao="verRelatorioCandidato" data-cid="${c.id}">Relatório</button>`)}

  <div class="grade g2">
    <div class="cartao">
      <h3>Dados</h3>
      <table><tbody>
        <tr><th>Posição atual</th><td>${esc(c.cargoAtual || '—')}${c.empresaAtual ? ' — ' + esc(c.empresaAtual) : ''}</td></tr>
        <tr><th>Local</th><td>${esc(c.localizacao || '—')}</td></tr>
        <tr><th>Senioridade</th><td>${esc(c.senioridade || '—')}</td></tr>
        <tr><th>E-mail</th><td>${esc(c.email || '—')}</td></tr>
        <tr><th>Telefone</th><td>${esc(c.telefone || '—')}</td></tr>
        <tr><th>LinkedIn</th><td>${c.linkedinUrl ? `<a href="${esc(c.linkedinUrl)}" target="_blank" rel="noopener">${esc(c.linkedinUrl)}</a>` : '—'}</td></tr>
        <tr><th>Remuneração</th><td>${esc((c.remuneracao || {}).atual || '—')} ${((c.remuneracao || {}).pretendida) ? ' · pretensão: ' + esc(c.remuneracao.pretendida) : ''}</td></tr>
        <tr><th>Disponibilidade</th><td>${esc(c.disponibilidade || '—')}</td></tr>
        <tr><th>Fonte</th><td>${esc(c.fonte || '—')}</td></tr>
        <tr><th>Atualizado</th><td>${fmtData(c.atualizadoEm || c.criadoEm)}</td></tr>
      </tbody></table>
      <div style="margin-top:10px">
        ${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span> `).join('')}
      </div>
    </div>

    <div class="cartao">
      <h3>LGPD</h3>
      <div class="linha" style="margin-bottom:8px">
        ${cons.status === 'concedido' ? '<span class="tag tag-verde">consentimento concedido</span>' :
          cons.status === 'negado' ? '<span class="tag tag-vermelha">titular recusou</span>' :
          '<span class="tag tag-amarela">sem registro de consentimento</span>'}
      </div>
      <div class="subtexto">
        ${cons.data ? `Registrado em ${fmtData(cons.data)}.<br>` : ''}
        ${cons.base ? `Base legal: ${esc(cons.base)}.<br>` : ''}
        ${cons.origem ? `Origem: ${esc(cons.origem)}.` : ''}
      </div>
      <div class="linha" style="margin-top:14px">
        ${seEdita(`<button class="btn btn-sec btn-mini" data-acao="registrarConsentimento" data-cid="${c.id}">Registrar consentimento</button>`)}
        ${seEdita(`<button class="btn btn-perigo btn-mini" data-acao="excluirCandidato" data-cid="${c.id}">Excluir dados</button>`)}
      </div>
      <h3 style="margin-top:16px">Processos (${procs.length})</h3>
      ${procs.length ? `<table><tbody>${procs.map((p) =>
        `<tr class="clicavel" data-acao="abrirAssignment" data-id="${p.assignment.id}">
          <td><strong>${esc(p.assignment.titulo)}</strong><div class="subtexto">${esc(nomeCliente(p.assignment.clienteId))}</div></td>
          <td style="text-align:right"><span class="tag tag-azul">${esc(p.vinculo.etapa)}</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="subtexto">Não está em nenhum processo.</div>'}
    </div>
  </div>

  ${c.resumo ? `<div class="cartao"><h3>Resumo</h3><div class="subtexto">${nl2br(c.resumo)}</div></div>` : ''}
  ${exp ? `<div class="cartao"><h3>Experiência</h3><ul class="timeline">${exp}</ul></div>` : ''}
  ${form ? `<div class="cartao"><h3>Formação</h3><ul class="timeline">${form}</ul></div>` : ''}
  ${(c.competencias || []).length ? `<div class="cartao"><h3>Competências</h3>${c.competencias.map((s) => `<span class="tag">${esc(s)}</span> `).join('')}</div>` : ''}
  ${(c.idiomas || []).length ? `<div class="cartao"><h3>Idiomas</h3>${c.idiomas.map((s) => `<span class="tag">${esc(s)}</span> `).join('')}</div>` : ''}

  <div class="cartao">
    <h3>Anotações do consultor</h3>
    ${seEdita(`<div class="campo"><textarea id="c-nota" placeholder="Registro de conversa, referências, motivações…"></textarea>
      <button class="btn btn-sec btn-mini" style="margin-top:8px" data-acao="addNotaCandidato" data-cid="${c.id}">Adicionar</button></div>`)}
    ${notas ? `<ul class="timeline">${notas}</ul>` : '<div class="subtexto">Sem anotações.</div>'}
  </div>`;
}

acoes.addNotaCandidato = (el, d) => {
  const c = acharCandidato(d.cid);
  const texto = $('#c-nota').value.trim();
  if (!texto) return;
  c.notas = c.notas || [];
  c.notas.push({ data: hoje(), texto });
  registrarAtividade('nota', `Anotação sobre ${c.nome}`, { candidatoId: c.id });
  salvar(); render();
};

acoes.verRelatorioCandidato = (el, d) => ir('#/relatorio/candidato/' + d.cid);

/* ---- formulário de candidato ---- */

function formCandidato(c) {
  c = c || {};
  const r = c.remuneracao || {};
  return `
  <div class="grade g2">
    <div class="campo"><label>Nome *</label><input id="c-nome" value="${esc(c.nome || '')}"></div>
    <div class="campo"><label>Headline / resumo de uma linha</label><input id="c-headline" value="${esc(c.headline || '')}"></div>
    <div class="campo"><label>Cargo atual</label><input id="c-cargo" value="${esc(c.cargoAtual || '')}"></div>
    <div class="campo"><label>Empresa atual</label><input id="c-empresa" value="${esc(c.empresaAtual || '')}"></div>
    <div class="campo"><label>Local</label><input id="c-local" value="${esc(c.localizacao || '')}"></div>
    <div class="campo"><label>Senioridade</label><select id="c-senioridade"><option value="">—</option>
      ${SENIORIDADES.map((s) => `<option ${s === c.senioridade ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="campo"><label>E-mail</label><input id="c-email" value="${esc(c.email || '')}"></div>
    <div class="campo"><label>Telefone</label><input id="c-telefone" value="${esc(c.telefone || '')}"></div>
    <div class="campo"><label>LinkedIn (URL)</label><input id="c-linkedin" value="${esc(c.linkedinUrl || '')}"></div>
    <div class="campo"><label>Disponibilidade / momento de carreira</label><input id="c-disponibilidade" value="${esc(c.disponibilidade || '')}"></div>
    <div class="campo"><label>Remuneração atual</label><input id="c-remun" value="${esc(r.atual || '')}"></div>
    <div class="campo"><label>Pretensão</label><input id="c-pretensao" value="${esc(r.pretendida || '')}"></div>
  </div>
  <div class="campo"><label>Resumo</label><textarea id="c-resumo">${esc(c.resumo || '')}</textarea></div>
  <div class="campo"><label>Competências (separadas por vírgula)</label>
    <input id="c-competencias" value="${esc((c.competencias || []).join(', '))}"></div>
  <div class="campo"><label>Idiomas (separados por vírgula)</label>
    <input id="c-idiomas" value="${esc((c.idiomas || []).join(', '))}"></div>
  <div class="campo"><label>Tags internas (setor, praça, "não abordar", etc.)</label>
    <input id="c-tags" value="${esc((c.tags || []).join(', '))}"></div>
  <div class="campo"><label>Experiência — uma por linha, no formato: Cargo | Empresa | Período</label>
    <textarea id="c-exp">${esc((c.experiencias || []).map((e) => [e.cargo, e.empresa, e.periodo].join(' | ')).join('\n'))}</textarea></div>
  <div class="campo"><label>Formação — uma por linha: Instituição | Curso | Período</label>
    <textarea id="c-form">${esc((c.formacao || []).map((f) => [f.instituicao, f.curso, f.periodo].join(' | ')).join('\n'))}</textarea></div>
  <div class="campo"><label>Fonte dos dados (importante para LGPD)</label>
    <input id="c-fonte" value="${esc(c.fonte || 'perfil público do LinkedIn')}"></div>
  <div class="linha">
    <button class="btn" data-acao="salvarCandidato" data-cid="${c.id || ''}" data-assign="${c._assignmentDestino || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
  </div>`;
}

function listaDeLinhas(valor, campos) {
  return valor.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split('|').map((s) => s.trim());
    const o = {};
    campos.forEach((k, i) => { o[k] = p[i] || ''; });
    return o;
  });
}

acoes.novoCandidatoManual = (el, d) => {
  abrirModal('Novo profissional', formCandidato({ _assignmentDestino: (d && d.id) || '' }));
};
acoes.editarCandidato = (el, d) => abrirModal('Editar profissional', formCandidato(acharCandidato(d.cid)));

acoes.salvarCandidato = (el, d) => {
  const nome = $('#c-nome').value.trim();
  if (!nome) { aviso('O nome é obrigatório.'); return; }
  let c = d.cid ? acharCandidato(d.cid) : null;
  const novo = !c;
  if (novo) { c = { id: uid(), criadoEm: hoje(), notas: [] }; base.candidatos.push(c); }
  c.nome = nome;
  c.headline = $('#c-headline').value.trim();
  c.cargoAtual = $('#c-cargo').value.trim();
  c.empresaAtual = $('#c-empresa').value.trim();
  c.localizacao = $('#c-local').value.trim();
  c.senioridade = $('#c-senioridade').value;
  c.email = $('#c-email').value.trim();
  c.telefone = $('#c-telefone').value.trim();
  c.linkedinUrl = $('#c-linkedin').value.trim();
  c.disponibilidade = $('#c-disponibilidade').value.trim();
  c.remuneracao = { atual: $('#c-remun').value.trim(), pretendida: $('#c-pretensao').value.trim() };
  c.resumo = $('#c-resumo').value;
  c.competencias = $('#c-competencias').value.split(',').map((s) => s.trim()).filter(Boolean);
  c.idiomas = $('#c-idiomas').value.split(',').map((s) => s.trim()).filter(Boolean);
  c.tags = $('#c-tags').value.split(',').map((s) => s.trim()).filter(Boolean);
  // O formulário mostra só Cargo|Empresa|Período; local e descrição já
  // importados continuam guardados quando a linha não muda.
  c.experiencias = listaDeLinhas($('#c-exp').value, ['cargo', 'empresa', 'periodo'])
    .map((e, i) => {
      const antiga = (c.experiencias || [])[i];
      return antiga && antiga.cargo === e.cargo && antiga.empresa === e.empresa
        ? Object.assign({}, antiga, e) : e;
    });
  c.formacao = listaDeLinhas($('#c-form').value, ['instituicao', 'curso', 'periodo']);
  c.fonte = $('#c-fonte').value.trim();
  c.atualizadoEm = hoje();
  registrarAtividade('candidato', `${novo ? 'Perfil cadastrado' : 'Perfil atualizado'}: ${c.nome}`, { candidatoId: c.id });
  salvar();
  fecharModal();
  if (d.assign) { acoes.vincularCandidato(null, { id: d.assign, cid: c.id }); return; }
  if (novo) ir('#/candidato/' + c.id); else render();
};

acoes.excluirCandidato = (el, d) => {
  const c = acharCandidato(d.cid);
  if (!confirm(`Excluir definitivamente os dados de ${c.nome}? (direito de eliminação — LGPD art. 18)`)) return;
  base.candidatos = base.candidatos.filter((x) => x.id !== c.id);
  base.assignments.forEach((a) => { a.candidatos = (a.candidatos || []).filter((v) => v.candidatoId !== c.id); });
  registrarAtividade('lgpd', `Dados de ${c.nome} eliminados`);
  salvar(); ir('#/candidatos'); render();
};

acoes.registrarConsentimento = (el, d) => {
  const c = acharCandidato(d.cid);
  const html = `
    <div class="campo"><label>Situação</label><select id="k-status">
      <option value="concedido">Consentimento concedido pelo titular</option>
      <option value="negado">Titular recusou / pediu remoção</option>
      <option value="pendente">Pendente</option></select></div>
    <div class="campo"><label>Base legal</label><select id="k-base">
      <option>consentimento do titular (art. 7º, I — LGPD)</option>
      <option>legítimo interesse do controlador (art. 7º, IX — LGPD)</option>
      <option>execução de contrato / procedimentos preliminares (art. 7º, V — LGPD)</option></select></div>
    <div class="campo"><label>Como foi obtido</label>
      <input id="k-origem" placeholder="Ex.: e-mail de 12/03, WhatsApp, portal de atualização"></div>
    <div class="campo"><label>Observação</label><textarea id="k-obs"></textarea></div>
    <div class="linha"><button class="btn" data-acao="salvarConsentimento" data-cid="${c.id}">Salvar</button>
      <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button></div>`;
  abrirModal('Registro de consentimento (LGPD)', html);
};

acoes.salvarConsentimento = (el, d) => {
  const c = acharCandidato(d.cid);
  c.consentimento = {
    status: $('#k-status').value,
    base: $('#k-base').value,
    origem: $('#k-origem').value.trim(),
    observacao: $('#k-obs').value.trim(),
    data: hoje()
  };
  registrarAtividade('lgpd', `Consentimento (${c.consentimento.status}) registrado para ${c.nome}`, { candidatoId: c.id });
  salvar(); fecharModal(); render();
};

/* ---------------------------- importação do LinkedIn ---------------------------- */

function telaImportacao(assignmentId, candidatoId) {
  const c = candidatoId ? acharCandidato(candidatoId) : null;
  return `
  ${c ? `<p class="subtexto">Atualizando o perfil de <strong>${esc(c.nome)}</strong> — você revisa antes de gravar.</p>` : ''}

  <div class="campo">
    <label>1. Link do perfil no LinkedIn</label>
    <div class="linha" style="flex-wrap:nowrap">
      <input id="li-url" placeholder="https://www.linkedin.com/in/..." value="${esc((c && c.linkedinUrl) || '')}">
      <button class="btn" data-acao="carregarPorUrl" data-assign="${assignmentId || ''}" data-cid="${candidatoId || ''}">Carregar</button>
    </div>
    <div class="dica" id="li-url-msg">O sistema tenta ler a página pública do perfil. O LinkedIn recusa a maior
      parte dessas leituras — quando recusar, use um dos dois caminhos abaixo, que sempre funcionam.</div>
  </div>

  <details class="bloco-dobra" open>
    <summary>2. Colar o perfil (o caminho que sempre funciona)</summary>
    <p class="subtexto" style="margin-top:10px">Abra o perfil no LinkedIn, selecione a página inteira
      (<strong>Ctrl/Cmd + A</strong>), copie (<strong>Ctrl/Cmd + C</strong>) e cole aqui. Vale também o texto
      do PDF que o LinkedIn gera em <em>Mais → Salvar em PDF</em>, ou um currículo.</p>
    <div class="campo"><textarea id="li-texto" style="min-height:190px" placeholder="Cole aqui o perfil copiado…"></textarea></div>
    <div class="linha">
      <button class="btn" data-acao="processarLinkedIn" data-assign="${assignmentId || ''}" data-cid="${candidatoId || ''}">Ler perfil</button>
      <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    </div>
  </details>

  <details class="bloco-dobra">
    <summary>3. Capturar com um clique (bookmarklet)</summary>
    <p class="subtexto" style="margin-top:10px">Arraste o botão abaixo para a barra de favoritos do navegador.
      Depois, estando no perfil do LinkedIn, clique nele: ele copia o perfil já limpo, e você volta aqui e cola.
      É o mesmo princípio da extensão que os sistemas grandes usam — só que sem instalar nada.</p>
    <p><a class="btn btn-sec" href="${esc(bookmarkletCaptura())}"
      onclick="return false" draggable="true">📋 Capturar perfil</a></p>
    <div class="dica">Se o navegador não deixar arrastar, crie um favorito qualquer, edite e cole o endereço deste botão.</div>
  </details>

  <p class="subtexto" style="margin-top:16px">
    <strong>Por que não sincroniza sozinho:</strong> o LinkedIn não abre API pública de perfis e proíbe leitura
    automática — sincronizar sem o profissional saber, além de violar os termos, é frágil de sustentar diante da
    LGPD. Para manter o cadastro vivo, use o <em>link de atualização</em> na ficha do profissional: ele mesmo
    confirma os dados e o consentimento.</p>`;
}

/** Bookmarklet: extrai o texto do perfil aberto e copia para a área de transferência. */
function bookmarkletCaptura() {
  const codigo = `(function(){
    if(!/linkedin\\.com/.test(location.host)){alert('Abra um perfil do LinkedIn e clique de novo.');return;}
    var alvo=document.querySelector('main')||document.body;
    var t=alvo.innerText.split('\\n').map(function(l){return l.trim();})
      .filter(function(l,i,a){return l&&l!==a[i-1];}).join('\\n');
    t=location.href.split('?')[0]+'\\n'+t;
    navigator.clipboard.writeText(t).then(function(){
      alert('Perfil copiado! Volte ao Sistema de Recrutamento e cole no campo de importação.');
    },function(){
      var c=document.createElement('textarea');c.value=t;document.body.appendChild(c);c.select();
      document.execCommand('copy');c.remove();alert('Perfil copiado!');
    });
  })()`;
  return 'javascript:' + encodeURIComponent(codigo.replace(/\s*\n\s*/g, ''));
}

acoes.carregarPorUrl = async (el, d) => {
  const url = $('#li-url').value.trim();
  const msg = $('#li-url-msg');
  if (!url) { aviso('Cole o link do perfil.'); return; }
  if (modoLocal) {
    msg.innerHTML = '<strong>Sem servidor não dá para buscar o link.</strong> Use o passo 2 (colar) ou o 3 (bookmarklet). ' +
      'Na versão com servidor, o sistema tenta ler a página pública.';
    return;
  }
  el.disabled = true;
  msg.textContent = 'Consultando o LinkedIn…';
  try {
    const r = await fetch('api/linkedin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok || !resp.texto) {
      msg.innerHTML = `<strong>${esc(resp.erro || 'O LinkedIn não devolveu o perfil.')}</strong>
        É o comportamento normal dele com quem não está logado — siga pelo passo 2 ou 3 abaixo, que trazem o
        mesmo resultado.`;
      el.disabled = false;
      return;
    }
    $('#li-texto').value = resp.texto;
    msg.textContent = 'Perfil lido. Confira o resultado na próxima tela.';
    acoes.processarLinkedIn(el, { assign: d.assign, cid: d.cid, url });
  } catch (e) {
    msg.textContent = 'Não consegui falar com o servidor.';
  }
  el.disabled = false;
};

acoes.novoCandidatoLinkedIn = (el, d) => abrirModal('Importar perfil do LinkedIn', telaImportacao((d && d.id) || '', ''));
acoes.atualizarPeloLinkedIn = (el, d) => abrirModal('Atualizar pelo LinkedIn', telaImportacao('', d.cid));

acoes.processarLinkedIn = (el, d) => {
  const texto = $('#li-texto').value;
  if (!texto.trim()) { aviso('Cole o texto do perfil primeiro.'); return; }
  const p = importarLinkedIn(texto);
  const antigo = d.cid ? acharCandidato(d.cid) : null;
  const mesclado = Object.assign({}, antigo || {}, {
    nome: p.nome || (antigo && antigo.nome) || '',
    headline: p.headline || (antigo && antigo.headline) || '',
    cargoAtual: p.cargoAtual || (antigo && antigo.cargoAtual) || '',
    empresaAtual: p.empresaAtual || (antigo && antigo.empresaAtual) || '',
    localizacao: p.localizacao || (antigo && antigo.localizacao) || '',
    linkedinUrl: p.linkedinUrl || (d.url || '') || (antigo && antigo.linkedinUrl) || '',
    email: p.email || (antigo && antigo.email) || '',
    telefone: p.telefone || (antigo && antigo.telefone) || '',
    resumo: p.resumo || (antigo && antigo.resumo) || '',
    experiencias: p.experiencias.length ? p.experiencias : (antigo && antigo.experiencias) || [],
    formacao: p.formacao.length ? p.formacao : (antigo && antigo.formacao) || [],
    competencias: p.competencias.length ? p.competencias : (antigo && antigo.competencias) || [],
    idiomas: p.idiomas.length ? p.idiomas : (antigo && antigo.idiomas) || [],
    fonte: 'perfil público do LinkedIn (importado em ' + fmtData(hoje()) + ')',
    _assignmentDestino: d.assign || ''
  });

  const achados = [
    p.nome && 'nome', p.headline && 'headline', p.localizacao && 'localização',
    p.experiencias.length && `${p.experiencias.length} experiência(s)`,
    p.formacao.length && `${p.formacao.length} formação(ões)`,
    p.competencias.length && `${p.competencias.length} competência(s)`,
    p.linkedinUrl && 'URL do perfil'
  ].filter(Boolean).join(', ');

  abrirModal('Revisar antes de gravar',
    `<div class="cartao" style="margin-bottom:12px"><strong>Li do texto colado:</strong> ${esc(achados || 'pouca coisa — confira e complete abaixo')}.
     <div class="subtexto">Corrija o que veio torto: o LinkedIn muda o layout com frequência, então a leitura é sempre uma ajuda, não uma verdade absoluta.</div></div>`
    + formCandidato(mesclado));
};

/* ---- link de atualização (portal do candidato) ---- */

acoes.linkAtualizacao = (el, d) => {
  const c = acharCandidato(d.cid);
  if (modoLocal) {
    abrirModal('Link de atualização', `<p>O link de atualização precisa do servidor rodando
      (<code>node server.js</code>), porque é o servidor que recebe a resposta do profissional.</p>
      <div class="linha"><button class="btn btn-fantasma" data-acao="fecharModal">Fechar</button></div>`);
    return;
  }
  if (!c.tokenPortal) { c.tokenPortal = uid().replace(/-/g, ''); salvar(); }
  const url = location.origin + '/portal/' + c.tokenPortal;
  const texto = `Olá, ${c.nome.split(' ')[0]}! Estamos com uma posição que pode fazer sentido para o seu momento. ` +
    `Para eu trabalhar com dados corretos e com o seu consentimento, dá uma olhada e confirma seu perfil aqui: ${url}`;
  abrirModal('Link de atualização do profissional', `
    <p class="subtexto">Envie este link ao profissional. Ele revisa os próprios dados, autoriza o uso
    (registro de consentimento LGPD) e pode pedir a exclusão. O que ele enviar entra direto no sistema.</p>
    <div class="campo"><label>Link</label><input id="p-url" value="${esc(url)}" readonly></div>
    <div class="campo"><label>Mensagem sugerida</label><textarea id="p-msg" style="min-height:80px">${esc(texto)}</textarea></div>
    <div class="linha">
      <button class="btn" data-acao="copiarLink">Copiar link</button>
      <button class="btn btn-sec" data-acao="copiarMensagem">Copiar mensagem</button>
      <button class="btn btn-fantasma" data-acao="fecharModal">Fechar</button>
    </div>
    <p class="subtexto" style="margin-top:10px">Vale só para quem tem o link. Para invalidá-lo, gere um novo.</p>`);
};

function copiar(valor) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(valor).then(() => aviso('Copiado.'), () => aviso('Copie manualmente.'));
  } else { aviso('Copie manualmente.'); }
}
acoes.copiarLink = () => copiar($('#p-url').value);
acoes.copiarMensagem = () => copiar($('#p-msg').value);

/* ---------------------------- clientes ---------------------------- */

function telaClientes() {
  const linhas = base.clientes.map((c) => {
    const abertos = base.assignments.filter((a) => a.clienteId === c.id && a.status === 'Aberto').length;
    const todos = base.assignments.filter((a) => a.clienteId === c.id).length;
    const contatos = c.contatos || [];
    return `<tr class="clicavel" data-acao="editarCliente" data-id="${c.id}">
      <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.setor || '')}</div></td>
      <td>${contatos.length
        ? contatos.slice(0, 3).map((k) => `<div>${esc(k.nome)}${k.cargo ? ' <span class="subtexto">· ' + esc(k.cargo) + '</span>' : ''}</div>`).join('') +
          (contatos.length > 3 ? `<div class="subtexto">+${contatos.length - 3}</div>` : '')
        : '<span class="subtexto">sem contatos</span>'}</td>
      <td class="num">${abertos} de ${todos}</td>
    </tr>`;
  }).join('');
  return `
  ${cabecalho('Carteira', 'Clientes', 'As empresas contratantes e quem responde por cada busca.',
    seEdita('<button class="btn" data-acao="novoCliente">+ Novo cliente</button>'))}
  <div class="cartao">
    ${base.clientes.length ? `<div class="rolagem"><table><thead><tr><th>Empresa</th><th>Contatos</th><th>Abertos / total</th></tr></thead><tbody>${linhas}</tbody></table></div>`
      : '<div class="vazio">Nenhum cliente cadastrado.</div>'}
  </div>`;
}

function linhaContato(k) {
  k = k || {};
  return `<div class="contato-linha" data-id="${k.id || uid()}">
    <input placeholder="Nome" data-campo="nome" value="${esc(k.nome || '')}">
    <input placeholder="Cargo" data-campo="cargo" value="${esc(k.cargo || '')}">
    <input placeholder="E-mail" data-campo="email" value="${esc(k.email || '')}">
    <input placeholder="Telefone" data-campo="telefone" value="${esc(k.telefone || '')}">
    <button class="btn btn-fantasma btn-mini" data-acao="removerLinha" title="Remover contato">✕</button>
  </div>`;
}

function formCliente(c) {
  c = c || {};
  const pacote = c.pacotePadrao || pacoteVazio();
  const contatos = (c.contatos || []).length ? c.contatos : [{ id: uid() }];
  return `
  <div class="grade g2">
    <div class="campo"><label>Empresa *</label><input id="cl-nome" value="${esc(c.nome || '')}"></div>
    <div class="campo"><label>Setor</label><input id="cl-setor" value="${esc(c.setor || '')}"></div>
  </div>

  <div class="campo">
    <label>Contatos na empresa</label>
    <div id="cl-contatos" class="repetidor">${contatos.map(linhaContato).join('')}</div>
    <button class="btn btn-sec btn-mini" style="margin-top:8px" data-acao="addContato">+ Adicionar contato</button>
    <div class="dica">Em cada assignment você escolhe qual desses contatos é o ponto focal da busca.</div>
  </div>

  <details class="bloco-dobra">
    <summary>Pacote típico desta empresa (opcional)</summary>
    <div class="dica" style="margin:10px 0 12px">Serve de ponto de partida quando você abrir um assignment
      para este cliente — dá para ajustar posição a posição.</div>
    ${camposPacote(pacote, 'clp')}
  </details>

  <div class="campo" style="margin-top:14px"><label>Observações</label><textarea id="cl-obs">${esc(c.obs || '')}</textarea></div>
  <div class="linha">
    <button class="btn" data-acao="salvarCliente" data-id="${c.id || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    ${c.id ? `<button class="btn btn-perigo espaco" data-acao="excluirCliente" data-id="${c.id}">Excluir</button>` : ''}
  </div>`;
}

acoes.addContato = () => {
  const caixa = $('#cl-contatos');
  caixa.insertAdjacentHTML('beforeend', linhaContato({ id: uid() }));
  ligarAcoes(caixa);
  const ultima = caixa.lastElementChild.querySelector('input');
  if (ultima) ultima.focus();
};

acoes.removerLinha = (el) => {
  const linha = el.closest('.contato-linha, .repetidor-linha');
  if (linha) linha.remove();
};

function lerContatos() {
  return $$('#cl-contatos .contato-linha').map((linha) => {
    const pega = (campo) => (linha.querySelector(`[data-campo="${campo}"]`) || {}).value || '';
    return {
      id: linha.dataset.id, nome: pega('nome').trim(), cargo: pega('cargo').trim(),
      email: pega('email').trim(), telefone: pega('telefone').trim()
    };
  }).filter((k) => k.nome || k.email || k.telefone);
}

acoes.novoCliente = () => abrirModal('Novo cliente', formCliente(null));
acoes.editarCliente = (el, d) => abrirModal('Editar cliente', formCliente(acharCliente(d.id)));
acoes.salvarCliente = (el, d) => {
  const nome = $('#cl-nome').value.trim();
  if (!nome) { aviso('Informe o nome da empresa.'); return; }
  let c = d.id ? acharCliente(d.id) : null;
  if (!c) { c = { id: uid(), criadoEm: hoje() }; base.clientes.push(c); }
  c.nome = nome;
  c.setor = $('#cl-setor').value.trim();
  c.contatos = lerContatos();
  c.pacotePadrao = lerPacote('clp');
  c.obs = $('#cl-obs').value;
  salvar(); fecharModal(); render();
};
acoes.excluirCliente = (el, d) => {
  if (base.assignments.some((a) => a.clienteId === d.id)) { aviso('Há assignments ligados a este cliente.'); return; }
  if (!confirm('Excluir cliente?')) return;
  base.clientes = base.clientes.filter((c) => c.id !== d.id);
  salvar(); fecharModal(); render();
};

/* ---------------------------- relatórios ---------------------------- */

function telaRelatorios() {
  return `
  ${cabecalho('Saídas', 'Relatórios', 'Para mandar ao cliente, arquivar no dossiê ou abrir no Excel.')}
  <div class="grade g2">
    <div class="cartao">
      <h3>Progresso do assignment</h3>
      <p class="subtexto">Status do funil, conversão entre etapas, tempo médio e o que aconteceu desde a última conversa com o cliente.</p>
      ${base.assignments.length ? `<table><tbody>${base.assignments.map((a) =>
        `<tr class="clicavel" data-acao="verRelatorioAssignment" data-id="${a.id}">
          <td><strong>${esc(a.titulo)}</strong><div class="subtexto">${esc(nomeCliente(a.clienteId))}</div></td>
          <td style="text-align:right"><span class="tag tag-azul">abrir</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="subtexto">Nenhum assignment ainda.</div>'}
    </div>
    <div class="cartao">
      <h3>Relatório do candidato</h3>
      <p class="subtexto">Perfil completo, histórico nos processos e pareceres — para enviar ao cliente ou arquivar.</p>
      <div class="campo"><input id="rel-busca-cand" placeholder="Buscar profissional…"></div>
      <div id="rel-lista"></div>
    </div>
  </div>
  <div class="cartao">
    <h3>Exportações</h3>
    <div class="linha">
      <button class="btn btn-sec" data-acao="exportarCandidatosCSV">Candidatos (CSV)</button>
      <button class="btn btn-sec" data-acao="exportarPipelineCSV">Pipeline completo (CSV)</button>
      <button class="btn btn-sec" data-acao="exportarBackup">Backup completo (JSON)</button>
    </div>
    <p class="subtexto" style="margin-top:8px">Os CSVs abrem direto no Excel (separador ponto e vírgula).</p>
  </div>`;
}

function ligarBuscaRelatorio() {
  const campo = $('#rel-busca-cand');
  if (!campo) return;
  const pinta = () => {
    const q = campo.value.trim().toLowerCase();
    const achados = base.candidatos
      .filter((c) => !q || textoDoCandidato(c).includes(q))
      .slice(0, 25);
    $('#rel-lista').innerHTML = achados.length ? `<table><tbody>${achados.map((c) =>
      `<tr class="clicavel" data-acao="verRelatorioCandidato" data-cid="${c.id}">
        <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.cargoAtual || '')}</div></td>
        <td style="text-align:right"><span class="tag tag-azul">abrir</span></td></tr>`).join('')}</tbody></table>`
      : '<div class="subtexto">Nada encontrado.</div>';
    ligarAcoes($('#rel-lista'));
  };
  campo.addEventListener('input', pinta);
  pinta();
}

function tempoMedioPorEtapa(a) {
  const soma = {}; const qtd = {};
  (a.candidatos || []).forEach((v) => {
    const h = (v.historico || []).slice().sort((x, y) => new Date(x.data) - new Date(y.data));
    h.forEach((entrada, i) => {
      const fim = h[i + 1] ? new Date(h[i + 1].data) : new Date();
      const dias = Math.max(0, Math.round((fim - new Date(entrada.data)) / 86400000));
      soma[entrada.etapa] = (soma[entrada.etapa] || 0) + dias;
      qtd[entrada.etapa] = (qtd[entrada.etapa] || 0) + 1;
    });
  });
  const media = {};
  Object.keys(soma).forEach((e) => { media[e] = Math.round(soma[e] / qtd[e]); });
  return media;
}

function passaramPor(a, etapa) {
  return (a.candidatos || []).filter((v) =>
    v.etapa === etapa || (v.historico || []).some((h) => h.etapa === etapa)).length;
}

function relatorioAssignment(id) {
  const a = acharAssignment(id);
  if (!a) return '<div class="vazio">Assignment não encontrado.</div>';
  const etapas = etapasDe(a);
  const medias = tempoMedioPorEtapa(a);
  const total = (a.candidatos || []).length;

  const linhasFunil = etapas.map((e, i) => {
    const passaram = passaramPor(a, e);
    const agora = (a.candidatos || []).filter((v) => v.etapa === e).length;
    const anterior = i === 0 ? total : passaramPor(a, etapas[i - 1]);
    const conv = i > 0 && anterior ? Math.round((passaram / anterior) * 100) + '%' : '—';
    const doTotal = total ? Math.round((passaram / total) * 100) + '%' : '—';
    return `<tr><td>${esc(e)}</td><td>${passaram}</td><td>${agora}</td>
      <td>${conv}</td><td>${doTotal}</td><td>${medias[e] != null ? medias[e] + ' d' : '—'}</td></tr>`;
  }).join('');

  const emProcesso = (a.candidatos || [])
    .filter((v) => ['Ativo', 'Contratado'].includes(v.situacao || 'Ativo'))
    .sort((x, y) => etapas.indexOf(y.etapa) - etapas.indexOf(x.etapa));

  const linhasCand = emProcesso.map((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    return `<tr>
      <td><strong>${esc(c.nome || '—')}</strong><div class="subtexto">${esc(c.cargoAtual || '')}${c.empresaAtual ? ' — ' + esc(c.empresaAtual) : ''}</div></td>
      <td>${esc(v.etapa)}</td>
      <td>${v.fit ? pontosFit(v.fit) : '—'}</td>
      <td class="num">${diasDesde(v.etapaDesde || v.entrouEm)} d</td>
      <td class="subtexto">${esc((v.parecer || '').slice(0, 220))}</td></tr>`;
  }).join('');

  const fora = (a.candidatos || []).filter((v) => ['Declinou', 'Descartado', 'Stand-by'].includes(v.situacao));
  const linhasFora = fora.map((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    return `<tr><td>${esc(c.nome || '—')}</td><td>${esc(v.situacao)}</td><td class="subtexto">${esc(v.motivo || '')}</td></tr>`;
  }).join('');

  const movs = (base.atividades || []).filter((at) => at.assignmentId === a.id).slice(0, 15)
    .map((at) => `<li>${esc(at.texto)} <span class="q">— ${fmtData(at.data)}</span></li>`).join('');

  return `
  <div class="linha nao-imprime" style="margin-bottom:12px">
    <button class="btn btn-fantasma" data-acao="voltarAssignment" data-id="${a.id}">← Voltar</button>
    <div class="espaco"></div>
    <button class="btn" data-acao="imprimir">Imprimir / PDF</button>
    <button class="btn btn-sec" data-acao="copiarRelatorio">Copiar como texto</button>
    <button class="btn btn-sec" data-acao="exportarAssignmentCSV" data-id="${a.id}">CSV</button>
  </div>
  <div class="relatorio" id="area-relatorio">
    <h1>Relatório de progresso — ${esc(a.titulo)}</h1>
    <p class="subtexto">${esc(nomeCliente(a.clienteId))}${a.localizacao ? ' · ' + esc(a.localizacao) : ''}
      ${a.consultor ? ' · Consultor: ' + esc(a.consultor) : ''}${contatoDoAssignment(a) ? ' · Contato: ' + esc(contatoDoAssignment(a).nome) : ''}<br>
      Aberto em ${fmtData(a.abertoEm)} (${diasDesde(a.abertoEm)} dias) ·
      Status: ${esc(a.status)}${a.prazoAlvo ? ' · Prazo alvo: ' + fmtData(a.prazoAlvo) : ''}<br>
      Emitido em ${fmtData(hoje())}</p>

    <h2>Resumo</h2>
    <table><tbody>
      <tr><th>Profissionais mapeados</th><td class="num">${total}</td></tr>
      <tr><th>Em processo ativo</th><td class="num">${(a.candidatos || []).filter((v) => (v.situacao || 'Ativo') === 'Ativo').length}</td></tr>
      <tr><th>Na short list</th><td class="num">${passaramPor(a, 'Short list')}</td></tr>
      <tr><th>Fora do processo</th><td class="num">${fora.length}</td></tr>
      <tr><th>Contratados</th><td class="num">${(a.candidatos || []).filter((v) => v.situacao === 'Contratado').length}</td></tr>
    </tbody></table>

    <h2>Funil</h2>
    <div class="rolagem"><table><thead><tr><th>Etapa</th><th>Passaram</th><th>Estão agora</th><th>Conversão da anterior</th><th>% do total</th><th>Tempo médio</th></tr></thead>
      <tbody>${linhasFunil}</tbody></table></div>

    <h2>Candidatos em processo</h2>
    ${linhasCand ? `<div class="rolagem"><table><thead><tr><th>Profissional</th><th>Etapa</th><th>Fit</th><th>Na etapa há</th><th>Parecer</th></tr></thead><tbody>${linhasCand}</tbody></table></div>`
      : '<p class="subtexto">Nenhum candidato ativo.</p>'}

    ${linhasFora ? `<h2>Saíram do processo</h2><div class="rolagem"><table><thead><tr><th>Profissional</th><th>Situação</th><th>Motivo</th></tr></thead><tbody>${linhasFora}</tbody></table></div>` : ''}

    ${movs ? `<h2>Movimentações recentes</h2><ul>${movs}</ul>` : ''}

    ${blocoPosicaoRelatorio(a)}
  </div>`;
}

function contatoDoAssignment(a) {
  const cliente = acharCliente(a.clienteId);
  return ((cliente || {}).contatos || []).find((k) => k.id === a.contatoId) || null;
}

/** Job spec e pacote no fim do relatório de progresso. */
function blocoPosicaoRelatorio(a) {
  const js = a.jobSpec || {};
  const p = a.pacote || {};
  const comp = (tipo) => (js.competencias || []).filter((c) => (c.tipo || 'Obrigatória') === tipo)
    .map((c) => esc(c.nome) + (c.anos ? ` (${esc(c.anos)} anos)` : '')).join(' · ');
  const obrig = comp('Obrigatória');
  const desej = comp('Desejável');
  const partes = [];

  if (js.missao) partes.push(`<h2>A posição</h2><p>${nl2br(js.missao)}</p>`);
  if ((js.entregas || []).length) {
    partes.push(`<h2>Entregas esperadas</h2><ul>${js.entregas.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
  }
  if (obrig || desej || (js.formacao || []).length || (js.idiomas || []).length) {
    partes.push(`<h2>Perfil buscado</h2><table><tbody>
      ${obrig ? `<tr><th>Obrigatório</th><td>${obrig}</td></tr>` : ''}
      ${desej ? `<tr><th>Desejável</th><td>${desej}</td></tr>` : ''}
      ${(js.formacao || []).length ? `<tr><th>Formação</th><td>${js.formacao.map((f) =>
        esc([f.nivel, f.curso].filter(Boolean).join(' em ')) + (f.instituicao ? ' — ' + esc(f.instituicao) : '') +
        (f.exigencia ? ` <span class="subtexto">(${esc(f.exigencia)})</span>` : '')).join('<br>')}</td></tr>` : ''}
      ${(js.idiomas || []).length ? `<tr><th>Idiomas</th><td>${js.idiomas.map((i) =>
        esc(i.idioma) + (i.nivel ? ' — ' + esc(i.nivel) : '')).join('<br>')}</td></tr>` : ''}
      ${(js.empresasAlvo || []).length ? `<tr><th>Empresas-alvo</th><td>${esc(js.empresasAlvo.join(', '))}</td></tr>` : ''}
      ${(js.empresasEvitar || []).length ? `<tr><th>Off-limits</th><td>${esc(js.empresasEvitar.join(', '))}</td></tr>` : ''}
    </tbody></table>`);
  }
  if (pacotePreenchido(p)) partes.push(`<h2>Pacote</h2>${tabelaPacote(p)}`);
  return partes.join('');
}

function relatorioCandidato(id) {
  const c = acharCandidato(id);
  if (!c) return '<div class="vazio">Profissional não encontrado.</div>';
  const procs = processosDoCandidato(c.id);

  const exp = (c.experiencias || []).map((e) =>
    `<li><strong>${esc(e.cargo || '')}</strong>${e.empresa ? ' — ' + esc(e.empresa) : ''}
      <div class="subtexto">${esc(e.periodo || '')}</div>
      ${e.descricao ? `<div class="subtexto">${nl2br(e.descricao)}</div>` : ''}</li>`).join('');
  const form = (c.formacao || []).map((f) =>
    `<li><strong>${esc(f.instituicao || '')}</strong> — ${esc(f.curso || '')} <span class="subtexto">${esc(f.periodo || '')}</span></li>`).join('');

  const historico = procs.map((p) => {
    const h = (p.vinculo.historico || []).map((x) => `${esc(x.etapa)} (${fmtData(x.data)})`).join(' → ');
    return `<tr><td><strong>${esc(p.assignment.titulo)}</strong><div class="subtexto">${esc(nomeCliente(p.assignment.clienteId))}</div></td>
      <td>${esc(p.vinculo.etapa)} · ${esc(p.vinculo.situacao || 'Ativo')}</td>
      <td class="subtexto">${h}</td></tr>`;
  }).join('');

  const pareceres = procs.filter((p) => p.vinculo.parecer).map((p) =>
    `<li><strong>${esc(p.assignment.titulo)}</strong><div class="subtexto">${nl2br(p.vinculo.parecer)}</div></li>`).join('');
  const notas = (c.notas || []).slice().reverse().map((n) =>
    `<li>${nl2br(n.texto)} <span class="subtexto">— ${fmtData(n.data)}</span></li>`).join('');

  return `
  <div class="linha nao-imprime" style="margin-bottom:12px">
    <button class="btn btn-fantasma" data-acao="abrirCandidato" data-cid="${c.id}">← Voltar</button>
    <div class="espaco"></div>
    <button class="btn" data-acao="imprimir">Imprimir / PDF</button>
    <button class="btn btn-sec" data-acao="copiarRelatorio">Copiar como texto</button>
  </div>
  <div class="relatorio" id="area-relatorio">
    <h1>${esc(c.nome)}</h1>
    <p class="subtexto">${esc(c.cargoAtual || '')}${c.empresaAtual ? ' — ' + esc(c.empresaAtual) : ''}
      ${c.localizacao ? '<br>' + esc(c.localizacao) : ''}
      ${c.linkedinUrl ? '<br>' + esc(c.linkedinUrl) : ''}<br>
      Emitido em ${fmtData(hoje())} · Dados atualizados em ${fmtData(c.atualizadoEm || c.criadoEm)}</p>

    ${c.resumo ? `<h2>Resumo</h2><p>${nl2br(c.resumo)}</p>` : ''}
    ${exp ? `<h2>Experiência</h2><ul>${exp}</ul>` : ''}
    ${form ? `<h2>Formação</h2><ul>${form}</ul>` : ''}
    ${(c.competencias || []).length ? `<h2>Competências</h2><p>${esc(c.competencias.join(' · '))}</p>` : ''}
    ${(c.idiomas || []).length ? `<h2>Idiomas</h2><p>${esc(c.idiomas.join(' · '))}</p>` : ''}

    <h2>Remuneração e disponibilidade</h2>
    <div class="rolagem"><table><tbody>
      <tr><th>Atual</th><td>${esc((c.remuneracao || {}).atual || '—')}</td></tr>
      <tr><th>Pretensão</th><td>${esc((c.remuneracao || {}).pretendida || '—')}</td></tr>
      <tr><th>Disponibilidade</th><td>${esc(c.disponibilidade || '—')}</td></tr>
    </tbody></table></div>

    ${historico ? `<h2>Processos</h2><div class="rolagem"><table><thead><tr><th>Assignment</th><th>Situação</th><th>Trajetória</th></tr></thead><tbody>${historico}</tbody></table></div>` : ''}
    ${pareceres ? `<h2>Pareceres do consultor</h2><ul>${pareceres}</ul>` : ''}
    ${notas ? `<h2>Anotações</h2><ul>${notas}</ul>` : ''}

    <h2>Origem dos dados (LGPD)</h2>
    <p class="subtexto">Fonte: ${esc(c.fonte || 'não informada')}.
      Consentimento: ${esc((c.consentimento || {}).status || 'não registrado')}
      ${(c.consentimento || {}).data ? ' em ' + fmtData(c.consentimento.data) : ''}.
      ${(c.consentimento || {}).base ? 'Base legal: ' + esc(c.consentimento.base) + '.' : ''}</p>
  </div>`;
}

acoes.voltarAssignment = (el, d) => ir('#/assignment/' + d.id);
acoes.imprimir = () => window.print();
acoes.copiarRelatorio = () => {
  const area = $('#area-relatorio');
  const texto = area.innerText.replace(/\n{3,}/g, '\n\n');
  copiar(texto);
};

/* ---------------------------- exportações ---------------------------- */

acoes.exportarCandidatosCSV = () => {
  const linhas = [['Nome', 'Headline', 'Cargo atual', 'Empresa atual', 'Local', 'Senioridade',
    'E-mail', 'Telefone', 'LinkedIn', 'Competências', 'Consentimento', 'Fonte', 'Atualizado em']];
  base.candidatos.forEach((c) => linhas.push([c.nome, c.headline, c.cargoAtual, c.empresaAtual,
    c.localizacao, c.senioridade, c.email, c.telefone, c.linkedinUrl,
    (c.competencias || []).join(', '), (c.consentimento || {}).status || 'pendente', c.fonte,
    fmtData(c.atualizadoEm || c.criadoEm)]));
  baixar('candidatos.csv', '﻿' + csv(linhas), 'text/csv');
};

acoes.exportarPipelineCSV = () => {
  const linhas = [['Assignment', 'Cliente', 'Status assignment', 'Profissional', 'Etapa', 'Situação',
    'Fit', 'Dias na etapa', 'Entrou em', 'Motivo', 'Parecer']];
  base.assignments.forEach((a) => (a.candidatos || []).forEach((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    linhas.push([a.titulo, nomeCliente(a.clienteId), a.status, c.nome, v.etapa, v.situacao || 'Ativo',
      v.fit || '', diasDesde(v.etapaDesde || v.entrouEm), fmtData(v.entrouEm), v.motivo || '', v.parecer || '']);
  }));
  baixar('pipeline.csv', '﻿' + csv(linhas), 'text/csv');
};

acoes.exportarAssignmentCSV = (el, d) => {
  const a = acharAssignment(d.id);
  const linhas = [['Profissional', 'Empresa atual', 'Etapa', 'Situação', 'Fit', 'Dias na etapa', 'Parecer']];
  (a.candidatos || []).forEach((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    linhas.push([c.nome, c.empresaAtual, v.etapa, v.situacao || 'Ativo', v.fit || '',
      diasDesde(v.etapaDesde || v.entrouEm), v.parecer || '']);
  });
  baixar(`pipeline-${(a.titulo || 'assignment').replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
    '﻿' + csv(linhas), 'text/csv');
};

acoes.exportarBackup = () => {
  baixar(`backup-recrutamento-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(base, null, 2), 'application/json');
};

/* ---------------------------- backup / restauração / exemplo ---------------------------- */

acoes.abrirBackup = () => {
  abrirModal('Backup e dados', `
    <p class="subtexto">${!modoLocal
      ? 'Os dados ficam em <code>dados/base.json</code>, na pasta do projeto. O servidor guarda uma cópia diária em <code>dados/backups/</code>.'
      : window.RECRUTAMENTO_ONLINE
        ? 'Você está na <strong>versão online</strong>: dá para usar o sistema inteiro, e os dados ficam salvos neste navegador. Para a operação de verdade — base num arquivo seu, backup diário e o link de atualização do candidato — rode a versão local. <strong>Exporte o JSON com frequência.</strong>'
        : 'Você está no <strong>modo navegador</strong>: os dados ficam salvos apenas neste computador/navegador. Exporte com frequência.'}</p>
    <div class="linha" style="margin-bottom:14px">
      <button class="btn" data-acao="exportarBackup">Exportar tudo (JSON)</button>
      <button class="btn btn-sec" data-acao="exportarCandidatosCSV">Candidatos (CSV)</button>
      <button class="btn btn-sec" data-acao="exportarPipelineCSV">Pipeline (CSV)</button>
    </div>
    <div class="campo"><label>Restaurar de um arquivo JSON (substitui tudo)</label>
      <input type="file" id="b-arquivo" accept="application/json"></div>
    <div class="linha"><button class="btn btn-sec" data-acao="restaurarBackup">Restaurar</button></div>
    <hr style="border:0;border-top:1px solid var(--borda);margin:16px 0">
    <div class="linha">
      <button class="btn btn-fantasma" data-acao="carregarExemplo">Carregar dados de exemplo</button>
      <span class="subtexto">Cria um cliente, um assignment e três profissionais fictícios para você ver o sistema funcionando.</span>
    </div>`);
};

acoes.restaurarBackup = () => {
  const arq = $('#b-arquivo').files[0];
  if (!arq) { aviso('Escolha um arquivo.'); return; }
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(leitor.result);
      if (!dados || !Array.isArray(dados.candidatos)) throw new Error('formato inesperado');
      if (!confirm('Isso substitui todos os dados atuais. Continuar?')) return;
      base = Object.assign(baseVazia(), dados, { versao: base.versao });
      salvar(); fecharModal(); render();
      aviso('Backup restaurado.');
    } catch (e) { aviso('Arquivo inválido.'); }
  };
  leitor.readAsText(arq);
};

acoes.carregarExemplo = () => {
  if (base.candidatos.length || base.assignments.length) {
    if (!confirm('Já existem dados. Adicionar o exemplo mesmo assim?')) return;
  }
  const contatoRh = { id: uid(), nome: 'Marina Prado', cargo: 'Diretora de Gente', email: 'marina@exemplo.com', telefone: '(11) 3000-1000' };
  const contatoCeo = { id: uid(), nome: 'Paulo Serra', cargo: 'CEO', email: 'paulo@exemplo.com', telefone: '' };
  const cliente = {
    id: uid(), nome: 'Aurora Alimentos', setor: 'Bens de consumo', criadoEm: hoje(),
    contatos: [contatoRh, contatoCeo],
    pacotePadrao: {
      fixoMensal: '45.000', fixoAnual: '', bonusTipo: 'percentual', bonusValor: '40',
      bonusDescricao: '60% metas da companhia, 40% individuais',
      beneficios: ['Plano de saúde', 'Previdência privada', 'Carro / auxílio combustível', 'PLR'],
      outros: '', observacao: ''
    }
  };
  base.clientes.push(cliente);

  const modelos = [
    { nome: 'Camila Duarte', cargoAtual: 'Diretora Comercial', empresaAtual: 'Vitalis Foods', localizacao: 'São Paulo, SP', senioridade: 'Diretoria', competencias: ['Go-to-market', 'Trade marketing', 'Gestão de P&L'], etapa: 'Entrevista cliente', fit: '5' },
    { nome: 'Rogério Menezes', cargoAtual: 'Head de Vendas LATAM', empresaAtual: 'Nordeste Bebidas', localizacao: 'Recife, PE', senioridade: 'Gerência', competencias: ['Canal indireto', 'KAM', 'Expansão'], etapa: 'Entrevista consultor', fit: '4' },
    { nome: 'Ana Beatriz Lopes', cargoAtual: 'Gerente Nacional de Contas', empresaAtual: 'Grupo Serrano', localizacao: 'Curitiba, PR', senioridade: 'Gerência', competencias: ['Key accounts', 'Negociação', 'Varejo alimentar'], etapa: 'Mapeado', fit: '3' }
  ];

  const assignment = {
    id: uid(), titulo: 'Diretor(a) Comercial Brasil', clienteId: cliente.id,
    contatoId: contatoRh.id, consultorId: (eu || {}).id || '', consultor: (eu || {}).nome || 'Consultor',
    cargo: 'Diretor Comercial', localizacao: 'São Paulo, SP', senioridade: 'Diretoria',
    status: 'Aberto', abertoEm: new Date(Date.now() - 32 * 86400000).toISOString(),
    processoId: (base.configuracao || configuracaoPadrao()).processoPadraoId,
    etapas: ETAPAS_PADRAO.slice(), candidatos: [], criadoEm: hoje(),
    pacote: JSON.parse(JSON.stringify(cliente.pacotePadrao)),
    jobSpec: {
      missao: 'Liderar a expansão do canal indireto no Brasil, reportando ao CEO, com P&L de R$ 1,2 bi e time de 240 pessoas.',
      entregas: ['Dobrar a receita do canal indireto em 24 meses',
        'Reestruturar a régua de distribuidores',
        'Montar a área de trade marketing'],
      competencias: [
        { nome: 'Canal indireto / distribuidores', tipo: 'Obrigatória', anos: '8' },
        { nome: 'Gestão de P&L', tipo: 'Obrigatória', anos: '5' },
        { nome: 'Trade marketing', tipo: 'Desejável', anos: '' },
        { nome: 'Bens de consumo', tipo: 'Desejável', anos: '' }
      ],
      formacao: [{ curso: 'Administração ou Engenharia', instituicao: '', nivel: 'Graduação', exigencia: 'Obrigatória' },
        { curso: 'Gestão comercial', instituicao: 'FGV, Insper', nivel: 'MBA', exigencia: 'Desejável' }],
      idiomas: [{ idioma: 'Inglês', nivel: 'Avançado', exigencia: 'Obrigatório' },
        { idioma: 'Espanhol', nivel: 'Intermediário', exigencia: 'Desejável' }],
      titulosAlvo: ['Diretor Comercial', 'Head of Sales', 'Diretor de Vendas'],
      localizacoes: ['São Paulo'],
      empresasAlvo: ['Vitalis Foods', 'Grupo Serrano', 'Nordeste Bebidas'],
      empresasEvitar: ['Aurora Alimentos'],
      observacoes: ''
    },
    descricao: 'Liderar a expansão do canal indireto no Brasil, reportando ao CEO.'
  };

  modelos.forEach((m, i) => {
    const c = {
      id: uid(), nome: m.nome, headline: m.cargoAtual + ' na ' + m.empresaAtual,
      cargoAtual: m.cargoAtual, empresaAtual: m.empresaAtual, localizacao: m.localizacao,
      senioridade: m.senioridade, competencias: m.competencias, idiomas: ['Português', 'Inglês'],
      experiencias: [{ cargo: m.cargoAtual, empresa: m.empresaAtual, periodo: '2021 - o momento' }],
      formacao: [{ instituicao: 'Universidade Exemplo', curso: 'Administração', periodo: '2005 - 2009' }],
      fonte: 'dado de exemplo', criadoEm: hoje(), atualizadoEm: hoje(), notas: [],
      consentimento: i === 0 ? { status: 'concedido', data: hoje(), base: 'consentimento do titular (art. 7º, I — LGPD)', origem: 'e-mail' } : null
    };
    base.candidatos.push(c);
    const entrou = new Date(Date.now() - (25 - i * 7) * 86400000).toISOString();
    assignment.candidatos.push({
      candidatoId: c.id, etapa: m.etapa, situacao: 'Ativo', fit: m.fit,
      entrouEm: entrou, etapaDesde: new Date(Date.now() - (12 - i * 4) * 86400000).toISOString(),
      historico: [{ etapa: 'Mapeado', data: entrou }].concat(
        m.etapa !== 'Mapeado' ? [{ etapa: m.etapa, de: 'Mapeado', data: new Date(Date.now() - (12 - i * 4) * 86400000).toISOString() }] : []),
      notas: [], parecer: i === 0 ? 'Aderência forte ao desafio de canal indireto; disponível para mudança.' : ''
    });
  });

  base.assignments.push(assignment);
  registrarAtividade('sistema', 'Dados de exemplo carregados');
  salvar(); fecharModal(); ir('#/assignment/' + assignment.id); render();
};

/* ---------------------------- inicialização ---------------------------- */



/* ================================================================
 * Controle de acesso
 *
 * Com servidor, o login é de verdade: a senha vai por POST, é guardada
 * como hash (scrypt) e a sessão é um cookie HttpOnly — o navegador nunca
 * vê a base sem estar logado.
 *
 * Sem servidor (arquivo local ou versão online), a base inteira mora no
 * navegador de quem abre. Aqui o login é uma tranca de porta: separa
 * papéis e evita que alguém mexa por engano, mas não protege o dado de
 * quem tem acesso à máquina. A própria tela de acesso avisa isso.
 * ================================================================ */

const PAPEIS = {
  admin: { nome: 'Administrador', descricao: 'Faz tudo, inclusive criar e gerir usuários.' },
  consultor: { nome: 'Consultor', descricao: 'Trabalha assignments, candidatos e relatórios.' },
  leitura: { nome: 'Somente leitura', descricao: 'Consulta e imprime relatórios, sem alterar nada.' }
};
const ADMIN_EMAIL_PADRAO = 'admin@recrutamento.local';
const ADMIN_SENHA_PADRAO = 'Admin@2026';
const SESSAO_LOCAL = 'recrut.sessao';
const HORAS_SESSAO_LOCAL = 12;

let eu = null;

const ehAdmin = () => !!eu && eu.papel === 'admin';
const podeEditar = () => !!eu && eu.papel !== 'leitura';

function iniciais(nome) {
  const partes = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

/* ---- hash local (só usado quando não há servidor) ---- */

async function hashLocal(senha, sal) {
  const cod = new TextEncoder();
  if (!(window.crypto && crypto.subtle)) {
    // Navegador antigo: guarda um resumo fraco, mas nunca a senha em claro.
    let h = 0;
    const texto = sal + '::' + senha;
    for (let i = 0; i < texto.length; i++) { h = (h * 31 + texto.charCodeAt(i)) >>> 0; }
    return 'fraco:' + h.toString(16);
  }
  const chave = await crypto.subtle.importKey('raw', cod.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: cod.encode(sal), iterations: 150000, hash: 'SHA-256' }, chave, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function forcaDaSenha(senha) {
  const t = String(senha || '');
  if (t.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(t) || !/\d/.test(t)) return 'A senha precisa misturar letras e números.';
  return null;
}

async function garantirAdminLocal() {
  if ((base.usuarios || []).length) return;
  const sal = uid();
  base.usuarios = [{
    id: uid(), nome: 'Administrador', email: ADMIN_EMAIL_PADRAO, papel: 'admin', ativo: true,
    sal, hash: await hashLocal(ADMIN_SENHA_PADRAO, sal), precisaTrocarSenha: true, criadoEm: hoje()
  }];
  localStorage.setItem('recrut.base', JSON.stringify(base));
}

function sessaoLocal() {
  try {
    const guardado = JSON.parse(localStorage.getItem(SESSAO_LOCAL) || 'null');
    if (!guardado || guardado.expira < Date.now()) return null;
    const u = (base.usuarios || []).find((x) => x.id === guardado.usuarioId);
    return u && u.ativo !== false ? usuarioPublico(u) : null;
  } catch (e) { return null; }
}

function usuarioPublico(u) {
  return {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo !== false,
    criadoEm: u.criadoEm, ultimoAcesso: u.ultimoAcesso, precisaTrocarSenha: !!u.precisaTrocarSenha
  };
}

/* ---- operações de acesso (mesma interface nos dois modos) ---- */

const Acesso = {
  async entrar(email, senha) {
    if (!modoLocal) {
      const r = await fetch('api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp.erro || 'Não consegui entrar.');
      return resp.usuario;
    }
    const alvo = (base.usuarios || []).find((u) => (u.email || '').toLowerCase() === String(email).trim().toLowerCase());
    if (!alvo || alvo.ativo === false) throw new Error('Usuário ou senha não conferem.');
    const hash = await hashLocal(senha, alvo.sal);
    if (hash !== alvo.hash) throw new Error('Usuário ou senha não conferem.');
    alvo.ultimoAcesso = hoje();
    localStorage.setItem('recrut.base', JSON.stringify(base));
    localStorage.setItem(SESSAO_LOCAL, JSON.stringify({
      usuarioId: alvo.id, expira: Date.now() + HORAS_SESSAO_LOCAL * 3600e3
    }));
    return usuarioPublico(alvo);
  },

  async sair() {
    if (!modoLocal) { try { await fetch('api/logout', { method: 'POST' }); } catch (e) { /* segue */ } }
    else localStorage.removeItem(SESSAO_LOCAL);
    eu = null;
    location.hash = '';
    mostrarAcesso();
  },

  async trocarSenha(senhaAtual, novaSenha) {
    if (!modoLocal) {
      const r = await fetch('api/senha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senhaAtual, novaSenha })
      });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp.erro || 'Não consegui trocar a senha.');
      return;
    }
    const alvo = base.usuarios.find((u) => u.id === eu.id);
    if (await hashLocal(senhaAtual, alvo.sal) !== alvo.hash) throw new Error('A senha atual não confere.');
    const problema = forcaDaSenha(novaSenha);
    if (problema) throw new Error(problema);
    alvo.sal = uid();
    alvo.hash = await hashLocal(novaSenha, alvo.sal);
    alvo.precisaTrocarSenha = false;
    localStorage.setItem('recrut.base', JSON.stringify(base));
  },

  async listar() {
    if (!modoLocal) {
      const r = await fetch('api/usuarios');
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp.erro || 'Não consegui listar os usuários.');
      return resp.usuarios;
    }
    return (base.usuarios || []).map(usuarioPublico);
  },

  async criar(dados) {
    const problema = forcaDaSenha(dados.senha);
    if (problema) throw new Error(problema);
    if (!modoLocal) {
      const r = await fetch('api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
      });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp.erro || 'Não consegui criar o usuário.');
      return resp.usuario;
    }
    const email = String(dados.email || '').trim().toLowerCase();
    if (!dados.nome || !email) throw new Error('Informe nome e e-mail.');
    if (base.usuarios.some((u) => (u.email || '').toLowerCase() === email)) {
      throw new Error('Já existe usuário com esse e-mail.');
    }
    const sal = uid();
    const novo = {
      id: uid(), nome: String(dados.nome).trim(), email, papel: dados.papel || 'consultor',
      ativo: true, sal, hash: await hashLocal(dados.senha, sal), precisaTrocarSenha: true, criadoEm: hoje()
    };
    base.usuarios.push(novo);
    localStorage.setItem('recrut.base', JSON.stringify(base));
    return usuarioPublico(novo);
  },

  async atualizar(id, dados) {
    if (dados.novaSenha) {
      const problema = forcaDaSenha(dados.novaSenha);
      if (problema) throw new Error(problema);
    }
    if (!modoLocal) {
      const r = await fetch('api/usuarios/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
      });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp.erro || 'Não consegui salvar.');
      return resp.usuario;
    }
    const alvo = base.usuarios.find((u) => u.id === id);
    if (!alvo) throw new Error('Usuário não encontrado.');
    const admins = base.usuarios.filter((u) => u.papel === 'admin' && u.ativo !== false);
    if (dados.nome != null) alvo.nome = String(dados.nome).trim() || alvo.nome;
    if (dados.papel && dados.papel !== alvo.papel) {
      if (alvo.papel === 'admin' && admins.length < 2) throw new Error('Precisa sobrar pelo menos um administrador.');
      alvo.papel = dados.papel;
    }
    if (dados.ativo != null) {
      if (!dados.ativo && alvo.papel === 'admin' && admins.length < 2) {
        throw new Error('Precisa sobrar pelo menos um administrador ativo.');
      }
      alvo.ativo = !!dados.ativo;
    }
    if (dados.novaSenha) {
      alvo.sal = uid();
      alvo.hash = await hashLocal(dados.novaSenha, alvo.sal);
      alvo.precisaTrocarSenha = true;
    }
    localStorage.setItem('recrut.base', JSON.stringify(base));
    return usuarioPublico(alvo);
  },

  async excluir(id) {
    if (id === eu.id) throw new Error('Não dá para excluir o próprio usuário.');
    if (!modoLocal) {
      const r = await fetch('api/usuarios/' + id, { method: 'DELETE' });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp.erro || 'Não consegui excluir.');
      return;
    }
    const alvo = base.usuarios.find((u) => u.id === id);
    const admins = base.usuarios.filter((u) => u.papel === 'admin' && u.ativo !== false);
    if (alvo.papel === 'admin' && admins.length < 2) throw new Error('Precisa sobrar pelo menos um administrador.');
    base.usuarios = base.usuarios.filter((u) => u.id !== id);
    localStorage.setItem('recrut.base', JSON.stringify(base));
  }
};

/* ---- telas de acesso ---- */

function mostrarAcesso(mensagem) {
  $('#aplicativo').classList.add('escondido');
  $('#acesso').classList.remove('escondido');
  const erro = $('#acesso-erro');
  if (mensagem) { erro.textContent = mensagem; erro.classList.remove('escondido'); }
  else erro.classList.add('escondido');

  const primeiroAcesso = modoLocal &&
    (base.usuarios || []).length === 1 && base.usuarios[0].precisaTrocarSenha;
  $('#acesso-nota').innerHTML = modoLocal
    ? (primeiroAcesso
        ? `<strong>Primeiro acesso:</strong> usuário <code>${ADMIN_EMAIL_PADRAO}</code>,
           senha <code>${ADMIN_SENHA_PADRAO}</code>. O sistema pede a troca assim que você entrar.<br><br>
           Esta é a versão sem servidor: a base fica guardada neste navegador, então o login organiza
           quem faz o quê, mas não protege os dados de quem tem acesso a este computador. Para controle
           de acesso de verdade, rode a versão com servidor.`
        : `Versão sem servidor: a base fica guardada neste navegador. O login separa os papéis, mas não
           protege os dados de quem tem acesso a este computador — para isso, rode a versão com servidor.`)
    : 'Acesso restrito. Se você não tem usuário, peça ao administrador.';
  setTimeout(() => { const c = $('#ac-email'); if (c) c.focus(); }, 60);
}

function mostrarApp() {
  $('#acesso').classList.add('escondido');
  $('#aplicativo').classList.remove('escondido');
  $('#eu-nome').textContent = eu.nome;
  $('#eu-papel').textContent = (PAPEIS[eu.papel] || {}).nome || eu.papel;
  $('#eu-avatar').textContent = iniciais(eu.nome);
  $('#menu-usuarios').classList.toggle('escondido', !ehAdmin());
  $('#menu-configuracoes').classList.toggle('escondido', !ehAdmin());
}

function formTrocaSenha(obrigatoria) {
  return `
  ${obrigatoria ? '<p class="subtexto">Esta é a senha inicial do sistema. Escolha uma sua antes de continuar.</p>' : ''}
  <div class="campo"><label for="ts-atual">Senha atual</label>
    <input id="ts-atual" type="password" autocomplete="current-password"></div>
  <div class="campo"><label for="ts-nova">Nova senha</label>
    <input id="ts-nova" type="password" autocomplete="new-password">
    <div class="dica">Mínimo de 8 caracteres, misturando letras e números.</div></div>
  <div class="campo"><label for="ts-confirma">Repita a nova senha</label>
    <input id="ts-confirma" type="password" autocomplete="new-password"></div>
  <div id="ts-erro" class="acesso-erro escondido"></div>
  <div class="linha">
    <button class="btn" data-acao="salvarTrocaSenha">Trocar senha</button>
    ${obrigatoria ? '' : '<button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>'}
  </div>`;
}

acoes.abrirConta = () => {
  abrirModal('Minha conta', `
    <div class="linha" style="gap:12px;margin-bottom:18px">
      <div class="avatar avatar-g">${esc(iniciais(eu.nome))}</div>
      <div>
        <strong style="font-size:16px">${esc(eu.nome)}</strong>
        <div class="subtexto">${esc(eu.email)} · ${esc((PAPEIS[eu.papel] || {}).nome || eu.papel)}</div>
      </div>
    </div>
    <h3>Trocar senha</h3>
    ${formTrocaSenha(false)}`);
};

acoes.salvarTrocaSenha = async (el) => {
  const erro = $('#ts-erro');
  const mostrar = (t) => { erro.textContent = t; erro.classList.remove('escondido'); };
  const nova = $('#ts-nova').value;
  if (nova !== $('#ts-confirma').value) { mostrar('As duas senhas novas não são iguais.'); return; }
  el.disabled = true;
  try {
    await Acesso.trocarSenha($('#ts-atual').value, nova);
    eu.precisaTrocarSenha = false;
    fecharModal();
    aviso('Senha trocada.');
    render();
  } catch (e) { mostrar(e.message); }
  el.disabled = false;
};

acoes.sair = () => Acesso.sair();

/* ---------------------------- tela de usuários ---------------------------- */

let usuariosCache = [];

function telaUsuarios() {
  if (!ehAdmin()) return '<div class="vazio">Só o administrador acessa esta área.</div>';
  const linhas = usuariosCache.map((u) => `
    <tr class="clicavel" data-acao="editarUsuario" data-id="${u.id}">
      <td>
        <div class="linha" style="gap:10px;flex-wrap:nowrap">
          <div class="avatar avatar-p">${esc(iniciais(u.nome))}</div>
          <div><strong>${esc(u.nome)}</strong><div class="subtexto">${esc(u.email)}</div></div>
        </div>
      </td>
      <td><span class="tag ${u.papel === 'admin' ? 'tag-latao' : u.papel === 'leitura' ? 'tag-cinza' : 'tag-azul'}">${esc((PAPEIS[u.papel] || {}).nome || u.papel)}</span></td>
      <td>${u.ativo ? '<span class="tag tag-verde">ativo</span>' : '<span class="tag tag-vermelha">inativo</span>'}
        ${u.precisaTrocarSenha ? '<span class="tag tag-amarela">senha inicial</span>' : ''}</td>
      <td class="num subtexto">${u.ultimoAcesso ? fmtData(u.ultimoAcesso) : '—'}</td>
    </tr>`).join('');

  return `
  ${cabecalho('Administração', 'Usuários', 'Quem entra no sistema e o que cada um pode fazer.',
    '<button class="btn" data-acao="novoUsuario">+ Novo usuário</button>')}
  <div class="cartao">
    <div class="rolagem">
      <table><thead><tr><th>Pessoa</th><th>Papel</th><th>Situação</th><th>Último acesso</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="4" class="subtexto">Nenhum usuário.</td></tr>'}</tbody></table>
    </div>
  </div>
  <div class="cartao">
    <h3>O que cada papel pode</h3>
    <div class="grade g3">
      ${Object.keys(PAPEIS).map((k) => `<div>
        <div class="eyebrow" style="margin-bottom:6px">${esc(PAPEIS[k].nome)}</div>
        <div class="subtexto">${esc(PAPEIS[k].descricao)}</div></div>`).join('')}
    </div>
  </div>`;
}

function formUsuario(u) {
  const novo = !u;
  u = u || { papel: 'consultor', ativo: true };
  return `
  <div class="grade g2">
    <div class="campo"><label>Nome</label><input id="u-nome" value="${esc(u.nome || '')}"></div>
    <div class="campo"><label>E-mail (é o login)</label>
      <input id="u-email" value="${esc(u.email || '')}" ${novo ? '' : 'disabled'} autocapitalize="none" spellcheck="false"></div>
    <div class="campo"><label>Papel</label><select id="u-papel">
      ${Object.keys(PAPEIS).map((k) => `<option value="${k}" ${k === u.papel ? 'selected' : ''}>${esc(PAPEIS[k].nome)}</option>`).join('')}
    </select></div>
    ${novo ? '' : `<div class="campo"><label>Situação</label><select id="u-ativo">
      <option value="1" ${u.ativo ? 'selected' : ''}>Ativo</option>
      <option value="0" ${!u.ativo ? 'selected' : ''}>Inativo (não consegue entrar)</option></select></div>`}
  </div>
  <div class="campo"><label>${novo ? 'Senha inicial' : 'Definir nova senha (opcional)'}</label>
    <input id="u-senha" type="text" value="${novo ? esc(senhaSugerida()) : ''}" placeholder="${novo ? '' : 'deixe vazio para manter'}">
    <div class="dica">Mínimo de 8 caracteres com letras e números. A pessoa troca no primeiro acesso —
      anote e entregue a senha por um canal seguro.</div></div>
  <div id="u-erro" class="acesso-erro escondido"></div>
  <div class="linha">
    <button class="btn" data-acao="salvarUsuario" data-id="${u.id || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    ${novo || u.id === eu.id ? '' : `<button class="btn btn-perigo espaco" data-acao="excluirUsuario" data-id="${u.id}">Excluir</button>`}
  </div>`;
}

function senhaSugerida() {
  const palavras = ['Serra', 'Aurora', 'Vento', 'Farol', 'Prisma', 'Cedro', 'Barca', 'Norte'];
  const i = Math.floor(Math.random() * palavras.length);
  const n = 100 + Math.floor(Math.random() * 900);
  return palavras[i] + n + '!';
}

acoes.novoUsuario = () => abrirModal('Novo usuário', formUsuario(null));
acoes.editarUsuario = (el, d) => abrirModal('Usuário', formUsuario(usuariosCache.find((u) => u.id === d.id)));

acoes.salvarUsuario = async (el, d) => {
  const erro = $('#u-erro');
  const mostrar = (t) => { erro.textContent = t; erro.classList.remove('escondido'); };
  el.disabled = true;
  try {
    if (d.id) {
      const dados = { nome: $('#u-nome').value, papel: $('#u-papel').value, ativo: $('#u-ativo').value === '1' };
      const senha = $('#u-senha').value.trim();
      if (senha) dados.novaSenha = senha;
      await Acesso.atualizar(d.id, dados);
    } else {
      await Acesso.criar({
        nome: $('#u-nome').value, email: $('#u-email').value,
        papel: $('#u-papel').value, senha: $('#u-senha').value.trim()
      });
    }
    usuariosCache = await Acesso.listar();
    fecharModal(); render();
    aviso(d.id ? 'Usuário atualizado.' : 'Usuário criado.');
  } catch (e) { mostrar(e.message); }
  el.disabled = false;
};

acoes.excluirUsuario = async (el, d) => {
  if (!confirm('Excluir este usuário? Ele perde o acesso na hora.')) return;
  try {
    await Acesso.excluir(d.id);
    usuariosCache = await Acesso.listar();
    fecharModal(); render();
  } catch (e) { aviso(e.message, 5000); }
};

/* ---------------------------- configurações da consultoria ---------------------------- */

function telaConfiguracoes() {
  if (!ehAdmin()) return '<div class="vazio">Só o administrador acessa as configurações.</div>';
  const cfg = base.configuracao || configuracaoPadrao();

  const processos = cfg.processos.map((pr) => `
    <div class="cartao" style="box-shadow:none;margin-bottom:10px">
      <div class="linha">
        <div>
          <strong>${esc(pr.nome)}</strong>
          ${pr.id === cfg.processoPadraoId ? '<span class="tag tag-latao">padrão</span>' : ''}
          <div class="subtexto">${pr.etapas.length} etapas · ${esc(pr.etapas.join(' → '))}</div>
        </div>
        <div class="espaco"></div>
        <button class="btn btn-sec btn-mini" data-acao="editarProcesso" data-id="${pr.id}">Editar</button>
        ${pr.id === cfg.processoPadraoId ? '' :
          `<button class="btn btn-fantasma btn-mini" data-acao="tornarProcessoPadrao" data-id="${pr.id}">Tornar padrão</button>
           <button class="btn btn-fantasma btn-mini" data-acao="excluirProcesso" data-id="${pr.id}">Excluir</button>`}
      </div>
    </div>`).join('');

  return `
  ${cabecalho('Administração', 'Configurações', 'Os padrões da consultoria: processo de seleção, benefícios e moeda.')}

  <div class="cartao">
    <div class="linha" style="margin-bottom:12px">
      <h2 style="margin:0">Processos de seleção</h2>
      <div class="espaco"></div>
      <button class="btn" data-acao="novoProcesso">+ Novo processo</button>
    </div>
    <p class="subtexto" style="margin-bottom:14px">Ao abrir um assignment você escolhe um destes; as etapas
      podem ser ajustadas naquela busca sem mexer no padrão.</p>
    ${processos}
  </div>

  <div class="cartao">
    <h2>Benefícios e moeda</h2>
    <div class="campo"><label>Moeda</label>
      <input id="cfg-moeda" value="${esc(cfg.moeda || 'R$')}" style="max-width:120px"></div>
    <div class="campo"><label>Benefícios oferecidos nos pacotes (um por linha)</label>
      <textarea id="cfg-beneficios" style="min-height:170px">${esc((cfg.beneficios || []).join('\n'))}</textarea>
      <div class="dica">Estes viram as caixinhas do pacote, no cliente e no assignment.</div></div>
    <button class="btn" data-acao="salvarConfiguracoes">Salvar</button>
  </div>`;
}

acoes.salvarConfiguracoes = () => {
  base.configuracao.moeda = $('#cfg-moeda').value.trim() || 'R$';
  base.configuracao.beneficios = porLinha($('#cfg-beneficios').value);
  salvar(); render(); aviso('Configurações salvas.');
};

function formProcesso(pr) {
  pr = pr || { nome: '', etapas: ETAPAS_PADRAO.slice() };
  return `
  <div class="campo"><label>Nome do processo</label>
    <input id="pr-nome" value="${esc(pr.nome || '')}" placeholder="Ex.: Executive search (padrão)"></div>
  <div class="campo"><label>Etapas, na ordem (uma por linha)</label>
    <textarea id="pr-etapas" style="min-height:180px">${esc((pr.etapas || []).join('\n'))}</textarea>
    <div class="dica">Assignments já abertos mantêm as etapas que estão usando — mudar aqui vale para os próximos.</div></div>
  <div class="linha">
    <button class="btn" data-acao="salvarProcesso" data-id="${pr.id || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
  </div>`;
}

acoes.novoProcesso = () => abrirModal('Novo processo de seleção', formProcesso(null));
acoes.editarProcesso = (el, d) =>
  abrirModal('Processo de seleção', formProcesso(base.configuracao.processos.find((pr) => pr.id === d.id)));

acoes.salvarProcesso = (el, d) => {
  const nome = $('#pr-nome').value.trim();
  const etapas = porLinha($('#pr-etapas').value);
  if (!nome) { aviso('Dê um nome ao processo.'); return; }
  if (etapas.length < 2) { aviso('Um processo precisa de pelo menos duas etapas.'); return; }
  const cfg = base.configuracao;
  let pr = d.id ? cfg.processos.find((x) => x.id === d.id) : null;
  if (!pr) { pr = { id: uid() }; cfg.processos.push(pr); }
  pr.nome = nome;
  pr.etapas = etapas;
  salvar(); fecharModal(); render();
};

acoes.tornarProcessoPadrao = (el, d) => {
  base.configuracao.processoPadraoId = d.id;
  salvar(); render();
};

acoes.excluirProcesso = (el, d) => {
  const cfg = base.configuracao;
  if (base.assignments.some((a) => a.processoId === d.id)) {
    aviso('Há assignments usando este processo. Eles continuam com as etapas atuais, mas o processo não pode sumir.', 6000);
    return;
  }
  if (!confirm('Excluir este processo?')) return;
  cfg.processos = cfg.processos.filter((pr) => pr.id !== d.id);
  salvar(); render();
};

/* ---------------------------- partida ---------------------------- */

async function iniciar() {
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  $('#btn-backup').addEventListener('click', () => acoes.abrirBackup());
  $('#btn-conta').addEventListener('click', () => acoes.abrirConta());
  $('#btn-sair').addEventListener('click', () => acoes.sair());
  $('#form-acesso').addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = $('#form-acesso button[type="submit"]');
    botao.disabled = true;
    try {
      eu = await Acesso.entrar($('#ac-email').value, $('#ac-senha').value);
      $('#ac-senha').value = '';
      await depoisDoLogin();
    } catch (erro) {
      mostrarAcesso(erro.message);
      $('#ac-senha').value = '';
    }
    botao.disabled = false;
  });

  modoLocal = location.protocol === 'file:' || !!window.RECRUTAMENTO_ONLINE;
  if (!modoLocal) {
    try {
      const r = await fetch('api/eu', { cache: 'no-store' });
      if (r.ok) eu = (await r.json()).usuario;
      else if (r.status !== 401) throw new Error('sem api');
    } catch (e) { modoLocal = true; }
  }
  if (modoLocal) {
    carregarLocal();
    await garantirAdminLocal();
    eu = sessaoLocal();
  }
  marcarModo();
  if (!eu) { mostrarAcesso(); return; }
  await depoisDoLogin();
}

async function depoisDoLogin() {
  try { await carregar(); } catch (e) { return; }
  if (ehAdmin()) { try { usuariosCache = await Acesso.listar(); } catch (e) { usuariosCache = []; } }
  mostrarApp();
  render();
  if (eu.precisaTrocarSenha) abrirModal('Troque a senha inicial', formTrocaSenha(true));
}

window.addEventListener('hashchange', () => { if (eu) render(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !eu?.precisaTrocarSenha) fecharModal(); });
document.addEventListener('DOMContentLoaded', iniciar);
