# Diagnóstico De Normalización De Base De Datos

## Objetivo

Este documento resume el estado actual del modelo de datos de MiLab, identifica redundancias y relaciones débiles, y propone un modelo objetivo más normalizado y mantenible.

La evaluación se basó en dos fuentes:

- El esquema canónico declarado en [sql-scripts/db_structure.sql](sql-scripts/db_structure.sql).
- La base local en ejecución `dbpazysalvo` dentro del contenedor `local_db`, consultada en modo solo lectura.

## Resumen Ejecutivo

El modelo actual funciona, pero mezcla tres conceptos distintos en varias tablas:

- Identidad de la persona.
- Cuenta de autenticación.
- Asignaciones operativas a facultades, UAL y sanciones.

El principal problema de normalización no es simplemente que existan "tablas solas", sino que algunas relaciones del dominio están representadas de forma duplicada o mediante columnas de texto que deberían ser claves foráneas.

Los hallazgos más importantes son estos:

1. `multas` es la tabla más desnormalizada del sistema: guarda referencias operativas como texto libre y no tiene claves foráneas.
2. `laboratorista` y `coordinador_laboratorio` duplican relaciones que ya existen en tablas de unión (`laboratorista_ual` y `coordinador_facultad`).
3. `auth` no representa de forma limpia la identidad autenticable: para estudiante y admin usa un identificador, pero para laboratorista y coordinador usa otro (`n_usuario` o `nombre_u`).
4. `logs.documento` está modelado como numérico, aunque el sistema ya maneja múltiples identificadores alfanuméricos.
5. No todas las tablas sin FK son un problema: `schema_migrations` puede quedar aislada por diseño, y `logs` puede quedar parcialmente desacoplada por auditoría. El problema es distinguir aislamiento intencional de desnormalización accidental.

## Inventario Actual De Tablas

### Tablas de identidad y acceso

- `auth`
- `usuario`
- `estudiante`
- `docente`
- `laboratorista`
- `coordinador_laboratorio`

### Tablas maestras

- `facultad`
- `ual`

### Tablas de relación

- `coordinador_facultad`
- `laboratorista_ual`

### Tablas operativas y de soporte

- `multas`
- `logs`
- `schema_migrations`

## Relaciones Declaradas Hoy

Las claves foráneas declaradas en [sql-scripts/db_structure.sql](sql-scripts/db_structure.sql) cubren estas relaciones:

1. `ual.id_facultad -> facultad.id_facultad`
2. `laboratorista.id_facultad -> facultad.id_facultad`
3. `laboratorista.id_ual -> ual.id_ual`
4. `coordinador_laboratorio.id_facultad -> facultad.id_facultad`
5. `coordinador_facultad.documento -> coordinador_laboratorio.documento`
6. `coordinador_facultad.id_facultad -> facultad.id_facultad`
7. `laboratorista_ual.documento -> laboratorista.documento`
8. `laboratorista_ual.id_ual -> ual.id_ual`

## Tablas Sin Relaciones Declaradas

En la base local actual, estas tablas no tienen FK entrantes ni salientes:

- `auth`
- `usuario`
- `estudiante`
- `docente`
- `logs`
- `multas`
- `schema_migrations`

Esto no significa automáticamente que todas estén mal modeladas.

### Aislamiento aceptable o esperable

1. `schema_migrations`
   Se espera que quede aislada.
2. `logs`
   Puede admitir desacoplamiento parcial si se quiere preservar trazabilidad incluso cuando una entidad operativa sea eliminada.

### Aislamiento que sí representa deuda técnica

1. `multas`
   Contiene referencias de negocio a personas y UAL, pero sin integridad referencial.
2. `auth`
   Es una tabla central del sistema y hoy depende de convenciones de aplicación, no de restricciones de base.
3. `usuario`, `estudiante` y `docente`
   Representan identidad académica y operativa, pero no están conectadas de manera explícita con `auth` ni con las entidades de sanciones.

