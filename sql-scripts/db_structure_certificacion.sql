CREATE SCHEMA IF NOT EXISTS milab;
SET search_path TO milab;
SET TIME ZONE 'America/Bogota';

BEGIN;

CREATE TABLE IF NOT EXISTS cursos (
    codigo_curso VARCHAR(100) NOT NULL,
    id_facultad INT NOT NULL,
    nombre_curso VARCHAR(255) NOT NULL,
    url_edx TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_cursos PRIMARY KEY (codigo_curso),
    CONSTRAINT fk_cursos_facultad FOREIGN KEY (id_facultad)
        REFERENCES dependencia_facultad(dependencia_facultad_id) ON DELETE RESTRICT,
    CONSTRAINT ck_codigo_curso_cursos CHECK (BTRIM(codigo_curso) <> ''),
    CONSTRAINT ck_nombre_curso_cursos CHECK (BTRIM(nombre_curso) <> ''),
    CONSTRAINT ck_url_edx_cursos CHECK (BTRIM(url_edx) <> '')
);

CREATE INDEX IF NOT EXISTS idx_cursos_facultad ON cursos(id_facultad);
CREATE INDEX IF NOT EXISTS idx_cursos_activo ON cursos(activo);

CREATE TABLE IF NOT EXISTS curso_laboratorio (
    codigo_curso VARCHAR(100) NOT NULL,
    id_laboratorio INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_curso_laboratorio PRIMARY KEY (codigo_curso, id_laboratorio),
    CONSTRAINT fk_curso_laboratorio_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_curso_laboratorio_ual FOREIGN KEY (id_laboratorio)
        REFERENCES ual(ual_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_curso_laboratorio_curso
    ON curso_laboratorio(codigo_curso);
CREATE INDEX IF NOT EXISTS idx_curso_laboratorio_laboratorio
    ON curso_laboratorio(id_laboratorio);
CREATE INDEX IF NOT EXISTS idx_curso_laboratorio_activo
    ON curso_laboratorio(activo);

CREATE TABLE IF NOT EXISTS equipo_especializado (
    codigo_curso VARCHAR(100) NOT NULL,
    id_equipo INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_equipo_especializado PRIMARY KEY (codigo_curso, id_equipo),
    CONSTRAINT fk_equipo_especializado_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_equipo_especializado_equipo FOREIGN KEY (id_equipo)
        REFERENCES equipo(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_equipo_especializado_curso
    ON equipo_especializado(codigo_curso);
CREATE INDEX IF NOT EXISTS idx_equipo_especializado_equipo
    ON equipo_especializado(id_equipo);
CREATE INDEX IF NOT EXISTS idx_equipo_especializado_activo
    ON equipo_especializado(activo);

-- ============================================================
-- MODULO CAPACITACION SOLICITUDES / SESIONES / CERTIFICACIONES
--
-- Lineamientos OIST aplicados (5 tablas NUEVAS, sin despliegue):
--   * PK = id (BIGSERIAL)
--   * FK columna = <tabla_referenciada>_id
--   * CHECK = ck_<columna>_<tabla>
--   * UNIQUE = uq_<columna(s)>_<tabla>  [INDEX WHERE para condicionales]
--   * FK = fk_<tabla_origen>_<tabla_destino_COMPLETA>
--   * activo + fecha_creacion + fecha_modificacion en todas
--
-- Nombres de columnas = COINCIDEN 1:1 con queries JS en
--   capacitacion-gestion.js + prestamos.js (evita desalineación)
-- ============================================================

CREATE TABLE IF NOT EXISTS sesion_capacitacion (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    nombre_curso_snapshot VARCHAR(255),
    ual_id INT NOT NULL,
    facultad_id INT NOT NULL,
    laboratorista_responsable_doc VARCHAR(50) NOT NULL,
    laboratorista_responsable_nombre VARCHAR(255),
    fecha_inicio TIMESTAMPTZ NOT NULL,
    fecha_fin TIMESTAMPTZ NOT NULL,
    cupo_maximo INT NOT NULL,
    lugar VARCHAR(255),
    descripcion TEXT,
    enlace_sesion TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'programada',
    evidencia_path TEXT,
    evidencia_nombre_original TEXT,
    evidencia_mime VARCHAR(100),
    evidencia_tamano_bytes BIGINT,
    evidencia_fecha_subida TIMESTAMPTZ,
    notas_evidencia TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_sesion_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_sesion_capacitacion_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sesion_capacitacion_facultad FOREIGN KEY (facultad_id)
        REFERENCES dependencia_facultad(dependencia_facultad_id) ON DELETE RESTRICT,
    CONSTRAINT ck_estado_sesion_capacitacion CHECK (
        estado IN ('programada','en_curso','realizada','cancelada')
    ),
    CONSTRAINT ck_cupo_maximo_sesion_capacitacion CHECK (cupo_maximo >= 1),
    CONSTRAINT ck_fecha_inicio_sesion_capacitacion CHECK (
        fecha_fin > fecha_inicio
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_codigo_curso_ual_id_fecha_inicio_sesion_capacitacion
    ON sesion_capacitacion(codigo_curso, ual_id, fecha_inicio)
    WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_sesion_capacitacion_ual_fecha
    ON sesion_capacitacion(ual_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_sesion_capacitacion_estado_activo
    ON sesion_capacitacion(estado, activo);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'sesion_capacitacion' AND column_name = 'evidencia_tamano_bytes'
    ) THEN
        ALTER TABLE sesion_capacitacion
            ADD COLUMN evidencia_tamano_bytes BIGINT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'sesion_capacitacion' AND column_name = 'notas_evidencia'
    ) THEN
        ALTER TABLE sesion_capacitacion
            ADD COLUMN notas_evidencia TEXT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS solicitud_capacitacion (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    solicitante_documento VARCHAR(50) NOT NULL,
    solicitante_usuario_id INT,
    solicitante_nombre VARCHAR(255),
    nombre_curso_snapshot VARCHAR(255),
    ual_id INT,
    facultad_id INT,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    mensaje_solicitante TEXT,
    motivo TEXT,
    observaciones_laboratorista TEXT,
    notas_internas TEXT,
    fecha_notificacion_programacion TIMESTAMPTZ,
    sesion_capacitacion_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_solicitud_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_solicitud_capacitacion_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_solicitud_capacitacion_usuario FOREIGN KEY (solicitante_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_facultad FOREIGN KEY (facultad_id)
        REFERENCES dependencia_facultad(dependencia_facultad_id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_estado_solicitud_capacitacion CHECK (
        estado IN ('pendiente','notificado','notificado_programada','atendido','atendido_cerrado','cancelado')
    ),
    CONSTRAINT ck_solicitante_documento_solicitud_capacitacion CHECK (
        BTRIM(COALESCE(solicitante_documento,'')) <> ''
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitante_documento_codigo_curso_estado_solicitud_capacitacion
    ON solicitud_capacitacion(solicitante_documento, codigo_curso, estado)
    WHERE estado IN ('pendiente','notificado','notificado_programada');
CREATE INDEX IF NOT EXISTS idx_solicitud_capacitacion_estado_activo
    ON solicitud_capacitacion(estado, activo);
CREATE INDEX IF NOT EXISTS idx_solicitud_capacitacion_sesion_capacitacion
    ON solicitud_capacitacion(sesion_capacitacion_id);

CREATE TABLE IF NOT EXISTS inscripcion_sesion_capacitacion (
    id BIGSERIAL NOT NULL,
    sesion_capacitacion_id BIGINT NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    usuario_id INT,
    usuario_nombre VARCHAR(255),
    fecha_inscripcion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    origen VARCHAR(30) NOT NULL DEFAULT 'directa',
    solicitud_capacitacion_id BIGINT,
    estado VARCHAR(30) NOT NULL DEFAULT 'inscrito',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_inscripcion_sesion_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_inscripcion_sesion_capacitacion_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT fk_inscripcion_sesion_capacitacion_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_inscripcion_sesion_capacitacion_solicitud_capacitacion FOREIGN KEY (solicitud_capacitacion_id)
        REFERENCES solicitud_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_origen_inscripcion_sesion_capacitacion CHECK (
        origen IN ('directa','lista_espera_solicitud')
    ),
    CONSTRAINT ck_estado_inscripcion_sesion_capacitacion CHECK (
        estado IN ('inscrito','cancelado','cancelado_estudiante','cupo_excedido','cupo_excedido_lista_espera')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sesion_capacitacion_id_usuario_documento_inscripcion_sesion_capacitacion
    ON inscripcion_sesion_capacitacion(sesion_capacitacion_id, usuario_documento)
    WHERE estado IN ('inscrito','cupo_excedido','cupo_excedido_lista_espera') AND activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_capacitacion_usuario
    ON inscripcion_sesion_capacitacion(sesion_capacitacion_id, usuario_documento);
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_capacitacion_estado_activo
    ON inscripcion_sesion_capacitacion(estado, activo);
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_capacitacion_solicitud_capacitacion
    ON inscripcion_sesion_capacitacion(solicitud_capacitacion_id);

CREATE TABLE IF NOT EXISTS asistencia_capacitacion (
    id BIGSERIAL NOT NULL,
    sesion_capacitacion_id BIGINT NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    inscripcion_sesion_capacitacion_id BIGINT,
    asistio BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metodo VARCHAR(30) NOT NULL DEFAULT 'manual',
    registrado_por_laboratorista_doc VARCHAR(50),
    registrado_por_laboratorista_nombre VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_asistencia_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_asistencia_capacitacion_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT fk_asistencia_capacitacion_inscripcion_sesion_capacitacion FOREIGN KEY (inscripcion_sesion_capacitacion_id)
        REFERENCES inscripcion_sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_metodo_asistencia_capacitacion CHECK (
        metodo IN ('manual','qr_documento','lista_asistencia')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sesion_capacitacion_id_usuario_documento_asistencia_capacitacion
    ON asistencia_capacitacion(sesion_capacitacion_id, usuario_documento)
    WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_asistencia_capacitacion_asistio
    ON asistencia_capacitacion(sesion_capacitacion_id, asistio, activo);
CREATE INDEX IF NOT EXISTS idx_asistencia_capacitacion_inscripcion
    ON asistencia_capacitacion(inscripcion_sesion_capacitacion_id);

CREATE TABLE IF NOT EXISTS certificacion_usuario (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    nombre_curso_snapshot VARCHAR(255),
    facultad_id INT,
    usuario_documento VARCHAR(50) NOT NULL,
    usuario_id INT,
    usuario_nombre VARCHAR(255),
    modalidad VARCHAR(20) NOT NULL,
    fecha_emision TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento TIMESTAMPTZ NOT NULL,
    vigencia_meses INT NOT NULL DEFAULT 12,
    sesion_capacitacion_id BIGINT,
    ual_id INT,
    solicitud_prestamo_id INT,
    entrega_equipo_id BIGINT,
    certificado_por_laboratorista_doc VARCHAR(50) NOT NULL,
    certificado_por_laboratorista_nombre VARCHAR(255),
    notas TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_certificacion_usuario PRIMARY KEY (id),
    CONSTRAINT fk_certificacion_usuario_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_facultad FOREIGN KEY (facultad_id)
        REFERENCES dependencia_facultad(dependencia_facultad_id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_solicitud_prestamo FOREIGN KEY (solicitud_prestamo_id)
        REFERENCES solicitud_prestamo(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_entrega_equipo FOREIGN KEY (entrega_equipo_id)
        REFERENCES entrega_equipo(id) ON DELETE SET NULL,
    CONSTRAINT ck_modalidad_certificacion_usuario CHECK (
        modalidad IN ('programada','prestamo')
    ),
    CONSTRAINT ck_vigencia_meses_certificacion_usuario CHECK (
        vigencia_meses BETWEEN 1 AND 60
    ),
    CONSTRAINT ck_fecha_emision_certificacion_usuario CHECK (
        fecha_vencimiento > fecha_emision
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_codigo_curso_usuario_documento_certificacion_usuario
    ON certificacion_usuario(codigo_curso, usuario_documento)
    WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_doc_curso_vig
    ON certificacion_usuario(usuario_documento, codigo_curso, fecha_vencimiento, activo);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_sesion_capacitacion
    ON certificacion_usuario(sesion_capacitacion_id);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_solicitud_prestamo
    ON certificacion_usuario(solicitud_prestamo_id);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_entrega_equipo
    ON certificacion_usuario(entrega_equipo_id);


-- ============================================================
-- SUBMODULO ENCUENTROS
-- ============================================================

CREATE TABLE IF NOT EXISTS encuentro_evento (
    id BIGSERIAL NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    lugar VARCHAR(255) NOT NULL,
    organizador VARCHAR(255) NOT NULL,
    banner_path TEXT,
    plantilla_pdf_path TEXT NOT NULL,
    plantilla_pdf_nombre VARCHAR(255) NOT NULL,
    plantilla_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado VARCHAR(20) NOT NULL DEFAULT 'programado',
    creado_por_usuario_id BIGINT,
    modificado_por_usuario_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_evento PRIMARY KEY (id),
    CONSTRAINT fk_encuentro_evento_creado_por FOREIGN KEY (creado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_encuentro_evento_modificado_por FOREIGN KEY (modificado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_estado_encuentro_evento CHECK (
        estado IN ('programado', 'en_curso', 'finalizado', 'cancelado')
    ),
    CONSTRAINT ck_horario_encuentro_evento CHECK (hora_fin > hora_inicio),
    CONSTRAINT ck_nombre_encuentro_evento CHECK (BTRIM(nombre) <> ''),
    CONSTRAINT ck_lugar_encuentro_evento CHECK (BTRIM(lugar) <> ''),
    CONSTRAINT ck_organizador_encuentro_evento CHECK (BTRIM(organizador) <> '')
);

CREATE INDEX IF NOT EXISTS idx_encuentro_evento_fecha_estado
    ON encuentro_evento(fecha, estado) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_encuentro_evento_nombre
    ON encuentro_evento(LOWER(nombre)) WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS encuentro_participante (
    id BIGSERIAL NOT NULL,
    evento_id BIGINT NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    documento VARCHAR(50) NOT NULL,
    documento_normalizado VARCHAR(50) NOT NULL,
    correo VARCHAR(255) NOT NULL,
    rol VARCHAR(255) NOT NULL DEFAULT 'Participante',
    facultad VARCHAR(255) NOT NULL,
    laboratorio VARCHAR(255) NOT NULL,
    usuario_id BIGINT,
    creado_por_usuario_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_inscripcion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_participante PRIMARY KEY (id),
    CONSTRAINT uq_id_evento_encuentro_participante UNIQUE (id, evento_id),
    CONSTRAINT uq_id_evento_usuario_encuentro_participante UNIQUE (id, evento_id, usuario_id),
    CONSTRAINT uq_evento_documento_encuentro_participante UNIQUE (evento_id, documento_normalizado),
    CONSTRAINT fk_encuentro_participante_evento FOREIGN KEY (evento_id)
        REFERENCES encuentro_evento(id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_participante_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_encuentro_participante_creado_por FOREIGN KEY (creado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_documento_encuentro_participante CHECK (BTRIM(documento) <> ''),
    CONSTRAINT ck_documento_normalizado_encuentro_participante CHECK (
        BTRIM(documento_normalizado) <> ''
    ),
    CONSTRAINT ck_correo_encuentro_participante CHECK (BTRIM(correo) <> ''),
    CONSTRAINT ck_nombre_encuentro_participante CHECK (BTRIM(nombre) <> '')
);

ALTER TABLE encuentro_participante
    ADD COLUMN IF NOT EXISTS rol VARCHAR(255) NOT NULL DEFAULT 'Participante';

CREATE INDEX IF NOT EXISTS idx_encuentro_participante_evento_nombre
    ON encuentro_participante(evento_id, LOWER(nombre)) WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS encuentro_asistencia (
    id BIGSERIAL NOT NULL,
    evento_id BIGINT NOT NULL,
    participante_id BIGINT NOT NULL,
    entrada_en TIMESTAMPTZ,
    entrada_por_usuario_id BIGINT,
    entrada_metodo VARCHAR(20) NOT NULL DEFAULT 'manual',
    salida_en TIMESTAMPTZ,
    salida_por_usuario_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_asistencia PRIMARY KEY (id),
    CONSTRAINT uq_id_evento_encuentro_asistencia UNIQUE (id, evento_id),
    CONSTRAINT uq_participante_encuentro_asistencia UNIQUE (participante_id),
    CONSTRAINT fk_encuentro_asistencia_participante_evento FOREIGN KEY (participante_id, evento_id)
        REFERENCES encuentro_participante(id, evento_id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_asistencia_entrada_por FOREIGN KEY (entrada_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_encuentro_asistencia_salida_por FOREIGN KEY (salida_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_metodo_entrada_encuentro_asistencia CHECK (entrada_metodo = 'manual'),
    CONSTRAINT ck_salida_posterior_entrada_encuentro_asistencia CHECK (
        salida_en IS NULL OR (entrada_en IS NOT NULL AND salida_en >= entrada_en)
    )
);

CREATE INDEX IF NOT EXISTS idx_encuentro_asistencia_evento_entrada
    ON encuentro_asistencia(evento_id, entrada_en, salida_en) WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS encuentro_asistencia_correccion (
    id BIGSERIAL NOT NULL,
    evento_id BIGINT NOT NULL,
    asistencia_id BIGINT NOT NULL,
    entrada_anterior TIMESTAMPTZ,
    salida_anterior TIMESTAMPTZ,
    entrada_nueva TIMESTAMPTZ,
    salida_nueva TIMESTAMPTZ,
    motivo VARCHAR(1000) NOT NULL,
    corregido_por_usuario_id BIGINT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_asistencia_correccion PRIMARY KEY (id),
    CONSTRAINT fk_encuentro_asistencia_correccion_asistencia FOREIGN KEY (asistencia_id, evento_id)
        REFERENCES encuentro_asistencia(id, evento_id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_asistencia_correccion_usuario FOREIGN KEY (corregido_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_motivo_encuentro_asistencia_correccion CHECK (BTRIM(motivo) <> ''),
    CONSTRAINT ck_salida_encuentro_asistencia_correccion CHECK (
        salida_nueva IS NULL OR (entrada_nueva IS NOT NULL AND salida_nueva >= entrada_nueva)
    )
);

CREATE INDEX IF NOT EXISTS idx_encuentro_asistencia_correccion_asistencia
    ON encuentro_asistencia_correccion(asistencia_id, fecha_creacion DESC);

CREATE TABLE IF NOT EXISTS encuentro_certificado (
    id BIGSERIAL NOT NULL,
    evento_id BIGINT NOT NULL,
    participante_id BIGINT NOT NULL,
    codigo VARCHAR(64) NOT NULL,
    token_verificacion VARCHAR(64) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'valido',
    email_estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    intentos_email INT NOT NULL DEFAULT 0,
    email_lease_hasta TIMESTAMPTZ,
    email_enviado_en TIMESTAMPTZ,
    email_error TEXT,
    archivo_actual TEXT NOT NULL,
    version_actual INT NOT NULL DEFAULT 1,
    datos_snapshot JSONB NOT NULL,
    creado_por_usuario_id BIGINT,
    anulado_por_usuario_id BIGINT,
    anulado_en TIMESTAMPTZ,
    motivo_anulacion VARCHAR(1000),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_emision TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_certificado PRIMARY KEY (id),
    CONSTRAINT uq_evento_participante_encuentro_certificado UNIQUE (evento_id, participante_id),
    CONSTRAINT uq_id_participante_evento_encuentro_certificado UNIQUE (id, participante_id, evento_id),
    CONSTRAINT uq_codigo_encuentro_certificado UNIQUE (codigo),
    CONSTRAINT uq_token_encuentro_certificado UNIQUE (token_verificacion),
    CONSTRAINT fk_encuentro_certificado_participante_evento FOREIGN KEY (participante_id, evento_id)
        REFERENCES encuentro_participante(id, evento_id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_certificado_creado_por FOREIGN KEY (creado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_encuentro_certificado_anulado_por FOREIGN KEY (anulado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_estado_encuentro_certificado CHECK (estado IN ('valido', 'anulado')),
    CONSTRAINT ck_email_estado_encuentro_certificado CHECK (
        email_estado IN ('pendiente', 'enviando', 'enviado', 'error', 'omitido')
    ),
    CONSTRAINT ck_version_encuentro_certificado CHECK (version_actual > 0),
    CONSTRAINT ck_intentos_email_encuentro_certificado CHECK (intentos_email >= 0),
    CONSTRAINT ck_anulacion_encuentro_certificado CHECK (
        (estado = 'valido' AND anulado_en IS NULL AND motivo_anulacion IS NULL)
        OR (estado = 'anulado' AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_encuentro_certificado_estado_email
    ON encuentro_certificado(email_estado, fecha_modificacion);

CREATE TABLE IF NOT EXISTS encuentro_certificado_version (
    id BIGSERIAL NOT NULL,
    certificado_id BIGINT NOT NULL,
    numero_version INT NOT NULL,
    archivo_path TEXT NOT NULL,
    plantilla_config_snapshot JSONB NOT NULL,
    datos_snapshot JSONB NOT NULL,
    generado_por_usuario_id BIGINT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_certificado_version PRIMARY KEY (id),
    CONSTRAINT uq_certificado_version_encuentro UNIQUE (certificado_id, numero_version),
    CONSTRAINT fk_encuentro_certificado_version_certificado FOREIGN KEY (certificado_id)
        REFERENCES encuentro_certificado(id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_certificado_version_usuario FOREIGN KEY (generado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_numero_version_encuentro_certificado CHECK (numero_version > 0)
);

CREATE TABLE IF NOT EXISTS encuentro_envio_certificado (
    id BIGSERIAL NOT NULL,
    certificado_id BIGINT NOT NULL,
    intento INT NOT NULL,
    estado VARCHAR(20) NOT NULL,
    error TEXT,
    iniciado_por_usuario_id BIGINT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_envio_certificado PRIMARY KEY (id),
    CONSTRAINT uq_certificado_intento_encuentro_envio UNIQUE (certificado_id, intento),
    CONSTRAINT fk_encuentro_envio_certificado_certificado FOREIGN KEY (certificado_id)
        REFERENCES encuentro_certificado(id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_envio_certificado_usuario FOREIGN KEY (iniciado_por_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_estado_encuentro_envio CHECK (
        estado IN ('enviando', 'enviado', 'error', 'omitido')
    ),
    CONSTRAINT ck_intento_encuentro_envio CHECK (intento > 0)
);

CREATE TABLE IF NOT EXISTS encuentro_logro (
    id BIGSERIAL NOT NULL,
    evento_id BIGINT NOT NULL,
    participante_id BIGINT NOT NULL,
    usuario_id BIGINT NOT NULL,
    certificado_id BIGINT NOT NULL,
    fecha_obtencion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_encuentro_logro PRIMARY KEY (id),
    CONSTRAINT uq_evento_usuario_encuentro_logro UNIQUE (evento_id, usuario_id),
    CONSTRAINT uq_evento_participante_encuentro_logro UNIQUE (evento_id, participante_id),
    CONSTRAINT fk_encuentro_logro_participante_usuario FOREIGN KEY (participante_id, evento_id, usuario_id)
        REFERENCES encuentro_participante(id, evento_id, usuario_id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_logro_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuario(id) ON DELETE RESTRICT,
    CONSTRAINT fk_encuentro_logro_certificado_participante_evento
        FOREIGN KEY (certificado_id, participante_id, evento_id)
        REFERENCES encuentro_certificado(id, participante_id, evento_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_encuentro_logro_usuario_fecha
    ON encuentro_logro(usuario_id, fecha_obtencion DESC);

COMMIT;
