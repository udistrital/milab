# Submódulo Encuentros

Encuentros forma parte de Certificación y reutiliza la sesión, roles, correo y tabla `log` existentes en MiLab.

## Instalación controlada

1. Aplicar `sql-scripts/db_structure_certificacion.sql` primero en un ambiente de pruebas y validar las tablas, claves foráneas e índices creados.
2. Aplicar `sql-scripts/db_seed_certificacion.sql` para registrar los accesos de menú y permisos iniciales.
3. Usar el procedimiento institucional de migraciones y aprobación para promover ambos scripts. No ejecutarlos directamente en producción sin revisión y respaldo de DBA.
4. Configurar el almacenamiento de archivos descrito abajo antes de habilitar cargas y generación de certificados.

Los scripts son idempotentes para las tablas, índices y accesos de Encuentros. No crean cuentas de MiLab a partir de participantes importados.

## Archivos y configuración de correo

`ENCUENTROS_STORAGE_DIR` es opcional. Si no se define, MiLab guarda los archivos en `private/encuentros` bajo el directorio de trabajo. En despliegues con contenedores, configurar esta variable a un volumen persistente, privado y con permisos de lectura/escritura para el proceso de Node.js. No publicar este directorio como contenido estático.

Las URL del QR se generan con `APP_BASE_URL` y la ruta pública `/encuentros/verificar/:token`. Enviar certificados usa el transportador institucional configurado mediante las variables de correo existentes (`EMAIL_USER`, `EMAIL_PASSWORD` y `EMAIL_HOST` o `EMAIL_SERVICE`). Las pruebas unitarias no envían correo.

## Plantillas de certificados

El archivo PDF cargado se conserva sin modificaciones. La configuración JSON del evento ubica texto y QR por página, con coordenadas en puntos PDF desde la esquina inferior izquierda. El eje `x` aumenta hacia la derecha y el eje `y` hacia arriba. `align` puede ser `left`, `center` o `right`; el QR usa `type: "qr"` y un ancho en puntos.

Ejemplo:

```json
{
  "nombre": { "x": 420, "y": 280, "fontSize": 24, "align": "center" },
  "evento": { "x": 420, "y": 235, "fontSize": 16, "align": "center" },
  "qr_verificacion": { "x": 690, "y": 35, "width": 70, "type": "qr" }
}
```

El QR `qr_verificacion` es obligatorio y solo sirve para verificación pública. La asistencia se registra manualmente por documento. Si una plantilla cambia, se debe actualizar la configuración y previsualizar con un evento de pruebas antes de emitir certificados. Cada certificado guarda su propia versión, sus datos de emisión y el archivo generado.

## Participantes Excel

Descargar la plantilla desde el detalle del evento y conservar estos encabezados:

`Nombre completo`, `Número de documento`, `Correo electrónico`, `Facultad`, `Laboratorio`

La columna del documento usa formato de texto. Los documentos ingresados como número se rechazan para evitar perder ceros iniciales. La importación admite hasta 2000 filas por archivo y requiere confirmar la vista previa.

## Validación

Ejecutar pruebas focalizadas con:

```sh
node --test tests/unit/libs/encuentros.test.js tests/unit/routes/encuentros.test.js
```

También se recomienda ejecutar `npm test` y `npm run db:audit:check` antes de promover cambios de aplicación o esquema.