## Hallazgos Sobre Redundancia

### 1. Redundancia en coordinadores

`coordinador_laboratorio` tiene una columna `id_facultad`, pero también existe la tabla `coordinador_facultad` para representar la relación entre coordinador y facultad.

Esto genera dos fuentes potenciales de verdad:

- Relación directa en `coordinador_laboratorio.id_facultad`
- Relación múltiple en `coordinador_facultad`

En la base local actual ambas coinciden, pero el diseño es redundante. Si el sistema soporta múltiples facultades por coordinador, entonces la fuente de verdad debe ser `coordinador_facultad` y `id_facultad` debería quedar como dato derivado temporal o eliminarse.

### 2. Redundancia en laboratoristas

`laboratorista` conserva `id_ual` e `id_facultad`, pero el sistema ya tiene `laboratorista_ual` para asignación a uno o varios laboratorios.

Eso produce dos niveles de representación:

- Asignación simple embebida en `laboratorista`
- Asignación relacional en `laboratorista_ual`

Si el negocio ya permite múltiples UAL por laboratorista, la fuente de verdad debe ser `laboratorista_ual`. En ese escenario, `laboratorista.id_ual` sobra como dato permanente, y `laboratorista.id_facultad` también puede inferirse desde la UAL si todas las UAL asignadas pertenecen a una misma facultad.

### 3. Redundancia e inconsistencia en identidad autenticable

El modelo actual usa `auth.documento` como identificador de la cuenta, pero no siempre representa el mismo concepto:

- En `usuario`, `auth.documento` coincide con el documento.
- En `laboratorista`, la cuenta en `auth` se relaciona con `n_usuario`.
- En `coordinador_laboratorio`, la cuenta en `auth` se relaciona con `nombre_u`.

Esto obliga al código a usar reglas condicionales y `COALESCE`, por ejemplo en flujos de correo y recuperación de contraseña.

En otras palabras, `auth.documento` no es realmente siempre un documento. A veces es documento y a veces es username. Ese es un síntoma clásico de modelo desalineado.

### 4. Auditoría con tipo de dato inconsistente

`logs.documento` está definido como `NUMERIC(16,0)`, pero el sistema maneja documentos y nombres de usuario como `VARCHAR(50)`.

Ese desacople ya causó un error real: una acción podía ejecutar el cambio de negocio y luego fallar al insertar la auditoría cuando el actor autenticado tenía un identificador alfanumérico.

## Hallazgos Sobre Relaciones Débiles u Orfandad

## Base local inspeccionada

Conteos observados:

- `auth`: 110
- `usuario`: 100
- `facultad`: 9
- `ual`: 345
- `multas`: 37
- `coordinador_laboratorio`: 8
- `coordinador_facultad`: 8
- `laboratorista`: 0
- `laboratorista_ual`: 0
- `estudiante`: 0
- `docente`: 0
- `logs`: 0

### Relaciones con FK efectivas

En la base local, las relaciones que hoy sí tienen FK no mostraron huérfanos efectivos.

### Tabla `multas`

`multas` concentra la mayor parte de la deuda estructural.

Problemas detectados:

1. `ual` se guarda como texto, no como `id_ual`.
2. `cod_multado` no está ligado por FK a una entidad académica consolidada.
3. `n_usuario` parece representar al actor que registra la multa, pero tampoco tiene FK.

Hallazgos en la base local:

1. Hay 6 valores en `multas.ual` que no empatan con `ual.nombre`, incluyendo diferencias de codificación como `Astron¢mico` frente a `Astronómico`.
2. Los 37 registros de `multas.cod_multado` no encuentran correspondencia en `estudiante.codigo`, porque la tabla `estudiante` está vacía en la base local.
3. `multas.n_usuario` sí coincide con valores existentes de usuario en el seed local, pero esa validez depende del dato, no del modelo.

