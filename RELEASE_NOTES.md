# Release Notes

## 3.2.0 - 2026-10-27

1. La consulta masiva de sanciones procesa hasta 50 documentos o códigos con progreso visible; las multas ajenas al catálogo de laboratorio no se tipifican como sanciones y los administradores pueden consultar otras multas SGA.
2. Se amplía la gestión de gestores de laboratorio con acciones de enrolamiento y edición, alcance universitario sin UAL e impersonación de cuentas con ese rol.
3. El tour guiado incorpora módulos de inventarios, hojas de vida, capacitación, encuentros y configuración, con recorridos y progreso en español.
4. El navegador administrativo del esquema de base de datos queda limitado a `milab`.

## 3.1.10 - 2026-10-24

1. El dashboard conserva sus secciones disponibles y muestra advertencias cuando fallan consultas opcionales de alcance, filtros o Paz y Salvos.
2. El rol `gestor_laboratorio` puede consultar el dashboard global en modo de solo lectura, igual que `coordinador_general`.

## 3.1.0 - 2026-10-24

1. La verificación de sanciones SGA consulta los códigos académicos asociados al documento, clasifica las multas de laboratorio por el nombre del concepto y distingue resultados completos de consultas parciales o no verificables.
2. El informe de consulta masiva incorpora resumen visual, barras por estado, detalle de sanciones y el listado completo de participantes, con identidad visual institucional.

## Hotfix 2026-10-15 - Registro en prueba académica

Se permite que estudiantes con estado `B` (prueba académica y activo) completen
la validación de registro e ingresen a MILab. Los estados no habilitados, como
egresado e inactivo, continúan bloqueados.

## 2.7.0 - 2026-09-16

Resumen rápido:

1. La sesión expirada abierta directamente en el navegador sobre rutas `/milab/api/...` ahora redirige a la pantalla de login con la plantilla de MiLab, en vez de mostrar el JSON en blanco. Las llamadas AJAX/fetch conservan la respuesta JSON `SESSION_EXPIRED`.
2. `/api/check-services` vuelve a ser público para permitir monitoreo externo del estado de los servicios académicos (OATI).
3. El dashboard de monitoreo separa "Certificados emitidos" de las nuevas tablas de "Estudiantes" y "Docentes registrados" (estado de cuenta, código y programa).
4. Base de datos para el módulo de Capacitación y Certificación (`cursos`, `curso_laboratorio`, `equipo_especializado`) y pipeline de despliegue actualizado para aplicarla solo desde la rama `modulo_capacitacion_certificacion`.

## Prestamos 2.0.0 - 2026-08-09

Notas completas del release:

- [docs/release-notes-prestamos-2.0.md](docs/release-notes-prestamos-2.0.md)

Resumen rapido:

1. Consolidacion funcional del modulo de prestamos (solicitudes, incidencias, practicas, reportes y parametrizacion).
2. Mejoras de estabilidad y calidad con pipeline completo en verde.
3. Hardening del flujo de recreacion de base de datos en CI y despliegue de pruebas.
