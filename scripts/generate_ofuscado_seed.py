#!/usr/bin/env python3
"""Generate an idempotent MILab test seed from the obfuscated XLSX workbook."""

import argparse
import hashlib
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta
from pathlib import Path


MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': MAIN_NS, 'r': REL_NS}
EXCEL_EPOCH = datetime(1899, 12, 30)
MISSING = {'', 'N/A', 'NA', 'N/D', 'ND', 'S/C', 'SC', 'SIN DATO', 'NO APLICA', 'NULL', 'NONE', '-', '--'}


def column_index(reference):
    index = 0
    for char in re.match(r'[A-Z]+', reference).group():
        index = index * 26 + ord(char) - ord('A') + 1
    return index - 1


def load_workbook(path):
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            strings = [
                ''.join(node.text or '' for node in item.findall('.//m:t', NS))
                for item in root.findall('m:si', NS)
            ]

        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        relationship_map = {item.attrib['Id']: item.attrib['Target'] for item in relationships}
        result = {}

        for sheet in workbook.findall('m:sheets/m:sheet', NS):
            target = relationship_map[sheet.attrib[f'{{{REL_NS}}}id']]
            sheet_path = target.lstrip('/') if target.startswith('/') else f'xl/{target}'
            sheet_path = sheet_path.replace('xl/xl/', 'xl/')
            root = ET.fromstring(archive.read(sheet_path))
            rows = root.findall('m:sheetData/m:row', NS)
            if not rows:
                raise ValueError(f'Sheet has no header row: {sheet.attrib["name"]}')

            header_cells = rows[0].findall('m:c', NS)
            headers = {
                column_index(cell.attrib['r']): read_cell(cell, strings)
                for cell in header_cells
            }
            records = []
            for row in rows[1:]:
                values = {}
                for cell in row.findall('m:c', NS):
                    header = headers.get(column_index(cell.attrib['r']))
                    if header:
                        values[header] = read_cell(cell, strings)
                records.append(values)
            result[sheet.attrib['name']] = records
        return result


def read_cell(cell, strings):
    if cell.attrib.get('t') == 'inlineStr':
        return ''.join(node.text or '' for node in cell.findall('.//m:t', NS))
    value = cell.find('m:v', NS)
    if value is None or value.text is None:
        return ''
    return strings[int(value.text)] if cell.attrib.get('t') == 's' else value.text


def normalized(value):
    text = unicodedata.normalize('NFKD', str(value or '').casefold())
    text = ''.join(char for char in text if not unicodedata.combining(char))
    return re.sub(r'[^a-z0-9]', '', text)


def clean(value):
    text = str(value or '').strip()
    return None if normalized(text) in {normalized(item) for item in MISSING} else text


def numeric(value):
    text = clean(value)
    if text is None:
        return None
    if re.fullmatch(r'\d+(?:\.0+)?', text):
        return int(float(text))
    return None


def as_boolean(value, default=True):
    text = normalized(value)
    if text in {'false', '0', 'no', 'inactivo', 'off'}:
        return False
    if text in {'true', '1', 'si', 'activo', 'on'}:
        return True
    return default


def as_timestamp(value):
    text = clean(value)
    if text is None:
        return None
    try:
        serial = float(text)
        if 1 <= serial <= 100000:
            return (EXCEL_EPOCH + timedelta(days=serial)).isoformat(sep=' ')
    except ValueError:
        pass
    for pattern in (
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d %H:%M',
        '%Y-%m-%d',
        '%d/%m/%Y %H:%M:%S',
        '%d/%m/%Y',
        '%m/%d/%Y %H:%M:%S',
        '%m/%d/%Y',
    ):
        try:
            return datetime.strptime(text, pattern).isoformat(sep=' ')
        except ValueError:
            continue
    raise ValueError('Unrecognized date in workbook; refusing to guess')