Conclusión: `multas` funciona hoy por convención de aplicación, no por integridad relacional.

## Diagnóstico Por Tabla

### `auth`

Estado actual:

- Tabla central de autenticación.
- No tiene FK.
- Usa `documento` como PK, pero ese campo no siempre representa documento real.

Problema:

- Mezcla identidad de login con identidad civil o académica.

Objetivo recomendado:

- Separar el identificador de cuenta del identificador de persona.
- A nivel mínimo, renombrar semánticamente el campo o introducir un `username` explícito.
- A nivel ideal, usar una tabla de cuenta con PK propia y relaciones 1:1 o 1:N hacia perfiles de dominio.

### `usuario`

Estado actual:

- Funciona como perfil académico de estudiante o docente para buena parte de los flujos.
- Está 1:1 con `auth` para estudiantes en la base local.

Problema:

- Convive con `estudiante` y `docente`, lo que difumina cuál tabla es la fuente oficial del sujeto académico.

Objetivo recomendado:

- Definir si `usuario` será la entidad académica canónica o si `estudiante` y `docente` deben absorber ese rol.
- Si `usuario` sigue siendo la fuente principal para estudiantes/docentes autenticados, `estudiante` y `docente` deberían tratarse como snapshots externos o eliminarse como tablas transaccionales.

### `estudiante` y `docente`

Estado actual:

- No tienen FK.
- Están vacías en la base local.

Problema:

- No es claro si son catálogos importados, snapshots temporales o entidades vivas del dominio.

Objetivo recomendado:

- Definir explícitamente su rol.
- Si son snapshots de integración externa, su aislamiento puede ser válido, pero deben documentarse como tal.
- Si se quieren usar como entidades de negocio, necesitan relación fuerte con el resto del modelo.

### `laboratorista`

Estado actual:

- Tiene identidad propia (`documento`) y también un identificador autenticable (`n_usuario`).
- Guarda `id_ual` e `id_facultad` además de existir `laboratorista_ual`.

Problema:

- Mezcla perfil, cuenta y asignación operativa.

Objetivo recomendado:

- Mantener en `laboratorista` solo datos del perfil.
- Dejar las asignaciones a laboratorios exclusivamente en `laboratorista_ual`.
- Derivar facultad desde `ual` o desde una tabla de relación si el negocio lo requiere.

### `coordinador_laboratorio`

Estado actual:

- Tiene identidad propia (`documento`) y también un identificador autenticable (`nombre_u`).
- Guarda `id_facultad` además de existir `coordinador_facultad`.

Problema:

- Igual que en laboratorista, mezcla perfil, cuenta y asignación.

Objetivo recomendado:

- Mantener en `coordinador_laboratorio` solo datos del perfil del coordinador.
- Representar facultades únicamente en `coordinador_facultad` si el negocio ya soporta múltiples asociaciones.

### `multas`

Estado actual:

- Es una tabla transaccional crítica.
- No tiene FKs.
- Usa texto libre para parte del vínculo con UAL.

Problema:

- Es la principal fuente de riesgo de datos huérfanos, diferencias de codificación, y consultas ambiguas.

Objetivo recomendado:

- Sustituir `ual` por `id_ual`.
- Relacionar el actor que registra la multa con un identificador consistente de cuenta o persona.
- Relacionar la persona sancionada con una entidad académica consistente.
- Mantener campos denormalizados de auditoría solo como snapshot opcional, no como clave de navegación.

### `logs`

Estado actual:

- Tabla de auditoría.
- Sin FK.
- `documento` numérico.

Problema:

- El tipo del actor no refleja la realidad actual del sistema.

Objetivo recomendado:

- Cambiar `documento` a `VARCHAR(50)` o separar `actor_identifier` y `actor_documento`.
- Mantener la tabla sin FK si se prioriza durabilidad de auditoría, pero con tipos correctos.

## Relación Objetivo Recomendada

