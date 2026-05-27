const express = require('express');
const { requireUser } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');

var router = express.Router();

const requireLegacyPdfGenerationSession = requireUser({
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireLegacyPdfGenerationSession, function (req, res) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ layout: '', size: 'A4' });
  const fs = require('fs');

  // Helper to move to next line
  function jumpLine(doc, lines) {
    for (let index = 0; index < lines; index++) {
      doc.moveDown();
    }
  }

  doc.pipe(fs.createWriteStream(buildGeneratePath('output.pdf')));

  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#fff');

  doc.fontSize(10);

  // Margin
  const distanceMargin = 18;

  doc
    .fillAndStroke('#78201F')
    .lineWidth(20)
    .lineJoin('round')
    .rect(
      distanceMargin,
      distanceMargin,
      doc.page.width - distanceMargin * 2,
      doc.page.height - distanceMargin * 2
    )
    .stroke();

  // Header
  const maxWidth = 140;
  const maxHeight = 70;

  doc.image(
    'src/public/img/Logo_Escudo_Acreditacion_Horizontal.png',
    doc.page.width / 2 - maxWidth / 2,
    60,
    {
      fit: [maxWidth, maxHeight],
      align: 'center',
    }
  );

  jumpLine(doc, 5);

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('PAZ Y SALVO LABS', {
      align: 'center',
    });

  jumpLine(doc, 2);

  // Content
  doc
    .font('src/public/fonts/NotoSansJP-Regular.otf')
    .fontSize(16)
    .fill('#021c27')
    .text('Certificado de paz y salvo Laboratorios U Distrital', {
      align: 'center',
    });

  jumpLine(doc, 1);

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Present to', {
      align: 'center',
    });

  jumpLine(doc, 2);

  doc
    .font('src/public/fonts/NotoSansJP-Bold.otf')
    .fontSize(24)
    .fill('#021c27')
    .text('STUDENT NAME', {
      align: 'center',
    });

  jumpLine(doc, 1);

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Successfully completed the Super Course for Awesomes.', {
      align: 'center',
    });

  jumpLine(doc, 7);

  doc.lineWidth(1);

  // Signatures
  const lineSize = 174;
  const signatureHeight = 390;

  doc.fillAndStroke('#021c27');
  doc.strokeOpacity(0.2);

  const startLine1 = 128;
  const endLine1 = 128 + lineSize;
  doc.moveTo(startLine1, signatureHeight).lineTo(endLine1, signatureHeight).stroke();

  const startLine2 = endLine1 + 32;
  const endLine2 = startLine2 + lineSize;
  doc.moveTo(startLine2, signatureHeight).lineTo(endLine2, signatureHeight).stroke();

  const startLine3 = endLine2 + 32;
  const endLine3 = startLine3 + lineSize;
  doc.moveTo(startLine3, signatureHeight).lineTo(endLine3, signatureHeight).stroke();

  doc
    .font('src/public/fonts/NotoSansJP-Bold.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('John Doe', startLine1, signatureHeight + 10, {
      columns: 1,
      columnGap: 0,
      height: 40,
      width: lineSize,
      align: 'center',
    });

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Associate Professor', startLine1, signatureHeight + 25, {
      columns: 1,
      columnGap: 0,
      height: 40,
      width: lineSize,
      align: 'center',
    });

  doc
    .font('src/public/fonts/NotoSansJP-Bold.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Student Name', startLine2, signatureHeight + 10, {
      columns: 1,
      columnGap: 0,
      height: 40,
      width: lineSize,
      align: 'center',
    });

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Student', startLine2, signatureHeight + 25, {
      columns: 1,
      columnGap: 0,
      height: 40,
      width: lineSize,
      align: 'center',
    });

  doc
    .font('src/public/fonts/NotoSansJP-Bold.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Jane Doe', startLine3, signatureHeight + 10, {
      columns: 1,
      columnGap: 0,
      height: 40,
      width: lineSize,
      align: 'center',
    });

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text('Director', startLine3, signatureHeight + 25, {
      columns: 1,
      columnGap: 0,
      height: 40,
      width: lineSize,
      align: 'center',
    });

  jumpLine(doc, 4);

  // Validation link
  const link = 'https://validate-your-certificate.hello/validation-code-here';

  const linkWidth = doc.widthOfString(link);
  const linkHeight = doc.currentLineHeight();

  doc
    .underline(doc.page.width / 2 - linkWidth / 2, 448, linkWidth, linkHeight, { color: '#021c27' })
    .link(doc.page.width / 2 - linkWidth / 2, 448, linkWidth, linkHeight, link);

  doc
    .font('src/public/fonts/NotoSansJP-Light.otf')
    .fontSize(10)
    .fill('#021c27')
    .text(link, doc.page.width / 2 - linkWidth / 2, 448, linkWidth, linkHeight);

  // Footer
  const bottomHeight = doc.page.height - 100;

  doc.image(
    buildGeneratePath('b6051844-a5a2-4c30-a7c4-d7953c10d5b6.png'),
    doc.page.width / 2 - 30,
    bottomHeight,
    {
      fit: [60, 60],
    }
  );

  doc.end();

  console.log('PDF generado!');

  try {
    const filePath = buildGeneratePath('output.pdf');

    res.download(filePath, 'output222.pdf', (err) => {
      if (err) {
        return res.send({
          error: err,
          msg: 'Error al generar PDF',
        });
      }
    });
  } catch {
    const filePath = buildGeneratePath('output.pdf');

    res.download(filePath, 'output223.pdf', (err2) => {
      if (err2) {
        return res.send({
          error: err2,
          msg: 'Error al generar PDF',
        });
      }
    });
  }
});

module.exports = router;

