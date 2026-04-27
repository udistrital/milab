const pool = require('../../libs/db');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const { format } = require('date-fns');
const util = require('util');
const { buildAppUrl } = require('../../libs/app-url');
const { buildGeneratePath } = require('../../libs/generate-path');
const {
  buildCertificateEmailFailureFeedback,
  buildCertificateEmailFeedback,
  sendCertificateEmail,
} = require('../../libs/certificate-email');
const { requireRoles } = require('../middlewares/auth');

// Variables de entorno
require('dotenv').config();

var router = express.Router();

const requireStaffStudentCertificateAccess = requireRoles(
  ['admin', 'laboratorista', 'coordinador'],
  {
    message: '¡Algo ha salido mal!',
    message2: 'Inténtalo nuevamente',
    limit: 'noSession',
  }
);

function normalizeAcademicStatus(value) {
  return (value || '').toString().trim().toUpperCase();
}

function isEgresadoStatus(value) {
  return normalizeAcademicStatus(value) === 'EGRESADO';
}

function extractOasStudentRecords(payload) {
  if (!payload) return [];

  const nested = payload?.datosEstudianteCollection?.datosBasicosEstudiante;
  if (Array.isArray(nested)) return nested;
  if (nested) return [nested];

  const flat = payload?.datosBasicosEstudiante;
  if (Array.isArray(flat)) return flat;
  if (flat) return [flat];

  return [];
}

function extractStudentCodes(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((item) => String(item?.codigo || '').trim())
    .filter((value) => value && value !== '0');
}

async function fetchStudentRecordsByDocumento(documento) {
  if (!documento || documento === '0') return [];

  try {
    const response = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
        'servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        documento
    );
    return extractOasStudentRecords(response.data);
  } catch {
    return [];
  }
}

