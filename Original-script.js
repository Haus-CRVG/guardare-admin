// ---------- Conexão com o Supabase (banco de dados real) ----------
const SUPABASE_URL = 'https://kelbiyyxvbecukeelfrf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6pWRhZzU2D2QF74FsnYItA_4s9b--38';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Cliente separado, sem guardar sessão — usado só para criar login de outras pessoas
// (funcionários, clientes) sem substituir a sessão de quem está logado no momento.
const dbAuthOnly = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------- Estado da aplicação ----------
// clientes, perfis, histórico e faturas agora vêm todos do Supabase.
// Perfis/histórico/faturas de um cliente específico só são buscados quando ele é aberto
// (carregarDetalheCliente), pra não sobrecarregar a listagem geral.
let clientes = [];
let clienteAtualId = null;

const statusLabel = { lead: "Lead", aguardando: "Aguardando Aceite", ativo: "Ativo", cancelado: "Cancelado" };
const statusClass = { lead: "status-lead", aguardando: "status-aguardando", ativo: "status-ativo", cancelado: "status-cancelado" };

function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR');
}

// Converte uma linha da tabela "clientes" (snake_case) para o formato usado na tela
function dbRowToCliente(row) {
    return {
        id: row.id,
        razaoSocial: row.razao_social || '',
        cnpj: row.cnpj_cpf || '',
        email: row.email || '',
        telefone: row.telefone || '',
        celular: row.celular || '',
        endereco: row.endereco || '',
        nomeProprietario: row.nome_proprietario || '',
        cpfResponsavel: row.cpf_responsavel || '',
        dataNascimento: row.data_nascimento || '',
        telefoneResponsavel: row.telefone_responsavel || '',
        status: row.status,
        motivoCancelamento: row.motivo_cancelamento || '',
        authUserId: row.auth_user_id || null,
        dataCadastro: formatarData(row.criado_em),
        dataCadastroRaw: row.criado_em,
        plano: {
            nome: row.plano_nome || '',
            valor: parseFloat(row.plano_valor) || 0,
            ciclo: row.plano_ciclo || 'mensal',
            diaVencimento: row.plano_dia_vencimento || null
        },
        // Carregados sob demanda quando o cliente é aberto (ver carregarDetalheCliente)
        perfis: [],
        historico: [],
        faturas: []
    };
}

function formatarDataHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR');
}

// Busca a lista atual no Supabase e atualiza a tela
async function carregarClientes() {
    const { data, error } = await db.from('clientes').select('*').order('criado_em', { ascending: false });
    if (error) {
        alert('Erro ao carregar clientes do banco: ' + error.message);
        console.error(error);
        return;
    }
    clientes = data.map(dbRowToCliente);
    renderLista();
}

// Registra um evento de histórico no banco (usado por qualquer ação que altere dados do cliente)
async function registrarHistorico(clienteId, usuario, campos) {
    const { data: evento, error: e1 } = await db.from('historico_evento').insert({ cliente_id: clienteId, usuario }).select().single();
    if (e1) { console.error(e1); return; }
    const linhas = campos.map(c => ({ evento_id: evento.id, campo: c.campo, valor_antigo: c.de, valor_novo: c.para }));
    const { error: e2 } = await db.from('historico_campo').insert(linhas);
    if (e2) console.error(e2);
}

// Busca perfis, histórico e faturas de UM cliente e preenche no objeto já carregado em `clientes`
async function carregarDetalheCliente(id) {
    const c = clientes.find(cl => cl.id === id);
    if (!c) return;

    const { data: perfisData, error: e1 } = await db.from('perfis_backup').select('*').eq('cliente_id', id).order('criado_em', { ascending: true });
    if (e1) console.error(e1);
    c.perfis = (perfisData || []).map(row => ({
        id: row.id,
        nome: row.nome,
        idsoftware: row.id_software_backup || '',
        retencao: row.dias_retencao,
        maquina: row.nome_maquina,
        so: row.sistema_operacional,
        tipo: row.tipo_backup,
        banco: row.banco_dados || '',
        origem: row.origem,
        copialocal: row.caminho_copia_local,
        dias: row.dias_semana || [],
        horarios: row.horarios_inicio,
        filtros: row.filtros || '',
        anotacoes: row.anotacoes || ''
    }));

    const { data: histData, error: e2 } = await db.from('historico_evento').select('*, historico_campo(*)').eq('cliente_id', id).order('data_hora', { ascending: false });
    if (e2) console.error(e2);
    c.historico = (histData || []).map(ev => ({
        usuario: ev.usuario,
        dataHora: formatarDataHora(ev.data_hora),
        campos: (ev.historico_campo || []).map(campo => ({ campo: campo.campo, de: campo.valor_antigo, para: campo.valor_novo }))
    }));

    const { data: fatData, error: e3 } = await db.from('faturas').select('*').eq('cliente_id', id).order('criado_em', { ascending: false });
    if (e3) console.error(e3);
    c.faturas = (fatData || []).map(row => ({
        id: row.id,
        referencia: row.referencia,
        valor: parseFloat(row.valor),
        status: row.status
    }));
}



function renderLista() {
    const busca = document.getElementById('filtro-busca').value.toLowerCase();
    const filtroStatus = document.getElementById('filtro-status').value;
    const dataDe = document.getElementById('filtro-data-de').value;
    const dataAte = document.getElementById('filtro-data-ate').value;

    const filtrados = clientes.filter(c => {
        const bateBusca = c.razaoSocial.toLowerCase().includes(busca) || c.cnpj.includes(busca);
        const bateStatus = !filtroStatus || c.status === filtroStatus;

        let bateData = true;
        if ((dataDe || dataAte) && c.dataCadastroRaw) {
            const dataCliente = c.dataCadastroRaw.slice(0, 10); // YYYY-MM-DD
            if (dataDe && dataCliente < dataDe) bateData = false;
            if (dataAte && dataCliente > dataAte) bateData = false;
        }

        return bateBusca && bateStatus && bateData;
    });

    const tbody = document.getElementById('tbody-clientes');
    tbody.innerHTML = filtrados.map(c => `
        <tr onclick="abrirCliente('${c.id}')">
            <td><small>${c.id.slice(0, 8)}</small></td>
            <td><strong>${c.razaoSocial}</strong><br><small>${c.cnpj}</small></td>
            <td>${c.perfis.length} perfil(is)</td>
            <td>${c.dataCadastro}</td>
            <td><span class="status ${statusClass[c.status]}">${statusLabel[c.status]}</span></td>
            <td class="acoes-cell" onclick="event.stopPropagation()">${renderAcoesLinha(c)}</td>
        </tr>
    `).join('') || `<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:40px;">Nenhum cliente encontrado.</td></tr>`;

    renderStats();
}

function filtrarPorStatus(status) {
    const select = document.getElementById('filtro-status');
    // Clicar de novo no mesmo card remove o filtro (alterna)
    select.value = (select.value === status) ? '' : status;
    renderLista();
    document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth' });
}

function renderStats() {
    const ativos = clientes.filter(c => c.status === 'ativo').length;
    const aguardando = clientes.filter(c => c.status === 'aguardando').length;
    const leads = clientes.filter(c => c.status === 'lead').length;
    const cancelados = clientes.filter(c => c.status === 'cancelado').length;
    const statusAtivo = document.getElementById('filtro-status').value;

    const card = (status, cor, titulo, valor) => `
        <div class="stat-card ${statusAtivo === status ? 'stat-card-active' : ''}" style="border-left-color: ${cor}; cursor:pointer;" onclick="filtrarPorStatus('${status}')">
            <h3>${titulo}</h3><p>${valor}</p>
        </div>`;

    document.getElementById('stats-grid').innerHTML =
        card('ativo', 'var(--primary)', 'Ativos', ativos) +
        card('aguardando', 'var(--warning)', 'Em Aceite', aguardando) +
        card('lead', 'var(--muted)', 'Leads', leads) +
        card('cancelado', 'var(--danger)', 'Cancelados', cancelados);

    const avisoEl = document.getElementById('filtro-ativo-aviso');
    if (statusAtivo) {
        avisoEl.style.display = 'block';
        avisoEl.innerHTML = `<span style="font-size:13px; color:var(--muted);">Filtrando por: <strong>${statusLabel[statusAtivo]}</strong></span>
            <button class="btn-action" style="margin-left:10px; padding:4px 12px;" onclick="filtrarPorStatus('${statusAtivo}')">✕ Limpar filtro</button>`;
    } else {
        avisoEl.style.display = 'none';
        avisoEl.innerHTML = '';
    }
}

