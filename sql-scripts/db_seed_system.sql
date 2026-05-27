-- Catalogos base y bootstrap minimo del sistema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM facultad) THEN
        INSERT INTO facultad (nombre) VALUES
            ('ASAB'),
            ('Bosa'),
            ('Calle 34'),
            ('Calle 42'),
            ('Macarena'),
            ('Calle 40'),
            ('Vivero'),
            ('Paiba'),
            ('Tecnologica');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ual) THEN
        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio De Fotografía', 1),
        ('Taller De Serigrafía', 1),
        ('Taller Tridimensional', 1),
        ('Taller De Vidrio', 1),
        ('Taller De Maderas', 1),
        ('Taller De Cerámica B016', 1),
        ('Taller De Hornos', 1),
        ('Taller De Grabado', 1),
        ('Taller De Litografía', 1),
        ('Taller De Metales', 1),
        ('Taller De Moldes', 1),
        ('Taller De Papel', 1),
        ('Taller De Fotografía', 1),
        ('Antiguo Taller De La Imagen Escénica', 1),
        ('Taller De Video Y Sonido', 1),
        ('Salón de Informática A 103', 1),
        ('Aula especializada A 103 Composición', 1),
        ('Aula especializada B 112 Taller Digital', 1),
        ('Aula especializada 233 Música', 1),
        ('Sala De Informática', 1),
        ('Aula especializada 102', 1),
        ('Aula especializada A 105', 1),
        ('Aula especializada 106', 1),
        ('Aula especializada A 108', 1),
        ('Aula especializada C 115', 1),
        ('Aula especializada C 114', 1),
        ('Aula especializada 207', 1),
        ('Aula especializada 208', 1),
        ('Aula especializada B 210 Dibujo', 1),
        ('Aula especializada B 211 Dibujo', 1),
        ('Aula especializada B 212 Dibujo', 1),
        ('Aula especializada C-214 Música', 1),
        ('Aula especializada C-215 Música', 1),
        ('Aula especializada C-216 Música', 1),
        ('Aula especializada C-217 Música', 1),
        ('Aula especializada C-219', 1),
        ('Aula especializada 205', 1),
        ('Aula especializada 301', 1),
        ('Aula especializada 302', 1),
        ('Aula especializada 303', 1),
        ('Aula especializada 307', 1),
        ('Proyectos De Grado', 1),
        ('Aula especializada 308 A - Consejerías', 1),
        ('Aula especializada 309', 1),
        ('Aula especializada 310', 1),
        ('Aula especializada 311 Bidimensional', 1),
        ('Aula especializada 312', 1),
        ('Aula especializada 313', 1),
        ('Aula especializada S-33', 1),
        ('Aula especializada S-34', 1),
        ('Aula especializada S-37', 1),
        ('Aula especializada S-38', 1),
        ('Aula especializada S-40', 1),
        ('Aula especializada 138 - Música', 1),
        ('Aula especializada 140 - Música', 1),
        ('Aula Especializada Percusión', 1),
        ('Aula Especializada Percusión ensamble', 1),
        ('Aula Especializada Percusión Sótano', 1),
        ('Aula especializada 232 Música', 1),
        ('Aula especializada 234 Música', 1),
        ('Aula especializada 237 Música', 1),
        ('Aula especializada 240 Música', 1),
        ('Aula especializada M-16 Música', 1),
        ('Aula especializada M-17 Música', 1),
        ('Aula especializada S-3', 1),
        ('Aula especializada J-1', 1),
        ('Aula especializada J-2', 1),
        ('Aula especializada J-3', 1),
        ('Aula especializada J-4', 1),
        ('Aula especializada J-5 Música', 1),
        ('Aula especializada 103 Costura', 1),
        ('Aula especializada 202', 1),
        ('Aula especializada 203', 1),
        ('Aula especializada 204', 1),
        ('Aula especializada 206', 1),
        ('Aula especializada 302', 1),
        ('Aula especializada 303', 1),
        ('Aula especializada 304', 1),
        ('Salón de profesores', 1),
        ('Estudio De Grabación', 1),
        ('Aula especializada 201', 1),
        ('Aula especializada 203', 1),
        ('Aula especializada 204', 1),
        ('Aula especializada 205', 1),
        ('Aula especializada 206', 1),
        ('Aula especializada 207', 1),
        ('Aula especializada 301', 1),
        ('Aula especializada 302', 1),
        ('Aula especializada De Percusión Batería', 1),
        ('Aula especializada De Bajo', 1),
        ('Observatorio pedagógico', 1),
        ('Aula especializada 125 Teatrino', 1),
        ('Auditorio Luis Enrique Osorio', 1),
        ('Teatrino', 1),
        ('Centro De Documentación De Las Artes "Gabriel Esquinas"', 1);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Estudio de Televisión', 2),
        ('Laboratorio de Fotografía', 2),
        ('Estudio de Radio', 2),
        ('Laboratorio de Biología', 2),
        ('Laboratorio de Biotecnología Ambiental', 2),
        ('Laboratorio de Microbiología', 2),
        ('Laboratorio de Calidad de Aguas', 2),
        ('Laboratorio de Calidad del Aire', 2),
        ('Laboratorio de Ecología y Zoonosis', 2),
        ('Laboratorio de Física', 2),
        ('Laboratorio de Hidráulica', 2),
        ('Laboratorio de Modelación Ambiental', 2),
        ('Laboratorio de Química General', 2),
        ('Laboratorio de Química Orgánica', 2),
        ('Laboratorio de Servicios Públicos', 2),
        ('Laboratorio de Fisiología del Deporte', 2),
        ('Laboratorios de Diseño de Plantas de Agua Potable y Agua Residual', 2),
        ('Salas de sistemas 102', 2),
        ('Salas de sistemas 103', 2),
        ('Salas de sistemas 106', 2),
        ('Salas de sistemas 107', 2),
        ('Almacén De Topografía', 2),
        ('Almacén De Topografía', 2),
        ('Almacén de Reactivos', 2);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio de Manufactura y Diseño Avanzado LAMDA', 3);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio de E-Learning ICG/OKP', 4);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio De Física 5b', 5),
        ('Laboratorio De Física 5d', 5),
        ('Laboratorio De Física 6a', 5),
        ('Laboratorio De Física 6b', 5),
        ('Laboratorio De Física 6c', 5),
        ('Laboratorio De Física 6d', 5),
        ('Laboratorio De Física 8a', 5),
        ('Laboratorio De Física 8b', 5),
        ('Sileat- Limnología', 5),
        ('Biología Biomolecular BIOMOL', 5),
        ('Biotecnología Vegetal', 5),
        ('Entomología KUMANGUI', 5),
        ('Instrumental N° 1', 5),
        ('Laboratorio Biología 1', 5),
        ('Laboratorio Biología 2', 5),
        ('Laboratorio Biología 3', 5),
        ('Laboratorio Biología 4', 5),
        ('Laboratorio Química 1', 5),
        ('Laboratorio Química 2', 5),
        ('Laboratorio Química 4', 5),
        ('Laboratorio Química 5', 5),
        ('Laboratorio Síntesis Orgánica', 5),
        ('Calidad Ambiental', 5),
        ('Laboratorio de Bioquímica y biología molecular', 5),
        ('Laboratorio Síntesis inorgánica', 5),
        ('Laboratorio Experimental Transversal', 5),
        ('Laboratorio Didacta de las matemáticas', 5),
        ('Taller Mecánica Fina I', 5),
        ('Taller de Artes Plásticas', 5),
        ('Taller de Grabado', 5),
        ('Aula de informática 307', 5),
        ('Aula de informática 312', 5),
        ('Aula de informática 538', 5),
        ('Aula de informática 539 - Prácticas Libres', 5),
        ('Aula de informática', 5),
        ('Artes escénicas danzas', 5),
        ('Artes escénicas teatro', 5),
        ('Artes Musicales 702', 5),
        ('Artes Musicales 704', 5),
        ('Artes Visuales 703', 5),
        ('Aula Multimedia', 5),
        ('Auditorio auxiliar 103', 5),
        ('Auditorio Principal', 5),
        ('Auditorio 104', 5),
        ('Ateneo Laboratorio En Pedagogía Y Didáctica De La Biología', 5),
        ('Laboratorio De Biodiversidad de alta montaña - Museo', 5),
        ('Laboratorio De Fitoquímica', 5),
        ('Laboratorio De Mutagénesis (Grupo De Investigación Biomol C.)', 5),
        ('Laboratorio Neurociencias', 5),
        ('Laboratorio Proteómica', 5),
        ('Kumangui - Colección', 5),
        ('Colorantes naturales', 5),
        ('Laboratorio de nanotecnología', 5),
        ('Physikalisch', 5),
        ('Didaquim', 5),
        ('Laboratorio de Caracterizacion Óptica', 5),
        ('Herbario', 5),
        ('Museo de colecciones biológicas', 5),
        ('Laboratorio De Física 5a - Almacén Administrativo', 5),
        ('Laboratorio De Física 5c - Almacén General', 5),
        ('Almacén Laboratorios de Física - Bodega', 5),
        ('Almacén biología', 5),
        ('Almacén de Reactivos', 5),
        ('Almacén de química', 5),
        ('Preparación de reactivos', 5);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio de Cartografía y Sensores Remotos', 6),
        ('Laboratorio De Fotogrametría Digital', 6),
        ('Laboratorio de instrumentación Electrónica', 6),
        ('Laboratorio Comunicaciones', 6),
        ('Laboratorio de Control', 6),
        ('Laboratorio De Física II 509', 6),
        ('Laboratorio De Física III 510', 6),
        ('Laboratorio de Automatización', 6),
        ('Laboratorio de Máquinas A', 6),
        ('Laboratorio circuitos eléctricos A', 6),
        ('Laboratorio Electrónica A', 6),
        ('Laboratorio Electrónica B', 6),
        ('Laboratorio Máquinas Eléctricas B', 6),
        ('Sala de informática 306', 6),
        ('Sala de informática 312', 6),
        ('Sala de informática 402', 6),
        ('Sala de informática 406', 6),
        ('Sala de informática 500', 6),
        ('Sala de informática 502', 6),
        ('Sala de informática 504', 6),
        ('Sala de informática 506', 6),
        ('Sala de informática 507', 6),
        ('Sala de informática 508', 6),
        ('Sala de informática 601', 6),
        ('Sala de informática 701', 6),
        ('Sala de informática 702', 6),
        ('Sala de informática 703', 6),
        ('Sala de informática 704', 6),
        ('Sala de informática 706', 6),
        ('Sala de informática 707', 6),
        ('Laboratorio De Nanotecnología', 6),
        ('Sala Rita (Red De Investigación De Tecnología Avanzada)', 6),
        ('Auditorio', 6),
        ('Laboratorio De Tecnologías Libres - Gicoge', 6),
        ('Grupo De Investigación Gitem', 6),
        ('Grupo De Investigación Lamic', 6),
        ('Laboratorio De Investigación Laser', 6),
        ('Cecad', 6);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio De Biología', 7),
        ('Laboratorio De Maderas', 7),
        ('Laboratorio De Sanidad Forestal', 7),
        ('Laboratorio De Suelos', 7),
        ('Laboratorio Calidad De Aguas', 7),
        ('Laboratorio De Cartografía Automatizada', 7),
        ('Laboratorio De Fotogrametría o Fotointerpretación', 7),
        ('Laboratorio De Microbiología Y Bioprospección Medioambiental', 7),
        ('Laboratorio De Química', 7),
        ('Laboratorio De Silvicultura', 7),
        ('Laboratorio De Tecnologías Limpias', 7),
        ('Taller de carpintería', 7),
        ('Salas de sistemas 102', 7),
        ('Salas de sistemas 103', 7),
        ('Salas de sistemas 104', 7),
        ('Salas de sistemas 105', 7),
        ('Laboratorio Fisiología Vegetal', 7),
        ('Laboratorio De Biología Molecular', 7),
        ('Sala múltiple', 7),
        ('Auditorio', 7),
        ('Laboratorio De Investigación equipo de osmosis y Cromatógrafo De Gases', 7),
        ('Sala especializada investigación en Topografía, Sala de Realidad Aumentada', 7),
        ('Herbario', 7),
        ('Xiloteca', 7),
        ('Almacén de Reactivos', 7),
        ('Almacén de Topografía', 7);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio Observatorio Astronómico', 8),
        ('Centro de Geoprocesamiento/Aula Especializada', 8);

        INSERT INTO ual (nombre, id_facultad)
        VALUES
        ('Laboratorio Aplicado de Instalaciones Eléctricas e Iluminación', 9),
        ('Laboratorio de resistencia de materiales', 9),
        ('Laboratorio de estructuras', 9),
        ('Laboratorio de hidráulica', 9),
        ('Laboratorio pavimentos', 9),
        ('Laboratorios materiales de construcción y patología', 9),
        ('Laboratorio de motores de combustión interna', 9),
        ('Laboratorio de tribología', 9),
        ('Laboratorio de suelos', 9),
        ('Laboratorio de suelos y servicios', 9),
        ('Laboratorio de mecánica de fluidos y máquinas hidráulicas', 9),
        ('Diseño y desarrollo tecnológico/Plásticos', 9),
        ('Laboratorio de automatización y control/Neumática', 9),
        ('Laboratorio de automatización y control/Hidráulica', 9),
        ('Laboratorio de tratamientos térmicos', 9),
        ('Laboratorio de metalografía', 9),
        ('Laboratorio de ciencias térmicas', 9),
        ('Laboratorio de metrología', 9),
        ('Laboratorio Aplicado de Circuitos, Electrónica y Control', 9),
        ('Laboratorio Especializado de Sistemas Eléctricos', 9),
        ('Laboratorio Aplicado de Máquinas Eléctricas', 9),
        ('Laboratorio Especializado de Sistemas de Potencia y Smart Grid', 9),
        ('Laboratorio HAS', 9),
        ('Laboratorio de Diseño de producto', 9),
        ('Laboratorio FMS', 9),
        ('Laboratorio GEIO', 9),
        ('Laboratorio de procesos de transformación', 9),
        ('Laboratorio de electrónica básica', 9),
        ('Laboratorio de telecomunicaciones', 9),
        ('Laboratorio especializado de control', 9),
        ('Laboratorio de electromagnetismo /ciencias básicas', 9),
        ('Laboratorio de circuitos eléctricos', 9),
        ('Laboratorio de electrónica aplicada', 9),
        ('Laboratorio de Practicas libres electrónica', 9),
        ('Laboratorio de física mecánica 1', 9),
        ('Laboratorio de física mecánica 2', 9),
        ('Laboratorio de física mecánica 3', 9),
        ('Laboratorio de química ambiental', 9),
        ('Laboratorio de química básica', 9),
        ('Laboratorio de fluidos y termodinámica', 9),
        ('Laboratorio de óptica y moderna', 9),
        ('Taller de control numérico computarizado', 9),
        ('Laboratorio de circuitos impresos', 9),
        ('Taller de máquinas y herramientas', 9),
        ('Taller de Soldadura', 9),
        ('Sala de informática 412', 9),
        ('Sala de informática 501', 9),
        ('Sala de informática 503', 9),
        ('Sala de informática 505', 9),
        ('Aula software especializado electrónica 1', 9),
        ('Aula software especializado electrónica 2', 9),
        ('Laboratorio de Software Aplicado 1 - Electricidad', 9),
        ('Laboratorio de Software Aplicado 2 - Electricidad', 9),
        ('Sala de informática 1', 9),
        ('Laboratorio redes y telemática', 9),
        ('Laboratorio de sistemas distribuidos', 9),
        ('Laboratorio de bases de datos avanzadas', 9),
        ('Laboratorio de inteligencia artificial', 9),
        ('Laboratorio de simulación y realidad virtual', 9),
        ('Laboratorio de ingeniería de software', 9),
        ('Sala de informática 2', 9),
        ('Sala de informática 3', 9),
        ('Sala de software de Ciencias Básicas', 9),
        ('Sala de software Ingeniería civil', 9),
        ('Sala de Software de Ingeniería Eléctrica', 9),
        ('Sala de software mecánica 1', 9),
        ('Sala de software mecánica 2', 9),
        ('Sala de informática 4', 9),
        ('Sala de informática 5', 9),
        ('Sala de informática 6', 9),
        ('Sala de informática 7', 9),
        ('Sala de software de Tecnología e Ingeniería de Producción A', 9),
        ('Sala de software de Tecnología e Ingeniería de Producción B', 9),
        ('Laboratorio Especializado de Compatibilidad y Alta Tensión', 9),
        ('Laboratorio Especializado de Ensayos Termoeléctricos', 9),
        ('Auditorio Gustavo Caamaño León', 9),
        ('Aula Múltiple 1', 9),
        ('Aula Múltiple 2', 9),
        ('Sala de audiovisuales 1', 9),
        ('Sala de audiovisuales 2', 9),
        ('Sala de audiovisuales 3', 9),
        ('Sala de audiovisuales 4', 9),
        ('Sala de audiovisuales 5', 9),
        ('Sala de audiovisuales 6', 9),
        ('Sala de audiovisuales 7', 9),
        ('Sala de audiovisuales 8', 9),
        ('Auditorio Lectus', 9),
        ('Oficina de laboratorios - Ciencias Básicas', 9),
        ('Almacén de Topografía', 9),
        ('Almacén audiovisuales', 9),
        ('Almacén de mecánica', 9),
        ('Oficina y almacén - Gestión de la Producción', 9),
        ('Almacén de laboratorio de informática', 9);
    END IF;
