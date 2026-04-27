const INSTITUTIONAL_EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@udistrital\.edu\.co$/i;

function normalizeInstitutionalEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function isInstitutionalEmail(value) {
  const normalizedEmail = normalizeInstitutionalEmail(value);

  return Boolean(normalizedEmail) && INSTITUTIONAL_EMAIL_PATTERN.test(normalizedEmail);
}

async function findEmailConflict(client, correo, excludedAuthDocument) {
  const normalizedEmail = normalizeInstitutionalEmail(correo);

  if (!normalizedEmail || !excludedAuthDocument) {
    return null;
  }

  const query = `
    SELECT source, auth_document
    FROM (
      SELECT 'auth' AS source, documento AS auth_document, LOWER(TRIM(correo)) AS correo
      FROM auth
      WHERE correo IS NOT NULL AND TRIM(correo) <> ''

      UNION ALL

      SELECT 'usuario' AS source, documento AS auth_document, LOWER(TRIM(correo)) AS correo
      FROM usuario
      WHERE correo IS NOT NULL AND TRIM(correo) <> ''

      UNION ALL

      SELECT 'laboratorista' AS source, n_usuario AS auth_document, LOWER(TRIM(correo)) AS correo
      FROM laboratorista
      WHERE correo IS NOT NULL AND TRIM(correo) <> ''

      UNION ALL

      SELECT 'coordinador_laboratorio' AS source, nombre_u AS auth_document, LOWER(TRIM(correo)) AS correo
      FROM coordinador_laboratorio
      WHERE correo IS NOT NULL AND TRIM(correo) <> ''

      UNION ALL

      SELECT 'estudiante' AS source, cc::VARCHAR(50) AS auth_document, LOWER(TRIM(correo)) AS correo
      FROM estudiante
      WHERE correo IS NOT NULL AND TRIM(correo) <> ''

      UNION ALL

      SELECT 'docente' AS source, cc::VARCHAR(50) AS auth_document, LOWER(TRIM(correo)) AS correo
      FROM docente
      WHERE correo IS NOT NULL AND TRIM(correo) <> ''
    ) existing_accounts
    WHERE correo = $1
      AND auth_document <> $2
    LIMIT 1
  `;

  const result = await client.query(query, [normalizedEmail, String(excludedAuthDocument)]);

  return result.rows[0] || null;
}

function isUniqueViolation(error) {
  return error?.code === '23505';
}

function normalizeLogDocument(value) {
  const normalizedValue = typeof value === 'string' ? value.trim() : String(value || '').trim();

  if (!normalizedValue || !/^\d+$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

module.exports = {
  findEmailConflict,
  isInstitutionalEmail,
  isUniqueViolation,
  normalizeLogDocument,
  normalizeInstitutionalEmail,
};
