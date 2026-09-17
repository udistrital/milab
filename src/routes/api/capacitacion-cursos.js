const express = require('express');
const { requireJsonRoles } = require('../middlewares/auth');

const router = express.Router();

const requireCursosRead = requireJsonRoles(['admin', 'laboratorista'], {
  message: 'No tiene permisos para consultar el catálogo de cursos.',
});
const requireCursosWrite = requireJsonRoles(['admin'], {
  message: 'Solo los administradores pueden crear, editar o eliminar cursos.',
});

router.get('/list', requireCursosRead, function (req, res) {
  return res.status(200).json({
    ok: true,
    cursos: [],
    _placeholder: true,
    _note: 'Conectar con tabla milab.cursos en la próxima historia de usuario.',
  });
});

router.post('/nuevo', requireCursosWrite, function (req, res) {
  return res.status(200).json({
    ok: true,
    _placeholder: true,
    _note: 'INSERT en milab.cursos pendiente.',
  });
});

router.post('/editar', requireCursosWrite, function (req, res) {
  return res.status(200).json({
    ok: true,
    _placeholder: true,
    _note: 'UPDATE en milab.cursos pendiente.',
  });
});

router.post('/eliminar', requireCursosWrite, function (req, res) {
  return res.status(200).json({
    ok: true,
    _placeholder: true,
    _note: 'UPDATE activo=FALSE en milab.cursos pendiente.',
  });
});

module.exports = router;
