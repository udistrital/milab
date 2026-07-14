const express = require('express');
const { requireUser } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');

let router = express.Router();

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
