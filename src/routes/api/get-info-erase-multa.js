const axios = require('axios');
const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

require('dotenv').config();

var router = express.Router();

const requireLaboratoristaEraseAccess = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireLaboratoristaEraseAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const { tipo_busqueda, valor_busqueda } = req.body;

  let con_codigo, con_estado, con_documento, con_carrera, con_nombre;
  let multaInfo;

  try {
    // Consulta 1 - Datos básicos del estudiante
    let urlBase;
    if (tipo_busqueda === 'codigo') {
      urlBase =
        'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_estudiante/' +
        valor_busqueda;
    } else {
      urlBase =
        'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        valor_busqueda;
    }

    const respuesta1 = await axios.get(urlBase);
    const dato1 = respuesta1.data;
    const cant_carreras = dato1.datosEstudianteCollection.datosBasicosEstudiante.length;

    con_codigo = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].codigo;
    con_estado = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].estado;
    con_documento =
      dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1]
        .numero_documento_identificacion;
    con_carrera = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].carrera;
    con_nombre = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].nombre;

    // La API OAS no devuelve numero_documento_identificacion, usar el valor de búsqueda original
    if (!con_documento || con_documento === 'undefined' || con_documento === 'null') {
      con_documento = String(valor_busqueda || '');
    }

    // Consulta 2 - Estado académico
    const respuesta2 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/estados_codigo/' +
        con_estado
    );
    con_estado = respuesta2.data.estado.nombre;

    // Consulta 3 - Carrera
    const respuesta3 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/carrera/' +
        con_carrera
    );
    con_carrera = respuesta3.data.carrerasCollection.carrera[0].nombre;

    // Buscar multas por CÓDIGO Y DOCUMENTO (para capturar cualquiera de ambas)
    const sanctionKeys = [
      String(con_codigo || '').trim(),
      String(con_documento || '').trim(),
    ].filter(Boolean);
    const query =
      'SELECT COUNT(*) AS multado FROM multas WHERE cod_multado::text = ANY($1::text[]) AND con_estado_multa = $2';
    const values = [sanctionKeys, 'ACTIVA'];
    const result = await pool.query(query, values);

    if (result.rows[0].multado > 0) {
      const queryMultaInfo =
        'SELECT * FROM multas WHERE cod_multado::text = ANY($1::text[]) AND con_estado_multa = $2';
      const valuesMultaInfo = [sanctionKeys, 'ACTIVA'];
      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;

      console.log(`Cantidad de multas activas: ${multaInfo.length}`);
      console.log(multaInfo);
      // ...existing code...
    } else {
      console.log('El estudiante no tiene multas activas.');
      return res.render('home/alerta-no-multado', {
        message: 'El estudiante no tiene multas activas.',
      });
    }

    // Verificar si es egresado
    if (con_estado === 'EGRESADO') {
      console.log('El estudiante es egresado. No se puede continuar.');
      return res.render('home/alerta-egresado', {
        message: 'El estudiante es egresado. No se puede continuar.',
      });
    }

    // Renderizar vista con datos
    return res.render('home/reg_multa_erase', {
      con_codigo,
      con_estado,
      con_documento,
      con_carrera,
      con_nombre,
      multaInfo,
    });
  } catch (error) {
    console.error('Error durante la consulta:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
