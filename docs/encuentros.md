# Submódulo Encuentros

Encuentros forma parte de Certificación y reutiliza la sesión, roles, correo y tabla `log` existentes en MiLab.

## Instalación controlada

1. Aplicar `sql-scripts/prod/db_structure_certificacion.sql` primero en un ambiente de pruebas y validar las tablas, claves foráneas e índices creados.
2. Aplicar `sql-scripts/prod/db_seed_certificacion.sql` para registrar los accesos de menú y permisos iniciales.
3. Usar el procedimiento institucional de migraciones y aprobación para promover ambos scripts. No ejecutarlos directamente en producción sin revisión y respaldo de DBA.
4. En bases existentes, confirmar el usuario PostgreSQL con el que se conecta la aplicación. Si es `milab_app`, aplicar [`sql/20261023_encuentros_app_permissions.sql`](../sql/20261023_encuentros_app_permissions.sql) con un DBA o propietario de los objetos.
5. Configurar el almacenamiento de archivos descrito abajo antes de habilitar cargas y generación de certificados.

Los scripts son idempotentes para las tablas, índices y accesos de Encuentros. No crean cuentas de MiLab a partir de participantes importados.

La migración `20261023_encuentros_app_permissions.sql` es transaccional e idempotente y concede permisos al rol PostgreSQL `milab_app`; solo sirve si ese es el usuario configurado en `DB_USER` o en el secreto de Secrets Manager. La migración anterior `20261021_encuentros_permissions.sql` toma como referencia el propietario y los privilegios directos de `milab.multa`, por lo que no garantiza permisos para un usuario de aplicación distinto. Estos `GRANT` de PostgreSQL tampoco asignan roles ni accesos de MiLab: para eso se requiere `db_seed_certificacion.sql` y que la cuenta tenga un rol de gestión de Encuentros.

## Archivos y configuración de correo

`ENCUENTROS_STORAGE_DIR` es opcional. Si no se define, MiLab guarda los archivos en `private/encuentros` bajo el directorio de trabajo. En despliegues con contenedores, montar almacenamiento persistente, privado y con permisos de lectura/escritura para el proceso de Node.js en `/usr/src/app/private/encuentros`; no publicar este directorio como contenido estático. En EC2 de pruebas se usa `/opt/milab-data/encuentros`, fuera del árbol `/opt/milab` que CI sincroniza con `rsync --delete`, y tanto CI como el script de reset configuran ese montaje.

Las URL del QR se generan con `APP_BASE_URL` y la ruta pública `/encuentros/verificar/:token`. Enviar certificados usa el transportador institucional configurado mediante las variables de correo existentes (`EMAIL_USER`, `EMAIL_PASSWORD` y `EMAIL_HOST` o `EMAIL_SERVICE`). Las pruebas unitarias no envían correo.

## Plantillas de certificados

Carga el PDF en el formulario de Encuentros. El editor muestra sus páginas y permite elegir un campo, hacer clic en un espacio libre para colocarlo y arrastrar su caja para moverlo. También puedes ajustar tamaño, alineación y color del texto. Para un PDF con varias páginas, navega hasta la página deseada antes de ubicar el campo. El QR se configura de la misma forma, indicando su esquina inferior izquierda y su tamaño.

El QR `qr_verificacion` es obligatorio y solo sirve para verificación pública. La asistencia se registra manualmente por documento. Quitar una caja elimina su ubicación del editor; no borra texto que ya forme parte del PDF original. El archivo cargado se conserva sin modificaciones: el certificado superpone los datos y el QR al PDF. Usa la vista previa del certificado con datos de ejemplo antes de guardar. Cada certificado guarda su propia versión, sus datos de emisión y el archivo generado.

## Participantes Excel

Descargar la plantilla desde el detalle del evento y conservar estos encabezados:

`Nombre completo`, `Número de documento`, `Correo electrónico`, `Cargo`, `Facultad`, `Unidad Académica de Laboratorio (UAL)`

Todos los campos son obligatorios. `Cargo` alimenta el campo `rol` del certificado; `Facultad` y `Unidad Académica de Laboratorio (UAL)` alimentan sus campos homónimos. La plantilla configura el documento como texto. Los documentos guardados como números enteros seguros se convierten a texto y generan una advertencia para revisar ceros iniciales; los valores no enteros o que exceden la precisión segura se rechazan. La importación admite hasta 2000 filas por archivo y requiere confirmar la vista previa.

## Registro por QR (ingreso y salida)

Cada evento tiene dos enlaces públicos, visibles en su detalle:

- `/encuentros/registro/ingreso/:eventoId` y `/encuentros/registro/salida/:eventoId`: formulario móvil que pide solo el número de documento. Al registrar, responde con el nombre del participante en mayúsculas y el resultado.
- `/encuentros/proyeccion/ingreso/:eventoId` y `/encuentros/proyeccion/salida/:eventoId`: página de MiLab con el QR centrado para proyectar a los asistentes. Apunta al enlace de registro correspondiente.

Reglas:

- Los enlaces solo registran mientras el evento está `en_curso`.
- Ingreso: registra la entrada una sola vez. Si ya estaba registrada, responde que la asistencia ya fue registrada.
- Salida: requiere una entrada previa y registra `salida_en` una sola vez.
- Documentos no inscritos responden que no fueron encontrados y piden acercarse con los organizadores.
- Cada registro público queda en `log` con nombre `Registro público QR` y acción `Encuentros: entrada registrada por QR` o `Encuentros: salida registrada por QR`.
- Los endpoints públicos tienen un límite de 120 solicitudes por minuto por IP.

**Riesgo aceptado:** el enlace usa el identificador numérico del evento, sin token. Los identificadores son secuenciales, por lo que cualquier persona que adivine un enlace y conozca un documento inscrito puede registrar ingreso o salida. Si se requiere mayor protección, usar un token aleatorio por evento.

## Cierre del evento y envío de certificados

Al finalizar un evento, puedes elegir entre enviar de inmediato los certificados pendientes a todas las participaciones completadas o hacerlo manualmente desde el detalle. En el modo manual, selecciona los asistentes que recibirán certificado y marca si deseas enviarles el correo. Los certificados generados sin correo quedan disponibles para descarga y su medalla se enlaza cuando el documento coincide con una cuenta MiLab activa.

El informe PDF reúne en su primera página las estadísticas y el resumen de participantes por facultad. Desde el detalle también puedes descargar un Excel con los datos de participantes, documento, correo, cargo, facultad, UAL, entrada, salida, estado de participación, código y estado del certificado, fechas de emisión/envío y estado de la medalla.

## Eventos históricos

Al crear un evento que ya se realizó, marca **El evento ya se realizó**. El sistema valida que su fecha y hora de finalización ya hayan pasado en `America/Bogota`. El evento quedará finalizado y su detalle permitirá descargar la plantilla de participaciones históricas. Completa las seis columnas de participante y añade `Entrada (ISO 8601)` y `Salida (ISO 8601)`; las fechas deben incluir zona horaria, por ejemplo `2026-10-20T09:00:00-05:00`. La salida no puede existir sin entrada ni ser anterior a ella.

Previsualiza el archivo antes de importarlo. Después puedes elegir si se envían correos a quienes tengan entrada y salida. Los certificados se generan para esas participaciones completadas; participantes sin ambas marcas se importan, pero no reciben certificado en ese proceso.

## Validación

Ejecutar pruebas focalizadas con:

```sh
node --test tests/unit/libs/encuentros.test.js tests/unit/routes/encuentros.test.js
```

También se recomienda ejecutar `npm test` y `npm run db:audit:check` antes de promover cambios de aplicación o esquema.