//         const respuesta3 = await axios.get("https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/carrera/" + con_carrera );
//         const dato3 = respuesta3.data;
//         con_carrera = dato3.carrerasCollection.carrera[0].nombre;

//         const req_consultar_multas = consultar_multas(con_codigo);

//         console.log("con_codigo " + con_codigo);
//         console.log("con_estado " + con_estado);
//         console.log("con_documento " + con_documento);
//         console.log("con_carrera " + con_carrera);
//         console.log("con_nombre " + con_nombre);

//         let data_to_submit = {nombre:con_nombre, cc:con_documento, codigo:con_codigo, programa:con_carrera, estado_estudiante:con_estado, fecha_creacion: con_fecha, fecha_vencimiento: fechaVencimiento, id_certificado:uniqueId, correo: correo, motivo_exp:motivo_exp, multa:con_multado};
//         submit_data(data_to_submit);

//         if (con_estado == "ACTIVO" || con_estado == "PRUEBA AC Y ACTIVO" || con_estado == "CANCELADO" || con_estado == "TERMINO Y MATRICULO" || con_estado == "APLAZO" || con_estado == "NO ESTUDIANTE AC004"|| con_estado == "VACACIONES" ) {
//           print_data();
//           salvar(con_codigo);
//         }
//         else {
//         console.log("ERROR el USUARIO NO ESTA ACTIVO");
//         }

//       } catch (error) {
//         console.error(error)
//         return res.render('home/message_error',{message: "¡Algo ha salido mal!", message2: 'Inténtalo nuevamente', limit: null});
//       }
//     }

//     function print_data() {
//       const PDFDocument = require('pdfkit');
//       const doc = new PDFDocument({layout: 'landscape', size: 'A4',});
//       const fs = require('fs');
//       const { file } = require('pdfkit');

//       function jumpLine(doc, lines) {
//         for (let index = 0; index < lines; index++) {
//           doc.moveDown();
//         }
//       }

//       doc.pipe(fs.createWriteStream( `src/public/generate/certificado_${con_codigo}.pdf`));

//       doc.rect(0, 0, doc.page.width, doc.page.height).fill('#fff');
//       doc.fontSize(10);
//       const distanceMargin = 22;

//       doc
//         .fillAndStroke('#78201F')
//         .lineWidth(20)
//         .lineJoin('round')
//         .rect(
//           distanceMargin,
//           distanceMargin,
//           doc.page.width - distanceMargin * 2,
//           doc.page.height - distanceMargin * 2,
//         )
//         .stroke();

//       const maxWidth = 150;
//       const maxHeight = 80;

//       doc.image('src/public/img/Logo_Escudo_Acreditacion_Horizontal.png', doc.page.width / 2 - maxWidth / 2, 60, {
//         fit: [maxWidth, maxHeight],
//         align: 'center',
//       });

//       jumpLine(doc, 4)

//       doc
//         .font('src/public/fonts/NotoSansJP-Light.otf')
//         .fontSize(18)
//         .fill('#021c27')
//         .text('COORDINACIÓN GENERAL DE LABORATORIOS - UNIVERSIDAD DISTRITAL FRANCISCO JOSÉ DE CALDAS', {
//           align: 'center',
//         });

//       jumpLine(doc, 2)

//       doc
//         .font('src/public/fonts/NotoSansJP-Regular.otf')
//         .fontSize(14)
//         .fill('#021c27')
//         .text('Certifica con Paz y Salvo en las Unidades Académicas de Laboratorios a;', {
//           align: 'center',
//         });

//       jumpLine(doc, 1)

//       doc
//         .font('src/public/fonts/NotoSansJP-Bold.otf')
//         .fontSize(18)
//         .fill('#021c27')
//         .text(con_nombre, {
//           align: 'center',
//         });

//       jumpLine(doc, 1)

//       doc
//         .font('src/public/fonts/NotoSansJP-Light.otf')
//         .fontSize(14)
//         .fill('#021c27')
//         .text('Del programa académico ' + con_carrera + ', Identificado(a) con la C.C. ' + con_documento + ' y el código de estudiante ' + con_codigo, {
//           align: 'center',
//         });

//       jumpLine(doc, 1)

//       doc
//         .font('src/public/fonts/NotoSansJP-Light.otf')
//         .fontSize(10)
//         .fill('#021c27')
//         .text('Se emite en Bogotá D.C. a traves del sistema de generación de Paz y Salvos el ' + con_fecha, {
//           align: 'center',
//         });

//       doc
//         .font('src/public/fonts/NotoSansJP-Light.otf')
//         .fontSize(10)
//         .fill('#021c27')
//         .text('Fecha de vencimiento del certificado ' + fechaVencimiento, {
//           align: 'center',
//         });

//       const bottomHeight = doc.page.height - 150;

//       doc.image(`src/public/generate/${con_codigo}.png`, doc.page.width / 2 - 30, bottomHeight, {
//         fit: [100, 100],
//       });

//       jumpLine(doc, 1)

//       doc.fontSize(10).text(`ID único de validación ${uniqueId1}`, { link: `http://localhost:3000/milab/api/validateqr/${uniqueId1}` ,
//         align: 'center',
//       });

//       doc.end();
//       console.log('PDF CERTIFICADO generado!');
//     }

//     switch_exit = consultarEndpointAnidado();

//     if (switch_exit == "ERROR" ) {
//       return res.send("ERROR");
//     } else {
//       //return res.send("Certificado Generado");
//     }

//     function salvar (req) {
//     }

//     function generateUniqueId() {
//       const { v4: uuidv4 } = require('uuid');
//       return uuidv4();
//     }

//     function submit_data(req) {
//       const { Pool } = require('pg');
//       const pool = new Pool({
//         host: process.env.DB_HOST,
//         port: process.env.DB_PORT,
//         user: process.env.DB_USER,