def sql(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def fit_text(value, limit):
    text = value or ''
    if len(text) <= limit:
        return text
    suffix = hashlib.sha256(text.encode('utf-8')).hexdigest()[:8]
    return text[:limit - len(suffix) - 1] + '-' + suffix


def insert_values(table, columns, rows):
    if not rows:
        return ''
    column_sql = ', '.join(columns)
    values = ',\n'.join(
        '    (' + ', '.join(sql(value) for value in row) + ')'
        for row in rows
    )
    return f'INSERT INTO {table} ({column_sql}) VALUES\n{values};\n'


def parse_sql_tuple(text, start):
    fields, current = [], []
    quoted = False
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == "'":
            if quoted and index + 1 < len(text) and text[index + 1] == "'":
                current.extend(["'", "'"])
                index += 2
                continue
            quoted = not quoted
            current.append(char)
        elif char == ',' and not quoted:
            fields.append(''.join(current).strip())
            current = []
        elif char == ')' and not quoted:
            fields.append(''.join(current).strip())
            return fields, index + 1
        else:
            current.append(char)
        index += 1
    raise ValueError('Unterminated VALUES tuple in db_seed_system.sql')


def system_uals(path):
    seed = path.read_text(encoding='utf-8')
    catalog = set()
    for match in re.finditer(r'INSERT\s+INTO\s+ual\b.*?\bVALUES', seed, re.I | re.S):
        end = seed.find('PERFORM setval(', match.end())
        if end < 0:
            raise ValueError('Could not locate end of a system UAL catalog block')
        block = seed[match.end():end]
        index = 0
        while index < len(block):
            if block[index] == "'":
                index = parse_sql_tuple(block, block.rfind('(', 0, index))[1]
                continue
            if block[index] == '(':
                fields, index = parse_sql_tuple(block, index)
                if len(fields) >= 5 and fields[0].startswith("'"):
                    name = fields[0][1:-1].replace("''", "'")
                    faculty_id = numeric(fields[4])
                    if name and faculty_id is not None:
                        catalog.add((faculty_id, name))
                continue
            index += 1
    if not catalog:
        raise ValueError('No UAL catalog rows found in db_seed_system.sql')
    return sorted(catalog, key=lambda item: (item[0], normalized(item[1]), item[1]))


def build_seed(workbook, system_seed):
    required_sheets = {
        'Estudantes', 'docentes', 'laboratoristas', 'coordinadores',
        'usuarios', 'certificados_generados', 'facultades', 'sanciones',
    }
    if not required_sheets.issubset(workbook):
        raise ValueError('Workbook is missing one or more expected sheets')

    users = {}

    def user_key(document):
        return str(clean(document) or '').casefold()

    def merge_user(document, **fields):
        key = user_key(document)
        if not key:
            return
        record = users.setdefault(key, {'documento': clean(document)})
        for name, value in fields.items():
            if value is not None:
                record[name] = value

    for row in workbook['usuarios']:
        document = clean(row.get('Documento'))
        if not document:
            continue
        merge_user(
            document,
            correo=clean(row.get('Correo')),
            nombre=clean(row.get('Nombre')),
            codigo=numeric(row.get('Código')),
            estado=clean(row.get('Estado')),
            carrera=clean(row.get('Carrera')),
            activo=as_boolean(row.get('Activo')),
            fecha_creacion=as_timestamp(row.get('Fecha creación')),
            fecha_modificacion=as_timestamp(row.get('Fecha modificación')),
        )

    for sheet, is_student in (('Estudantes', True), ('docentes', False)):
        for row in workbook[sheet]:
            document = clean(row.get('Cédula'))
            if not document:
                continue
            merge_user(
                document,
                correo=clean(row.get('Correo')),
                nombre=clean(row.get('Nombres y apellidos')),
                codigo=numeric(row.get('Código')),
                estado=clean(row.get('Estado cuenta')),
                carrera=clean(row.get('Programa')),
            )

    sanctions = []
    missing_sanction_documents = set()
    for row_number, row in enumerate(workbook['sanciones'], start=1):
        document = clean(row.get('Documento Sancionado'))
        if document and user_key(document) not in users:
            missing_sanction_documents.add(user_key(document))
        sanctions.append((row_number, row))

    for index, key in enumerate(sorted(missing_sanction_documents), start=1):
        source = next(row for _, row in sanctions if user_key(row.get('Documento Sancionado')) == key)
        document = clean(source.get('Documento Sancionado'))
        code = numeric(source.get('Codigo Sancionado'))
        person_type = normalized(source.get('Tipo Sancionado'))
        role = 'docente' if 'docent' in person_type else 'estudiante'
        merge_user(
            document,
            correo=f'seed-sancionado-{index:04d}@example.test',
            nombre=f'Usuario de prueba sancionado {index:04d}',
            codigo=code,
            estado='Activo',
            activo=True,
        )

    student_rows, teacher_rows, role_rows = [], [], set()
    for row in workbook['Estudantes']:
        document = clean(row.get('Cédula'))
        if not document:
            continue
        user = users[user_key(document)]
        student_rows.append((
            document, clean(row.get('Nombres y apellidos')), numeric(row.get('Código')),
            clean(row.get('Programa')), clean(row.get('Estado cuenta')), user.get('activo', True),
            as_timestamp(row.get('Fecha creación')), user.get('fecha_modificacion'),
        ))
        role_rows.add((document, 'estudiante'))

    for row in workbook['docentes']:
        document = clean(row.get('Cédula'))
        if not document:
            continue
        user = users[user_key(document)]
        teacher_rows.append((
            document, clean(row.get('Nombres y apellidos')), clean(row.get('Estado cuenta')),
            user.get('activo', True), as_timestamp(row.get('Fecha creación')),
            user.get('fecha_modificacion'),
        ))
        role_rows.add((document, 'docente'))

    laboratory_rows = []
    for row in workbook['laboratoristas']:
        document = clean(row.get('Documento'))
        if not document:
            continue
        laboratory_rows.append((
            document, clean(row.get('Laboratorista')) or 'Laboratorista de prueba',
            clean(row.get('Usuario red')), clean(row.get('Correo')),
            clean(row.get('Contrato')), True,
        ))
        role_rows.add((document, 'laboratorista'))

    coordinator_rows = []
    for row in workbook['coordinadores']:
        document = clean(row.get('Documento'))
        if not document:
            continue
        email = clean(row.get('Correo'))
        username = email.split('@', 1)[0] if email else f'coord-prueba-{len(coordinator_rows) + 1:04d}'
        coordinator_rows.append((
            document, clean(row.get('Coordinador')) or 'Coordinador de prueba',
            email, clean(row.get('Resolución')), clean(row.get('Soporte URL')),
            username[:50], True,
        ))
        role_rows.add((document, 'coordinador'))

    for _, row in sanctions:
        document = clean(row.get('Documento Sancionado'))
        if document in {item[0] for item in student_rows} | {item[0] for item in teacher_rows}:
            continue
        user = users[user_key(document)] if document else None
        if not user:
            continue
        person_type = normalized(row.get('Tipo Sancionado'))
        role = 'docente' if 'docent' in person_type else 'estudiante'
        role_rows.add((document, role))
        if role == 'docente':
            teacher_rows.append((
                document, user.get('nombre'), user.get('estado'), True, None, None,
            ))
        else:
            student_rows.append((
                document, user.get('nombre'), user.get('codigo'), None,
                user.get('estado'), True, None, None,
            ))

    user_rows = []
    for user in sorted(users.values(), key=lambda item: user_key(item.get('documento'))):
        user_rows.append((
            user.get('documento'), (user.get('correo') or '').lower(),
            user.get('nombre') or 'Usuario de prueba',
            user.get('codigo'), user.get('estado'), user.get('carrera'),
            user.get('activo', True), user.get('fecha_creacion'),
            user.get('fecha_modificacion'),
        ))

    faculty_rows, dependency_rows = [], []
    for row in workbook['facultades']:
        name = clean(row.get('Nombre'))
        match = re.search(r'\s*ID:\s*(\d+)\s*$', name or '', re.I)
        if not match:
            continue
        faculty_id = int(match.group(1))
        faculty_name = re.sub(r'\s*ID:\s*\d+\s*$', '', name, flags=re.I).strip()
        faculty_rows.append((faculty_id, faculty_name, True))
        count = numeric(row.get('Dependencias')) or 0
        for ordinal in range(1, count + 1):
            dependency_rows.append((
                faculty_id, ordinal,
                f'Dependencia de pruebas {ordinal:02d} (Facultad {faculty_id})',
            ))
    if not faculty_rows:
        raise ValueError('No faculty IDs could be read from the workbook')
    faculty_rows.sort()
    dependency_rows.sort()

    dependency_options = [(faculty_id, ordinal) for faculty_id, ordinal, _ in dependency_rows]
    coordinator_scopes = []
    coordinators_sorted = sorted(coordinator_rows, key=lambda row: row[0])
    faculty_ids = [row[0] for row in faculty_rows]
    for index, coordinator in enumerate(coordinators_sorted):
        mode = index % 3
        if mode == 0:
            coordinator_scopes.append((coordinator[0], 'faculty', faculty_ids[(index // 3) % len(faculty_ids)], None))
        elif mode == 1:
            faculty_id, ordinal = dependency_options[(index // 3) % len(dependency_options)]
            coordinator_scopes.append((coordinator[0], 'dependency', faculty_id, ordinal))
        else:
            coordinator_scopes.append((coordinator[0], 'ual', None, None))

    catalog = system_uals(system_seed)
    source_uals = sorted({
        clean(row.get('UAL')) for _, row in sanctions if clean(row.get('UAL'))
    }, key=lambda value: normalized(value))
    catalog_by_name = {}
    for faculty_id, name in catalog:
        catalog_by_name.setdefault(normalized(name), []).append((faculty_id, name))
    ual_map = []
    synthetic_index = 0
    for index, source_name in enumerate(source_uals):
        candidates = catalog_by_name.get(normalized(source_name))
        synthetic = not bool(candidates)
        if candidates:
            target_faculty, target_name = candidates[0]
        else:
            target_faculty, target_name = catalog[synthetic_index % len(catalog)]
            synthetic_index += 1
        ual_map.append((source_name, target_name, target_faculty, synthetic))

    fine_rows = []
    for row_number, row in sanctions:
        document = clean(row.get('Documento Sancionado'))
        laboratory = clean(row.get('CC Laboratorista'))
        source_ual = clean(row.get('UAL'))
        source_id = clean(row.get('ID')) or f'ROW-{row_number:04d}'
        note = clean(row.get('Observaciones')) or ''
        marker = f'[SEED-OFUSCADO:{source_id}] '
        fine_rows.append((
            marker + note[:470], fit_text(clean(row.get('Categoria')), 100), laboratory,
            document, as_timestamp(row.get('Fecha Multa')), clean(row.get('Estado')),
            clean(row.get('Tipo Sancion')), source_ual,
        ))

    certificate_rows = []
    for row in workbook['certificados_generados']:
        certificate_id = clean(row.get('Certificado'))
        if not certificate_id:
            continue
        certificate_type = normalized(row.get('Tipo'))
        kind = 'docente' if 'docent' in certificate_type else 'estudiante'
        certificate_rows.append((
            clean(row.get('ID')), kind, clean(row.get('Cédula')),
            numeric(row.get('Código')), certificate_id,
            as_timestamp(row.get('Fecha de creación')),
            as_timestamp(row.get('Fecha de vencimiento')),
            clean(row.get('Estado')), clean(row.get('Motivo')),
            clean(row.get('Sanciones')), clean(row.get('Correo')),
        ))

    role_values = sorted(role_rows)
    scope_values = coordinator_scopes
    ual_map_values = [
        (source_name, target_name, target_faculty, synthetic)
        for source_name, target_name, target_faculty, synthetic in ual_map
    ]

    body = []
    body.append("""-- Test-only seed generated from docs/data_ofuscada_pruebas.xlsx.
-- Run after db_structure.sql and db_seed_system.sql.
-- This script is additive/idempotent: it never truncates or deletes application data.
-- Synthetic relationships are deterministic and use only UALs from db_seed_system.sql.
CREATE SCHEMA IF NOT EXISTS milab;
SET search_path TO milab;
SET TIME ZONE 'America/Bogota';
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('milab.db_seed_pruebas_ofuscado'));

CREATE TEMP TABLE tmp_seed_usuarios (
    documento TEXT, correo TEXT, nombre TEXT, codigo BIGINT, estado TEXT,
    carrera TEXT, activo BOOLEAN, fecha_creacion TIMESTAMPTZ,
    fecha_modificacion TIMESTAMPTZ
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_usuarios', (
        'documento', 'correo', 'nombre', 'codigo', 'estado', 'carrera', 'activo',
        'fecha_creacion', 'fecha_modificacion',
    ), user_rows))
    body.append("""
CREATE TEMP TABLE tmp_seed_roles (documento TEXT, rol TEXT) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_roles', ('documento', 'rol'), role_values))
    body.append("""
CREATE TEMP TABLE tmp_seed_estudiantes (
    documento TEXT, nombre TEXT, codigo BIGINT, programa TEXT, estado TEXT,
    activo BOOLEAN, fecha_creacion TIMESTAMPTZ, fecha_modificacion TIMESTAMPTZ
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_estudiantes', (
        'documento', 'nombre', 'codigo', 'programa', 'estado', 'activo',
        'fecha_creacion', 'fecha_modificacion',
    ), student_rows))
    body.append("""
CREATE TEMP TABLE tmp_seed_docentes (
    documento TEXT, nombre TEXT, estado TEXT, activo BOOLEAN,
    fecha_creacion TIMESTAMPTZ, fecha_modificacion TIMESTAMPTZ
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_docentes', (
        'documento', 'nombre', 'estado', 'activo', 'fecha_creacion', 'fecha_modificacion',
    ), teacher_rows))
    body.append("""
CREATE TEMP TABLE tmp_seed_laboratoristas (
    documento TEXT, nombre TEXT, n_usuario TEXT, correo TEXT,
    contrato TEXT, activo BOOLEAN
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_laboratoristas', (
        'documento', 'nombre', 'n_usuario', 'correo', 'contrato', 'activo',
    ), laboratory_rows))
    body.append("""
CREATE TEMP TABLE tmp_seed_coordinadores (
    documento TEXT, nombre TEXT, correo TEXT, resolucion TEXT,
    soporte TEXT, nombre_u TEXT, activo BOOLEAN
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_coordinadores', (
        'documento', 'nombre', 'correo', 'resolucion', 'soporte', 'nombre_u', 'activo',
    ), coordinators_sorted))
    body.append("""
CREATE TEMP TABLE tmp_seed_facultades (
    facultad_id INTEGER, nombre TEXT, activo BOOLEAN
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_facultades', (
        'facultad_id', 'nombre', 'activo',
    ), faculty_rows))
    body.append("""
CREATE TEMP TABLE tmp_seed_dependencias (
    facultad_id INTEGER, ordinal INTEGER, nombre TEXT, dependencia_id INTEGER
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_dependencias', (
        'facultad_id', 'ordinal', 'nombre', 'dependencia_id',
    ), [(faculty_id, ordinal, name, None) for faculty_id, ordinal, name in dependency_rows]))
    body.append("""
CREATE TEMP TABLE tmp_seed_coordinator_scopes (
    documento TEXT, alcance TEXT, facultad_id INTEGER, dependencia_ordinal INTEGER
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_coordinator_scopes', (
        'documento', 'alcance', 'facultad_id', 'dependencia_ordinal',
    ), scope_values))
    body.append("""
CREATE TEMP TABLE tmp_seed_ual_map (
    ual_origen TEXT, ual_destino TEXT, facultad_id INTEGER, sintetico BOOLEAN
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_ual_map', (
        'ual_origen', 'ual_destino', 'facultad_id', 'sintetico',
    ), ual_map_values))
    body.append("""
CREATE TEMP TABLE tmp_seed_multas (
    observacion TEXT, categoria TEXT, laboratorista_documento TEXT,
    sancionado_documento TEXT, fecha_multa TIMESTAMPTZ, estado TEXT,
    tipo_sancion TEXT, ual_origen TEXT
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_multas', (
        'observacion', 'categoria', 'laboratorista_documento',
        'sancionado_documento', 'fecha_multa', 'estado', 'tipo_sancion', 'ual_origen',
    ), fine_rows))
    body.append("""
CREATE TEMP TABLE tmp_seed_certificados (
    source_id TEXT, tipo TEXT, documento TEXT, codigo BIGINT,
    certificado_id TEXT, fecha_creacion TIMESTAMPTZ, fecha_vencimiento TIMESTAMPTZ,
    estado TEXT, motivo TEXT, sanciones TEXT, correo TEXT
) ON COMMIT DROP;
""")
    body.append(insert_values('tmp_seed_certificados', (
        'source_id', 'tipo', 'documento', 'codigo', 'certificado_id',
        'fecha_creacion', 'fecha_vencimiento', 'estado', 'motivo', 'sanciones', 'correo',
    ), certificate_rows))
    body.append("""
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM milab.rol WHERE nombre = 'estudiante')
       OR NOT EXISTS (SELECT 1 FROM milab.rol WHERE nombre = 'docente')
       OR NOT EXISTS (SELECT 1 FROM milab.rol WHERE nombre = 'laboratorista')
       OR NOT EXISTS (SELECT 1 FROM milab.rol WHERE nombre = 'coordinador') THEN
        RAISE EXCEPTION 'Run db_seed_system.sql before the obfuscated test seed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM milab.ual) THEN
        RAISE EXCEPTION 'No system UALs found; run db_seed_system.sql first';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tmp_seed_facultades f
        LEFT JOIN milab.dependencia_facultad d
          ON d.dependencia_facultad_id = f.facultad_id
        WHERE d.dependencia_facultad_id IS NULL
    ) THEN
        RAISE EXCEPTION 'A workbook faculty ID is missing from the system catalog';
    END IF;
END $$;

INSERT INTO dependencia_facultad (dependencia_facultad_id, nombre, padre_id, activo)
SELECT facultad_id, nombre, NULL, activo
FROM tmp_seed_facultades
ON CONFLICT (dependencia_facultad_id) DO UPDATE
SET nombre = EXCLUDED.nombre,
    padre_id = NULL,
    activo = EXCLUDED.activo,
    fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO dependencia_facultad (nombre, padre_id, activo)
SELECT d.nombre, d.facultad_id, TRUE
FROM tmp_seed_dependencias d
WHERE NOT EXISTS (
    SELECT 1 FROM dependencia_facultad existing
    WHERE existing.padre_id = d.facultad_id
      AND lower(existing.nombre) = lower(d.nombre)
);

UPDATE tmp_seed_dependencias d
SET dependencia_id = child.dependencia_facultad_id
FROM dependencia_facultad child
WHERE child.padre_id = d.facultad_id
  AND lower(child.nombre) = lower(d.nombre);

SELECT setval(
    pg_get_serial_sequence('dependencia_facultad', 'dependencia_facultad_id'),
    GREATEST((SELECT max(dependencia_facultad_id) FROM dependencia_facultad), 1),
    TRUE
);

-- Distribute existing system UALs consistently across generated dependencies.
-- One UAL out of every four stays directly under its faculty for scope-testing.
WITH ranked_uals AS (
    SELECT u.ual_id,
           COALESCE(parent.padre_id, parent.dependencia_facultad_id) AS root_id,
           row_number() OVER (
               PARTITION BY COALESCE(parent.padre_id, parent.dependencia_facultad_id)
               ORDER BY u.ual_id
           ) AS position,
           count(*) OVER (
               PARTITION BY COALESCE(parent.padre_id, parent.dependencia_facultad_id)
           ) AS total
    FROM ual u
    JOIN dependencia_facultad parent
      ON parent.dependencia_facultad_id = u.facultad_id
    JOIN tmp_seed_facultades f
      ON f.facultad_id = COALESCE(parent.padre_id, parent.dependencia_facultad_id)
), destinations AS (
    SELECT ranked.ual_id,
           CASE WHEN ranked.position % 4 = 0 THEN ranked.root_id
                ELSE child.dependencia_id END AS destination_id
    FROM ranked_uals ranked
    LEFT JOIN LATERAL (
        SELECT d.dependencia_id
        FROM tmp_seed_dependencias d
        WHERE d.facultad_id = ranked.root_id
          AND d.ordinal = ((ranked.position - 1) % NULLIF((
              SELECT count(*) FROM tmp_seed_dependencias all_deps
              WHERE all_deps.facultad_id = ranked.root_id
          ), 0)) + 1
    ) child ON TRUE
    WHERE ranked.position % 4 = 0
       OR EXISTS (SELECT 1 FROM tmp_seed_dependencias d WHERE d.facultad_id = ranked.root_id)
)
UPDATE ual u
SET facultad_id = destinations.destination_id,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM destinations
WHERE u.ual_id = destinations.ual_id
  AND destinations.destination_id IS NOT NULL
  AND u.facultad_id IS DISTINCT FROM destinations.destination_id;

INSERT INTO usuario (
    documento, correo, nombre, codigo, estado, carrera, activo,
    fecha_creacion, fecha_modificacion
)
SELECT documento, correo, nombre, codigo, estado, carrera, activo,
       COALESCE(fecha_creacion, CURRENT_TIMESTAMP),
       COALESCE(fecha_modificacion, fecha_creacion, CURRENT_TIMESTAMP)
FROM tmp_seed_usuarios
ON CONFLICT (documento) DO UPDATE
SET correo = EXCLUDED.correo,
    nombre = EXCLUDED.nombre,
    codigo = EXCLUDED.codigo,
    estado = EXCLUDED.estado,
    carrera = EXCLUDED.carrera,
    activo = EXCLUDED.activo,
    fecha_creacion = EXCLUDED.fecha_creacion,
    fecha_modificacion = EXCLUDED.fecha_modificacion;

INSERT INTO usuario_rol (usuario_id, rol_id, activo)
SELECT u.id, r.id, TRUE
FROM tmp_seed_roles seed
JOIN usuario u ON u.documento = seed.documento
JOIN rol r ON r.nombre = seed.rol
ON CONFLICT (usuario_id, rol_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

UPDATE perfil_estudiante p
SET documento = seed.documento,
    nombre = seed.nombre,
    codigo = seed.codigo,
    programa = seed.programa,
    estado = seed.estado,
    activo = seed.activo,
    fecha_creacion = COALESCE(seed.fecha_creacion, p.fecha_creacion),
    fecha_modificacion = COALESCE(seed.fecha_modificacion, p.fecha_modificacion)
FROM tmp_seed_estudiantes seed
JOIN usuario u ON u.documento = seed.documento
WHERE p.usuario_id = u.id;

INSERT INTO perfil_estudiante (
    usuario_id, documento, nombre, codigo, programa, estado, activo,
    fecha_creacion, fecha_modificacion
)
SELECT u.id, seed.documento, seed.nombre, seed.codigo, seed.programa,
       seed.estado, seed.activo, seed.fecha_creacion, seed.fecha_modificacion
FROM tmp_seed_estudiantes seed
JOIN usuario u ON u.documento = seed.documento
WHERE NOT EXISTS (
    SELECT 1 FROM perfil_estudiante existing WHERE existing.usuario_id = u.id
);

UPDATE perfil_docente p
SET documento = seed.documento,
    nombre = seed.nombre,
    estado = seed.estado,
    activo = seed.activo,
    fecha_creacion = COALESCE(seed.fecha_creacion, p.fecha_creacion),
    fecha_modificacion = COALESCE(seed.fecha_modificacion, p.fecha_modificacion)
FROM tmp_seed_docentes seed
JOIN usuario u ON u.documento = seed.documento
WHERE p.usuario_id = u.id;

INSERT INTO perfil_docente (
    usuario_id, documento, nombre, estado, activo,
    fecha_creacion, fecha_modificacion
)
SELECT u.id, seed.documento, seed.nombre, seed.estado, seed.activo,
       seed.fecha_creacion, seed.fecha_modificacion
FROM tmp_seed_docentes seed
JOIN usuario u ON u.documento = seed.documento
WHERE NOT EXISTS (
    SELECT 1 FROM perfil_docente existing WHERE existing.usuario_id = u.id
);

INSERT INTO laboratorista (
    documento, nombre, n_usuario, correo, contrato, usuario_id, activo
)
SELECT seed.documento, seed.nombre, seed.n_usuario, seed.correo, seed.contrato,
       u.id, seed.activo
FROM tmp_seed_laboratoristas seed
JOIN usuario u ON u.documento = seed.documento
ON CONFLICT (documento) DO UPDATE
SET nombre = EXCLUDED.nombre,
    n_usuario = EXCLUDED.n_usuario,
    correo = EXCLUDED.correo,
    contrato = EXCLUDED.contrato,
    usuario_id = EXCLUDED.usuario_id,
    activo = EXCLUDED.activo,
    fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO coordinador (
    documento, nombre, correo, numero_resolucion_coordinador,
    soporte_resolucion, nombre_u, usuario_id, activo
)
SELECT seed.documento, seed.nombre, seed.correo, seed.resolucion,
       seed.soporte, seed.nombre_u, u.id, seed.activo
FROM tmp_seed_coordinadores seed
JOIN usuario u ON u.documento = seed.documento
ON CONFLICT (documento) DO UPDATE
SET nombre = EXCLUDED.nombre,
    correo = EXCLUDED.correo,
    numero_resolucion_coordinador = EXCLUDED.numero_resolucion_coordinador,
    soporte_resolucion = EXCLUDED.soporte_resolucion,
    nombre_u = EXCLUDED.nombre_u,
    usuario_id = EXCLUDED.usuario_id,
    activo = EXCLUDED.activo,
    fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO coordinador_facultad (coordinador_documento_id, facultad_id, activo)
SELECT scope.documento, scope.facultad_id, TRUE
FROM tmp_seed_coordinator_scopes scope
WHERE scope.alcance = 'faculty'
ON CONFLICT (coordinador_documento_id, facultad_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO coordinador_facultad (coordinador_documento_id, facultad_id, activo)
SELECT scope.documento, dependency.dependencia_id, TRUE
FROM tmp_seed_coordinator_scopes scope
JOIN tmp_seed_dependencias dependency
  ON dependency.facultad_id = scope.facultad_id
 AND dependency.ordinal = scope.dependencia_ordinal
WHERE scope.alcance = 'dependency'
ON CONFLICT (coordinador_documento_id, facultad_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

-- Coordinators are divided into faculty-only, dependency-only and UAL scopes.
WITH coordinators AS (
    SELECT scope.documento,
           row_number() OVER (ORDER BY scope.documento) AS position
    FROM tmp_seed_coordinator_scopes scope
    WHERE scope.alcance = 'ual'
), available_uals AS (
    SELECT ual_id,
           row_number() OVER (ORDER BY ual_id) AS position,
           count(*) OVER () AS total
    FROM ual
    WHERE activo = TRUE
)
INSERT INTO usuario_ual_rol_operativo (usuario_id, rol_id, ual_id, activo)
SELECT u.id, r.id,
       available_uals.ual_id, TRUE
FROM coordinators c
JOIN usuario u ON u.documento = c.documento
JOIN rol r ON r.nombre = 'coordinador'
JOIN available_uals
  ON available_uals.position = ((c.position - 1) % available_uals.total) + 1
ON CONFLICT (usuario_id, rol_id, ual_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO laboratorista_ual (laboratorista_documento_id, ual_id, activo)
SELECT DISTINCT lab.documento, target.ual_id, TRUE
FROM tmp_seed_multas fine
JOIN tmp_seed_laboratoristas lab
  ON lab.documento = fine.laboratorista_documento
JOIN tmp_seed_ual_map mapping
  ON mapping.ual_origen = fine.ual_origen
JOIN LATERAL (
    SELECT u.ual_id
    FROM ual u
    JOIN dependencia_facultad d
      ON d.dependencia_facultad_id = u.facultad_id
    WHERE u.nombre = mapping.ual_destino
      AND COALESCE(d.padre_id, d.dependencia_facultad_id) = mapping.facultad_id
    ORDER BY u.ual_id
    LIMIT 1
) target ON TRUE
ON CONFLICT (laboratorista_documento_id, ual_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

-- Give any remaining laboratorista a stable UAL assignment without overwriting
-- explicitly derived assignments.
WITH available_uals AS (
    SELECT ual_id,
           row_number() OVER (ORDER BY ual_id) AS position,
           count(*) OVER () AS total
    FROM ual
    WHERE activo = TRUE
), unassigned_labs AS (
    SELECT lab.documento,
           row_number() OVER (ORDER BY lab.documento) AS position
    FROM tmp_seed_laboratoristas lab
    WHERE NOT EXISTS (
        SELECT 1 FROM laboratorista_ual existing
        WHERE existing.laboratorista_documento_id = lab.documento
          AND existing.activo = TRUE
    )
)
INSERT INTO laboratorista_ual (laboratorista_documento_id, ual_id, activo)
SELECT labs.documento, ual.ual_id, TRUE
FROM unassigned_labs labs
JOIN available_uals ual
  ON ual.position = ((labs.position - 1) % ual.total) + 1
ON CONFLICT (laboratorista_documento_id, ual_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO usuario_ual_rol_operativo (usuario_id, rol_id, ual_id, activo)
SELECT DISTINCT u.id, r.id, lu.ual_id, TRUE
FROM laboratorista_ual lu
JOIN tmp_seed_laboratoristas seed
  ON seed.documento = lu.laboratorista_documento_id
JOIN usuario u ON u.documento = seed.documento
JOIN rol r ON r.nombre = 'laboratorista'
WHERE lu.activo = TRUE
ON CONFLICT (usuario_id, rol_id, ual_id) DO UPDATE
SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM tmp_seed_ual_map mapping
        WHERE NOT EXISTS (
            SELECT 1
            FROM ual u
            JOIN dependencia_facultad d
              ON d.dependencia_facultad_id = u.facultad_id
            WHERE u.nombre = mapping.ual_destino
              AND COALESCE(d.padre_id, d.dependencia_facultad_id) = mapping.facultad_id
        )
    ) THEN
        RAISE EXCEPTION 'A mapped system UAL is missing; run db_seed_system.sql first';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tmp_seed_multas s
        LEFT JOIN usuario u ON u.documento = s.sancionado_documento
        WHERE u.id IS NULL
    ) THEN
        RAISE EXCEPTION 'A sanctioned test user could not be resolved';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tmp_seed_multas s
        LEFT JOIN laboratorista l ON l.documento = s.laboratorista_documento
        WHERE l.documento IS NULL
    ) THEN
        RAISE EXCEPTION 'A sanction laboratorista could not be resolved';
    END IF;
END $$;

UPDATE multa target
SET cat_multa = seed.categoria,
    laboratorista_documento_id = seed.laboratorista_documento,
    usuario_sancionado_id = sanctioned.id,
    ual_id = mapped.ual_id,
    fecha_multa = seed.fecha_multa::DATE,
    con_estado_multa = seed.estado,
    obs_multa = seed.observacion,
    tipo_sancion = seed.tipo_sancion,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM tmp_seed_multas seed
JOIN usuario sanctioned ON sanctioned.documento = seed.sancionado_documento
JOIN tmp_seed_ual_map mapping ON mapping.ual_origen = seed.ual_origen
JOIN LATERAL (
    SELECT u.ual_id
    FROM ual u
    JOIN dependencia_facultad d
      ON d.dependencia_facultad_id = u.facultad_id
    WHERE u.nombre = mapping.ual_destino
      AND COALESCE(d.padre_id, d.dependencia_facultad_id) = mapping.facultad_id
    ORDER BY u.ual_id
    LIMIT 1
) mapped ON TRUE
WHERE target.obs_multa = seed.observacion;

INSERT INTO multa (
    cat_multa, laboratorista_documento_id, usuario_sancionado_id, ual_id,
    fecha_multa, con_estado_multa, obs_multa, tipo_sancion, activo
)
SELECT seed.categoria, seed.laboratorista_documento, sanctioned.id,
       mapped.ual_id, seed.fecha_multa::DATE, seed.estado, seed.observacion,
       seed.tipo_sancion, TRUE
FROM tmp_seed_multas seed
JOIN usuario sanctioned ON sanctioned.documento = seed.sancionado_documento
JOIN tmp_seed_ual_map mapping ON mapping.ual_origen = seed.ual_origen
JOIN LATERAL (
    SELECT u.ual_id
    FROM ual u
    JOIN dependencia_facultad d
      ON d.dependencia_facultad_id = u.facultad_id
    WHERE u.nombre = mapping.ual_destino
      AND COALESCE(d.padre_id, d.dependencia_facultad_id) = mapping.facultad_id
    ORDER BY u.ual_id
    LIMIT 1
) mapped ON TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM multa existing
    WHERE existing.obs_multa = seed.observacion
);

-- Certificate IDs are the stable natural keys because the legacy export IDs
-- are not unique and are not database primary keys.
UPDATE certificado_estudiante target
SET fecha_creacion = seed.fecha_creacion,
    fecha_vencimiento = seed.fecha_vencimiento,
    correo = seed.correo,
    motivo_exp = seed.motivo,
    multa = seed.sanciones,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM tmp_seed_certificados seed
JOIN LATERAL (
    SELECT u.id
    FROM usuario u
    WHERE (seed.documento IS NOT NULL AND u.documento = seed.documento)
       OR (seed.documento IS NULL AND seed.codigo IS NOT NULL AND u.codigo = seed.codigo)
    ORDER BY CASE WHEN u.documento = seed.documento THEN 0 ELSE 1 END, u.id
    LIMIT 1
) resolved ON TRUE
WHERE seed.tipo = 'estudiante'
  AND target.usuario_id = resolved.id
  AND target.certificado_id = seed.certificado_id;

INSERT INTO certificado_estudiante (
    usuario_id, fecha_creacion, fecha_vencimiento, certificado_id,
    motivo_exp, correo, multa, activo
)
SELECT resolved.id, seed.fecha_creacion, seed.fecha_vencimiento,
       seed.certificado_id, seed.motivo, seed.correo, seed.sanciones, TRUE
FROM tmp_seed_certificados seed
JOIN LATERAL (
    SELECT u.id
    FROM usuario u
    WHERE (seed.documento IS NOT NULL AND u.documento = seed.documento)
       OR (seed.documento IS NULL AND seed.codigo IS NOT NULL AND u.codigo = seed.codigo)
    ORDER BY CASE WHEN u.documento = seed.documento THEN 0 ELSE 1 END, u.id
    LIMIT 1
) resolved ON TRUE
WHERE seed.tipo = 'estudiante'
  AND NOT EXISTS (
      SELECT 1 FROM certificado_estudiante existing
      WHERE existing.usuario_id = resolved.id
        AND existing.certificado_id = seed.certificado_id
  );

UPDATE certificado_docente target
SET fecha_creacion = seed.fecha_creacion,
    correo = seed.correo,
    motivo_exp = seed.motivo,
    estado_docente = seed.estado,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM tmp_seed_certificados seed
JOIN LATERAL (
    SELECT u.id
    FROM usuario u
    WHERE (seed.documento IS NOT NULL AND u.documento = seed.documento)
       OR (seed.documento IS NULL AND seed.codigo IS NOT NULL AND u.codigo = seed.codigo)
    ORDER BY CASE WHEN u.documento = seed.documento THEN 0 ELSE 1 END, u.id
    LIMIT 1
) resolved ON TRUE
WHERE seed.tipo = 'docente'
  AND target.usuario_id = resolved.id
  AND target.certificado_id = seed.certificado_id;

INSERT INTO certificado_docente (
    usuario_id, fecha_creacion, certificado_id, correo,
    motivo_exp, estado_docente, activo
)
SELECT resolved.id, seed.fecha_creacion, seed.certificado_id,
       seed.correo, seed.motivo, seed.estado, TRUE
FROM tmp_seed_certificados seed
JOIN LATERAL (
    SELECT u.id
    FROM usuario u
    WHERE (seed.documento IS NOT NULL AND u.documento = seed.documento)
       OR (seed.documento IS NULL AND seed.codigo IS NOT NULL AND u.codigo = seed.codigo)
    ORDER BY CASE WHEN u.documento = seed.documento THEN 0 ELSE 1 END, u.id
    LIMIT 1
) resolved ON TRUE
WHERE seed.tipo = 'docente'
  AND NOT EXISTS (
      SELECT 1 FROM certificado_docente existing
      WHERE existing.usuario_id = resolved.id
        AND existing.certificado_id = seed.certificado_id
  );

COMMIT;

SELECT 'usuarios de prueba' AS conjunto, count(*) AS filas
FROM usuario WHERE correo LIKE '%@example.test';
SELECT 'sanciones del seed' AS conjunto, count(*) AS filas
FROM multa WHERE obs_multa LIKE '[SEED-OFUSCADO:%';
""")
    return '\n'.join(body)


def main():
    parser = argparse.ArgumentParser(description='Genera el seed de pruebas desde el libro ofuscado.')
    parser.add_argument('--input', default='docs/data_ofuscada_pruebas.xlsx')
    parser.add_argument('--catalog', default='sql-scripts/db_seed_system.sql')
    parser.add_argument('--output', default='sql-scripts/db_seed_pruebas_ofuscado.sql')
    args = parser.parse_args()
    source = Path(args.input)
    catalog = Path(args.catalog)
    output = Path(args.output)
    if not source.is_file():
        raise FileNotFoundError(f'Obfuscated workbook not found: {source}')
    if not catalog.is_file():
        raise FileNotFoundError(f'System seed not found: {catalog}')
    content = build_seed(load_workbook(source), catalog)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(content, encoding='utf-8')
    print(f'Generated {output}')
    print(f'SQL bytes: {len(content.encode("utf-8"))}')


if __name__ == '__main__':
    main()
