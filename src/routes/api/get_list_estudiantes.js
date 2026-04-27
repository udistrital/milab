var express = require('express');
const axios = require('axios');
var router = express.Router();
const { requireRoles } = require('../middlewares/auth');

const bp = require('body-parser');

const pool = require('../../libs/db');
router.use(bp.json());
router.use(bp.urlencoded({ extended: true }));

const path = require('path');

const requireAdminStudentsListAccess = requireRoles('admin', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireBulkStudentQueryAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.get('/', requireAdminStudentsListAccess, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const requestedType = typeof req.query.tipo === 'string' ? req.query.tipo.trim() : 'todos';
  const selectedType = ['todos', 'estudiante', 'docente'].includes(requestedType)
    ? requestedType
    : 'todos';

  try {
    const filters = [];
    const values = [];

    if (selectedType !== 'todos') {
      values.push(selectedType);
      filters.push(`tipo_registro = $${values.length}`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const query = `
      WITH certificados AS (
        SELECT
          'estudiante' AS tipo_registro,
          id,
          nombre,
          cc::TEXT AS documento,
          codigo::TEXT AS codigo,
          programa,
          estado_estudiante AS estado,
          fecha_creacion,
          fecha_vencimiento,
          id_certificado,
          correo,
          motivo_exp,
          multa::TEXT AS multa
        FROM estudiante

        UNION ALL

        SELECT
          'docente' AS tipo_registro,
          id,
          nombre,
          cc::TEXT AS documento,
          NULL::TEXT AS codigo,
          NULL::TEXT AS programa,
          estado_docente AS estado,
          fecha_creacion::TIMESTAMP AS fecha_creacion,
          NULL::TIMESTAMP AS fecha_vencimiento,
          id_certificado,
          correo,
          motivo_exp,
          multa::TEXT AS multa
        FROM docente
      )
      SELECT *
      FROM certificados
      ${whereClause}
      ORDER BY fecha_creacion DESC NULLS LAST, id DESC
    `;

    const result = await pool.query(query, values);
    const rows = result.rows;
    res.render('home/get_list_estudiantes', {
      sampleData1: rows,
      selectedType,
    });
    //res.send(rows); // Puedes cambiar esto a una plantilla HTML para mostrar los datos de manera más amigable
  } catch (error) {
    console.error(error);
    res.status(500).send('Error en el servidor');
  }
});

router.get('/get_consulta', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/consulta_masiva', { sampleData1: 0, error: null });
});

router.post('/consulta_masiva', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const max = req.body.consulta_masiva.split(',').map(Number);
  if (max.length > 20) {
    res.render('home/consulta_masiva', {
      sampleData1: 0,
      error: 'Has excedido el límite de 20 estudiantes, inténtalo nuevamente.',
    });
  } else {
    const query = `
                  SELECT
                  t.cod_multado_convert,
                    json_agg(
                        CASE 
                            WHEN m.con_estado_multa = 'ACTIVA' 
                            THEN json_build_object(
                                'cat_multa', m.cat_multa,
                                'nombre_laboratorista', m.nombre_laboratorista,
                                'cc_laboratorista', m.cc_laboratorista,
                                'cod_multado', m.cod_multado,
                                'ual', m.ual,
                                'fecha_multa', m.fecha_multa,
                                'con_estado_multa', m.con_estado_multa,
                                'obs_multa', m.obs_multa
                            )
                            ELSE NULL
                        END
                    ) AS multas
                  FROM
                    UNNEST(STRING_TO_ARRAY($1, ',')) AS t(cod_multado_convert)
                  LEFT JOIN multas m ON t.cod_multado_convert::numeric = m.cod_multado
                  GROUP BY
                    t.cod_multado_convert;
            `; //
    const values = [req.body.consulta_masiva];
    const sampleData1 = await pool.query(query, values);
    //console.log(sampleData1.rows);

    const processedData = sampleData1.rows.map((row) => {
      const codMultado = row.cod_multado_convert;
      let multas = row.multas;

      // Verifica si todos los objetos en multas son null
      const allNull = multas.every((multa) => multa === null);

      // Si todos son null, deja solo un objeto null
      if (allNull) {
        multas = [null];
      }

      // Devuelve el objeto procesado
      return {
        cod_multado_convert: codMultado,
        multas: multas,
      };
    });
    //console.log(processedData);

    const filteredData = processedData.map((row) => {
      const multas = row.multas;

      if (multas !== null && multas.length > 1) {
        row.multas = multas.filter((multa) => multa !== null);
      }

      return row;
    });
    //console.log(filteredData);

    // Modifica el bucle forEach para que sea async
    await Promise.all(
      filteredData.map(async (row) => {
        try {
          const respuesta = await axios.get(
            'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_estudiante/' +
              row.cod_multado_convert
          );
          const codigo =
            respuesta.data?.datosEstudianteCollection?.datosBasicosEstudiante?.[0]?.codigo;

          if (!codigo) {
            throw new Error('Codigo de estudiante no disponible');
          }
        } catch {
          // Aquí puedes manejar errores
          return (row.multas[0] = 'unknown');
          //console.error(error);
        }
      })
    );
    //console.log(filteredData);

    //res.json(sampleData1.rows);
    res.render('home/consulta_masiva', { sampleData1: filteredData, error: null });
  }
});

