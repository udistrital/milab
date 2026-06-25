const express = require('express');

const router = express.Router();

function getAuthenticatedHomePath(user) {
  return user?.tipo ? '/milab/inicio' : null;
}

function redirectToCanonicalPublicRoute(req, res, targetPath) {
  const authenticatedHomePath = getAuthenticatedHomePath(req.session.user);
  if (authenticatedHomePath) {
    return res.redirect(authenticatedHomePath);
  }

  return res.redirect(targetPath);
}

router.get('/', function (req, res) {
  const authenticatedHomePath = getAuthenticatedHomePath(req.session.user);
  if (authenticatedHomePath) {
    return res.redirect(authenticatedHomePath);
  }

  return res.render('home/index_2');
});

router.get('/inicio', function (req, res) {
  if (!req.session?.user) {
    return res.redirect('/milab/');
  }

  return res.render('home/inicio');
});

router.get('/index_2', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/');
});

router.get('/index', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/');
});

router.get('/qrcode', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/');
});

router.get('/generade', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/');
});

router.get('/consulta', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/api/consulta-invit');
});

router.get('/contact', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/');
});

router.get('/reg_multa', function (req, res) {
  res.render('home/reg_multa');
});
router.get('/get-info-multa-docente', function (req, res) {
  res.render('home/get-info-multa-docente');
});

router.get('/validateqr-ok', function (req, res) {
  res.render('home/validateqr-ok');
});

router.get('/validateqr-ok-docente', function (req, res) {
  res.render('home/validateqr-ok-docente');
});

router.get('/validateqr-error', function (req, res) {
  res.render('home/validateqr-error');
});

router.get('/validateqr-error-docente', function (req, res) {
  res.render('home/validateqr-error-docente');
});

router.get('/reg_multa_erase', function (req, res) {
  res.render('home/reg_multa_erase');
});
//Login view
router.get('/auth/login', function (req, res) {
  const authenticatedHomePath = getAuthenticatedHomePath(req.session.user);
  if (authenticatedHomePath) {
    return res.redirect(authenticatedHomePath);
  }

  return res.render('home/login_2', {
    error: null,
    confirmacion: null,
  });
});

router.get('/auth/login_2', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/auth/login');
});

router.get('/login', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/auth/login');
});

router.get('/login_2', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/auth/login');
});

router.get('/register', function (req, res) {
  return res.redirect('/milab/auth/microsoft');
});

router.get('/register_2', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/register');
});

router.get('/laboratoristas_registrados', function (req, res) {
  res.render('home/laboratoristas_registrados');
});
router.get('/estudiantes_registrados', function (req, res) {
  res.render('home/estudiantes_registrados');
});

// Add route for coordinadores_registrados
router.get('/coordinadores_registrados', function (req, res) {
  res.render('home/coordinadores_registrados');
});

router.get('/registro_coordinador', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/api/registro_coordinador/load_info');
});
router.get('/get-info-docente', function (req, res) {
  res.render('home/get-info-docente');
});
router.get('/consulta-invit', function (req, res) {
  return redirectToCanonicalPublicRoute(req, res, '/milab/api/consulta-invit');
});

module.exports = router;
