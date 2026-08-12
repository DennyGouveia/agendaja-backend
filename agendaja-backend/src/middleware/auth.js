const { verificarToken } = require('../utils/jwt');

// Exige token válido, popula req.usuario
function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }

  try {
    const payload = verificarToken(header.split(' ')[1]);
    req.usuario = payload; // { id, tipo, email }
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

// Restringe rota a um ou mais tipos de usuário
// Uso: autorizar('EMPRESA_ADMIN', 'PROFISSIONAL')
function autorizar(...tiposPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !tiposPermitidos.includes(req.usuario.tipo)) {
      return res.status(403).json({ erro: 'Acesso não permitido para este tipo de usuário' });
    }
    next();
  };
}

module.exports = { autenticar, autorizar };