function renderAcoesLinha(c) {
    // Botões variam conforme o status do cliente
    switch (c.status) {
        case 'lead':
            return `<button class="btn-action" onclick="abrirCliente('${c.id}', 'perfis')">⚙️ Cadastrar Perfis</button>
                    <button class="btn-action" onclick="abrirCliente('${c.id}', 'dados')">✏️ Editar Dados</button>`;
        case 'aguardando':
            return `<button class="btn-action" onclick="abrirCliente('${c.id}', 'perfis')">📄 Reenviar Link</button>
                    <button class="btn-action" onclick="abrirCliente('${c.id}', 'perfis')">⚙️ Configurar</button>`;
        case 'ativo':
            return `<button class="btn-action" onclick="abrirCliente('${c.id}', 'dados')">📄 Contrato</button>
                    <button class="btn-action" onclick="abrirCliente('${c.id}', 'perfis')">⚙️ Perfis</button>
                    <button class="btn-action" onclick="abrirCliente('${c.id}', 'financeiro')">💰 Financeiro</button>`;
        case 'cancelado':
            return `<button class="btn-action" onclick="abrirCliente('${c.id}', 'historico')">🕒 Histórico</button>`;
        default:
            return '';
    }
}

// ---------- Navegação ----------
function voltarLista() {
    clienteAtualId = null;
    document.getElementById('view-detalhe').style.display = 'none';
    document.getElementById('view-lista').style.display = 'block';
    renderLista();
}

async function abrirNovoCliente() {
    const { data, error } = await db.from('clientes').insert({
        razao_social: '', cnpj_cpf: '', email: '', telefone: '', celular: '', endereco: '',
        nome_proprietario: '', cpf_responsavel: '', telefone_responsavel: '',
        status: 'lead', plano_nome: '', plano_valor: 0, plano_ciclo: 'mensal'
    }).select().single();

    if (error) {
        alert('Erro ao criar cliente no banco: ' + error.message);
        console.error(error);
        return;
    }

    await registrarHistorico(data.id, "Sistema", [{ campo: "Status", de: "-", para: "Lead" }]);
    await carregarClientes();
    await abrirCliente(data.id);
}

async function abrirCliente(id, tab) {
    clienteAtualId = id;
    document.getElementById('view-lista').style.display = 'none';
    document.getElementById('view-detalhe').style.display = 'block';
    mudarTab(tab || 'dados');
    await carregarDetalheCliente(id);
    renderDetalhe();
}

function getClienteAtual() {
    return clientes.find(c => c.id === clienteAtualId);
}

function renderDetalhe() {
    const c = getClienteAtual();
    document.getElementById('detalhe-nome').textContent = c.razaoSocial || "(Novo cliente)";
    document.getElementById('detalhe-meta').textContent = (c.cnpj || "CNPJ/CPF não informado") + " · Cadastrado em " + c.dataCadastro;
    document.getElementById('detalhe-status-badge').textContent = statusLabel[c.status];
    document.getElementById('detalhe-status-badge').className = "status " + statusClass[c.status];

    document.getElementById('f-nomeProprietario').value = c.nomeProprietario;
    document.getElementById('f-cpfResponsavel').value = c.cpfResponsavel;
    document.getElementById('f-dataNascimento').value = c.dataNascimento;
    document.getElementById('f-telefoneResponsavel').value = c.telefoneResponsavel;

    document.getElementById('f-razaoSocial').value = c.razaoSocial;
    document.getElementById('f-cnpj').value = c.cnpj;
    document.getElementById('f-email').value = c.email;
    document.getElementById('f-telefone').value = c.telefone;
    document.getElementById('f-celular').value = c.celular;
    document.getElementById('f-endereco').value = c.endereco;
    document.getElementById('f-plano-nome').value = c.plano.nome;
    document.getElementById('f-plano-valor').value = c.plano.valor || '';
    document.getElementById('f-plano-ciclo').value = c.plano.ciclo;
    document.getElementById('f-plano-dia').value = c.plano.diaVencimento || '';

    document.getElementById('btn-cancelar-cliente').style.display = c.status === 'cancelado' ? 'none' : 'inline-block';

    renderPerfis();
    renderHistorico();
    renderFinanceiro();
}

function mudarTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['dados','perfis','historico','financeiro'].forEach(t => {
        document.getElementById('tab-' + t).style.display = (t === tab) ? 'block' : 'none';
    });
}

// ---------- Dados do cliente ----------
function normalizaDoc(v) { return v.replace(/\D/g, ''); }

async function salvarDadosCliente() {
    const c = getClienteAtual();
    const novoCnpj = document.getElementById('f-cnpj').value.trim();
    const razaoSocial = document.getElementById('f-razaoSocial').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const telefone = document.getElementById('f-telefone').value.trim();

    if (!razaoSocial || !novoCnpj || !email || !telefone) {
        alert("Preencha os campos obrigatórios: Razão Social, CNPJ, E-mail e Telefone.");
        return;
    }

    // valida duplicidade exata de documento (permite matriz/filial - mesma raiz)
    const docNovo = normalizaDoc(novoCnpj);
    const duplicado = clientes.some(other => other.id !== c.id && normalizaDoc(other.cnpj) === docNovo);
    if (duplicado) {
        alert("Já existe um cliente cadastrado com este CNPJ exato.");
        return;
    }

    const alteracoes = [];
    const dataNascimentoForm = document.getElementById('f-dataNascimento').value;
    const campos = [
        ['nomeProprietario', 'Nome do Proprietário', document.getElementById('f-nomeProprietario').value.trim()],
        ['cpfResponsavel', 'CPF do Responsável', document.getElementById('f-cpfResponsavel').value.trim()],
        ['dataNascimento', 'Data de Nascimento', dataNascimentoForm],
        ['telefoneResponsavel', 'Telefone do Responsável', document.getElementById('f-telefoneResponsavel').value.trim()],
        ['razaoSocial', 'Razão Social', razaoSocial],
        ['cnpj', 'CNPJ', novoCnpj],
        ['email', 'E-mail', email],
        ['telefone', 'Telefone', telefone],
        ['celular', 'Celular', document.getElementById('f-celular').value.trim()],
        ['endereco', 'Endereço', document.getElementById('f-endereco').value.trim()],
    ];
    campos.forEach(([key, label, valor]) => {
        if (c[key] !== valor) {
            alteracoes.push({ campo: label, de: c[key] || '-', para: valor || '-' });
            c[key] = valor;
        }
    });

    const novoPlanoNome = document.getElementById('f-plano-nome').value.trim();
    const novoPlanoValor = parseFloat(document.getElementById('f-plano-valor').value) || 0;
    const novoPlanoCiclo = document.getElementById('f-plano-ciclo').value;
    const novoPlanoDia = parseInt(document.getElementById('f-plano-dia').value) || null;
    const planoCampos = [
        ['nome', 'Plano Contratado', novoPlanoNome],
        ['valor', 'Valor de Recorrência', novoPlanoValor.toFixed(2)],
        ['ciclo', 'Ciclo de Cobrança', novoPlanoCiclo],
        ['diaVencimento', 'Dia de Vencimento', novoPlanoDia ? String(novoPlanoDia) : ''],
    ];
    planoCampos.forEach(([key, label, valor]) => {
        let atual = c.plano[key];
        if (key === 'valor') atual = (atual || 0).toFixed(2);
        if (key === 'diaVencimento') atual = atual ? String(atual) : '';
        if (atual !== valor) {
            alteracoes.push({ campo: label, de: atual || '-', para: valor || '-' });
            if (key === 'valor') c.plano[key] = novoPlanoValor;
            else if (key === 'diaVencimento') c.plano[key] = novoPlanoDia;
            else c.plano[key] = valor;
        }
    });

    // (o histórico dessas alterações é gravado depois de confirmar o update no banco)

    // Grava de verdade no Supabase
    const payload = {
        razao_social: c.razaoSocial,
        cnpj_cpf: c.cnpj,
        email: c.email,
        telefone: c.telefone,
        celular: c.celular,
        endereco: c.endereco,
        nome_proprietario: c.nomeProprietario,
        cpf_responsavel: c.cpfResponsavel,
        data_nascimento: dataNascimentoForm || null,
        telefone_responsavel: c.telefoneResponsavel,
        plano_nome: c.plano.nome,
        plano_valor: c.plano.valor,
        plano_ciclo: c.plano.ciclo,
        plano_dia_vencimento: c.plano.diaVencimento
    };
    const { error } = await db.from('clientes').update(payload).eq('id', c.id);
    if (error) {
        alert('Erro ao salvar no banco: ' + error.message);
        console.error(error);
        return;
    }

    if (alteracoes.length > 0) {
        await registrarHistorico(c.id, "Usuário Demo", alteracoes);
    }

    clienteAtualId = c.id;
    await carregarClientes();
    await carregarDetalheCliente(c.id);
    renderDetalhe();
    alert("Dados salvos.");
}

