import argparse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


NS = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
MONTH_MAP = {
    'Jan': 1,
    'Feb': 2,
    'Mar': 3,
    'Apr': 4,
    'May': 5,
    'Jun': 6,
    'Jul': 7,
    'Aug': 8,
    'Sep': 9,
    'Oct': 10,
    'Nov': 11,
    'Dec': 12,
}
DEFAULT_PASSWORD = 'PazYSalvo2026!'
OFFICIAL_FACULTY_NAMES = {
    'VIVERO': 'Vivero',
    'TECNOLOGICA': 'Tecnologica',
    'PAIBA': 'Paiba',
    'ASAB': 'ASAB',
    'BOSA': 'Bosa',
    'CALLE 34': 'Calle 34',
    'CALLE 40': 'Calle 40',
    'CALLE 42': 'Calle 42',
    'MACARENA': 'Macarena',
}
FACULTY_ALIAS_RULES = [
    {
        'official_name': OFFICIAL_FACULTY_NAMES['VIVERO'],
        'patterns': [
            'VIVERO',
            'FACULTAD VIVERO',
            'SEDE VIVERO',
            'MEDIO AMBIENTE',
            'RECURSOS NATURALES',
            'FACULTAD DEL MEDIO AMBIENTE',
        ],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['TECNOLOGICA'],
        'patterns': ['TECNOLOGICA', 'FACULTAD TECNOLOGICA', 'SEDE TECNOLOGICA'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['PAIBA'],
        'patterns': ['PAIBA', 'SEDE PAIBA'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['ASAB'],
        'patterns': ['ASAB'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['BOSA'],
        'patterns': ['BOSA'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['CALLE 34'],
        'patterns': ['CALLE 34'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['CALLE 40'],
        'patterns': ['CALLE 40'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['CALLE 42'],
        'patterns': ['CALLE 42'],
    },
    {
        'official_name': OFFICIAL_FACULTY_NAMES['MACARENA'],
        'patterns': ['MACARENA'],
    },
]
LOCAL_EXTRA_SANCTIONS = [
    {
        'id': 1001,
        'category': 'Uso indebido de laboratorio',
        'lab_name': 'Coordinación Paiba',
        'punished_code': 20241081011,
        'ual': 'Centro de Geoprocesamiento/Aula Especializada',
        'sanction_date': '2026-01-15',
        'status': 'Pendiente',
        'notes': 'Caso piloto local para validación de aprobación por facultad Paiba.',
    },
    {
        'id': 1002,
        'category': 'Incumplimiento de protocolo',
        'lab_name': 'Coordinación Paiba',
        'punished_code': 20241081012,
        'ual': 'Laboratorio Observatorio Astronómico',
        'sanction_date': '2026-01-16',
        'status': 'POR SALDAR',
        'notes': 'Caso piloto local para validación de cierre por facultad Paiba.',
    },
    {
        'id': 1003,
        'category': 'Daño de material',
        'lab_name': 'Coordinación Vivero',
        'punished_code': 20251180018,
        'ual': 'Laboratorio De Microbiología Y Bioprospección Medioambiental',
        'sanction_date': '2026-01-17',
        'status': 'POR SALDAR',
        'notes': 'Caso piloto local para validación de aprobación visible en Vivero.',
    },
]


def sql_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def normalize_faculty_text(value):
    return (
        str(value or '')
        .upper()
        .replace('Á', 'A')
        .replace('É', 'E')
        .replace('Í', 'I')
        .replace('Ó', 'O')
        .replace('Ú', 'U')
        .replace('Ü', 'U')
        .replace('Ñ', 'N')
    )


def canonicalize_faculty_name(value):
    normalized_value = normalize_faculty_text(value)

    if not normalized_value:
        return None

    for rule in FACULTY_ALIAS_RULES:
        if any(pattern in normalized_value for pattern in rule['patterns']):
            return rule['official_name']

    return None


def parse_excel_date(raw_value):
    parts = raw_value.split()
    month = MONTH_MAP[parts[1]]
    day = int(parts[2])
    year = int(parts[3])
    return f'{year:04d}-{month:02d}-{day:02d}'


def column_index(reference):
    index = 0
    for char in reference:
        if char.isalpha():
            index = index * 26 + ord(char.upper()) - 64
    return index - 1


def parse_sheet(archive, workbook_root, relationship_map, name, shared_strings):
    sheet = next(item for item in workbook_root.find('a:sheets', NS) if item.attrib['name'] == name)
    target = 'xl/' + relationship_map[
        sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
    ]
    root = ET.fromstring(archive.read(target))
    rows = []

    for row in root.findall('.//a:sheetData/a:row', NS):
        values = {}
        for cell in row.findall('a:c', NS):
            index = column_index(cell.attrib['r'])
            cell_type = cell.attrib.get('t')
            value_node = cell.find('a:v', NS)
            value = ''

            if cell_type == 's' and value_node is not None:
                value = shared_strings[int(value_node.text)]
            elif cell_type == 'inlineStr':
                value = ''.join(node.text or '' for node in cell.findall('.//a:t', NS))
            elif value_node is not None:
                value = value_node.text or ''

            values[index] = value

        if values:
            rows.append([values.get(i, '') for i in range(max(values) + 1)])

    return rows


def load_workbook_rows(workbook_path):
    with zipfile.ZipFile(workbook_path) as archive:
        shared_strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared_root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            for item in shared_root.findall('a:si', NS):
                shared_strings.append(''.join(node.text or '' for node in item.findall('.//a:t', NS)))

        workbook_root = ET.fromstring(archive.read('xl/workbook.xml'))
        rel_root = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        relationship_map = {rel.attrib['Id']: rel.attrib['Target'] for rel in rel_root}

        coordinators = parse_sheet(
            archive,
            workbook_root,
            relationship_map,
            'coordinadores_registrados',
            shared_strings,
        )[1:]
        roster = parse_sheet(
            archive,
            workbook_root,
            relationship_map,
            'listado_estudiantes_docentes',
            shared_strings,
        )[1:]
        sanctions = parse_sheet(
            archive,
            workbook_root,
            relationship_map,
            'sanciones',
            shared_strings,
        )[1:]

    return coordinators, roster, sanctions


def build_coordinator_values(rows):
    values = []

    for name, document, email, faculty_label, status in rows:
        username = email.split('@', 1)[0].strip().lower() if email else f'coord_{document.strip()}'
        faculty_name = canonicalize_faculty_name(faculty_label)

        if not faculty_name:
            raise ValueError(f'No se pudo normalizar la facultad origen: {faculty_label!r}')

        auth_type = 'coordinador' if status.strip().lower() == 'activo' else 'inactivo'
        values.append(
            '    ('
            + ', '.join(
                [
                    sql_quote(name.strip()),
                    sql_quote(document.strip()),
                    sql_quote(email.strip().lower()),
                    sql_quote(username),
                    sql_quote(faculty_name),
                    sql_quote(status.strip()),
                    sql_quote(auth_type),
                    sql_quote(f'RES-PILOTO-{document.strip()}'),
                    sql_quote('Precarga local derivada desde data_piloto_paz_y_salvos.xlsx'),
                ]
            )
            + ')'
        )

    return ',\n'.join(values)


def build_roster_values(rows):
    values = []

    for name, document, code, program, status, email in rows:
        role = 'estudiante' if str(code).strip() else 'docente'
        values.append(
            '    ('
            + ', '.join(
                [
                    sql_quote(name.strip()),
                    sql_quote(document.strip()),
                    code.strip() if str(code).strip() else 'NULL',
                    sql_quote(program.strip()) if str(program).strip() else 'NULL',
                    sql_quote(status.strip()),
                    sql_quote(email.strip().lower()),
                    sql_quote(role),
                ]
            )
            + ')'
        )

    return ',\n'.join(values)


def build_sanction_values(rows):
    values = []

    for seed_id, category, lab_name, punished_code, ual, sanction_date, status, notes in rows:
        values.append(
            '    ('
            + ', '.join(
                [
                    seed_id.strip(),
                    sql_quote(category.strip()),
                    sql_quote(lab_name.strip()),
                    punished_code.strip(),
                    sql_quote(ual.strip()),
                    sql_quote(parse_excel_date(sanction_date.strip())),
                    sql_quote(status.strip()),
                    sql_quote(notes.strip()),
                ]
            )
            + ')'
        )

    for extra_sanction in LOCAL_EXTRA_SANCTIONS:
        values.append(
            '    ('
            + ', '.join(
                [
                    str(extra_sanction['id']),
                    sql_quote(extra_sanction['category']),
                    sql_quote(extra_sanction['lab_name']),
                    str(extra_sanction['punished_code']),
                    sql_quote(extra_sanction['ual']),
                    sql_quote(extra_sanction['sanction_date']),
                    sql_quote(extra_sanction['status']),
                    sql_quote(extra_sanction['notes']),
                ]
            )
            + ')'
        )

    return ',\n'.join(values)


def render_sql(coordinators, roster, sanctions):
    coordinator_values = build_coordinator_values(coordinators)
    roster_values = build_roster_values(roster)
    sanction_values = build_sanction_values(sanctions)

    return f"""-- Precarga local derivada desde data_piloto_paz_y_salvos.xlsx
-- Generado por scripts/generate_piloto_seed.py
-- Credenciales semilla:
--   - Estudiantes/docentes: documento + clave temporal {DEFAULT_PASSWORD}
--   - Coordinadores: usuario derivado del correo (antes del @) + clave temporal {DEFAULT_PASSWORD}

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'auth'
          AND column_name = 'correo'
    ) THEN
        ALTER TABLE auth
        ADD COLUMN correo VARCHAR(255);
    END IF;
END $$;

CREATE TEMP TABLE tmp_seed_coordinadores (
    nombre TEXT NOT NULL,
    documento VARCHAR(50) NOT NULL,
    correo VARCHAR(255) NOT NULL,
    nombre_u VARCHAR(50) NOT NULL,
    facultad_nombre TEXT NOT NULL,
    estado_origen TEXT NOT NULL,
    auth_tipo TEXT NOT NULL,
    numero_resolucion_coordinador VARCHAR(100) NOT NULL,
    soporte_resolucion TEXT NOT NULL
);

INSERT INTO tmp_seed_coordinadores (
    nombre,
    documento,
    correo,
    nombre_u,
    facultad_nombre,
    estado_origen,
    auth_tipo,
    numero_resolucion_coordinador,
    soporte_resolucion
)
VALUES
{coordinator_values};

CREATE TEMP TABLE tmp_seed_usuarios (
    nombre TEXT NOT NULL,
    documento VARCHAR(50) NOT NULL,
    codigo BIGINT,
    carrera TEXT,
    estado VARCHAR(50) NOT NULL,
    correo VARCHAR(255) NOT NULL,
    tipo VARCHAR(20) NOT NULL
);

INSERT INTO tmp_seed_usuarios (
    nombre,
    documento,
    codigo,
    carrera,
    estado,
    correo,
    tipo
)
VALUES
{roster_values};

CREATE TEMP TABLE tmp_seed_multas (
    id INTEGER NOT NULL,
    cat_multa TEXT NOT NULL,
    nombre_laboratorista VARCHAR(500) NOT NULL,
    cod_multado NUMERIC(20,0) NOT NULL,
    ual TEXT NOT NULL,
    fecha_multa DATE NOT NULL,
    con_estado_multa TEXT NOT NULL,
    obs_multa TEXT NOT NULL
);

INSERT INTO tmp_seed_multas (
    id,
    cat_multa,
    nombre_laboratorista,
    cod_multado,
    ual,
    fecha_multa,
    con_estado_multa,
    obs_multa
)
VALUES
{sanction_values};

UPDATE coordinador c
SET nombre = s.nombre,
    correo = s.correo,
    facultad_id = f.facultad_id,
    numero_resolucion_coordinador = s.numero_resolucion_coordinador,
    soporte_resolucion = s.soporte_resolucion,
    nombre_u = s.nombre_u
FROM tmp_seed_coordinadores s
JOIN facultad f ON f.nombre = s.facultad_nombre
WHERE c.documento = s.documento
    AND NOT EXISTS (
            SELECT 1
            FROM coordinador c_conflict
            WHERE c_conflict.documento <> c.documento
                AND (
                        LOWER(c_conflict.correo) = LOWER(s.correo)
                        OR c_conflict.nombre_u = s.nombre_u
                )
    );

INSERT INTO coordinador (
    documento,
    nombre,
    correo,
    facultad_id,
    numero_resolucion_coordinador,
    soporte_resolucion,
    nombre_u
)
SELECT
    s.documento,
    s.nombre,
    s.correo,
    f.facultad_id,
    s.numero_resolucion_coordinador,
    s.soporte_resolucion,
    s.nombre_u
FROM tmp_seed_coordinadores s
JOIN facultad f ON f.nombre = s.facultad_nombre
LEFT JOIN coordinador by_document ON by_document.documento = s.documento
LEFT JOIN coordinador by_email ON LOWER(by_email.correo) = LOWER(s.correo)
LEFT JOIN coordinador by_user ON by_user.nombre_u = s.nombre_u
WHERE by_document.documento IS NULL
  AND by_email.documento IS NULL
  AND by_user.documento IS NULL;

INSERT INTO coordinador_facultad (coordinador_documento_id, facultad_id)
SELECT DISTINCT s.documento, f.facultad_id
FROM tmp_seed_coordinadores s
JOIN facultad f ON f.nombre = s.facultad_nombre
ON CONFLICT DO NOTHING;

UPDATE auth a
SET correo = s.correo,
    tipo = s.auth_tipo
FROM tmp_seed_coordinadores s
WHERE a.documento = s.nombre_u;

INSERT INTO auth (documento, password, tipo, password_cambiado, correo)
SELECT
    s.nombre_u,
    crypt('{DEFAULT_PASSWORD}', gen_salt('bf', 12)),
    s.auth_tipo,
    FALSE,
    s.correo
FROM tmp_seed_coordinadores s
LEFT JOIN auth a ON a.documento = s.nombre_u
WHERE a.documento IS NULL;

UPDATE usuario u
SET codigo = s.codigo,
    nombre = LEFT(s.nombre, 100),
    correo = s.correo,
    estado = s.estado,
    carrera = LEFT(COALESCE(s.carrera, ''), 100)
FROM tmp_seed_usuarios s
WHERE u.documento = s.documento
    AND NOT EXISTS (
            SELECT 1
            FROM usuario u_conflict
            WHERE u_conflict.documento <> u.documento
                AND LOWER(u_conflict.correo) = LOWER(s.correo)
    );

INSERT INTO usuario (documento, codigo, nombre, correo, estado, carrera)
SELECT
    s.documento,
    s.codigo,
    LEFT(s.nombre, 100),
    s.correo,
    s.estado,
    LEFT(COALESCE(s.carrera, ''), 100)
FROM tmp_seed_usuarios s
LEFT JOIN usuario by_document ON by_document.documento = s.documento
LEFT JOIN usuario by_email ON LOWER(by_email.correo) = LOWER(s.correo)
WHERE by_document.documento IS NULL
  AND by_email.documento IS NULL;

UPDATE auth a
SET correo = s.correo,
    tipo = s.tipo
FROM tmp_seed_usuarios s
WHERE a.documento = s.documento;

INSERT INTO auth (documento, password, tipo, password_cambiado, correo)
SELECT
    s.documento,
    crypt('{DEFAULT_PASSWORD}', gen_salt('bf', 12)),
    s.tipo,
    TRUE,
    s.correo
FROM tmp_seed_usuarios s
LEFT JOIN auth a ON a.documento = s.documento
WHERE a.documento IS NULL;

INSERT INTO multas (
    id,
    cat_multa,
    nombre_laboratorista,
    cc_laboratorista,
    cod_multado,
    ual,
    fecha_multa,
    con_estado_multa,
    obs_multa,
    n_usuario
)
SELECT
    s.id,
    s.cat_multa,
    s.nombre_laboratorista,
    NULL,
    s.cod_multado,
    s.ual,
    s.fecha_multa,
    s.con_estado_multa,
    s.obs_multa,
    NULL
FROM tmp_seed_multas s
ON CONFLICT (id) DO UPDATE
SET cat_multa = EXCLUDED.cat_multa,
    nombre_laboratorista = EXCLUDED.nombre_laboratorista,
    cod_multado = EXCLUDED.cod_multado,
    ual = EXCLUDED.ual,
    fecha_multa = EXCLUDED.fecha_multa,
    con_estado_multa = EXCLUDED.con_estado_multa,
    obs_multa = EXCLUDED.obs_multa,
    cc_laboratorista = EXCLUDED.cc_laboratorista,
    n_usuario = EXCLUDED.n_usuario;

SELECT setval(
    pg_get_serial_sequence('multas', 'id'),
    GREATEST(COALESCE((SELECT MAX(id) FROM multas), 1), 1),
    TRUE
);
"""


def main():
    parser = argparse.ArgumentParser(description='Genera el seed SQL piloto desde el Excel de pruebas.')
    parser.add_argument(
        '--input',
        default='data_piloto_paz_y_salvos.xlsx',
        help='Ruta al archivo Excel fuente.',
    )
    parser.add_argument(
        '--output',
        default='sql-scripts/db_seed_pruebas_local.sql',
        help='Ruta del SQL generado.',
    )
    args = parser.parse_args()

    coordinators, roster, sanctions = load_workbook_rows(Path(args.input))
    sql = render_sql(coordinators, roster, sanctions)
    output_path = Path(args.output)
    output_path.write_text(sql, encoding='utf-8')
    print(f'Seed generado en {output_path}')


if __name__ == '__main__':
    main()