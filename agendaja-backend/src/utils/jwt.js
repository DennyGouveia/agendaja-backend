const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';
const EXPIRA_EM = '7d';

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, tipo: usuario.tipo, email: usuario.email },
    SECRET,
    { expiresIn: EXPIRA_EM }
  );
}

function verificarToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { gerarToken, verificarToken };