async function cancelarCliente() {
    const c = getClienteAtual();
    const motivo = prompt("Informe o motivo do cancelamento (obrigatório):");
    if (!motivo || !motivo.trim()) {
        if (motivo !== null) alert("O motivo é obrigatório para cancelar o cliente.");
        return;
    }
    const statusAnterior = c.status;

    const { error } = await db.from('clientes').update({ status: 'cancelado', motivo_cancelamento: motivo.trim() }).eq('id', c.id);
    if (error) {
        alert('Erro ao cancelar no banco: ' + error.message);
        console.error(error);
        return;
    }

    await registrarHistorico(c.id, "Usuário Demo", [
        { campo: "Status", de: statusLabel[statusAnterior], para: "Cancelado" },
        { campo: "Motivo do Cancelamento", de: "-", para: motivo.trim() }
    ]);

    await carregarClientes();
    await carregarDetalheCliente(c.id);
    renderDetalhe();
}

// ---------- Perfis de backup ----------
function renderPerfis() {
    const c = getClienteAtual();
    document.getElementById('perfis-info').textContent = c.perfis.length + " perfil(is) cadastrado(s)";

    const podeEnviar = c.perfis.length > 0 && c.status === 'lead';
    const btnEnviar = document.getElementById('btn-enviar-aceite');
    btnEnviar.disabled = !podeEnviar;
    btnEnviar.title = podeEnviar ? "" : (c.perfis.length === 0 ? "Cadastre ao menos 1 perfil para liberar" : "Disponível apenas quando o cliente está como Lead");

    document.getElementById('btn-confirmar-aceite').style.display = (c.status === 'aguardando') ? 'inline-block' : 'none';

    const lista = document.getElementById('lista-perfis');
    if (c.perfis.length === 0) {
        lista.innerHTML = `<div class="empty-state"><div style="font-size:32px;">🗂️</div><p>Nenhum perfil de backup cadastrado ainda.</p></div>`;
        return;
    }

    lista.innerHTML = c.perfis.map((p, idx) => `
        <div class="perfil-card">
            <div class="perfil-info">
                <strong>${p.nome}</strong>
                <div>${p.maquina} · ${p.so} · ${p.tipo === 'banco' ? 'Banco de Dados (' + p.banco + ')' : 'Arquivos/Pastas'} · Retenção: ${p.retencao}</div>
                <div>Dias: ${p.dias.join(', ')}</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn-action" onclick="abrirModalPerfil(${idx})">✏️ Editar</button>
                <button class="btn-action" onclick="removerPerfil(${idx})">Remover</button>
            </div>
        </div>
    `).join('');
}

let perfilEditIndex = null;

function abrirModalPerfil(idx) {
    const c = getClienteAtual();
    perfilEditIndex = (typeof idx === 'number') ? idx : null;
    document.querySelector('#modal-perfil h3').textContent = perfilEditIndex === null ? "Novo Perfil de Backup" : "Editar Perfil de Backup";

    if (perfilEditIndex !== null) {
        const p = c.perfis[perfilEditIndex];
        document.getElementById('p-nome').value = p.nome;
        document.getElementById('p-idsoftware').value = p.idsoftware;
        document.getElementById('p-retencao').value = p.retencao;
        document.getElementById('p-maquina').value = p.maquina;
        document.getElementById('p-so').value = p.so;
        document.getElementById('p-tipo').value = p.tipo;
        document.getElementById('p-banco').value = p.banco || 'Firebird';
        document.getElementById('p-origem').value = p.origem;
        document.getElementById('p-copialocal').value = p.copialocal;
        document.querySelectorAll('.checkbox-grid input').forEach(i => i.checked = p.dias.includes(i.value));
        document.getElementById('p-horarios').value = p.horarios;
        document.getElementById('p-filtros').value = p.filtros;
        document.getElementById('p-anotacoes').value = p.anotacoes;
        alternarCampoBanco();
    } else {
        document.querySelectorAll('#modal-perfil input[type=text], #modal-perfil textarea').forEach(i => i.value = '');
        document.getElementById('p-retencao').value = '30 dias';
        document.getElementById('p-so').value = 'Windows';
        document.getElementById('p-tipo').value = 'arquivos';
        document.querySelectorAll('.checkbox-grid input').forEach(i => i.checked = i.value !== 'Domingo');
        alternarCampoBanco();
    }

    document.getElementById('modal-perfil').style.display = 'flex';
}
function fecharModalPerfil() {
    perfilEditIndex = null;
    document.getElementById('modal-perfil').style.display = 'none';
}
function alternarCampoBanco() {
    const tipo = document.getElementById('p-tipo').value;
    document.getElementById('grupo-banco').style.display = tipo === 'banco' ? 'flex' : 'none';
}

async function salvarPerfil() {
    const nome = document.getElementById('p-nome').value.trim();
    const maquina = document.getElementById('p-maquina').value.trim();
    const origem = document.getElementById('p-origem').value.trim();
    const copialocal = document.getElementById('p-copialocal').value.trim();
    const horarios = document.getElementById('p-horarios').value.trim();
    const dias = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map(i => i.value);

    if (!nome || !maquina || !origem || !copialocal || !horarios || dias.length === 0) {
        alert("Preencha os campos obrigatórios do perfil.");
        return;
    }

    const tipo = document.getElementById('p-tipo').value;
    const payload = {
        cliente_id: clienteAtualId,
        nome,
        id_software_backup: document.getElementById('p-idsoftware').value.trim(),
        dias_retencao: document.getElementById('p-retencao').value,
        nome_maquina: maquina,
        sistema_operacional: document.getElementById('p-so').value,
        tipo_backup: tipo,
        banco_dados: tipo === 'banco' ? document.getElementById('p-banco').value : null,
        origem,
        caminho_copia_local: copialocal,
        dias_semana: dias,
        horarios_inicio: horarios,
        filtros: document.getElementById('p-filtros').value.trim(),
        anotacoes: document.getElementById('p-anotacoes').value.trim()
    };

    const c = getClienteAtual();
    let erro;
    if (perfilEditIndex !== null) {
        const perfilExistente = c.perfis[perfilEditIndex];
        ({ error: erro } = await db.from('perfis_backup').update(payload).eq('id', perfilExistente.id));
    } else {
        ({ error: erro } = await db.from('perfis_backup').insert(payload));
    }

    if (erro) {
        alert('Erro ao salvar o perfil no banco: ' + erro.message);
        console.error(erro);
        return;
    }

    await registrarHistorico(clienteAtualId, "Usuário Demo", [
        { campo: "Perfil de Backup", de: perfilEditIndex !== null ? "Editado" : "-", para: nome }
    ]);

    fecharModalPerfil();
    await carregarDetalheCliente(clienteAtualId);
    renderPerfis();
    renderHistorico();
}

async function removerPerfil(idx) {
    const c = getClienteAtual();
    if (!confirm("Remover este perfil de backup?")) return;
    const perfil = c.perfis[idx];

    const { error } = await db.from('perfis_backup').delete().eq('id', perfil.id);
    if (error) {
        alert('Erro ao remover o perfil no banco: ' + error.message);
        console.error(error);
        return;
    }

    await registrarHistorico(clienteAtualId, "Usuário Demo", [{ campo: "Perfil de Backup", de: perfil.nome, para: "Removido" }]);

    await carregarDetalheCliente(clienteAtualId);
    renderPerfis();
    renderHistorico();
}

// Cria o login do cliente no Supabase Auth (se ele ainda não tiver um) e vincula ao cadastro.
// Retorna { email, senha } se criou agora, null se já existia, ou { erro } se algo falhou.
async function garantirAcessoPortal(c) {
    if (c.authUserId) return null; // já tem acesso, nada a fazer aqui
    if (!c.email) return { erro: "Cliente sem e-mail cadastrado." };

    const senhaTemp = gerarSenhaTemporaria();
    const { data, error } = await dbAuthOnly.auth.signUp({ email: c.email, password: senhaTemp });
    if (error) {
        if (error.message.includes('already registered')) {
            return { erro: "Já existe uma conta de login com esse e-mail, sem vínculo com este cliente. Verifique em Authentication → Users no Supabase (pode ser um funcionário com o mesmo e-mail, ou uma tentativa anterior que falhou)." };
        }
        return { erro: error.message };
    }

    const { error: e2 } = await db.from('clientes').update({ auth_user_id: data.user.id }).eq('id', c.id);
    if (e2) return { erro: e2.message };

    return { email: c.email, senha: senhaTemp };
}

