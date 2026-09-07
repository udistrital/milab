# ERD (Modelo de datos)

    SERIAL facultad_id PK

## Proposito

Modelo relacional principal de MILab basado en `sql-scripts/db_structure.sql`.

## Diagrama (Mermaid)

```mermaid
    SERIAL ual_id PK
  log {
    INT facultad_id FK
    VARCHAR nombre
    NUMERIC documento
    TIMESTAMPTZ fecha_creacion
    TEXT accion
    VARCHAR persona
    BOOLEAN activo
    TIMESTAMPTZ fecha_modificacion
  }

  usuario {
    INT ual_id FK
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
    INT facultad_id FK
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
    INT ual_id FK
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
    TEXT certificado_id
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
    TEXT certificado_id
    TEXT correo
    TEXT motivo_exp
    INTEGER multa
    TEXT origen_descarga
    TEXT estado_docente
    BOOLEAN activo
    TIMESTAMPTZ fecha_modificacion
  }

  facultad {
    SERIAL facultad_id PK
    TEXT nombre
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  ual {
    SERIAL ual_id PK
    TEXT nombre
    INT facultad_id FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  laboratorista {
    VARCHAR documento PK
    VARCHAR nombre
    VARCHAR n_usuario
    VARCHAR correo
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
    VARCHAR numero_resolucion_coordinador
    TEXT soporte_resolucion
    VARCHAR nombre_u
    BIGINT usuario_id FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  coordinador_facultad {
    VARCHAR coordinador_documento_id FK
    INT facultad_id FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  laboratorista_ual {
    VARCHAR laboratorista_documento_id FK
    INT ual_id FK
    BOOLEAN activo
    TIMESTAMPTZ fecha_creacion
    TIMESTAMPTZ fecha_modificacion
  }

  multa {
    SERIAL id PK
    TEXT cat_multa
    VARCHAR laboratorista_documento_id FK
    BIGINT usuario_sancionado_id FK
    INT ual_id FK
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
  facultad ||--o{ coordinador_facultad : asigna
  coordinador ||--o{ coordinador_facultad : gestiona
  laboratorista ||--o{ laboratorista_ual : asigna
  ual ||--o{ laboratorista_ual : contiene
  usuario ||--o{ laboratorista : vinculo
  usuario ||--o{ coordinador : vinculo
  laboratorista ||--o{ multa : registra
  usuario ||--o{ multa : recibe
  ual ||--o{ multa : ocurre_en
```

## Referencias De Esquema

| Tabla                    | Columnas principales                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log`                    | id, nombre, documento, fecha_creacion, accion, persona, activo, fecha_modificacion                                                                                           |
| `usuario`                | id, correo, documento, nombre, codigo, estado, carrera, activo, fecha_creacion, fecha_modificacion                                                                           |
| `rol`                    | id, nombre, activo, fecha_creacion, fecha_modificacion                                                                                                                       |
| `usuario_rol`            | usuario_id, rol_id, activo, meta, fecha_creacion, fecha_modificacion                                                                                                         |
| `perfil_estudiante`      | usuario_id, documento, nombre, codigo, programa, estado, activo, fecha_creacion, fecha_modificacion                                                                          |
| `perfil_docente`         | usuario_id, documento, nombre, estado, activo, fecha_creacion, fecha_modificacion                                                                                            |
| `menu_item`              | id, parent_id, section, label, route, icon, order_index, activo, fecha_creacion, fecha_modificacion                                                                          |
| `rol_permiso`            | rol_id, menu_item_id, can_view, can_use, activo, fecha_creacion, fecha_modificacion                                                                                          |
| `certificado_estudiante` | id, usuario_id, fecha_creacion, fecha_vencimiento, certificado_id, motivo_expedicion, correo, motivo_exp, multa, activo, fecha_modificacion                                  |
| `certificado_docente`    | id, usuario_id, fecha_creacion, certificado_id, correo, motivo_exp, multa, origen_descarga, estado_docente, activo, fecha_modificacion                                       |
| `facultad`               | facultad_id, nombre, activo, fecha_creacion, fecha_modificacion                                                                                                              |
| `ual`                    | ual_id, nombre, facultad_id, activo, fecha_creacion, fecha_modificacion                                                                                                      |
| `laboratorista`          | documento, nombre, n_usuario, correo, contrato, usuario_id, activo, fecha_creacion, fecha_modificacion                                                                       |
| `coordinador`            | documento, nombre, correo, numero_resolucion_coordinador, soporte_resolucion, nombre_u, usuario_id, activo, fecha_creacion, fecha_modificacion                               |
| `coordinador_facultad`   | coordinador_documento_id, facultad_id, activo, fecha_creacion, fecha_modificacion                                                                                            |
| `laboratorista_ual`      | laboratorista_documento_id, ual_id, activo, fecha_creacion, fecha_modificacion                                                                                               |
| `multa`                  | id, cat_multa, laboratorista_documento_id, usuario_sancionado_id, ual_id, fecha_multa, con_estado_multa, obs_multa, tipo_sancion, activo, fecha_creacion, fecha_modificacion |

## Notas De Modelado

- El esquema canónico ya no usa las tablas `estudiante` y `docente` como entidades principales del dominio.
- Las sanciones (`multa`) ya están conectadas por claves foráneas reales a `laboratorista`, `usuario` y `ual`.
- Las relaciones de alcance se modelan de forma autoritativa mediante `coordinador_facultad` y `laboratorista_ual`.
