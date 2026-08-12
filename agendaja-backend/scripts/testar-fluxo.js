// Testa o fluxo ponta a ponta do AgendaJá contra um servidor rodando localmente.
// Uso: npm run dev (num terminal) e depois, em outro terminal: npm run test:fluxo
//
// Cobre: cadastro de empresa + plano -> confirmação de pagamento (rota de dev) ->
// login -> criar serviço -> cadastrar profissional -> definir expediente ->
// cadastrar cliente -> checar disponibilidade -> criar agendamento -> avaliar.

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let passos = 0;
let falhas = 0;

async function chamar(metodo, caminho, body, token) {
  const resp = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const texto = await resp.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: resp.status, dados };
}

function passo(nome, condicao, detalhe) {
  passos++;
  if (condicao) {
    console.log(`✅ ${nome}`);
  } else {
    falhas++;
    console.log(`❌ ${nome}`);
    if (detalhe) console.log('   →', JSON.stringify(detalhe));
  }
}

async function main() {
  const sufixo = Date.now(); // evita colisão de e-mail em execuções repetidas
  console.log(`\nTestando contra ${BASE}\n`);

  // 1. Cadastro de empresa (autoatendimento, plano BASICO)
  const registroEmpresa = await chamar('POST', '/auth/registro', {
    tipo: 'EMPRESA_ADMIN',
    nome: 'Ana Admin',
    email: `admin${sufixo}@teste.com`,
    senha: 'senha1234',
    empresa: {
      nome: 'Studio Teste',
      setor: 'Estética',
      endereco: 'Rua Teste, 123',
      plano: 'BASICO',
    },
  });
  passo('Cadastro de empresa cria assinatura PENDENTE', registroEmpresa.status === 201 && registroEmpresa.dados.assinaturaId, registroEmpresa.dados);
  const assinaturaId = registroEmpresa.dados.assinaturaId;

  // 2. Login deve ser recusado antes do pagamento
  const loginAntesDoPagamento = await chamar('POST', '/auth/login', {
    email: `admin${sufixo}@teste.com`,
    senha: 'senha1234',
  });
  passo('Login bloqueado antes do pagamento (402)', loginAntesDoPagamento.status === 402, loginAntesDoPagamento.dados);

  // 3. Confirmar pagamento (atalho de desenvolvimento)
  const confirmacao = await chamar('POST', `/auth/registro/confirmar-pagamento/${assinaturaId}`);
  passo('Pagamento confirmado libera token', confirmacao.status === 200 && confirmacao.dados.token, confirmacao.dados);
  const tokenAdmin = confirmacao.dados.token;

  // 4. Login agora deve funcionar
  const loginDepois = await chamar('POST', '/auth/login', {
    email: `admin${sufixo}@teste.com`,
    senha: 'senha1234',
  });
  passo('Login funciona depois do pagamento', loginDepois.status === 200 && loginDepois.dados.token, loginDepois.dados);

  // 5. Buscar a empresa recém-criada (rota pública)
  const buscaEmpresas = await chamar('GET', '/empresas?setor=Estética');
  const empresa = buscaEmpresas.dados.find(e => e.nome === 'Studio Teste');
  passo('Empresa aparece na busca pública', !!empresa, buscaEmpresas.dados);
  const empresaId = empresa?.id;

  // 6. Criar um serviço
  const servico = await chamar('POST', '/servicos', {
    empresaId,
    nome: 'Corte de teste',
    duracaoMin: 30,
    preco: 50,
  }, tokenAdmin);
  passo('Serviço criado', servico.status === 201, servico.dados);
  const servicoId = servico.dados.id;

  // 7. Cadastrar um profissional vinculado à empresa
  const registroProfissional = await chamar('POST', '/auth/registro', {
    tipo: 'PROFISSIONAL',
    nome: 'Pedro Profissional',
    email: `prof${sufixo}@teste.com`,
    senha: 'senha1234',
    empresaId,
  });
  passo('Profissional cadastrado', registroProfissional.status === 201 && registroProfissional.dados.token, registroProfissional.dados);
  const tokenProfissional = registroProfissional.dados.token;

  // 8. Buscar o id do profissional (via empresa)
  const empresaDetalhe = await chamar('GET', `/empresas/${empresaId}`);
  const profissionalId = empresaDetalhe.dados.profissionais?.[0]?.id;
  passo('Profissional aparece na empresa', !!profissionalId, empresaDetalhe.dados);

  // 9. Definir expediente (todo dia da semana, 09h-18h, pra garantir disponibilidade no teste)
  const horarios = await chamar('POST', `/profissionais/${profissionalId}/horarios`, {
    horarios: [0, 1, 2, 3, 4, 5, 6].map(diaSemana => ({ diaSemana, horaInicio: '09:00', horaFim: '18:00' })),
  }, tokenProfissional);
  passo('Expediente definido', horarios.status === 201, horarios.dados);

  // 10. Cadastrar um cliente
  const registroCliente = await chamar('POST', '/auth/registro', {
    tipo: 'CLIENTE',
    nome: 'Carla Cliente',
    email: `cliente${sufixo}@teste.com`,
    senha: 'senha1234',
  });
  passo('Cliente cadastrado', registroCliente.status === 201 && registroCliente.dados.token, registroCliente.dados);
  const tokenCliente = registroCliente.dados.token;

  // 11. Checar disponibilidade pra amanhã
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const disponibilidade = await chamar('GET', `/profissionais/${profissionalId}/horarios-livres?data=${amanha}&servicoId=${servicoId}`);
  passo('Disponibilidade retorna horários livres', disponibilidade.dados.horariosLivres?.length > 0, disponibilidade.dados);
  const horarioEscolhido = disponibilidade.dados.horariosLivres?.[0];

  // 12. Criar o agendamento
  const agendamento = await chamar('POST', '/agendamentos', {
    profissionalId,
    servicoId,
    inicio: `${amanha}T${horarioEscolhido}:00`,
  }, tokenCliente);
  passo('Agendamento criado sem conflito', agendamento.status === 201, agendamento.dados);
  const agendamentoId = agendamento.dados.id;

  // 13. Tentar agendar o MESMO horário de novo — deve dar conflito (409)
  const agendamentoDuplicado = await chamar('POST', '/agendamentos', {
    profissionalId,
    servicoId,
    inicio: `${amanha}T${horarioEscolhido}:00`,
  }, tokenCliente);
  passo('Conflito de horário é rejeitado (409)', agendamentoDuplicado.status === 409, agendamentoDuplicado.dados);

  // 14. Profissional avalia o cliente
  const avaliacaoCliente = await chamar('POST', `/avaliacoes/cliente/${agendamentoId}`, {
    compareceu: true, atrasoMais15: false, cancelouTarde: false, nota: 5,
  }, tokenProfissional);
  passo('Avaliação do cliente registrada', avaliacaoCliente.status === 201, avaliacaoCliente.dados);

  // 15. Cliente avalia o profissional
  const avaliacaoProfissional = await chamar('POST', `/avaliacoes/profissional/${agendamentoId}`, {
    pontualidade: 5, qualidade: 5, atendimento: 5, limpeza: 5,
  }, tokenCliente);
  passo('Avaliação do profissional registrada', avaliacaoProfissional.status === 201, avaliacaoProfissional.dados);

  // 16. Nota pública do profissional (sem login)
  const notaPublica = await chamar('GET', `/avaliacoes/profissional/${profissionalId}/resumo`);
  passo('Nota pública do profissional acessível sem login', notaPublica.status === 200 && notaPublica.dados.totalAvaliacoes === 1, notaPublica.dados);

  // 17. Outro profissional (inexistente) NÃO deve ver o histórico do cliente
  const historicoNegado = await chamar('GET', `/avaliacoes/cliente/${registroCliente.dados.usuario.id}`, null, tokenAdmin);
  // tokenAdmin não é de profissional, então isso já deve barrar por tipo (403) — valida a regra de acesso
  passo('Histórico do cliente é protegido (não dá pra acessar sem vínculo)', historicoNegado.status === 403, historicoNegado.dados);

  console.log(`\n${passos - falhas}/${passos} passos passaram.`);
  if (falhas > 0) {
    console.log(`⚠️  ${falhas} falha(s) — confira os detalhes acima.`);
    process.exit(1);
  } else {
    console.log('🎉 Fluxo completo funcionando de ponta a ponta.');
  }
}

main().catch(err => {
  console.error('\n💥 Erro inesperado ao rodar o teste:', err.message);
  console.error('Confira se o servidor está rodando (npm run dev) antes de testar.');
  process.exit(1);
});