async function enviarLinkAceite() {
    const c = getClienteAtual();
    if (c.perfis.length === 0 || c.status !== 'lead') return;

    const { error } = await db.from('clientes').update({ status: 'aguardando' }).eq('id', c.id);
    if (error) {
        alert('Erro ao atualizar status no banco: ' + error.message);
        console.error(error);
        return;
    }

    const acesso = await garantirAcessoPortal(c);

    await registrarHistorico(c.id, "Sistema", [{ campo: "Status", de: "Lead", para: "Aguardando Aceite" }]);

    await carregarClientes();
    await carregarDetalheCliente(c.id);
    renderDetalhe();

    if (acesso && acesso.senha) {
        mostrarCredenciais("Credenciais de acesso ao Portal do Cliente (repasse até termos e-mail automático — Passo 7):", acesso.email, acesso.senha);
    } else if (acesso && acesso.erro) {
        alert("Status atualizado, mas houve um erro ao criar o acesso do cliente: " + acesso.erro);
    } else {
        alert("Link de aceite enviado (simulação). Status alterado para 'Aguardando Aceite'.");
    }
}

async function gerarAcessoPortal() {
    const c = getClienteAtual();
    if (!c.email) {
        alert("Cadastre um e-mail antes de gerar o acesso do cliente.");
        return;
    }
    if (c.authUserId) {
        alert("Este cliente já tem uma conta de acesso criada (" + c.email + "). A redefinição de senha vai ficar disponível quando configurarmos o envio automático de e-mails (Passo 7).");
        return;
    }
    if (!confirm("Criar acesso ao Portal do Cliente para " + c.email + "?")) return;

    const resultado = await garantirAcessoPortal(c);
    if (resultado.erro) {
        alert('Erro ao criar acesso: ' + resultado.erro);
        return;
    }

    await registrarHistorico(c.id, "Usuário Demo", [{ campo: "Acesso ao Portal", de: "-", para: "Criado (" + c.email + ")" }]);
    await carregarClientes();
    await carregarDetalheCliente(c.id);
    renderDetalhe();

    mostrarCredenciais("Acesso ao Portal do Cliente criado com sucesso:", resultado.email, resultado.senha);
}

async function confirmarAceiteManual() {
    const c = getClienteAtual();
    if (c.status !== 'aguardando') return;
    if (!confirm("Confirmar que o cliente aceitou o contrato? Isso vai ativar o cliente agora.")) return;

    const { error } = await db.from('clientes').update({ status: 'ativo' }).eq('id', c.id);
    if (error) {
        alert('Erro ao ativar cliente no banco: ' + error.message);
        console.error(error);
        return;
    }

    await registrarHistorico(c.id, "Usuário Demo", [
        { campo: "Status", de: "Aguardando Aceite", para: "Ativo" },
        { campo: "Dados de adesão", de: "-", para: "Confirmado manualmente pelo administrador (aceite fora do portal)" }
    ]);

    await carregarClientes();
    await carregarDetalheCliente(c.id);
    renderDetalhe();
    alert("Cliente ativado com sucesso!");
}

// ---------- Histórico ----------
function renderHistorico() {
    const c = getClienteAtual();
    const lista = document.getElementById('lista-historico');
    if (c.historico.length === 0) {
        lista.innerHTML = `<div class="empty-state"><p>Nenhum evento registrado ainda.</p></div>`;
        return;
    }
    lista.innerHTML = c.historico.map(ev => `
        <div class="historico-evento">
            <div class="evento-header">${ev.dataHora} - <span class="usuario">${ev.usuario}</span></div>
            ${ev.campos.map(campo => `
                <div class="historico-campo">
                    <span class="campo-nome">${campo.campo} alterado</span>
                    <div class="de-para">de: <b>${campo.de}</b></div>
                    <div class="de-para">para: <b>${campo.para}</b></div>
                </div>
            `).join('')}
        </div>
    `).join('');
}

// ---------- Financeiro (por cliente) ----------
const statusFaturaLabel = { aberto: "Em Aberto", pago: "Pago", atrasado: "Atrasado" };
const statusFaturaClass = { aberto: "status-aguardando", pago: "status-ativo", atrasado: "status-cancelado" };

function referenciaAtual() {
    const hoje = new Date();
    return String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
}

function renderFinanceiro() {
    const c = getClienteAtual();
    const podeFinanceiro = !!(meuAdminInfo && meuAdminInfo.pode_financeiro);

    document.getElementById('financeiro-resumo').innerHTML =
        `Plano: <strong>${c.plano.nome || '-'}</strong> · Valor: <strong>R$ ${c.plano.valor.toFixed(2)}</strong> · Ciclo: <strong>${c.plano.ciclo}</strong>`;

    const ref = referenciaAtual();
    const jaTemFaturaDoMes = c.faturas.some(f => f.referencia === ref);
    const acoesEl = document.getElementById('financeiro-acoes');
    if (podeFinanceiro && c.plano.valor > 0 && !jaTemFaturaDoMes) {
        acoesEl.innerHTML = `<button class="btn-new" onclick="gerarFaturaManual()">+ Gerar Fatura (Referência ${ref})</button>`;
    } else {
        acoesEl.innerHTML = '';
    }

    const tbody = document.getElementById('lista-faturas');
    if (c.faturas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:30px;">Nenhuma fatura gerada ainda.</td></tr>`;
        return;
    }
    tbody.innerHTML = c.faturas.map((f, idx) => `
        <tr>
            <td>${f.referencia}</td>
            <td>R$ ${f.valor.toFixed(2)}</td>
            <td>${calcularVencimento(f.referencia, c.plano.diaVencimento)}</td>
            <td><span class="status ${statusFaturaClass[f.status]}">${statusFaturaLabel[f.status]}</span></td>
            <td>${podeFinanceiro ? `
                <button class="btn-action" onclick="abrirModalBoleto(${idx})">📄 Gerar Boleto</button>
                <button class="btn-action" onclick="emitirNFSe(${idx})">🧾 Emitir NFSe</button>
            ` : `<span style="color:var(--muted); font-size:12px;">Sem acesso</span>`}</td>
        </tr>
    `).join('');
}

async function gerarFaturaManual() {
    const c = getClienteAtual();
    const ref = referenciaAtual();
    const { error } = await db.from('faturas').insert({ cliente_id: c.id, referencia: ref, valor: c.plano.valor, status: 'aberto' });
    if (error) {
        alert('Erro ao gerar fatura: ' + error.message);
        console.error(error);
        return;
    }
    await registrarHistorico(c.id, "Usuário Demo", [{ campo: "Fatura", de: "-", para: "Gerada manualmente (" + ref + ") - R$ " + c.plano.valor.toFixed(2) }]);
    await carregarDetalheCliente(c.id);
    renderFinanceiro();
    renderHistorico();
}

function calcularVencimento(referencia, dia) {
    const [mes, ano] = referencia.split('/');
    const diaFmt = String(dia || 10).padStart(2, '0');
    return `${diaFmt}/${mes}/${ano}`;
}

function gerarLinhaDigitavelFake(cliente_id, valor) {
    // Apenas visual — não é uma linha digitável bancária real
    const base = (cliente_id || '00000000').replace(/\D/g, '').padEnd(8, '0').slice(0, 8);
    const valorStr = String(Math.round(valor * 100)).padStart(10, '0');
    return `341${base.slice(0,5)}.${base.slice(5,8)}1 00000.${valorStr.slice(0,6)} 1 ${valorStr}`;
}

let boletoFaturaAtual = null;

function abrirModalBoleto(idx) {
    const c = getClienteAtual();
    const fatura = c.faturas[idx];
    boletoFaturaAtual = fatura;

    document.getElementById('boleto-pagador').textContent = c.razaoSocial;
    document.getElementById('boleto-cnpj').textContent = c.cnpj;
    document.getElementById('boleto-referencia').textContent = fatura.referencia;
    document.getElementById('boleto-vencimento').textContent = calcularVencimento(fatura.referencia, c.plano.diaVencimento);
    document.getElementById('boleto-valor').textContent = 'R$ ' + fatura.valor.toFixed(2);
    document.getElementById('boleto-linha-digitavel').textContent = gerarLinhaDigitavelFake(c.id, fatura.valor);

    document.getElementById('modal-boleto').style.display = 'flex';
}

function fecharModalBoleto() {
    boletoFaturaAtual = null;
    document.getElementById('modal-boleto').style.display = 'none';
}

function enviarBoletoEmail() {
    const c = getClienteAtual();
    alert("Boleto enviado (simulação) para o e-mail " + c.email + ".");
}

