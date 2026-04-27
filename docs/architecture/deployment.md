# Despliegue

## Proposito

Vista de despliegue con Docker Compose y dependencias externas.

## Diagrama (Mermaid)

```mermaid
flowchart TB
  user[Usuarios] --> lb[DNS / HTTP(S)]

  subgraph DockerHost[Host Docker]
    app[Contenedor milabud\nNode.js + Express]
    db[(Contenedor dbpostgres\nPostgreSQL)]
    vol[(Volumen DB)]
    app --> db
    db --> vol
  end

  app --> oas[Servicios OAS]
  app --> entra[Microsoft Entra]
  app --> recaptcha[Google reCAPTCHA]
  app --> smtp[SMTP Outlook]
```
