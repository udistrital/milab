SET TIME ZONE 'America/Bogota';

BEGIN;

CREATE TABLE IF NOT EXISTS inventario (
    id SERIAL NOT NULL,
    serie VARCHAR(100),
    placa VARCHAR(100),
    nombre_bien VARCHAR(255) NOT NULL,
    grupo_inventario VARCHAR(100),
    nivel_inventario VARCHAR(50),
    funcionario_doc VARCHAR(50),
    nombre_funcionario VARCHAR(255),
    fecha_registro DATE DEFAULT CURRENT_DATE,
    sede VARCHAR(100),
    dependencia VARCHAR(100),
    espacio_fisico VARCHAR(100),
    disponible_prestamo BOOLEAN DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_inventario PRIMARY KEY (id),
    CONSTRAINT uq_serie_inventario UNIQUE (serie),
    CONSTRAINT uq_placa_inventario UNIQUE (placa)
);

CREATE INDEX IF NOT EXISTS idx_inventario_serie ON inventario(serie);
CREATE INDEX IF NOT EXISTS idx_inventario_placa ON inventario(placa);
CREATE INDEX IF NOT EXISTS idx_inventario_funcionario ON inventario(funcionario_doc);
CREATE INDEX IF NOT EXISTS idx_inventario_disponible_prestamo ON inventario(disponible_prestamo);

CREATE TABLE IF NOT EXISTS equipo (
    id SERIAL NOT NULL,
    codigo VARCHAR(50) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    especificaciones JSONB,
    categoria VARCHAR(100) NOT NULL,
    laboratorio VARCHAR(100),
    facultad VARCHAR(100),
    area_conocimiento VARCHAR(100),
    estado VARCHAR(50) NOT NULL,
    ubicacion VARCHAR(255),
    ubicacion_prestamo JSONB NOT NULL DEFAULT '{"dentro": true, "fuera": false}',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_equipo PRIMARY KEY (id),
    CONSTRAINT uq_codigo_equipo UNIQUE (codigo),
    CONSTRAINT ck_estado_equipo CHECK (estado IN ('disponible', 'prestado', 'mantenimiento', 'fuera_servicio'))
);

CREATE TABLE IF NOT EXISTS horario_equipo (
    id SERIAL NOT NULL,
    equipo_id INT NOT NULL,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_horario_equipo PRIMARY KEY (id),
    CONSTRAINT fk_horario_equipo_equipo FOREIGN KEY (equipo_id) REFERENCES equipo(id) ON DELETE CASCADE,
    CONSTRAINT ck_hora_inicio_horario_equipo CHECK (hora_inicio < hora_fin)
);

CREATE INDEX IF NOT EXISTS idx_equipo_codigo ON equipo(codigo);
CREATE INDEX IF NOT EXISTS idx_equipo_categoria ON equipo(categoria);
CREATE INDEX IF NOT EXISTS idx_equipo_estado ON equipo(estado);
CREATE INDEX IF NOT EXISTS idx_equipo_facultad ON equipo(facultad);
CREATE INDEX IF NOT EXISTS idx_horario_equipo_equipo ON horario_equipo(equipo_id);
CREATE INDEX IF NOT EXISTS idx_horario_equipo_fecha ON horario_equipo(fecha);

CREATE TABLE IF NOT EXISTS solicitud_prestamo (
    id SERIAL NOT NULL,
    usuario_id BIGINT NOT NULL,
    equipo_id INT NOT NULL,
    fecha_inicio TIMESTAMPTZ NOT NULL,
    fecha_fin TIMESTAMPTZ NOT NULL,
    justificacion_academica TEXT NOT NULL,
    categoria_practica VARCHAR(20) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    tipo_aprobacion VARCHAR(20) NOT NULL DEFAULT 'manual',
    motivo_rechazo TEXT,
    formato_archivo VARCHAR(100),
    formato_payload JSONB,
    firma_digital TEXT NOT NULL,
    fecha_firma TIMESTAMPTZ,
    recordatorio_enviado BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_solicitud_prestamo PRIMARY KEY (id),
    CONSTRAINT fk_solicitud_prestamo_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    CONSTRAINT fk_solicitud_prestamo_equipo FOREIGN KEY (equipo_id) REFERENCES equipo(id) ON DELETE CASCADE,
    CONSTRAINT ck_categoria_practica_solicitud_prestamo CHECK (categoria_practica IN ('academica', 'extension', 'investigacion', 'otra')),
    CONSTRAINT ck_estado_solicitud_prestamo CHECK (estado IN ('pendiente', 'en_cola', 'aprobado', 'activo', 'finalizado', 'rechazado', 'cancelado')),
    CONSTRAINT ck_tipo_aprobacion_solicitud_prestamo CHECK (tipo_aprobacion IN ('manual', 'automatico')),
    CONSTRAINT ck_fecha_inicio_solicitud_prestamo CHECK (fecha_inicio < fecha_fin)
);

