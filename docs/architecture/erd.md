# ERD (Modelo de datos)

## Proposito

Modelo relacional principal de MILab basado en `sql-scripts/db_structure.sql`.

## Diagrama (Mermaid)

```mermaid
erDiagram
  log {
    SERIAL id PK
    VARCHAR nombre
    NUMERIC documento
    TIMESTAMPTZ fecha_creacion
    TEXT accion
    VARCHAR persona
    BOOLEAN activo
    TIMESTAMPTZ fecha_modificacion
  }

  usuario {
    BIGSERIAL id PK
    VARCHAR correo
    VARCHAR documento
    VARCHAR nombre
    BIGINT codigo
    VARCHAR estado
    VARCHAR carrera
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  rol {
    SERIAL id PK
    VARCHAR nombre
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  usuario_rol {
    BIGINT usuario_id FK
    INT rol_id FK
    BOOLEAN activo
    JSONB meta
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  perfil_estudiante {
    BIGINT usuario_id PK
    VARCHAR documento
    VARCHAR nombre
    BIGINT codigo
    TEXT programa
    TEXT estado
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  perfil_docente {
    BIGINT usuario_id PK
    VARCHAR documento
    VARCHAR nombre
    TEXT estado
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  menu_item {
    SERIAL id PK
    INT parent_id FK
    VARCHAR section
    TEXT label
    TEXT route
    TEXT icon
    INT order_index
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  rol_permiso {
    INT rol_id FK
    INT menu_item_id FK
    BOOLEAN can_view
    BOOLEAN can_use
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  certificado_estudiante {
    SERIAL id PK
    BIGINT usuario_id FK
    TIMESTAMP fecha_creacion
    TIMESTAMP fecha_vencimiento
    TEXT id_certificado
    TEXT motivo_expedicion
    TEXT correo
    TEXT motivo_exp
    TEXT multa
    BOOLEAN activo
    TIMESTAMPTZ fecha_modificacion
  }

  certificado_docente {
    SERIAL id PK
    BIGINT usuario_id FK
    TIMESTAMPTZ fecha_creacion
    TEXT id_certificado
    TEXT correo
    TEXT motivo_exp
    INTEGER multa
    TEXT origen_descarga
    TEXT estado_docente
    BOOLEAN activo
    TIMESTAMPTZ fecha_modificacion
  }

  facultad {
    SERIAL id_facultad PK
    TEXT nombre
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  ual {
    SERIAL id_ual PK
    TEXT nombre
    INT id_facultad FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  laboratorista {
    VARCHAR documento PK
    VARCHAR nombre
    VARCHAR n_usuario
    VARCHAR correo
    INT id_ual FK
    INT id_facultad FK
    VARCHAR contrato
    BIGINT usuario_id FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  coordinador {
    VARCHAR documento PK
    VARCHAR nombre
    VARCHAR correo
    INT id_facultad FK
    VARCHAR numero_resolucion_coordinador
    TEXT soporte_resolucion
    VARCHAR nombre_u
    BIGINT usuario_id FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  coordinador_facultad {
    VARCHAR documento FK
    INT id_facultad FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  laboratorista_ual {
    VARCHAR documento FK
    INT id_ual FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  multa {
    SERIAL id PK
    TEXT cat_multa
    VARCHAR documento_laboratorista FK
    BIGINT usuario_id_sancionado FK
    INT id_ual FK
    DATE fecha_multa
    TEXT con_estado_multa
    TEXT obs_multa
    TEXT tipo_sancion
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  usuario ||--o{ usuario_rol : asigna
  rol ||--o{ usuario_rol : pertenece
  rol ||--o{ rol_permiso : concede
  menu_item ||--o{ rol_permiso : habilita
  menu_item ||--o{ menu_item : parent
  usuario ||--|| perfil_estudiante : perfil
  usuario ||--|| perfil_docente : perfil
  usuario ||--o{ certificado_estudiante : emite
  usuario ||--o{ certificado_docente : emite
  facultad ||--o{ ual : contiene
  facultad ||--o{ coordinador : referencia
  facultad ||--o{ coordinador_facultad : asigna
  facultad ||--o{ laboratorista : referencia
  coordinador ||--o{ coordinador_facultad : gestiona
  laboratorista ||--o{ laboratorista_ual : asigna
  ual ||--o{ laboratorista_ual : contiene
  ual ||--o{ laboratorista : referencia
  usuario ||--o{ laboratorista : vinculo
  usuario ||--o{ coordinador : vinculo
  laboratorista ||--o{ multa : registra
  usuario ||--o{ multa : recibe
  ual ||--o{ multa : ocurre_en
```

## Referencias De Esquema

| Tabla | Columnas principales |
| --- | --- |
| `log` | id, nombre, documento, fecha_creacion, accion, persona, activo, fecha_modificacion |
| `usuario` | id, correo, documento, nombre, codigo, estado, carrera, activo, fecha_creacion, fecha_modificacion |
| `rol` | id, nombre, activo, fecha_creacion, fecha_modificacion |
| `usuario_rol` | usuario_id, rol_id, activo, meta, fecha_creacion, fecha_modificacion |
| `perfil_estudiante` | usuario_id, documento, nombre, codigo, programa, estado, activo, fecha_creacion, fecha_modificacion |
| `perfil_docente` | usuario_id, documento, nombre, estado, activo, fecha_creacion, fecha_modificacion |
| `menu_item` | id, parent_id, section, label, route, icon, order_index, activo, fecha_creacion, fecha_modificacion |
| `rol_permiso` | rol_id, menu_item_id, can_view, can_use, activo, fecha_creacion, fecha_modificacion |
| `certificado_estudiante` | id, usuario_id, fecha_creacion, fecha_vencimiento, id_certificado, motivo_expedicion, correo, motivo_exp, multa, activo, fecha_modificacion |
| `certificado_docente` | id, usuario_id, fecha_creacion, id_certificado, correo, motivo_exp, multa, origen_descarga, estado_docente, activo, fecha_modificacion |
| `facultad` | id_facultad, nombre, activo, fecha_creacion, fecha_modificacion |
| `ual` | id_ual, nombre, id_facultad, activo, fecha_creacion, fecha_modificacion |
| `laboratorista` | documento, nombre, n_usuario, correo, id_ual, id_facultad, contrato, usuario_id, activo, fecha_creacion, fecha_modificacion |
| `coordinador` | documento, nombre, correo, id_facultad, numero_resolucion_coordinador, soporte_resolucion, nombre_u, usuario_id, activo, fecha_creacion, fecha_modificacion |
| `coordinador_facultad` | documento, id_facultad, activo, fecha_creacion, fecha_modificacion |
| `laboratorista_ual` | documento, id_ual, activo, fecha_creacion, fecha_modificacion |
| `multa` | id, cat_multa, documento_laboratorista, usuario_id_sancionado, id_ual, fecha_multa, con_estado_multa, obs_multa, tipo_sancion, activo, fecha_creacion, fecha_modificacion |

## Notas De Modelado

- El esquema canónico ya no usa las tablas `estudiante` y `docente` como entidades principales del dominio.
- Las sanciones (`multa`) ya están conectadas por claves foráneas reales a `laboratorista`, `usuario` y `ual`.
- `coordinador.id_facultad` y `laboratorista.id_ual` / `id_facultad` siguen existiendo, pero las tablas `coordinador_facultad` y `laboratorista_ual` son las relaciones que soportan alcance múltiple.
