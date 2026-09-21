# Release Notes

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