END $$;

INSERT INTO rol (nombre)
VALUES
    ('admin'),
    ('coordinador'),
    ('laboratorista'),
    ('docente'),
    ('estudiante')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO usuario (correo, documento, nombre)
VALUES
    ('acmendeza@udistrital.edu.co', '1024467835', 'Administrador Principal'),
    ('dfvargasa@udistrital.edu.co', '1030683338', 'Administrador Secundario')
ON CONFLICT (documento) DO UPDATE
SET correo = EXCLUDED.correo,
    nombre = EXCLUDED.nombre,
    fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO usuario_rol (usuario_id, rol_id, activo)
SELECT u.id, r.id, TRUE
FROM usuario u
JOIN rol r ON r.nombre = 'admin'
WHERE u.documento IN ('1024467835', '1030683338')
ON CONFLICT (usuario_id, rol_id) DO UPDATE
SET activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP;

WITH sources AS (
        SELECT LOWER(TRIM(correo)) AS correo,
                     TRIM(documento)::VARCHAR(50) AS documento,
                     nombre,
                     1 AS priority
        FROM usuario
        WHERE correo IS NOT NULL
            AND TRIM(correo) <> ''
            AND documento IS NOT NULL
            AND TRIM(documento) <> ''

        UNION ALL

        SELECT LOWER(TRIM(correo)) AS correo,
                     TRIM(documento)::VARCHAR(50) AS documento,
                     nombre,
                     2 AS priority
        FROM coordinador
        WHERE correo IS NOT NULL
            AND TRIM(correo) <> ''
            AND documento IS NOT NULL
            AND TRIM(documento) <> ''

        UNION ALL

        SELECT LOWER(TRIM(correo)) AS correo,
                     TRIM(documento)::VARCHAR(50) AS documento,
                     nombre,
                     3 AS priority
        FROM laboratorista
        WHERE correo IS NOT NULL
            AND TRIM(correo) <> ''
            AND documento IS NOT NULL
            AND TRIM(documento) <> ''

),
ranked AS (
        SELECT *,
                     ROW_NUMBER() OVER (PARTITION BY correo ORDER BY priority) AS rn_email,
                     ROW_NUMBER() OVER (PARTITION BY documento ORDER BY priority) AS rn_doc
        FROM sources
)
INSERT INTO usuario (correo, documento, nombre)
SELECT correo, documento, COALESCE(nombre, correo)
FROM ranked
WHERE rn_email = 1
    AND rn_doc = 1