La propuesta objetivo no tiene que implementarse de una sola vez, pero sí conviene tomarla como dirección arquitectónica.

### Núcleo de identidad

1. Una entidad de persona o perfil base con documento textual.
2. Una entidad de cuenta (`auth`) separada del concepto de documento.
3. Una relación clara entre cuenta y perfil humano.

En términos prácticos, eso significa dejar de usar el mismo campo para estas dos cosas:

- Documento legal o académico.
- Username o identificador de login.

### Asignaciones operativas

1. `facultad` como catálogo maestro.
2. `ual` como hijo de `facultad`.
3. `coordinador_facultad` como única fuente de verdad para coordinadores.
4. `laboratorista_ual` como única fuente de verdad para laboratoristas.

### Operación y sanciones

1. `multas.id_ual -> ual.id_ual`
2. Referencia consistente al actor que registra la multa.
3. Referencia consistente al sujeto sancionado.

Si el sistema debe sancionar tanto estudiantes como docentes, la opción más limpia no es seguir con campos ambiguos, sino unificar el sujeto sancionable mediante una entidad académica común o una capa explícita de tipado.

## Modelo Objetivo En Términos Prácticos

Sin fijar todavía nombres definitivos, la dirección recomendada es esta:

1. `auth`
   Debe representar cuenta, no documento.
2. `usuario` o `persona`
   Debe representar identidad de la persona.
3. `coordinador_facultad`
   Debe ser la relación autoritativa coordinador-facultad.
4. `laboratorista_ual`
   Debe ser la relación autoritativa laboratorista-UAL.
5. `multas`
   Debe depender de claves foráneas reales, no de nombres de UAL ni usernames en texto.

## Orden Recomendado De Normalización

No conviene intentar una migración total en un solo paso. El orden recomendado es este:

### Fase 1. Corregir inconsistencias de bajo riesgo

1. Cambiar `logs.documento` a `VARCHAR(50)`.
2. Corregir codificación y catálogos base que hoy impiden empates exactos por texto.
3. Documentar cuáles tablas son snapshots externos y cuáles son entidades de negocio.

### Fase 2. Consolidar relaciones duplicadas

1. Declarar `coordinador_facultad` como fuente de verdad.
2. Declarar `laboratorista_ual` como fuente de verdad.
3. Backfill y validaciones para que las columnas duplicadas queden solo como legado temporal.

### Fase 3. Reestructurar identidad

1. Separar username de documento en autenticación.
2. Formalizar la relación entre cuenta y perfil humano.

### Fase 4. Normalizar `multas`

1. Introducir `id_ual`.
2. Introducir referencias consistentes a actor y sujeto.
3. Dejar texto descriptivo solo como snapshot de auditoría.

## Riesgos De Implementación

1. Muchas rutas hoy dependen de joins implícitos y convenciones de aplicación, sobre todo en recuperación de contraseña, correos y gestión de roles.
2. Normalizar sin pruebas primero puede romper login, flujos de sanción y generación de certificados.
3. La base local no representa todo el volumen ni todas las variantes de producción, así que antes de imponer nuevas FK conviene correr diagnósticos equivalentes sobre el ambiente de pruebas o una copia controlada.

## Recomendación Final

La primera deuda estructural a ejecutar no debería ser una reescritura completa del esquema, sino una combinación de dos pasos:

1. Crear una red mínima de pruebas automatizadas sobre autenticación, recuperación, correo y permisos.
2. Empezar la normalización por `logs`, relaciones duplicadas y `multas`.

En términos de impacto y retorno técnico, el orden sugerido es:

1. Tipos e identidad de auditoría.
2. Relaciones duplicadas de coordinador y laboratorista.
3. Normalización de `multas`.
4. Rediseño formal de identidad entre cuenta y persona.

Ese orden permite mejorar integridad y mantenibilidad sin bloquear el sistema en una migración demasiado grande.
