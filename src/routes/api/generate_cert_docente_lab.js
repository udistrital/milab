const pool = require('../../libs/db');
const express = require('express');
const QRCode = require('qrcode');
const { format } = require('date-fns');
const { buildAppUrl } = require('../../libs/app-url');
const { buildGeneratePath } = require('../../libs/generate-path');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const {
  buildCertificateEmailFailureFeedback,
  buildCertificateEmailFeedback,
  sendCertificateEmail,
} = require('../../libs/certificate-email');
const { ensurePerfilDocente } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

// Variables de entorno
require('dotenv').config();

var router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireStaffTeacherCertificateAccess = requireRoles(
  ['admin', 'laboratorista', 'coordinador'],
  {
    message: '¡Algo ha salido mal!',
    message2: 'Inténtalo nuevamente',
    limit: 'noSession',
  }
);

router.post('/', requireStaffTeacherCertificateAccess, function (req, res) {
  const requestBody = req.body || {};
  const { numero_documento_identificacion, motivo_exp, correo } = requestBody;

  if (!numero_documento_identificacion || !motivo_exp) {
    return res.render('home/message_error', {
      message: 'No fue posible procesar la solicitud.',
      message2: 'Verifica los datos del formulario e inténtalo nuevamente.',
      limit: null,
    });
  }

  var con_estado;
  var con_documento;
  var con_nombre;
  // var switch_exit; // Removed: never used
  var qr_name;
  // var con_multado; // Removed: always undefined
  var uniqueId1;
  // var multado; // Removed: never used
  const actorRole = req.session?.user?.tipo || 'personal autorizado';

  console.log(motivo_exp);

  // Determinar origen de la descarga (L: Laboratorista/Admin)
  // Como esta ruta es específica para laboratoristas, forzamos 'L'
  let origen_descarga = actorRole;
  let correo_to_save = correo;

  // Obtener la fecha de hoy
  var con_fecha = new Date();
  con_fecha = format(con_fecha, 'yyyy/MM/dd HH:mm:ss'); // Ajuste de horario al local

  // Obtener la fecha de vencimiento en 2 meses
  var fechaVencimiento = new Date();
  fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 2);
  fechaVencimiento = format(fechaVencimiento, 'yyyy/MM/dd HH:mm:ss');

  // Función para generar QR de forma asíncrona
  function generateQRCode(documento, uniqueId) {
    return new Promise((resolve, reject) => {
      QRCode.toFile(
        buildGeneratePath(`${documento}.png`),
        buildAppUrl(`/api/validateqr-docente/${uniqueId}`),
        { errorCorrectionLevel: 'H' },
        function (err) {
          if (err) {
            reject(err);
          } else {
            console.log('QR unico generado!');
            resolve();
          }
        }
      );
    });
  }

  // Función para obtener la info del docente mediante CC segun consultas a la OAS
  async function consultarEndpointAnidado() {
    try {
      const dato1 = await requestOati(
        getAcademicServicePath(`consultar_estado_docente/${numero_documento_identificacion}`)
      );
      const docenteData = dato1.docentesCollection.docente[0];
      con_estado = docenteData.estado_docente;
      con_documento = numero_documento_identificacion;
      con_nombre = docenteData.nombre;

      console.log('con_estado ' + con_estado);
      console.log('con_documento ' + con_documento);
      console.log('con_nombre ' + con_nombre);

      //----------------------- Generar QR y guardar Imagen

      const uniqueId = generateUniqueId(); // Esta función genera un ID único

      // ESPERAR a que el QR se genere completamente
      await generateQRCode(con_documento, uniqueId);

      qr_name = con_documento + '-' + uniqueId;
      uniqueId1 = uniqueId;
      console.log(qr_name);

      // const req_consultar_multas = await consultar_multas(con_documento); // Removed: never used

      const usuarioId = await ensurePerfilDocente({
        documento: con_documento,
        nombre: con_nombre,
        estado: con_estado,
        correo: correo_to_save,
      });

      if (!usuarioId) {
        return res.render('home/message_error', {
          message: 'No se pudo registrar el perfil del docente.',
          message2: 'Verifica los datos e intenta nuevamente.',
          limit: null,
        });
      }

      // Consultar si el usuario está multado
      let con_multado = 0;
      try {
        const result = await pool.query(
          'SELECT 1 FROM multa WHERE usuario_id_sancionado = $1 LIMIT 1',
          [usuarioId]
        );
        if (result.rows.length > 0) {
          console.log('EL USUARIO ESTA MULTADO');
          con_multado = 1;
        } else {
          console.log('EL USUARIO NO ESTA MULTADO');
        }
      } catch (err) {
        console.error('Error consultando multas:', err);
      }

      // Guardar en la base de datos la solicitud de certificado
      let data_to_submit = {
        usuario_id: usuarioId,
        fecha_creacion: con_fecha,
        id_certificado: uniqueId,
        correo: correo_to_save,
        multa: con_multado,
        motivo_exp: motivo_exp,
        origen_descarga: origen_descarga,
      };
      submit_data(data_to_submit);

      if (con_estado === 'Activo') {
        // Ahora el QR ya está generado, podemos crear el PDF
        await print_data();
        let emailFeedback = null;

        try {
          const emailResult = await sendCertificateEmail({
            correo: correo_to_save,
            pdfPath: buildGeneratePath(`certificado_${con_documento}.pdf`),
            ownerName: con_nombre,
            reference: con_documento,
            referenceType: 'documento',
            motivo: motivo_exp,
          });
          emailFeedback = buildCertificateEmailFeedback(emailResult, {
            missingRecipientMessage:
              'El certificado se generó correctamente, pero no se envió por correo porque no se tiene registrado el email del docente en el sistema.',
          });
        } catch (emailError) {
          console.error('Error al enviar certificado de docente por correo:', emailError);
          emailFeedback = buildCertificateEmailFailureFeedback();
        }

        salvar(con_documento, emailFeedback);
      } else {
        console.log('ERROR el USUARIO NO ESTA ACTIVO');
        return res.render('home/message_error', {
          message: 'No fue posible generar el certificado',
          message2: 'Intentelo nuevamente.',
          limit: null,
        });
      }
    } catch (error) {
      console.error(error);
      return res.render('home/message_error', {
        message: '¡Algo ha salido mal!',
        message2: 'Inténtalo nuevamente',
        limit: null,
      });
    }
  }

  // - Inicio función para imprimir PDF con toda la data
  async function print_data() {
    return new Promise((resolve, reject) => {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ layout: 'portrait', size: 'A4' });
      const fs = require('fs');

      const pdfFilePath = buildGeneratePath(`certificado_${con_documento}.pdf`);
      const stream = fs.createWriteStream(pdfFilePath);
      doc.pipe(stream);

      console.log(`PDF file should be generated at: ${pdfFilePath}`);

      // const { file } = require('pdfkit'); // Removed: never used

      // Helper to move to next line
      function jumpLine(doc, lines) {
        for (let index = 0; index < lines; index++) {
          doc.moveDown();
        }
      }

      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#fff');

      doc.fontSize(10);

      const marginTop = 40;
      const tableWidth = doc.page.width - 80;
      const tableHeight = 80;
      const startX = 40;

      doc
        .strokeColor('#000000')
        .lineWidth(1)
        .rect(startX, marginTop, tableWidth, tableHeight)
        .stroke();

      const col1Width = 90;
      const col2Width = 180;
      const col3Width = 110;
      // const col4Width = 135; // Removed: never used

      doc
        .moveTo(startX + col1Width, marginTop)
        .lineTo(startX + col1Width, marginTop + tableHeight)
        .stroke();

      doc
        .moveTo(startX + col1Width + col2Width, marginTop)
        .lineTo(startX + col1Width + col2Width, marginTop + tableHeight)
        .stroke();

      doc
        .moveTo(startX + col1Width + col2Width + col3Width, marginTop)
        .lineTo(startX + col1Width + col2Width + col3Width, marginTop + tableHeight)
        .stroke();

      const row1Height = 25;
      const row2Height = 25;

      doc
        .moveTo(startX + col1Width, marginTop + row1Height)
        .lineTo(startX + col1Width + col2Width, marginTop + row1Height)
        .stroke();

      doc
        .moveTo(startX + col1Width, marginTop + row1Height + row2Height)
        .lineTo(startX + col1Width + col2Width, marginTop + row1Height + row2Height)
        .stroke();

      doc
        .moveTo(startX + col1Width + col2Width, marginTop + 25)
        .lineTo(startX + col1Width + col2Width + col3Width, marginTop + 25)
        .stroke();

      doc
        .moveTo(startX + col1Width + col2Width, marginTop + 50)
        .lineTo(startX + col1Width + col2Width + col3Width, marginTop + 50)
        .stroke();

      doc.image('src/public/img/Logo_Escudo_Verticall.jpg', startX + 5, marginTop + 10, {
        fit: [80, 60],
        align: 'center',
      });

      doc.image(
        'src/public/img/logo_sigud.jpg',
        startX + col1Width + col2Width + col3Width + 5,
        marginTop + 10,
        {
          fit: [125, 60],
          align: 'center',
        }
      );

      // Título PAZ Y SALVO (celda central superior)
      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(8)
        .fill('#021c27')
        .text('PAZ Y SALVO', startX + col1Width + 10, marginTop + 4, {
          width: col2Width - 10,
          align: 'center',
        });

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(8)
        .fill('#021c27')
        .text('Código: GL-PR-007-', startX + col1Width + col2Width + 5, marginTop + 5, {
          width: col3Width - 10,
          align: 'center',
        });
      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(8)
        .fill('#021c27')
        .text('FR-010', startX + col1Width + col2Width + 5, marginTop + 15, {
          width: col3Width - 10,
          align: 'center',
        });

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(9)
        .fill('#021c27')
        .text(
          'Macro proceso: Apoyo a lo misional',
          startX + col1Width + 5,
          marginTop + row1Height + 5,
          {
            width: col2Width - 10,
            align: 'left',
          }
        );

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(9)
        .fill('#021c27')
        .text('Versión: 04', startX + col1Width + col2Width + 5, marginTop + 30, {
          width: col3Width - 10,
          align: 'center',
        });

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(9)
        .fill('#021c27')
        .text(
          'Proceso: Gestión de Laboratorios',
          startX + col1Width + 5,
          marginTop + row1Height + row2Height + 5,
          {
            width: col2Width - 10,
            align: 'left',
          }
        );

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(8)
        .fill('#021c27')
        .text('Fecha de aprobación:', startX + col1Width + col2Width + 5, marginTop + 55, {
          width: col3Width - 10,
          align: 'center',
        });

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(8)
        .fill('#021c27')
        .text('30/10/2017', startX + col1Width + col2Width + 5, marginTop + 68, {
          width: col3Width - 10,
          align: 'center',
        });

      jumpLine(doc, 6);

      doc
        .strokeColor('#000000')
        .lineWidth(1)
        .moveTo(doc.page.width / 2 - 200, doc.y)
        .lineTo(doc.page.width / 2 + 200, doc.y)
        .stroke();

      jumpLine(doc, 2);

      doc
        .font('src/public/fonts/NotoSansJP-Bold.otf')
        .fontSize(16)
        .fill('#021c27')
        .text('Hace constar', 40, doc.y, {
          width: doc.page.width - 80,
          align: 'center',
        });

      jumpLine(doc, 2);

      let texto_cuerpo =
        'Que ' +
        con_nombre +
        ' identificado con Cédula de Ciudadanía ' +
        con_documento +
        ', se encuentra a Paz y Salvo con los laboratorios.';

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(12)
        .fill('#021c27')
        .text(texto_cuerpo, 40, doc.y, {
          width: doc.page.width - 80,
          align: 'justify',
        });

      jumpLine(doc, 0.5);

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .text('El certificado fue generado con el motivo ', 40, doc.y, {
          width: doc.page.width - 80,
          align: 'justify',
          continued: true,
        })
        .font('src/public/fonts/NotoSansJP-Bold.otf')
        .text(motivo_exp + ' ', {
          continued: true,
        })
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .text(
          ' y entregado en Bogotá D.C, a través del sistema de información de laboratorios de la Universidad Distrital - MILab en el módulo de generación de Paz y Salvos el ' +
            con_fecha,
          {
            width: doc.page.width - 80,
            align: 'justify',
          }
        );

      jumpLine(doc, 0.5);
      doc
        .font('src/public/fonts/NotoSansJP-Bold.otf')
        .fontSize(10)
        .fill('#7a1f1f')
        .text(
          `Constancia: este certificado fue generado por un tercero autorizado (${actorRole}) distinto al titular.`,
          40,
          doc.y,
          {
            width: doc.page.width - 80,
            align: 'justify',
          }
        );

      jumpLine(doc, 0.5);
      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(12)
        .fill('#021c27')
        .text(
          'Expedido por: MILab de la Coordinación General de Laboratorios de la Universidad Distrital Francisco José de Caldas.',
          40,
          doc.y,
          {
            width: doc.page.width - 80,
            align: 'justify',
          }
        );

      jumpLine(doc, 1);

      const qrSize = 130;
      const bottomHeight = doc.y + 70; // Margen superior para el texto y el QR

      // ID único — centrado arriba del QR
      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(10)
        .fill('#021c27')
        .text(`ID único de validación ${uniqueId1}`, 40, bottomHeight - 30, {
          width: doc.page.width - 80,
          align: 'center',
          link: buildAppUrl(`/api/validateqr-docente/${uniqueId1}`),
        });

      // QR — centrado
      doc.image(
        buildGeneratePath(`${con_documento}.png`),
        (doc.page.width - qrSize) / 2,
        bottomHeight,
        {
          fit: [qrSize, qrSize],
        }
      );

      // Posición del texto de vencimiento, al lado derecho
      const afterQRPosition = bottomHeight + qrSize + 20;

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(10)
        .fill('#021c27')
        .text(
          'Fecha de vencimiento del certificado ' + fechaVencimiento,
          doc.page.width / 2 + 50,
          afterQRPosition + 50,
          {
            width: doc.page.width / 2 - 60,
            align: 'left',
          }
        );

      doc.end();

      // Esperar a que el PDF termine de escribirse
      stream.on('finish', () => {
        console.log('PDF CERTIFICADO generado!');
        resolve();
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  // Ejecutar la función principal de forma asíncrona
  consultarEndpointAnidado().catch((error) => {
    console.error('Error en consultarEndpointAnidado:', error);
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  });

  function salvar(req, emailFeedback) {
    return res.render('home/message_success', {
      message: 'Certificado generado correctamente',
      message2: emailFeedback?.message || 'Revisa tu correo institucional.',
      autoDownloadAction: '/milab/api/download-pdf-docente',
      autoDownloadFields: {
        con_documento: con_documento,
      },
      autoDownloadMessage: 'La descarga del certificado comenzará automáticamente.',
    });
  }

  // Función para generar un ID único para cada código QR
  function generateUniqueId() {
    const { v4: uuidv4 } = require('uuid');
    return uuidv4();
  }

  // Función para subir data a la base de datos - certificados solicitadas
  function submit_data(req) {
    // Usar pool centralizado

    const {
      usuario_id,
      fecha_creacion,
      id_certificado,
      correo,
      multa,
      motivo_exp,
      origen_descarga,
    } = req;
    pool.query(
      'INSERT INTO certificado_docente (usuario_id, fecha_creacion, id_certificado, correo, multa, motivo_exp, origen_descarga) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [usuario_id, fecha_creacion, id_certificado, correo, multa, motivo_exp, origen_descarga],
      (error) => {
        if (error) {
          throw error;
        }
      }
    );
  }
});

global.miVariableGlobal = 'Hola desde el objeto global';

module.exports = router;