ON CONFLICT (correo) DO UPDATE
SET documento = EXCLUDED.documento,
        nombre = EXCLUDED.nombre,
    fecha_modificacion = CURRENT_TIMESTAMP;

-- Los roles coordinador, laboratorista, docente y estudiante no se activan por seed.
-- Su asociación ocurre en los flujos de negocio:
--   - coordinador: cuando un admin lo registra
--   - laboratorista: cuando un coordinador lo registra
--   - docente/estudiante: cuando el usuario inicia sesión y OATI confirma el perfil activo

-- Menus y permisos base (RBAC).
INSERT INTO menu_item (section, label, route, icon, order_index)
VALUES
    ('primary', 'Inicio', '/milab/inicio', 'bi-house-door', 1),
    ('primary', 'Monitoreo', '/milab/api/dashboard', 'bi-activity', 2),
    ('primary', 'Autorizaciones', '/milab/api/aprobacion_multa', 'bi-clipboard2-check', 3),
    ('primary', 'Solicitar certificado estudiante', '/milab/api/get-data1/verificacion', 'bi-patch-check', 4),
    ('primary', 'Solicitar certificado docente', '/milab/api/verifica_multa_docente/verificacion', 'bi-patch-check', 5),
    ('account', 'Perfil', '/milab/api/profile', 'bi-person-circle', 1)
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Registro', 'bi-person-plus', 1
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Registro' AND parent_id IS NULL
);

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Consulta y control', 'bi-grid-1x2', 2
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Consulta y control' AND parent_id IS NULL
);

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Paz y Salvos', 'bi-patch-check', 3
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Paz y Salvos' AND parent_id IS NULL
);

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Administración', 'bi-sliders', 5
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Administración' AND parent_id IS NULL
);

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Sanciones', 'bi-shield-exclamation', 4
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Sanciones' AND parent_id IS NULL
);

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Configuración', 'bi-gear', 6
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Configuración' AND parent_id IS NULL
);