router.get('/generate_pdf', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const PDFDocument = require('pdfkit');

  const sampleData1 = JSON.parse(req.query.data || '[]');
  sampleData1.forEach((data) => {
    if (data.multas[0] === null) {
      return (data.multas[0] = 'El estudiante no tiene multas');
    } else if (data.multas[0] === 'unknown') {
      return (data.multas[0] = 'Datos inválidos. Verifica la información e inténtalo nuevamente.');
    } else {
      return data.multas;
    }
  });

  if (sampleData1.length > 0) {
    const doc = new PDFDocument();
    const fileName = 'consulta_estudiantes.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    doc.pipe(res);

    try {
      //  imagen izquierda
      const leftImagePath = path.join(__dirname, '../../public/img/Logo_Laboratorioss.png');
      doc.image(leftImagePath, 20, 20, { width: 100, height: 100 });

      //  imagen derecha
      const rightImagePath = path.join(__dirname, '../../public/img/Logo_Escudo_Verticall.jpg');
      doc.image(rightImagePath, doc.page.width - 120, 20, { width: 100, height: 100 });
    } catch (error) {
      console.error('Error al cargar la imagen:', error);
      res.status(500).send('Error al cargar la imagen en el PDF');
      return;
    }

    doc.fontSize(16).text('Universidad Distrital Francisco José de Caldas', { align: 'center' });

    doc.fontSize(14).text('COORDINACIÓN GENERAL DE LABORATORIOS', { align: 'center' }).moveDown(1);

    const textYPosition = 140;
    const tableWidth = doc.page.width - 40;
    doc
      .fontSize(12)
      .text(
        'Este es un informe masivo del estado de los estudiantes en las unidades académicas de laboratorios de la Universidad Distrital Francisco José de Caldas. A continuación, se listan los estudiantes consultados por código (los estudiantes sin ningún problema aparecerán a paz y salvo).',
        20,
        textYPosition,
        { width: tableWidth, align: 'justify' }
      )
      .moveDown(1);

    //  fila de encabezado  columnas
    const numberOfColumns = 5;
    const cellWidth = (doc.page.width - 40) / numberOfColumns;
    const startX = 20; // Posición de inicio con margen
    let y = doc.y;

    //  encabezado tabla
    doc.fontSize(14).font('Helvetica-Bold');
    doc.rect(startX, y, cellWidth * numberOfColumns, 30).fillAndStroke('black', 'black');
    doc.fillColor('white');
    doc.text('Consulta de Estudiantes', startX, y + 5, {
      width: cellWidth * numberOfColumns,
      align: 'center',
    });
    y += 30;

    doc.fillColor('black');

    const tableHeaders = [
      'Código Estudiante',
      'Motivo Multa',
      'Fecha de la Multa',
      'Observación',
      'UAL',
    ]; //'Estado Multa'
    const tableRows = [];

    sampleData1.forEach((item) => {
      item.multas.forEach((multa) => {
        tableRows.push([
          item.cod_multado_convert,
          multa?.cat_multa || 'El estudiante no tiene multas',
          // multa?.con_estado_multa || '',
          multa?.fecha_multa || '',
          multa?.obs_multa || 'El estudiante está a paz y salvo',
          multa?.ual || '',
        ]);
      });
    });

    //  encabezados tabla
    doc.fontSize(12).font('Helvetica');
    tableHeaders.forEach((header, idx) => {
      doc.rect(startX + idx * cellWidth, y, cellWidth, 30).fillAndStroke('gray', 'black');
      doc.fillColor('black');
      doc.text(header, startX + idx * cellWidth + 5, y + 5, {
        width: cellWidth - 10,
        align: 'center',
      });
    });
    y += 30;

    //  filas tabla   máximo de 3 filas
    doc.fontSize(12).font('Helvetica');
    let rowCount = 0;
    tableRows.forEach((row) => {
      let maxHeight = 30; // Altura mínima de una fila
      row.forEach((cell) => {
        const textHeight = doc.heightOfString(cell, { width: cellWidth - 10 });
        maxHeight = Math.max(maxHeight, textHeight + 10);
      });

      // Verificar  altura
      if (rowCount >= 3 || y + maxHeight > doc.page.height - 40) {
        // 40 para el margen inferior
        doc.addPage();
        y = 40;
        rowCount = 0;

        //  encabezados nueva página
        doc.fontSize(12).font('Helvetica');
        tableHeaders.forEach((header, i) => {
          doc.rect(startX + i * cellWidth, y, cellWidth, 30).fillAndStroke('gray', 'black');
          doc.fillColor('black');
          doc.text(header, startX + i * cellWidth + 5, y + 5, {
            width: cellWidth - 10,
            align: 'center',
          });
        });
        y += 30;
      }

      //  celdas de la fila en la tabla
      row.forEach((cell, i) => {
        doc.rect(startX + i * cellWidth, y, cellWidth, maxHeight).stroke();
        doc.text(cell, startX + i * cellWidth + 5, y + 5, {
          width: cellWidth - 10,
          align: 'center',
        });
      });
      y += maxHeight;
      rowCount++;
    });

    const currentDate = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc
      .fontSize(10)
      .text(
        `Se emite en Bogotá D.C. a través del Sistema de Paz y Salvos de la Coordinación General de Laboratorios de la Universidad Distrital Francisco José de Caldas el ${currentDate}`,
        startX,
        y + 10,
        { align: 'center' }
      );

    doc.end();
  } else {
    res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

module.exports = router;
