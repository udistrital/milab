const express = require('express');

const { body } = require('express-validator');
const limiter = require('../middlewares/limiter');

// Variables de entorno
require('dotenv').config();

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post(
  '/login',
  limiter,
  [
    body('documento')
      .isString()
      .notEmpty()
      .escape()
      .withMessage('Por favor ingresa un documento válido'),
    body('password').isString().notEmpty().escape(),
  ],
  async (req, res) => {
    return res.redirect('/auth/microsoft');
  }
);

module.exports = router;