UPDATE menu_item
SET order_index = 5
WHERE section = 'secondary' AND label = 'Administración' AND parent_id IS NULL;

UPDATE menu_item
SET order_index = 4
WHERE section = 'secondary' AND label = 'Sanciones' AND parent_id IS NULL;

UPDATE menu_item
SET order_index = 6
WHERE section = 'secondary' AND label = 'Configuración' AND parent_id IS NULL;

DELETE FROM menu_item child
USING menu_item parent
WHERE parent.id = child.parent_id
    AND parent.section = 'secondary'
    AND parent.label = 'Consultas'
    AND parent.parent_id IS NULL;

DELETE FROM menu_item
WHERE section = 'secondary'
    AND label = 'Consultas'
    AND parent_id IS NULL;

DELETE FROM menu_item child
USING menu_item parent
WHERE parent.id = child.parent_id
    AND parent.section = 'secondary'
    AND parent.label = 'Consulta y control'
    AND parent.parent_id IS NULL
    AND child.section = 'secondary'
    AND child.label = 'Sanciones'
    AND child.route = '/milab/api/get_list_multas';

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Registro de coordinadores', '/milab/api/registro_coordinador/load_info', 'bi-person-badge', 1
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Registro' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Registro de laboratoristas', '/milab/api/register_labs/load_info', 'bi-person-plus', 2
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Registro' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Certificados', '/milab/api/get_list_estudiantes', 'bi-file-earmark-check', 1
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Consulta masiva', '/milab/api/get_list_estudiantes/get_consulta', 'bi-collection', 2
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Coordinadores registrados', '/milab/api/coordinadores_registrados', 'bi-people', 3
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Estudiantes y docentes registrados', '/milab/api/estudiantes_registrados', 'bi-card-list', 4
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Facultades y UAL', '/milab/api/facultad', 'bi-building', 5
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Logs', '/milab/api/logs', 'bi-journal-text', 6
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Laboratoristas registrados', '/milab/api/laboratoristas_registrados', 'bi-person-workspace', 7
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Agregar admin', '/milab/api/admins/load_info', 'bi-person-gear', 9
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Listado de sanciones', '/milab/api/get_list_multas', 'bi-shield-exclamation', 8
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Consulta y control' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE menu_item child
SET label = 'Listado de sanciones'
FROM menu_item parent
WHERE parent.id = child.parent_id
    AND parent.section = 'secondary'
    AND parent.label = 'Consulta y control'
    AND parent.parent_id IS NULL
    AND child.section = 'secondary'
    AND child.route = '/milab/api/get_list_multas'
    AND child.label = 'Sanciones';

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Verificar estudiante', '/milab/api/verificar_estudiante', 'bi-person-check', 1
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Paz y Salvos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Verificar docente', '/milab/api/verificar_docente', 'bi-person-vcard', 2
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Paz y Salvos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE menu_item child
SET parent_id = parent.id,
        order_index = CASE child.label
                WHEN 'Sanciones de estudiantes' THEN 1
                WHEN 'Sanciones de docentes' THEN 2
                ELSE child.order_index
        END
