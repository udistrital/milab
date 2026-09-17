const express = require('express');
const { requireJsonRoles } = require('../middlewares/auth');

const router = express.Router();

const requireEquiposAccess = requireJsonRoles(['admin', 'laboratorista'], {
  message: 'No tiene permisos para gestionar la asociación de cursos con equipos.',
});

router.get('/list', requireEquiposAccess, function (req, res) {
  return res.status(200).json({
    ok: true,
    cursos: [],
    equipos: [],
    asociados: [],
    _placeholder: true,
    _note: 'Cruzar milab.cursos + milab.equipo + milab.equipo_especializado.',
  });
});

router.post('/asociar', requireEquiposAccess, function (req, res) {
  return res.status(200).json({
    ok: true,
    _placeholder: true,
    _note: 'INSERT en milab.equipo_especializado (DELETE previo en transacción many-to-many).',
  });
});

router.post('/retirar', requireEquiposAccess, function (req, res) {
  return res.status(200).json({
    ok: true,
    _placeholder: true,
    _note: 'DELETE de fila en milab.equipo_especializado por PK (codigo_curso, id_equipo).',
  });
});

module.exports = router;