router.post('/', requireStaffStudentCertificateAccess, function (req, res) {
  const { numero_documento_identificacion, motivo_exp, con_codigo: codigo_form, correo } = req.body;
  var con_codigo;
  var con_estado;
  var con_documento;
  var con_carrera;
  var con_nombre;
  // var switch_exit; // Removed: never assigned or used
  var qr_name;
  // var con_multado; // Removed: never used
  var uniqueId1;
  var multado;
  var con_facultad;
  const actorRole = req.session?.user?.tipo || 'personal autorizado';

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
      let oasUrl;
      // Si el documento es '0' o no existe, usamos el código del formulario
      if (
        (!numero_documento_identificacion || numero_documento_identificacion === '0') &&
        codigo_form
      ) {
        oasUrl =
          'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_estudiante/' +
          codigo_form;
      } else {
        oasUrl =
          'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_activos_cedula/' +
          numero_documento_identificacion;
      }

      const respuesta1 = await axios.get(oasUrl);
      const dato1 = respuesta1.data; // Obtener los datos de la respuesta 1

      const studentRecords = extractOasStudentRecords(dato1);
      if (!studentRecords.length) {
        throw new Error('Estudiante no encontrado en OAS');
      }

      const datosEstudiante = studentRecords[studentRecords.length - 1];

      con_codigo = datosEstudiante.codigo;
      con_estado = datosEstudiante.estado;
      con_documento = datosEstudiante.documento || numero_documento_identificacion;
      // Si sigue siendo 0 o nulo, aseguramos '0'
      if (!con_documento || con_documento === 'undefined' || con_documento === 'null')
        con_documento = '0';

      con_carrera = datosEstudiante.carrera;
      con_nombre = datosEstudiante.nombre;

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

      const respuesta2 = await axios.get(
        'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/estados_codigo/' +
          con_estado
      );
      const dato2 = respuesta2.data; // Obtener los datos de la respuesta 2
      con_estado = dato2.estado.nombre;

      const respuesta3 = await axios.get(
        'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/carrera/' +
          con_carrera
      );
      const dato3 = respuesta3.data; // Obtener los datos de la respuesta 3
      con_carrera = dato3.carrerasCollection.carrera[0].nombre;

      if (isEgresadoStatus(con_estado)) {
        return res.render('home/message_error', {
          message: 'Estudiante egresado',
          message2: 'No es posible generar el certificado para estudiantes egresados.',
          limit: null,
        });
      }

      let codigoList = extractStudentCodes(studentRecords);

      if (con_documento && con_documento !== '0') {
        const recordsByDocumento = await fetchStudentRecordsByDocumento(con_documento);
        const documentCodes = extractStudentCodes(recordsByDocumento);
        if (documentCodes.length) {
          codigoList = documentCodes;
        }
      }

      if (!codigoList.length && con_codigo) {
        codigoList = [String(con_codigo)];
      }

      const sanctionKeys = [String(con_documento || '').trim(), ...codigoList].filter(Boolean);

      const multaRows = await consultar_multas(sanctionKeys);

      if (multaRows.length > 0) {
        return res.render('home/alerta-multado', {
          multaInfo: multaRows,
        });
      }

      console.log('con_codigo ' + con_codigo);
      console.log('con_estado ' + con_estado);
      console.log('con_documento ' + con_documento);
      console.log('con_carrera ' + con_carrera);
      console.log('con_nombre ' + con_nombre);

      // Determinar origen de la descarga (L: Laboratorista/Admin)
      // Se usa 'L' para indicar descarga por laboratorista
      let origen_descarga = actorRole;

      // Guardar en la base de datos la solicitud de certificado
      // NOTA: Se asume que la tabla estudiante tiene la columna motivo_expedicion.
      // Si no la tiene, se debería agregar o ajustar el query.
      // Basado en el requerimiento del usuario, se guarda en motivo_expedicion.

      let data_to_submit = {
        nombre: con_nombre,
        cc: con_documento,
        codigo: con_codigo,
        programa: con_carrera,
        estado_estudiante: con_estado,
        fecha_creacion: con_fecha,
        fecha_vencimiento: fechaVencimiento,
        id_certificado: uniqueId,
        correo,
        motivo_exp: motivo_exp,
        motivo_expedicion: origen_descarga,
        multa: multado,
      };
      submit_data(data_to_submit);

      if (!isEgresadoStatus(con_estado)) {
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
        console.log('ERROR el USUARIO ESTA EGRESADO');
        return res.status(403).render('home/message_error', {
          message: 'Estudiante egresado',
          message2: 'No es posible generar el certificado para estudiantes egresados.',
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
      // const { file } = require('pdfkit'); // Removed: never used

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

      // function centeredText(text, font = 'NotoSansJP-Regular.otf') { ... } // Removed: never used

      let texto_identificacion = 'con código ' + con_codigo;
      if (con_documento && con_documento !== '0') {
        texto_identificacion = 'con código/cédula ' + con_codigo + '/' + con_documento;
      }

      doc
        .font('src/public/fonts/NotoSansJP-Regular.otf')
        .fontSize(12)
        .fill('#021c27')
        .text(
          'Que ' +
            con_nombre +
            ' ' +
            texto_identificacion +
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
          ' y entregado en Bogotá D.C, a través del sistema de generación de Paz y Salvos el ' +
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
          'Expedido por: Sistema de Paz y Salvos de la Coordinación General de Laboratorios de la Universidad Distrital Francisco José de Caldas.',
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
          link: buildAppUrl(`/api/validateqr/${uniqueId1}`),
        });

      // QR — centrado
      doc.image(
        buildGeneratePath(`${con_codigo}.png`),
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

      stream.on('finish', () => {
        console.log('PDF CERTIFICADO generado!');
        resolve();
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

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
      nombre,
      cc,
      codigo,
      programa,
      estado_estudiante,
      fecha_creacion,
      fecha_vencimiento,
      id_certificado,
      correo,
      motivo_exp,
      motivo_expedicion,
      multa,
    } = req;
    // AQUÍ AGREGAMOS motivo_expedicion AL QUERY
    pool.query(
      'INSERT INTO estudiante (nombre, cc, codigo, programa, estado_estudiante, fecha_creacion, fecha_vencimiento, id_certificado, correo, motivo_exp, motivo_expedicion, multa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
      [
        nombre,
        cc,
        codigo,
        programa,
        estado_estudiante,
        fecha_creacion,
        fecha_vencimiento,
        id_certificado,
        correo,
        motivo_exp,
        motivo_expedicion,
        multa,
      ],
      (error) => {
        if (error) {
          throw error;
        }
      }
    );
  }

  // Función para consultar multas asignadas al usuario

  async function consultar_multas(codigos) {
    const query = util.promisify(pool.query).bind(pool);
    const codigoList = Array.isArray(codigos) ? codigos : [];

    if (!codigoList.length) {
      multado = 0;
      return [];
    }

    try {
      const result = await query(
        "SELECT * FROM multas WHERE cod_multado::text = ANY($1::text[]) AND con_estado_multa IN ('ACTIVA','Pendiente','POR SALDAR')",
        [codigoList]
      );

      if (result.rows.length > 0) {
        console.table(result.rows);
        console.log('EL USUARIO ESTA MULTADO');
        multado = 1;
      } else {
        console.log('EL USUARIO NO ESTA MULTADO');
        multado = 0;
      }

      return result.rows;
    } catch (error) {
      console.error('error', error);
      throw error;
    }
  }

  consultarEndpointAnidado();
});

global.miVariableGlobal = 'Hola desde el objeto global';

module.exports = router;