FROM menu_item parent
WHERE parent.section = 'secondary'
    AND parent.label = 'Sanciones'
    AND parent.parent_id IS NULL
    AND child.section = 'secondary'
    AND child.label IN ('Sanciones de estudiantes', 'Sanciones de docentes')
    AND child.parent_id IS DISTINCT FROM parent.id
    AND NOT EXISTS (
            SELECT 1
            FROM menu_item sibling
            WHERE sibling.section = 'secondary'
                AND sibling.parent_id = parent.id
                AND sibling.label = child.label
                AND sibling.route IS NOT DISTINCT FROM child.route
    );

DELETE FROM menu_item child
USING menu_item parent
WHERE parent.section = 'secondary'
    AND parent.label = 'Administración'
    AND parent.parent_id IS NULL
    AND child.section = 'secondary'
    AND child.parent_id = parent.id
    AND child.label IN ('Sanciones de estudiantes', 'Sanciones de docentes');

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Sanciones de estudiantes', '/milab/api/get-info-multa/get', 'bi-mortarboard', 1
FROM menu_item parent
WHERE parent.section = 'secondary'
    AND parent.label = 'Sanciones'
    AND parent.parent_id IS NULL
    AND NOT EXISTS (
            SELECT 1
            FROM menu_item existing
            WHERE existing.section = 'secondary'
                AND existing.parent_id = parent.id
                AND existing.label = 'Sanciones de estudiantes'
                AND existing.route = '/milab/api/get-info-multa/get'
    );

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Sanciones de docentes', '/milab/api/get-info-multa-docente/get', 'bi-person-lines-fill', 2
FROM menu_item parent
WHERE parent.section = 'secondary'
    AND parent.label = 'Sanciones'
    AND parent.parent_id IS NULL
    AND NOT EXISTS (
            SELECT 1
            FROM menu_item existing
            WHERE existing.section = 'secondary'
                AND existing.parent_id = parent.id
                AND existing.label = 'Sanciones de docentes'
                AND existing.route = '/milab/api/get-info-multa-docente/get'
    );

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Permisos y menus', '/milab/api/admin/menus', 'bi-sliders', 1
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Configuración' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM rol_permiso rp
USING rol r, menu_item mi
WHERE rp.rol_id = r.id
    AND rp.menu_item_id = mi.id
    AND r.nombre = 'laboratorista'
    AND mi.section = 'secondary'
    AND mi.label = 'Administración'
    AND mi.parent_id IS NULL;

