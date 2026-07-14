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
const { ensurePerfilEstudiante } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

// Variables de entorno
require('dotenv').config();

var router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireStudentCertificateAccess = requireRoles(['admin', 'estudiante'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireStudentCertificateAccess, async function (req, res) {
  const { numero_documento_identificacion, motivo_exp, correo } = req.body;
  var con_codigo;
  var con_estado;
  var con_documento;
  var con_carrera;
  var con_nombre;
  var qr_name;
  var con_multado = null;
  // con_multado removed (was never assigned)
  var uniqueId1;
  // multado removed (was never used)
  var con_facultad;

  console.log(motivo_exp);

  // Obtener la fecha de hoy
  var con_fecha = new Date();
  con_fecha = format(con_fecha, 'yyyy/MM/dd HH:mm:ss'); // Ajuste de horario al local

  // Obtener la fecha de vencimiento en 2 meses
  var fechaVencimiento = new Date();
  fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 2);
  fechaVencimiento = format(fechaVencimiento, 'yyyy/MM/dd HH:mm:ss');

  function determinarFacultad(codigoCarrera) {
    const medioambiente = [
      '1',
      '2',
      '3',
      '4',
      '10',
      '14',
      '21',
      '24',
      '30',
      '31',
      '32',
      '33',
      '80',
      '81',
      '85',
      '110',
      '114',
      '131',
      '180',
      '181',
      '185',
      '186',
      '481',
      '485',
      '607',
      '710',
      '732',
      '780',
      '781',
      '785',
    ];
    const ingenieria = [
      '5',
      '7',
      '15',
      '20',
      '22',
      '25',
      '27',
      '28',
      '295',
      '395',
      '495',
      '595',
      '695',
      '700',
    ];
    const salud = ['27', '28', '90', '93'];
    const asab = ['11', '12', '16', '96', '97', '98', '102', '103', '104'];
    const educacion = [
      '52',
      '53',
      '135',
      '140',
      '145',
      '150',
      '155',
      '160',
      '164',
      '165',
      '187',
      '188',
      '245',
      '255',
      '260',
      '265',
      '287',
      '288',
      '952',
      '953',
    ];
    const tecno = [
      '77',
      '78',
      '79',
      '272',
      '372',
      '373',
      '374',
      '375',
      '377',
      '378',
      '379',
      '383',
      '572',
      '573',
      '574',
      '577',
      '578',
      '579',
      '583',
      '673',
      '677',
      '678',
      '772',
      '773',
      '774',
      '777',
      '778',
      '779',
      '872',
      '873',
      '874',
      '877',
      '878',
      '879',
      '972',
      '973',
      '974',
      '977',
      '978',
      '979',
    ];
    const matematicas = ['107', '108', '109', '167'];

    // Convertir el código a string para comparación
    const codigo = codigoCarrera.toString();

    if (medioambiente.includes(codigo)) {
      return ' del Medio Ambiente y Recursos Naturales';
    } else if (ingenieria.includes(codigo)) {
      return ' de Ingeniería';
    } else if (salud.includes(codigo)) {
      return ' de Ciencias de la Salud';
    } else if (asab.includes(codigo)) {
      return ' de Artes ASAB';
    } else if (educacion.includes(codigo)) {
      return ' de Ciencias y Educación';
    } else if (tecno.includes(codigo)) {
      return ' Tecnológica';
    } else if (matematicas.includes(codigo)) {
      return ' de Ciencias Matemáticas y Naturales';
    } else {
      return ' no identificada';
    }
  }

  // Función para obtener la info del estudiante mediante CC segun consultas a la OAS
  async function consultarEndpointAnidado() {
    try {
      const dato1 = await requestOati(
        getAcademicServicePath(`datos_basicos_activos_cedula/${numero_documento_identificacion}`)
      );
      // dataString removed (was never used)
      var cant_carreras = dato1.datosEstudianteCollection.datosBasicosEstudiante.length;

      con_codigo = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].codigo;
      con_estado = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].estado;
      //con_documento = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras-1].documento ;
      con_documento = numero_documento_identificacion;
      con_carrera =
        dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].carrera;
      con_nombre = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].nombre;

      con_facultad = determinarFacultad(con_carrera);

      console.log('Código de carrera: ' + con_carrera);
      console.log('Facultad determinada: ' + con_facultad);
      //----------------------- Generar QR y guardar Imagen

      const uniqueId = generateUniqueId(); // Esta función genera un ID único
      QRCode.toFile(
        buildGeneratePath(`${con_codigo}.png`),
        buildAppUrl(`/api/validateqr/${uniqueId}`),
        {
          // QRCode.toDataURL(`src/public/generate/${con_codigo}.png`, 'https://validateQR/' + uniqueId, {
          errorCorrectionLevel: 'H',
        },
        function (err) {
          if (err) throw err;
          console.log('QR unico generado!');
        }
      );

      qr_name = con_codigo + '-' + uniqueId;
      uniqueId1 = uniqueId;
      console.log(qr_name);

      const dato2 = await requestOati(getAcademicServicePath(`estados_codigo/${con_estado}`));
      con_estado = dato2.estado.nombre;

      const dato3 = await requestOati(getAcademicServicePath(`carrera/${con_carrera}`));
      con_carrera = dato3.carrerasCollection.carrera[0].nombre;

      console.log('con_codigo ' + con_codigo);
      console.log('con_estado ' + con_estado);
      console.log('con_documento ' + con_documento);
      console.log('con_carrera ' + con_carrera);
      console.log('con_nombre ' + con_nombre);

      // Guardar en la base de datos la solicitud de certificado

      const usuarioId = await ensurePerfilEstudiante({
        documento: con_documento,
        nombre: con_nombre,
        codigo: con_codigo,
        programa: con_carrera,
        estado: con_estado,
        correo,
      });

      if (!usuarioId) {
        return res.render('home/message_error', {
          message: 'No se pudo registrar el perfil del estudiante.',
          message2: 'Verifica los datos e intenta nuevamente.',
          limit: null,
        });
      }

      let data_to_submit = {
        usuario_id: usuarioId,
        fecha_creacion: con_fecha,
        fecha_vencimiento: fechaVencimiento,
        certificado_id: uniqueId,
        correo: correo,
        motivo_exp: motivo_exp,
        multa: con_multado,
      };
      submit_data(data_to_submit);

      if (
        con_estado == 'ACTIVO' ||
        con_estado == 'PRUEBA AC Y ACTIVO' ||
        con_estado == 'CANCELADO' ||
        con_estado == 'TERMINO Y MATRICULO' ||
        con_estado == 'APLAZO' ||
        con_estado == 'NO ESTUDIANTE AC004' ||
        con_estado == 'VACACIONES' ||
        con_estado == 'ABANDONO' ||
        con_estado == 'PRUEBA ACAD'
      ) {
        await print_data();
        let emailFeedback = null;

        try {
          const emailResult = await sendCertificateEmail({
            correo,
            pdfPath: buildGeneratePath(`certificado_${con_codigo}.pdf`),
            ownerName: con_nombre,
            reference: con_codigo,
            referenceType: 'código',
            motivo: motivo_exp,
          });
          emailFeedback = buildCertificateEmailFeedback(emailResult);
        } catch (emailError) {
          console.error('Error al enviar certificado de estudiante por correo:', emailError);
          emailFeedback = buildCertificateEmailFailureFeedback();
        }

        salvar(con_codigo, emailFeedback);
      } else {
        console.log('ERROR el USUARIO NO ESTA ACTIVO');
        // ERROR MENSAJES WEB
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
  // ----- FIN Función obtener data y generar QR

  // - Inicio función para imprimir PDF con toda la data
  function print_data() {
    return new Promise((resolve, reject) => {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ layout: 'portrait', size: 'A4' });
      const fs = require('fs');
      const stream = fs.createWriteStream(buildGeneratePath(`certificado_${con_codigo}.pdf`));
      // file removed (was never used)

      // Helper to move to next line
      function jumpLine(doc, lines) {
        for (let index = 0; index < lines; index++) {
          doc.moveDown();
        }
      }

      // doc.pipe(fs.createWriteStream('src/public/generate/output.pdf'));
      doc.pipe(stream);

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
      // col4Width removed (was never used)

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

      // centeredText removed (was never used)

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(12)
        .fill('#021c27')
        .text(
          'Que ' +
            con_nombre +
            ' con código/cédula ' +
            con_codigo +
            '/' +
            con_documento +
            ', de la Facultad  ' +
            con_facultad +
            '. Proyecto curricular ' +
            con_carrera +
            ', se encuentra a Paz y Salvo con los laboratorios.',
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
        .font('src/public/fonts/NotoSansJP-Regular.otf')
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

      const qrSize = 110;
      const qrTop = doc.y + 28;

      // ID único — centrado arriba del QR
      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(10)
        .fill('#021c27')
        .text(`ID único de validación ${uniqueId1}`, 40, qrTop - 22, {
          width: doc.page.width - 80,
          align: 'center',
          link: buildAppUrl(`/api/validateqr/${uniqueId1}`),
        });

      // QR — centrado
      doc.image(buildGeneratePath(`${con_codigo}.png`), (doc.page.width - qrSize) / 2, qrTop, {
        fit: [qrSize, qrSize],
      });

      const expirationTextY = qrTop + qrSize + 12;

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(10)
        .fill('#021c27')
        .text('Fecha de vencimiento del certificado ' + fechaVencimiento, 40, expirationTextY, {
          width: doc.page.width - 80,
          align: 'center',
        });

      doc.end();

      stream.on('finish', () => {
        console.log('PDF CERTIFICADO generado!');
        resolve();
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  await consultarEndpointAnidado();

  function salvar(req, emailFeedback) {
    return res.render('home/message_success', {
      message: 'Certificado generado correctamente',
      message2: emailFeedback?.message || 'Revisa tu correo institucional.',
    });
  }

  // Función para generar un ID único para cada código QR

  function generateUniqueId() {
    const { v4: uuidv4 } = require('uuid');
    return uuidv4();
  }

  // Función para subir data a la ba se de datos - certificados solicitadas

  function submit_data(req) {
    // Usar pool centralizado

    const {
      usuario_id,
      fecha_creacion,
      fecha_vencimiento,
      certificado_id,
      correo,
      motivo_exp,
      multa,
    } = req;
    pool.query(
      'INSERT INTO certificado_estudiante (usuario_id, fecha_creacion, fecha_vencimiento, certificado_id, correo, motivo_exp, multa) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [usuario_id, fecha_creacion, fecha_vencimiento, certificado_id, correo, motivo_exp, multa],
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
