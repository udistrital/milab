# Despliegue

## Proposito

Vista de despliegue de MILab con Docker Compose, dependencias externas y comportamiento operativo de los ambientes locales y de pruebas.

## Diagrama (Mermaid)

```mermaid
flowchart TB
  user[Usuarios] --> lb[DNS / HTTP(S)]

  subgraph DockerHost[Host Docker]
    app[Contenedor milabud\nNode.js + Express]
    db[(Contenedor dbpostgres\nPostgreSQL)]
    seed[Contenedor dbseed\nSeed / migración]
    vol[(Volumen DB)]
    app --> db
    seed --> db
    db --> vol
  end

  app --> oas[Servicios OAS]
  app --> entra[Microsoft Entra]
  app --> recaptcha[Google reCAPTCHA]
  app --> smtp[SMTP Outlook]
```

## Topología Actual

### Aplicación

- `milabud`: contenedor Node.js + Express.
- Expone vistas EJS, rutas web y API.
- Genera enlaces absolutos con `APP_BASE_URL` cuando está definido.

### Base de datos

- `dbpostgres`: contenedor PostgreSQL.
- Usa volumen persistente para datos.
- El esquema canónico y el seed viven en `sql-scripts/`.

### Seed / inicialización

- `dbseed`: contenedor o paso de seed utilizado para inicialización o sincronización estructural según el ambiente.

## Ambientes Relevantes

### Local

- Compose principal de trabajo: `Docker/docker-compose.local.yml`.
- Se usa para reconstrucción rápida del stack y validación funcional local.

### Pruebas

- El despliegue de pruebas está automatizado en `.github/workflows/ci.yml`.
- Solo despliega automáticamente desde las ramas:
  - `prestamos`
  - `normalizacion_bd`
- El workflow ejecuta:
  1. checkout,
  2. `npm ci`,
  3. validaciones de formato, lint y audit,
  4. pruebas unitarias,
  5. copia de código al host,
  6. copia de `/opt/.env` a `/opt/milab/Docker/.env`,
  7. `docker compose up -d --build --force-recreate dbpostgres milabud`.

## Variables Y Comportamiento De Entorno

### APP_BASE_URL

- Se usa para construir enlaces absolutos en correos y flujos de recuperación o registro.
- Si no existe, la aplicación usa fallback según el ambiente.

### NODE_ENV

- Cuando `NODE_ENV !== 'production'`, la aplicación renderiza un banner visible de ambiente no productivo.
- Ese banner aparece tanto en páginas autenticadas como en varias vistas públicas y de autenticación.

## Dependencias Externas

- Microsoft Entra para autenticación institucional.
- Google reCAPTCHA para flujos públicos sensibles.
- SMTP Outlook para correo transaccional.
- OAS / servicios académicos para consultas externas.

## Consideraciones Operativas

1. El contenedor de aplicación depende de disponibilidad de la base y de la configuración del archivo `.env` inyectado en el host.
2. El entorno de pruebas debe considerarse no productivo; por eso el banner depende de `NODE_ENV`.
3. El despliegue por CI ya valida formato, lint, auditoría y pruebas unitarias antes de recrear contenedores.
4. Los errores de arranque por rutas o vistas corruptas se reflejan inmediatamente en los logs del contenedor `milabud`.