function salvarBoletoPDF() {
    const conteudo = document.querySelector('#modal-boleto .boleto-box').outerHTML;
    const janela = window.open('', '_blank');
    janela.document.write(`
        <html><head><title>Boleto</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 30px; }
            .boleto-box { border: 1.5px solid #0f172a; border-radius: 6px; padding: 18px; max-width: 500px; }
            .boleto-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; font-size: 13px; color: #64748b; }
            .boleto-header strong { font-size: 15px; color: #0f172a; }
            .boleto-linha { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px dashed #e2e8f0; }
            .boleto-linha span { color: #64748b; }
            .boleto-linha.boleto-valor b { font-size: 18px; color: #2563eb; }
            .boleto-codigo { margin-top: 14px; font-family: 'Courier New', monospace; font-size: 13px; background: #f1f5f9; padding: 8px 10px; border-radius: 4px; text-align: center; }
            .boleto-barras { margin-top: 10px; height: 40px; background: repeating-linear-gradient(90deg, #0f172a 0px, #0f172a 2px, transparent 2px, transparent 5px, #0f172a 5px, #0f172a 8px, transparent 8px, transparent 10px); }
        </style>
        </head><body>${conteudo}</body></html>
    `);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);
}

function emitirNFSe(idx) {
    const c = getClienteAtual();
    alert("NFSe emitida (simulação) para a referência " + c.faturas[idx].referencia + ".");
}


// ---------- Faturamento em lote ----------
let clienteIdsFaturadosNoMes = new Set();

async function carregarFaturasDoMes() {
    const ref = referenciaAtual();
    const { data, error } = await db.from('faturas').select('cliente_id').eq('referencia', ref);
    if (error) {
        console.error(error);
        clienteIdsFaturadosNoMes = new Set();
        return;
    }
    clienteIdsFaturadosNoMes = new Set((data || []).map(r => r.cliente_id));
}

async function abrirFaturamento() {
    document.getElementById('view-lista').style.display = 'none';
    document.getElementById('view-faturamento').style.display = 'block';
    document.getElementById('faturamento-mes-label').textContent = "Referência: " + referenciaAtual();
    await carregarFaturasDoMes();
    renderFaturamento();
}

function voltarListaDeFaturamento() {
    document.getElementById('view-faturamento').style.display = 'none';
    document.getElementById('view-lista').style.display = 'block';
    renderLista();
}

function clientesPendentesDeFaturamento() {
    return clientes.filter(c =>
        c.status === 'ativo' &&
        c.plano.ciclo === 'mensal' &&
        !clienteIdsFaturadosNoMes.has(c.id)
    );
}

function alternarPeriodoFaturamento() {
    const personalizado = document.getElementById('fat-periodo').value === 'personalizado';
    document.getElementById('fat-label-de').style.display = personalizado ? 'flex' : 'none';
    document.getElementById('fat-label-ate').style.display = personalizado ? 'flex' : 'none';
    renderFaturamento();
}

function renderFaturamento() {
    const busca = (document.getElementById('fat-busca').value || '').toLowerCase();
    const periodo = document.getElementById('fat-periodo').value;

    let diaDe = 1, diaAte = 31;
    if (periodo === 'personalizado') {
        const dataDe = document.getElementById('fat-data-de').value;
        const dataAte = document.getElementById('fat-data-ate').value;
        diaDe = dataDe ? new Date(dataDe + 'T00:00:00').getDate() : 1;
        diaAte = dataAte ? new Date(dataAte + 'T00:00:00').getDate() : 31;
    }

    let pendentes = clientesPendentesDeFaturamento();

    pendentes = pendentes.filter(c => {
        const bateBusca = !busca || c.razaoSocial.toLowerCase().includes(busca) || c.cnpj.includes(busca);
        const dia = c.plano.diaVencimento || 0;
        const bateData = periodo === 'mensal' || (dia >= diaDe && dia <= diaAte);
        return bateBusca && bateData;
    });

    const tbody = document.getElementById('tbody-faturamento');

    if (pendentes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:40px;">Nenhum cliente pendente de faturamento com esses filtros. 🎉</td></tr>`;
    } else {
        tbody.innerHTML = pendentes.map(c => `
            <tr>
                <td><input type="checkbox" class="check-fat" data-id="${c.id}" checked onchange="atualizarTotaisFaturamento()"></td>
                <td>${c.razaoSocial}</td>
                <td>${c.plano.nome || '-'}</td>
                <td>${c.plano.diaVencimento || '-'}</td>
                <td>R$ ${c.plano.valor.toFixed(2)}</td>
                <td><span class="status status-aguardando">Pendente</span></td>
            </tr>
        `).join('');
    }
    atualizarTotaisFaturamento();
}

function atualizarTotaisFaturamento() {
    const marcados = Array.from(document.querySelectorAll('.check-fat:checked')).map(i => i.dataset.id);
    const selecionados = clientes.filter(c => marcados.includes(c.id));
    const total = selecionados.reduce((soma, c) => soma + c.plano.valor, 0);

    document.getElementById('faturamento-total').textContent = "R$ " + total.toFixed(2);
    document.getElementById('faturamento-qtd').textContent = selecionados.length;
}

function alternarTodosFaturamento(checkbox) {
    document.querySelectorAll('.check-fat').forEach(i => i.checked = checkbox.checked);
    atualizarTotaisFaturamento();
}

async function gerarBoletosLote() {
    const ref = referenciaAtual();
    const marcados = Array.from(document.querySelectorAll('.check-fat:checked')).map(i => i.dataset.id);
    if (marcados.length === 0) {
        alert("Selecione ao menos um cliente para gerar os boletos.");
        return;
    }

    for (const id of marcados) {
        const c = clientes.find(cl => cl.id === id);
        const { error } = await db.from('faturas').insert({
            cliente_id: id, referencia: ref, valor: c.plano.valor, status: 'aberto'
        });
        if (error) {
            alert('Erro ao gerar boleto para ' + c.razaoSocial + ': ' + error.message);
            console.error(error);
            continue;
        }
        await registrarHistorico(id, "Usuário Demo", [{ campo: "Fatura", de: "-", para: "Boleto gerado (" + ref + ") - R$ " + c.plano.valor.toFixed(2) }]);
    }

    alert(marcados.length + " boleto(s) gerado(s) para a referência " + ref + " (simulação).");
    await carregarFaturasDoMes();
    renderFaturamento();
}

// ---------- Autenticação ----------
let meuAdminInfo = null;

async function verificarSessao() {
    const { data: { session } } = await db.auth.getSession();
    if (session) {
        mostrarApp();
    } else {
        mostrarLogin();
    }
}

async function mostrarApp() {
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-trocar-senha').style.display = 'none';
    await carregarMeuAdminInfo();

    if (meuAdminInfo.deve_trocar_senha) {
        document.getElementById('view-trocar-senha').style.display = 'flex';
        return;
    }

    document.getElementById('app-crm').style.display = 'block';
    carregarClientes();
    atualizarBadgeChamados();
}

async function carregarMeuAdminInfo() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    const { data, error } = await db.from('admins').select('*').eq('user_id', session.user.id).single();
    if (error) {
        console.error(error);
        meuAdminInfo = { super_admin: false, pode_financeiro: false, deve_trocar_senha: false };
    } else {
        meuAdminInfo = data;
    }
    document.getElementById('btn-usuarios').style.display = meuAdminInfo.super_admin ? 'inline-block' : 'none';
    document.getElementById('btn-faturamento').style.display = meuAdminInfo.pode_financeiro ? 'inline-block' : 'none';
}

async function salvarTrocaSenha() {
    const novaSenha = document.getElementById('ts-nova-senha').value;
    const confirmaSenha = document.getElementById('ts-confirma-senha').value;
    const erroEl = document.getElementById('ts-erro');
    erroEl.style.display = 'none';

    if (!novaSenha || novaSenha.length < 6) {
        erroEl.textContent = 'A senha deve ter pelo menos 6 caracteres.';
        erroEl.style.display = 'block';
        return;
    }
    if (novaSenha !== confirmaSenha) {
        erroEl.textContent = 'As senhas não coincidem.';
        erroEl.style.display = 'block';
        return;
    }

    const { error: e1 } = await db.auth.updateUser({ password: novaSenha });
    if (e1) {
        erroEl.textContent = 'Erro ao trocar senha: ' + e1.message;
        erroEl.style.display = 'block';
        return;
    }

    const { error: e2 } = await db.rpc('mark_password_changed');
    if (e2) {
        erroEl.textContent = 'Senha trocada, mas houve um erro ao liberar o acesso: ' + e2.message + '. Tente atualizar a página.';
        erroEl.style.display = 'block';
        console.error(e2);
        return;
    }

    document.getElementById('ts-nova-senha').value = '';
    document.getElementById('ts-confirma-senha').value = '';
    document.getElementById('view-trocar-senha').style.display = 'none';
    document.getElementById('app-crm').style.display = 'block';
    meuAdminInfo.deve_trocar_senha = false;
    carregarClientes();
}