WITH role_map AS (SELECT id, nombre FROM rol),
menu_map AS (SELECT id, label, route, section, parent_id FROM menu_item)
INSERT INTO rol_permiso (rol_id, menu_item_id)
SELECT role_map.id, menu_map.id
FROM role_map
JOIN menu_map ON menu_map.section = 'primary'
WHERE (
    role_map.nombre IN ('admin', 'coordinador', 'laboratorista', 'estudiante', 'docente')
    AND menu_map.label = 'Inicio'
) OR (
    role_map.nombre IN ('admin', 'coordinador', 'laboratorista') AND menu_map.label = 'Monitoreo'
) OR (
    role_map.nombre = 'coordinador' AND menu_map.label = 'Autorizaciones'
) OR (
    role_map.nombre = 'estudiante' AND menu_map.label = 'Solicitar certificado estudiante'
) OR (
    role_map.nombre = 'docente' AND menu_map.label = 'Solicitar certificado docente'
)
ON CONFLICT DO NOTHING;

WITH role_map AS (SELECT id, nombre FROM rol),
menu_map AS (SELECT id, label, route, section, parent_id FROM menu_item)
INSERT INTO rol_permiso (rol_id, menu_item_id)
SELECT role_map.id, menu_map.id
FROM role_map
JOIN menu_map ON menu_map.section = 'account'
WHERE role_map.nombre IN ('admin', 'coordinador', 'laboratorista', 'estudiante', 'docente')
ON CONFLICT DO NOTHING;