CREATE INDEX IF NOT EXISTS idx_solicitud_prestamo_usuario ON solicitud_prestamo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_prestamo_equipo ON solicitud_prestamo(equipo_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_prestamo_estado ON solicitud_prestamo(estado);
CREATE INDEX IF NOT EXISTS idx_solicitud_prestamo_inicio ON solicitud_prestamo(fecha_inicio);

CREATE TABLE IF NOT EXISTS cola_solicitud (
    id SERIAL NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    usuario_id BIGINT NOT NULL,
    equipo_id INT,
    laboratorio VARCHAR(150),
    fecha_inicio TIMESTAMPTZ NOT NULL,
    fecha_fin TIMESTAMPTZ NOT NULL,
    observaciones TEXT,
    referencia_id INT,
    atendida_por_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_cola_solicitud PRIMARY KEY (id),
    CONSTRAINT fk_cola_solicitud_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    CONSTRAINT fk_cola_solicitud_equipo FOREIGN KEY (equipo_id) REFERENCES equipo(id) ON DELETE SET NULL,
    CONSTRAINT fk_cola_solicitud_usuario_atendida_por FOREIGN KEY (atendida_por_id) REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_tipo_cola_solicitud CHECK (tipo IN ('prestamo', 'practica')),
    CONSTRAINT ck_estado_cola_solicitud CHECK (estado IN ('pendiente', 'atendida', 'cancelada')),
    CONSTRAINT ck_fecha_inicio_cola_solicitud CHECK (fecha_inicio < fecha_fin)
);

CREATE INDEX IF NOT EXISTS idx_cola_solicitud_tipo_estado
    ON cola_solicitud(tipo, estado);
CREATE INDEX IF NOT EXISTS idx_cola_solicitud_equipo
    ON cola_solicitud(equipo_id);
CREATE INDEX IF NOT EXISTS idx_cola_solicitud_usuario
    ON cola_solicitud(usuario_id);
CREATE INDEX IF NOT EXISTS idx_cola_solicitud_referencia
    ON cola_solicitud(referencia_id);

CREATE TABLE IF NOT EXISTS entrega_equipo (
    id SERIAL NOT NULL,
    solicitud_prestamo_id INT NOT NULL,
    fecha_entrega TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_devolucion_esperada TIMESTAMPTZ,
    condicion_entrega TEXT NOT NULL,
    fecha_devolucion_real TIMESTAMPTZ,
    condicion_devolucion TEXT,
    lista_componentes JSONB NOT NULL DEFAULT '[]'::jsonb,
    creado_por_id BIGINT,
    firma_digital TEXT NOT NULL,
    fecha_firma TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_entrega_equipo PRIMARY KEY (id),
    CONSTRAINT uq_solicitud_prestamo_id_entrega_equipo UNIQUE (solicitud_prestamo_id),
    CONSTRAINT fk_entrega_equipo_solicitud_prestamo FOREIGN KEY (solicitud_prestamo_id) REFERENCES solicitud_prestamo(id) ON DELETE CASCADE,
    CONSTRAINT fk_entrega_equipo_usuario_creador FOREIGN KEY (creado_por_id) REFERENCES usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_entrega_equipo_solicitud_prestamo ON entrega_equipo(solicitud_prestamo_id);
CREATE INDEX IF NOT EXISTS idx_entrega_equipo_entrega ON entrega_equipo(fecha_entrega);
CREATE INDEX IF NOT EXISTS idx_entrega_equipo_devolucion_real ON entrega_equipo(fecha_devolucion_real);

CREATE TABLE IF NOT EXISTS incidencia (
    id SERIAL NOT NULL,
    equipo_id INT,
    solicitud_prestamo_id INT,
    entrega_equipo_id INT,
    origen VARCHAR(20) NOT NULL DEFAULT 'prestamo',
    reserva_practica_id INT,
    practica_tipo VARCHAR(20),
    reportado_por_id BIGINT,
    documento_que_reporto VARCHAR(50),
    nombre_que_reporto VARCHAR(255),
    tipo_incidencia VARCHAR(120) NOT NULL,
    descripcion TEXT NOT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'abierta',
    sancion_tipo VARCHAR(30),
    sancion_detalle TEXT,
    descripcion_cierre TEXT,
    evidencia_foto BYTEA,
    evidencia_mime VARCHAR(50),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_incidencia PRIMARY KEY (id),
    CONSTRAINT fk_incidencia_equipo FOREIGN KEY (equipo_id) REFERENCES equipo(id) ON DELETE CASCADE,
    CONSTRAINT fk_incidencia_solicitud_prestamo FOREIGN KEY (solicitud_prestamo_id) REFERENCES solicitud_prestamo(id) ON DELETE SET NULL,
    CONSTRAINT fk_incidencia_entrega_equipo FOREIGN KEY (entrega_equipo_id) REFERENCES entrega_equipo(id) ON DELETE SET NULL,
    CONSTRAINT fk_incidencia_usuario_reporta FOREIGN KEY (reportado_por_id) REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_origen_incidencia CHECK (origen IN ('prestamo', 'practica')),
    CONSTRAINT ck_practica_tipo_incidencia CHECK (practica_tipo IS NULL OR practica_tipo IN ('libre', 'docente')),
    CONSTRAINT ck_estado_incidencia CHECK (estado IN ('pendiente_confirmacion', 'abierta', 'pendiente_cierre', 'cerrada')),
    CONSTRAINT ck_sancion_tipo_incidencia CHECK (sancion_tipo IS NULL OR sancion_tipo IN ('pedagogica', 'reposicion', 'otro'))
);

CREATE INDEX IF NOT EXISTS idx_incidencia_equipo ON incidencia(equipo_id);
CREATE INDEX IF NOT EXISTS idx_incidencia_solicitud_prestamo ON incidencia(solicitud_prestamo_id);
CREATE INDEX IF NOT EXISTS idx_incidencia_reserva_practica ON incidencia(reserva_practica_id);
CREATE INDEX IF NOT EXISTS idx_incidencia_estado ON incidencia(estado);

CREATE TABLE IF NOT EXISTS parametrizacion (
    id SERIAL NOT NULL,
    max_horas_mes_practica_libre INT NOT NULL DEFAULT 0,
    max_horas_mes_prestamos INT NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_parametrizacion PRIMARY KEY (id),
    CONSTRAINT ck_max_horas_mes_practica_libre_parametrizacion CHECK (max_horas_mes_practica_libre >= 0),
    CONSTRAINT ck_max_horas_mes_prestamos_parametrizacion CHECK (max_horas_mes_prestamos >= 0)
);

CREATE TABLE IF NOT EXISTS practica_config (
    id SERIAL NOT NULL,
    facultad_id INT NOT NULL,
    min_cancel_hours INT NOT NULL DEFAULT 1,
    min_reserva_hours INT NOT NULL DEFAULT 2,
    min_docente_reserva_days INT NOT NULL DEFAULT 0,
    max_activas_estudiante INT NOT NULL DEFAULT 2,
    dias_sancion_no_asistencia INT NOT NULL DEFAULT 1,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_practica_config PRIMARY KEY (id),
    CONSTRAINT fk_practica_config_facultad FOREIGN KEY (facultad_id) REFERENCES facultad(facultad_id) ON DELETE CASCADE,
    CONSTRAINT uq_facultad_id_practica_config UNIQUE (facultad_id),
    CONSTRAINT ck_min_cancel_hours_practica_config CHECK (min_cancel_hours >= 1),
    CONSTRAINT ck_min_reserva_hours_practica_config CHECK (min_reserva_hours >= 2),
    CONSTRAINT ck_min_docente_reserva_days_practica_config CHECK (min_docente_reserva_days >= 0),
    CONSTRAINT ck_max_activas_estudiante_practica_config CHECK (max_activas_estudiante >= 1),
    CONSTRAINT ck_dias_sancion_no_asistencia_practica_config CHECK (dias_sancion_no_asistencia >= 0)
);

CREATE INDEX IF NOT EXISTS idx_practica_config_facultad ON practica_config(facultad_id);

ALTER TABLE coordinador
ADD COLUMN IF NOT EXISTS firma_digital TEXT;

ALTER TABLE coordinador
ADD COLUMN IF NOT EXISTS fecha_firma TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS facultad_modulo_acceso (
    id SERIAL NOT NULL,
    facultad_id INT NOT NULL,
    modulo VARCHAR(50) NOT NULL,
    rol VARCHAR(30) NOT NULL,
    permitido BOOLEAN NOT NULL DEFAULT TRUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_facultad_modulo_acceso PRIMARY KEY (id),
    CONSTRAINT uq_facultad_modulo_acceso UNIQUE (facultad_id, modulo, rol),
    CONSTRAINT fk_facultad_modulo_acceso_facultad FOREIGN KEY (facultad_id) REFERENCES facultad(facultad_id) ON DELETE CASCADE,
    CONSTRAINT ck_facultad_modulo_acceso_modulo CHECK (modulo IN ('prestamos')),
    CONSTRAINT ck_facultad_modulo_acceso_rol CHECK (rol IN ('coordinador', 'laboratorista'))
);

CREATE INDEX IF NOT EXISTS idx_facultad_modulo_acceso_facultad_id
    ON facultad_modulo_acceso(facultad_id);

CREATE TABLE IF NOT EXISTS reserva_practica (
    id SERIAL NOT NULL,
    usuario_id BIGINT NOT NULL,
    sala_id INT,
    fecha_inicio TIMESTAMPTZ NOT NULL,
    fecha_fin TIMESTAMPTZ NOT NULL,
    laboratorio VARCHAR(150) NOT NULL,
    facultad VARCHAR(150) NOT NULL,
    tipo_practica VARCHAR(20) NOT NULL DEFAULT 'libre',
    categoria_practica VARCHAR(20) NOT NULL,
    modalidad_libre VARCHAR(20),
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    justificacion TEXT NOT NULL,
    formato_archivo VARCHAR(100),
    formato_payload JSONB,
    firma_digital TEXT,
    fecha_firma TIMESTAMPTZ,
    recordatorio_enviado BOOLEAN NOT NULL DEFAULT FALSE,
    motivo_rechazo TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_reserva_practica PRIMARY KEY (id),
    CONSTRAINT fk_reserva_practica_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    CONSTRAINT ck_tipo_practica_reserva_practica CHECK (tipo_practica IN ('libre', 'docente')),
    CONSTRAINT ck_categoria_practica_reserva_practica CHECK (categoria_practica IN ('academica', 'extension', 'investigacion', 'otra')),
    CONSTRAINT ck_estado_reserva_practica CHECK (estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'en_cola', 'aprobada', 'activa', 'iniciada', 'completada', 'finalizada', 'rechazada', 'cancelada', 'no_asistio')),
    CONSTRAINT ck_fecha_inicio_reserva_practica CHECK (fecha_inicio < fecha_fin),
    CONSTRAINT ck_modalidad_libre_reserva_practica CHECK (
      modalidad_libre IS NULL OR modalidad_libre IN ('uno_a_uno', 'uno_a_varios', 'varios_a_uno')
    )
);

CREATE INDEX IF NOT EXISTS idx_reserva_practica_usuario ON reserva_practica(usuario_id);
CREATE INDEX IF NOT EXISTS idx_reserva_practica_sala ON reserva_practica(sala_id);
CREATE INDEX IF NOT EXISTS idx_reserva_practica_facultad ON reserva_practica(facultad);
CREATE INDEX IF NOT EXISTS idx_reserva_practica_laboratorio ON reserva_practica(laboratorio);
CREATE INDEX IF NOT EXISTS idx_reserva_practica_estado ON reserva_practica(estado);
CREATE INDEX IF NOT EXISTS idx_reserva_practica_inicio ON reserva_practica(fecha_inicio);

ALTER TABLE incidencia
ADD CONSTRAINT fk_incidencia_reserva_practica
FOREIGN KEY (reserva_practica_id)
REFERENCES reserva_practica(id)
ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS email_notification (
    id SERIAL NOT NULL,
    source_system VARCHAR(50),
    template_name VARCHAR(100),
    recipient VARCHAR(255),
    subject VARCHAR(255),
    status VARCHAR(20),
    error_message TEXT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_envio TIMESTAMPTZ,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    correlation_id VARCHAR(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_email_notification PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_email_notification_created_at
    ON email_notification(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_email_notification_status
    ON email_notification(status);

CREATE TABLE IF NOT EXISTS sala (
    id SERIAL NOT NULL,
    ual_id INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    tipo_espacio VARCHAR(30) NOT NULL DEFAULT 'Sala',
    permite_practica_libre BOOLEAN NOT NULL DEFAULT TRUE,
    permite_practica_docente BOOLEAN NOT NULL DEFAULT FALSE,
    formato_practica_libre VARCHAR(80) NOT NULL DEFAULT 'PL_REGLAMENTO_GENERAL',
    formato_practica_docente VARCHAR(80) NOT NULL DEFAULT 'DOC_PRACTICA_DOCENTE_SOLICITUD',
    capacidad INT NOT NULL DEFAULT 1,
    descripcion TEXT,
    equipos_nombres TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_sala PRIMARY KEY (id),
    CONSTRAINT fk_sala_ual FOREIGN KEY (ual_id) REFERENCES ual(ual_id) ON DELETE CASCADE,
    CONSTRAINT uq_ual_id_nombre_sala UNIQUE (ual_id, nombre),
    CONSTRAINT ck_tipo_espacio_sala CHECK (tipo_espacio IN ('Aula', 'Laboratorio', 'Sala', 'Otro')),
    CONSTRAINT ck_capacidad_sala CHECK (capacidad > 0)
);

CREATE TABLE IF NOT EXISTS horario_sala (
    id SERIAL NOT NULL,
    sala_id INT NOT NULL,
    dia_semana INT,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    fecha DATE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    tipo_practica VARCHAR(20) NOT NULL DEFAULT 'libre',
    modalidad_libre VARCHAR(20),
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_horario_sala PRIMARY KEY (id),
    CONSTRAINT fk_horario_sala_sala FOREIGN KEY (sala_id) REFERENCES sala(id) ON DELETE CASCADE,
    CONSTRAINT ck_hora_inicio_horario_sala CHECK (hora_inicio < hora_fin),
    CONSTRAINT ck_dia_semana_horario_sala CHECK (dia_semana IS NULL OR dia_semana BETWEEN 0 AND 6),
    CONSTRAINT ck_contexto_horario_sala CHECK (
        (fecha IS NOT NULL AND dia_semana IS NULL) OR
        (fecha IS NULL AND dia_semana IS NOT NULL)
    ),
    CONSTRAINT ck_tipo_practica_horario_sala CHECK (tipo_practica IN ('libre', 'docente')),
    CONSTRAINT ck_modalidad_libre_horario_sala CHECK (modalidad_libre IS NULL OR modalidad_libre IN ('uno_a_uno', 'uno_a_varios', 'varios_a_uno'))
);

CREATE INDEX IF NOT EXISTS idx_sala_ual ON sala(ual_id);
CREATE INDEX IF NOT EXISTS idx_sala_activo ON sala(activo);
CREATE INDEX IF NOT EXISTS idx_horario_sala_sala ON horario_sala(sala_id);
CREATE INDEX IF NOT EXISTS idx_horario_sala_fecha ON horario_sala(fecha);
CREATE INDEX IF NOT EXISTS idx_horario_sala_dia_semana ON horario_sala(dia_semana);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_reserva_practica_sala'
    ) THEN
        ALTER TABLE reserva_practica
        ADD CONSTRAINT fk_reserva_practica_sala
        FOREIGN KEY (sala_id) REFERENCES sala(id) ON DELETE SET NULL;
    END IF;
END $$;

COMMIT;
