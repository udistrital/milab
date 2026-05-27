# Flujos Criticos (Secuencia / Actividad)

## Login Con Microsoft Entra

```mermaid
sequenceDiagram
  actor Usuario
  participant Web as MILab Web
  participant Entra as Microsoft Entra
  participant DB as PostgreSQL

  Usuario->>Web: GET /milab/auth/login
  Web-->>Usuario: 302 /milab/auth/microsoft
  Usuario->>Entra: OAuth2 autorización
  Entra-->>Usuario: redirect /milab/auth/microsoft/callback?code=...
  Usuario->>Web: GET /milab/auth/microsoft/callback
  Web->>DB: SELECT usuario por correo
  DB-->>Web: usuario + roles
  Web-->>Usuario: 302 /milab/inicio
```

## Generación De Certificado (Estudiante / Docente)

```mermaid
sequenceDiagram
  actor Usuario
  participant Web as MILab API
  participant OAS as Servicios OAS
  participant DB as PostgreSQL
  participant FS as Almacén local
  participant SMTP as SMTP

  Usuario->>Web: POST /milab/api/get-data* o /generate_cert_*
  Web->>OAS: Consulta estado académico
  OAS-->>Web: Datos de persona
  Web->>DB: Consultar sanciones activas
  DB-->>Web: ¿Tiene sanciones?
  alt Sin sanciones activas
    Web->>FS: Generar QR + PDF
    Web->>SMTP: Enviar correo con PDF
    Web-->>Usuario: message_success
  else Con sanciones activas
    Web-->>Usuario: alerta de sanciones
  end
```

## Flujo De Sanción (Registro Y Aprobación)

```mermaid
sequenceDiagram
  actor Laboratorista
  actor Coordinador
  participant Web as MILab API
  participant DB as PostgreSQL

  Laboratorista->>Web: POST /milab/api/submit o /submit_docente
  Web->>Web: Validar fecha y body parseado
  Web->>DB: INSERT multa
  DB-->>Web: OK
  Web-->>Laboratorista: message_success

  Coordinador->>Web: POST /milab/api/aprobacion_multa/activar
  Web->>DB: UPDATE multa a ACTIVA
  DB-->>Web: OK
  Web-->>Coordinador: respuesta OK

  Coordinador->>Web: POST /milab/api/aprobacion_multa/saldar
  Web->>DB: UPDATE multa a SALDADA
  DB-->>Web: OK
  Web-->>Coordinador: respuesta OK
```

## Monitoreo Por Rol

```mermaid
sequenceDiagram
  actor Usuario
  participant Web as MILab API
  participant DB as PostgreSQL

  Usuario->>Web: GET /milab/api/dashboard?filtro=mes&grafico=sanciones
  Web->>Web: Resolver rol primario

  alt Rol admin
    Web->>DB: Consultas globales de certificados, sanciones y usuarios
  else Rol coordinador
    Web->>DB: Resolver facultades en coordinador_facultad
    Web->>DB: Filtrar datos por facultades asignadas
  else Rol laboratorista
    Web->>DB: Resolver UAL en laboratorista_ual
    Web->>DB: Filtrar datos por UAL asignadas
  end

  DB-->>Web: Series e indicadores permitidos por rol
  Web-->>Usuario: Render home/dashboard
```

## Banner De Ambiente No Productivo

```mermaid
sequenceDiagram
  actor Usuario
  participant Web as Express / EJS

  Usuario->>Web: GET cualquier vista pública o autenticada
  Web->>Web: Leer NODE_ENV
  Web->>Web: Exponer environmentName e isNonProductionEnvironment en res.locals
  alt NODE_ENV != production
    Web-->>Usuario: Renderiza environment-banner.ejs
  else NODE_ENV == production
    Web-->>Usuario: No renderiza banner
  end
```