WITH role_map AS (SELECT id, nombre FROM rol),
menu_map AS (SELECT id, label, route, section, parent_id FROM menu_item)
INSERT INTO rol_permiso (rol_id, menu_item_id)
SELECT role_map.id, menu_map.id
FROM role_map
JOIN menu_map ON menu_map.section = 'secondary'
WHERE (
    role_map.nombre = 'admin' AND menu_map.label IN (
        'Registro',
        'Registro de coordinadores',
        'Consulta y control',
        'Certificados',
        'Consulta masiva',
        'Listado de sanciones',
        'Coordinadores registrados',
        'Estudiantes y docentes registrados',
        'Facultades y UAL',
        'Logs',
        'Laboratoristas registrados',
        'Agregar admin',
        'Sanciones',
        'Paz y Salvos',
        'Verificar estudiante',
        'Verificar docente'
    )
) OR (
    role_map.nombre = 'coordinador' AND menu_map.label IN (
        'Registro',
        'Registro de laboratoristas',
        'Consulta y control',
        'Consulta masiva',
        'Listado de sanciones',
        'Estudiantes y docentes registrados',
        'Laboratoristas registrados',
        'Sanciones',
        'Paz y Salvos',
        'Verificar estudiante',
        'Verificar docente'
    )
) OR (
    role_map.nombre = 'laboratorista' AND menu_map.label IN (
        'Consulta y control',
        'Consulta masiva',
        'Listado de sanciones',
        'Sanciones',
        'Sanciones de estudiantes',
        'Sanciones de docentes',
        'Paz y Salvos',
        'Verificar estudiante',
        'Verificar docente'
    )
)
OR (
    role_map.nombre = 'admin' AND menu_map.label IN (
        'Configuración',
        'Permisos y menus'
    )
)
ON CONFLICT DO NOTHING;