function mostrarLogin() {
    document.getElementById('app-crm').style.display = 'none';
    document.getElementById('view-trocar-senha').style.display = 'none';
    document.getElementById('view-login').style.display = 'flex';
}

async function fazerLogin() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const erroEl = document.getElementById('login-erro');
    erroEl.style.display = 'none';

    if (!email || !senha) {
        erroEl.textContent = 'Preencha e-mail e senha.';
        erroEl.style.display = 'block';
        return;
    }

    const { error } = await db.auth.signInWithPassword({ email, password: senha });
    if (error) {
        erroEl.textContent = 'E-mail ou senha inválidos.';
        erroEl.style.display = 'block';
        return;
    }
    mostrarApp();
}

async function fazerLogout() {
    await db.auth.signOut();
    meuAdminInfo = null;
    mostrarLogin();
}

// ---------- Modal de Credenciais (com botão de copiar) ----------
function mostrarCredenciais(contexto, email, senha) {
    document.getElementById('cred-contexto').textContent = contexto;
    document.getElementById('cred-email').value = email;
    document.getElementById('cred-senha').value = senha;
    document.getElementById('modal-credenciais').style.display = 'flex';
}

function fecharModalCredenciais() {
    document.getElementById('modal-credenciais').style.display = 'none';
}

function copiarCredencial(inputId) {
    const el = document.getElementById(inputId);
    el.select();
    el.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(el.value).then(() => {
        alert('Copiado!');
    }).catch(() => {
        alert('Não foi possível copiar automaticamente — selecione o texto manualmente.');
    });
}

// ---------- Gerenciar Usuários (Super Admin) ----------
function abrirUsuarios() {
    document.getElementById('view-lista').style.display = 'none';
    document.getElementById('view-usuarios').style.display = 'block';
    carregarUsuarios();
}

function voltarListaDeUsuarios() {
    document.getElementById('view-usuarios').style.display = 'none';
    document.getElementById('view-lista').style.display = 'block';
    renderLista();
}

async function carregarUsuarios() {
    const { data, error } = await db.from('admins').select('*').order('nome');
    const tbody = document.getElementById('tbody-usuarios');
    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:30px;">Erro ao carregar usuários.</td></tr>`;
        console.error(error);
        return;
    }
    tbody.innerHTML = data.map(a => `
        <tr>
            <td>${a.nome || '-'}</td>
            <td>${a.email || '-'}</td>
            <td>${a.super_admin ? '👑 Super Admin' : 'Admin'}</td>
            <td>${a.pode_financeiro ? '✅ Sim' : '❌ Não'}</td>
            <td><button class="btn-action" onclick="gerarNovaSenhaUsuario('${a.user_id}', '${a.email}')">🔑 Gerar Nova Senha</button></td>
        </tr>
    `).join('');
}

async function gerarNovaSenhaUsuario(userId, email) {
    if (!confirm("Gerar uma nova senha temporária para " + email + "?\n\nA senha atual dessa pessoa deixará de funcionar.")) return;

    const { data, error } = await db.functions.invoke('reset-password', { body: { userId } });
    if (error) {
        alert('Erro ao chamar a função de redefinição: ' + error.message);
        console.error(error);
        return;
    }
    if (data && data.error) {
        alert('Erro: ' + data.error);
        return;
    }

    mostrarCredenciais("Nova senha temporária gerada:", email, data.senha);
}

function abrirModalUsuario() {
    document.getElementById('u-nome').value = '';
    document.getElementById('u-email').value = '';
    document.getElementById('u-financeiro').checked = false;
    document.getElementById('modal-usuario').style.display = 'flex';
}

function fecharModalUsuario() {
    document.getElementById('modal-usuario').style.display = 'none';
}

function gerarSenhaTemporaria() {
    return Math.random().toString(36).slice(-8) + "Aa1!";
}

async function criarUsuario() {
    const nome = document.getElementById('u-nome').value.trim();
    const email = document.getElementById('u-email').value.trim();
    const podeFinanceiro = document.getElementById('u-financeiro').checked;

    if (!nome || !email) {
        alert("Preencha nome e e-mail.");
        return;
    }

    const senhaTemp = gerarSenhaTemporaria();
    const { data, error } = await dbAuthOnly.auth.signUp({ email, password: senhaTemp });
    if (error) {
        if (error.message.includes('already registered')) {
            alert('Já existe uma conta de login com esse e-mail, mas sem usuário vinculado no CRM (provavelmente uma tentativa anterior que falhou no meio do caminho).\n\nVá em Authentication → Users no Supabase, apague esse e-mail, e tente criar de novo.');
        } else {
            alert('Erro ao criar login: ' + error.message);
        }
        console.error(error);
        return;
    }

    const { error: e2 } = await db.from('admins').insert({
        user_id: data.user.id, nome, email, super_admin: false, pode_financeiro: podeFinanceiro, deve_trocar_senha: true
    });
    if (e2) {
        alert('Erro ao salvar permissões do usuário: ' + e2.message);
        console.error(e2);
        return;
    }

    fecharModalUsuario();
    await carregarUsuarios();
    mostrarCredenciais("Usuário criado com sucesso:", email, senhaTemp);
}

// ---------- Chamados / Chat (admin) ----------
let chamadosAdminCache = [];
let chamadoAdminSelecionadoId = null;
let ultimoTotalNaoLidasAdmin = 0;

function tocarSomAdmin() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = 740;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        o.start();
        o.stop(ctx.currentTime + 0.35);
    } catch (e) { /* navegador sem suporte a áudio, ignora */ }
}

function chamadoTemMensagemNaoLida(ch) {
    const msgsCliente = (ch.mensagens_chamado || []).filter(m => m.autor_tipo === 'cliente');
    if (msgsCliente.length === 0) return false;
    const ultimaData = msgsCliente.reduce((max, m) => m.criado_em > max ? m.criado_em : max, msgsCliente[0].criado_em);
    if (!ch.admin_visto_em) return true;
    return ultimaData > ch.admin_visto_em;
}

async function atualizarBadgeChamados() {
    const { data, error } = await db.from('chamados').select('admin_visto_em, mensagens_chamado(autor_tipo, criado_em)');
    const badge = document.getElementById('badge-chamados');
    if (error) { console.error(error); return; }
    const qtdNaoLidas = (data || []).filter(chamadoTemMensagemNaoLida).length;
    if (qtdNaoLidas > ultimoTotalNaoLidasAdmin) tocarSomAdmin();
    ultimoTotalNaoLidasAdmin = qtdNaoLidas;
    if (qtdNaoLidas > 0) {
        badge.textContent = qtdNaoLidas;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function abrirChamadosAdmin() {
    document.getElementById('view-lista').style.display = 'none';
    document.getElementById('view-chamados-admin').style.display = 'block';
    chamadoAdminSelecionadoId = null;
    document.getElementById('chamado-admin-vazio').style.display = 'block';
    document.getElementById('chamado-admin-conteudo').style.display = 'none';
    carregarChamadosAdmin();
}

function voltarListaDeChamadosAdmin() {
    document.getElementById('view-chamados-admin').style.display = 'none';
    document.getElementById('view-lista').style.display = 'block';
    renderLista();
}

async function carregarChamadosAdmin() {
    const { data, error } = await db.from('chamados')
        .select('*, clientes(razao_social), mensagens_chamado(*)')
        .order('criado_em', { ascending: false });

    const lista = document.getElementById('lista-chamados-admin');
    if (error) {
        lista.innerHTML = `<div class="empty-state"><p>Erro ao carregar chamados.</p></div>`;
        console.error(error);
        return;
    }

    chamadosAdminCache = data || [];

    if (chamadosAdminCache.length === 0) {
        lista.innerHTML = `<div class="empty-state"><p>Nenhum chamado ainda.</p></div>`;
    } else {
        lista.innerHTML = chamadosAdminCache.map(ch => {
            const naoLida = chamadoTemMensagemNaoLida(ch);
            const msgs = (ch.mensagens_chamado || []).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
            const ultima = msgs[msgs.length - 1];
            return `
                <div class="chamado-item ${ch.id === chamadoAdminSelecionadoId ? 'selecionado' : ''}" onclick="selecionarChamadoAdmin('${ch.id}')">
                    <div class="chamado-item-topo">
                        <span class="chamado-cliente-nome">${ch.clientes ? ch.clientes.razao_social : 'Cliente'}</span>
                        ${naoLida ? '<span class="dot-nao-lida"></span>' : ''}
                    </div>
                    <div class="chamado-assunto">${ch.assunto}${ultima ? ' — ' + ultima.texto : ''}</div>
                    <div class="chamado-data">${formatarDataHora(ch.criado_em)} · <span class="status ${statusChamadoClass[ch.status]}">${statusChamadoLabel[ch.status]}</span></div>
                </div>
            `;
        }).join('');
    }

    atualizarBadgeChamados();
}

const statusChamadoLabel = { aberto: "Aberto", andamento: "Em Andamento", resolvido: "Resolvido" };
const statusChamadoClass = { aberto: "status-aguardando", andamento: "status-aguardando", resolvido: "status-ativo" };

async function selecionarChamadoAdmin(id) {
    chamadoAdminSelecionadoId = id;
    document.getElementById('chamado-admin-vazio').style.display = 'none';
    document.getElementById('chamado-admin-conteudo').style.display = 'flex';

    // Marca como visto (zera o não lida) antes de renderizar
    await db.from('chamados').update({ admin_visto_em: new Date().toISOString() }).eq('id', id);

    await renderChamadoAdminDetalhe();
    await carregarChamadosAdmin(); // atualiza a lista (tira o pontinho, recalcula badge)
}

async function renderChamadoAdminDetalhe() {
    const ch = chamadosAdminCache.find(c => c.id === chamadoAdminSelecionadoId) || { assunto: '', clientes: {}, status: 'aberto' };
    document.getElementById('chamado-admin-titulo').textContent = ch.assunto;
    document.getElementById('chamado-admin-cliente').textContent = ch.clientes ? ch.clientes.razao_social : '';
    document.getElementById('chamado-admin-status').value = ch.status;

    const inputEl = document.getElementById('chat-input-admin');
    const botaoEnviar = document.getElementById('btn-enviar-chamado-admin');
    const resolvido = ch.status === 'resolvido';
    inputEl.disabled = resolvido;
    botaoEnviar.disabled = resolvido;
    inputEl.placeholder = resolvido ? 'Chamado resolvido. Mude o status para reabrir, se precisar responder.' : 'Escreva uma resposta...';

    const { data, error } = await db.from('mensagens_chamado').select('*').eq('chamado_id', chamadoAdminSelecionadoId).order('criado_em', { ascending: true });
    const thread = document.getElementById('chat-thread-admin');
    if (error) {
        thread.innerHTML = '<p style="color:var(--muted);">Erro ao carregar mensagens.</p>';
        console.error(error);
        return;
    }
    thread.innerHTML = (data || []).map(m => `
        <div class="msg ${m.autor_tipo === 'cliente' ? 'msg-cliente' : 'msg-suporte'}">
            ${m.texto}
            <div class="msg-meta">${m.autor_tipo === 'cliente' ? (ch.clientes ? ch.clientes.razao_social : 'Cliente') : (m.autor_nome || 'Você')} · ${formatarDataHora(m.criado_em)}</div>
        </div>
    `).join('');
    thread.scrollTop = thread.scrollHeight;
}

async function enviarMensagemChamadoAdmin() {
    const texto = document.getElementById('chat-input-admin').value.trim();
    if (!texto || !chamadoAdminSelecionadoId) return;

    const { error } = await db.from('mensagens_chamado').insert({
        chamado_id: chamadoAdminSelecionadoId, autor_tipo: 'suporte',
        autor_nome: (meuAdminInfo && meuAdminInfo.nome) || 'Suporte', texto
    });
    if (error) {
        alert('Erro ao enviar mensagem: ' + error.message);
        console.error(error);
        return;
    }

    // Já marca como visto (a própria resposta não deveria contar como não lida pra você depois)
    await db.from('chamados').update({ admin_visto_em: new Date().toISOString() }).eq('id', chamadoAdminSelecionadoId);

    document.getElementById('chat-input-admin').value = '';
    tocarSomAdmin();
    await renderChamadoAdminDetalhe();
    await carregarChamadosAdmin();
}

async function mudarStatusChamadoAdmin() {
    const novoStatus = document.getElementById('chamado-admin-status').value;
    const { error } = await db.from('chamados').update({ status: novoStatus }).eq('id', chamadoAdminSelecionadoId);
    if (error) {
        alert('Erro ao atualizar status: ' + error.message);
        console.error(error);
        return;
    }
    await carregarChamadosAdmin();
}

function abrirModalNovoChamadoAdmin() {
    const select = document.getElementById('nca-cliente');
    select.innerHTML = clientes
        .filter(c => c.status !== 'cancelado')
        .map(c => `<option value="${c.id}">${c.razaoSocial}</option>`)
        .join('');
    document.getElementById('nca-assunto').value = '';
    document.getElementById('nca-mensagem').value = '';
    document.getElementById('modal-novo-chamado-admin').style.display = 'flex';
}

function fecharModalNovoChamadoAdmin() {
    document.getElementById('modal-novo-chamado-admin').style.display = 'none';
}

async function criarChamadoAdmin() {
    const clienteId = document.getElementById('nca-cliente').value;
    const categoria = document.getElementById('nca-categoria').value;
    const assunto = document.getElementById('nca-assunto').value.trim();
    const mensagem = document.getElementById('nca-mensagem').value.trim();

    if (!clienteId || !assunto || !mensagem) {
        alert('Preencha cliente, assunto e a mensagem inicial.');
        return;
    }

    const { data, error } = await db.from('chamados').insert({
        cliente_id: clienteId, assunto, categoria, status: 'aberto', admin_visto_em: new Date().toISOString()
    }).select().single();
    if (error) {
        alert('Erro ao abrir chamado: ' + error.message);
        console.error(error);
        return;
    }

    const { error: e2 } = await db.from('mensagens_chamado').insert({
        chamado_id: data.id, autor_tipo: 'suporte', autor_nome: (meuAdminInfo && meuAdminInfo.nome) || 'Suporte', texto: mensagem
    });
    if (e2) { console.error(e2); }

    fecharModalNovoChamadoAdmin();
    await carregarChamadosAdmin();
    selecionarChamadoAdmin(data.id);
}

// ---------- Propostas / Orçamento ----------
// Dados fixos do fornecedor — ajuste aqui com os dados reais da Haus Pro Solutions
const FORNECEDOR = {
    nome: "Haus Pro Solutions",
    cnpj: "00.000.000/0000-00", // TODO: ajustar com o CNPJ real
    endereco: "Cascavel - PR", // TODO: ajustar com o endereço real
    telefone: "(45) 00000-0000", // TODO: ajustar com o telefone real
    email: "contato@hps.dev.br"
};
const MARCA_DAGUA_TEXTO = "HAUS PRO SOLUTIONS";

let itensPropostaAtual = [];
let propostasCache = [];

function abrirPropostas() {
    document.getElementById('view-lista').style.display = 'none';
    document.getElementById('view-propostas').style.display = 'block';
    document.getElementById('propostas-form-view').style.display = 'none';
    document.getElementById('propostas-lista-view').style.display = 'block';
    carregarPropostas();
}

function voltarListaDePropostas() {
    document.getElementById('view-propostas').style.display = 'none';
    document.getElementById('view-lista').style.display = 'block';
    renderLista();
}

async function carregarPropostas() {
    const { data, error } = await db.from('propostas').select('*').order('numero', { ascending: false });
    const tbody = document.getElementById('tbody-propostas');
    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:30px;">Erro ao carregar propostas.</td></tr>`;
        console.error(error);
        return;
    }
    propostasCache = data || [];
    if (propostasCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:30px;">Nenhuma proposta gerada ainda.</td></tr>`;
        return;
    }
    tbody.innerHTML = propostasCache.map(p => `
        <tr>
            <td>Nº ${p.numero}</td>
            <td>${p.cliente_nome}</td>
            <td>${formatarData(p.data_proposta)}</td>
            <td>R$ ${parseFloat(p.valor_total).toFixed(2)}</td>
            <td><button class="btn-action" onclick="reimprimirProposta('${p.id}')">🖨️ Ver/Reimprimir</button></td>
        </tr>
    `).join('');
}

function abrirFormNovaProposta() {
    document.getElementById('propostas-lista-view').style.display = 'none';
    document.getElementById('propostas-form-view').style.display = 'block';

    const select = document.getElementById('prop-cliente-select');
    select.innerHTML = '<option value="">— selecionar para preencher automaticamente —</option>' +
        clientes.filter(c => c.status !== 'cancelado').map(c => `<option value="${c.id}">${c.razaoSocial}</option>`).join('');

    document.getElementById('prop-cliente-nome').value = '';
    document.getElementById('prop-cliente-cnpj').value = '';
    document.getElementById('prop-cliente-telefone').value = '';
    document.getElementById('prop-cliente-endereco').value = '';
    document.getElementById('prop-cliente-email').value = '';
    document.getElementById('prop-cidade').value = 'Cascavel - PR';
    document.getElementById('prop-data').value = new Date().toISOString().slice(0, 10);
    document.getElementById('prop-prazo').value = 'Imediato após assinatura do contrato';
    document.getElementById('prop-validade').value = '07 dias';
    document.getElementById('prop-pagamento').value = 'Boleto Bancário | Cartão de Crédito | Pix';

    itensPropostaAtual = [{ descricao: '', quantidade: 1, valorUnitario: 0 }];
    renderItensProposta();
}

function preencherClienteProposta() {
    const id = document.getElementById('prop-cliente-select').value;
    if (!id) return;
    const c = clientes.find(cl => cl.id === id);
    if (!c) return;
    document.getElementById('prop-cliente-nome').value = c.razaoSocial;
    document.getElementById('prop-cliente-cnpj').value = c.cnpj;
    document.getElementById('prop-cliente-telefone').value = c.telefone;
    document.getElementById('prop-cliente-endereco').value = c.endereco;
    document.getElementById('prop-cliente-email').value = c.email;
}

function renderItensProposta() {
    const tbody = document.getElementById('tbody-itens-proposta');
    tbody.innerHTML = itensPropostaAtual.map((item, idx) => `
        <tr>
            <td>${String(idx + 1).padStart(2, '0')}</td>
            <td><input type="text" value="${item.descricao}" oninput="itensPropostaAtual[${idx}].descricao=this.value"></td>
            <td><input type="number" min="1" value="${item.quantidade}" style="width:70px;" oninput="itensPropostaAtual[${idx}].quantidade=parseFloat(this.value)||0; recalcularTotalProposta();"></td>
            <td><input type="number" step="0.01" min="0" value="${item.valorUnitario}" style="width:110px;" oninput="itensPropostaAtual[${idx}].valorUnitario=parseFloat(this.value)||0; recalcularTotalProposta();"></td>
            <td class="valor-total-item">R$ ${(item.quantidade * item.valorUnitario).toFixed(2)}</td>
            <td><button class="btn-action" onclick="removerItemProposta(${idx})">✕</button></td>
        </tr>
    `).join('');
    recalcularTotalProposta();
}

function adicionarItemProposta() {
    itensPropostaAtual.push({ descricao: '', quantidade: 1, valorUnitario: 0 });
    renderItensProposta();
}

function removerItemProposta(idx) {
    if (itensPropostaAtual.length === 1) {
        alert('A proposta precisa ter ao menos um item.');
        return;
    }
    itensPropostaAtual.splice(idx, 1);
    renderItensProposta();
}

function recalcularTotalProposta() {
    document.querySelectorAll('#tbody-itens-proposta tr').forEach((tr, idx) => {
        const item = itensPropostaAtual[idx];
        tr.querySelector('.valor-total-item').textContent = 'R$ ' + (item.quantidade * item.valorUnitario).toFixed(2);
    });
    const total = itensPropostaAtual.reduce((soma, i) => soma + (i.quantidade * i.valorUnitario), 0);
    document.getElementById('prop-valor-total-exibido').textContent = 'R$ ' + total.toFixed(2);
    return total;
}

function formatarDataExtenso(isoDate) {
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const [ano, mes, dia] = isoDate.split('-');
    return `${parseInt(dia)} de ${meses[parseInt(mes) - 1]} de ${ano}`;
}

async function gerarProposta() {
    const clienteNome = document.getElementById('prop-cliente-nome').value.trim();
    const cidade = document.getElementById('prop-cidade').value.trim();
    const dataProposta = document.getElementById('prop-data').value;

    if (!clienteNome || !cidade || !dataProposta) {
        alert('Preencha ao menos o nome do cliente, cidade e data.');
        return;
    }
    if (itensPropostaAtual.every(i => !i.descricao.trim())) {
        alert('Adicione ao menos um item com descrição.');
        return;
    }

    const valorTotal = recalcularTotalProposta();

    const payload = {
        cliente_nome: clienteNome,
        cliente_cnpj: document.getElementById('prop-cliente-cnpj').value.trim(),
        cliente_endereco: document.getElementById('prop-cliente-endereco').value.trim(),
        cliente_telefone: document.getElementById('prop-cliente-telefone').value.trim(),
        cliente_email: document.getElementById('prop-cliente-email').value.trim(),
        cidade,
        data_proposta: dataProposta,
        prazo_entrega: document.getElementById('prop-prazo').value.trim(),
        validade: document.getElementById('prop-validade').value.trim(),
        forma_pagamento: document.getElementById('prop-pagamento').value.trim(),
        itens: itensPropostaAtual,
        valor_total: valorTotal
    };

    const { data, error } = await db.from('propostas').insert(payload).select().single();
    if (error) {
        alert('Erro ao salvar a proposta: ' + error.message);
        console.error(error);
        return;
    }

    imprimirProposta(data);
    voltarListaDePropostas();
}

async function reimprimirProposta(id) {
    const proposta = propostasCache.find(p => p.id === id);
    if (proposta) imprimirProposta(proposta);
}

function imprimirProposta(p) {
    const itens = p.itens || [];
    const linhasItens = itens.map((item, idx) => `
        <tr>
            <td>${String(idx + 1).padStart(2, '0')}</td>
            <td>${item.descricao}</td>
            <td>${String(item.quantidade).padStart(2, '0')}</td>
            <td>R$ ${item.valorUnitario.toFixed(2)}</td>
            <td>R$ ${(item.quantidade * item.valorUnitario).toFixed(2)}</td>
        </tr>
    `).join('');

    const html = `
    <html><head><title>Proposta Nº ${p.numero}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 50px 60px; color: #1e293b; position: relative; }
        .marca-dagua {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 70px; font-weight: bold; color: rgba(37, 99, 235, 0.08); white-space: nowrap; z-index: -1;
        }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .data-linha { color: #475569; margin-bottom: 28px; }
        .duas-colunas { display: flex; gap: 40px; margin-bottom: 26px; }
        .bloco { flex: 1; }
        .bloco h3 { font-size: 13px; text-transform: uppercase; color: #2563eb; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
        .bloco p { font-size: 13px; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 13px; text-align: left; }
        th { background: #f1f5f9; }
        .total-row td { font-weight: bold; background: #f8fafc; text-align: right; }
        .termos { margin-top: 26px; font-size: 13px; line-height: 1.8; }
    </style>
    </head><body>
        <div class="marca-dagua">${MARCA_DAGUA_TEXTO}</div>
        <h1>ORÇAMENTO OU PROPOSTA COMERCIAL Nº ${p.numero}</h1>
        <div class="data-linha">${p.cidade}, ${formatarDataExtenso(p.data_proposta)}.</div>

        <div class="duas-colunas">
            <div class="bloco">
                <h3>Dados do cliente</h3>
                <p><b>Cliente:</b> ${p.cliente_nome}</p>
                <p><b>CNPJ:</b> ${p.cliente_cnpj || '-'}</p>
                <p><b>Endereço:</b> ${p.cliente_endereco || '-'}</p>
                <p><b>Telefone:</b> ${p.cliente_telefone || '-'}</p>
                <p><b>E-mail:</b> ${p.cliente_email || '-'}</p>
            </div>
            <div class="bloco">
                <h3>Dados do fornecedor</h3>
                <p><b>Nome da empresa:</b> ${FORNECEDOR.nome}</p>
                <p><b>CNPJ:</b> ${FORNECEDOR.cnpj}</p>
                <p><b>Endereço:</b> ${FORNECEDOR.endereco}</p>
                <p><b>Telefone:</b> ${FORNECEDOR.telefone}</p>
                <p><b>E-mail:</b> ${FORNECEDOR.email}</p>
            </div>
        </div>

        <h3 style="font-size:13px; text-transform:uppercase; color:#2563eb;">Descrição do(s) produto(s) e/ou serviço(s)</h3>
        <table>
            <thead><tr><th>Item</th><th>Descrição detalhada do Item</th><th>Quant.</th><th>Valor Unitário</th><th>Valor Total</th></tr></thead>
            <tbody>
                ${linhasItens}
                <tr class="total-row"><td colspan="4">VALOR TOTAL DA PROPOSTA</td><td>R$ ${parseFloat(p.valor_total).toFixed(2)}</td></tr>
            </tbody>
        </table>

        <div class="termos">
            <p><b>Prazo/Data de entrega:</b> ${p.prazo_entrega || '-'}</p>
            <p><b>Validade da proposta:</b> ${p.validade || '-'}</p>
            <p><b>Forma de pagamento:</b> ${p.forma_pagamento || '-'}</p>
        </div>
    </body></html>`;

    const janela = window.open('', '_blank');
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);
}

// ---------- Init ----------
verificarSessao();
