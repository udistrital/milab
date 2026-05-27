# C4 - Contenedores

## Proposito

Vista de contenedores principales de MILab, su persistencia y dependencias externas.

## Diagrama (Mermaid)

```mermaid
flowchart LR
  browser[Cliente web\nNavegador]

  subgraph dockerHost[Host Docker Compose]
    app[Contenedor milabud\nNode.js + Express + EJS]
    db[(Contenedor dbpostgres\nPostgreSQL)]
    dbInit[Init DB\nSQL en docker-entrypoint-initdb.d]
    storage[(Volumen local\nDB + archivos generados)]
  end

  entra[Microsoft Entra ID\nOAuth2 login]
  oati[Bus OATI UD\nOAuth2 client credentials]
  oasLegacy[Servicios academicos OAS/WSO2\nconsultas legacy]
  recaptcha[Google reCAPTCHA]
  smtp[SMTP Outlook / Office 365]

  browser -->|HTTP(S) / Browser| app
  app -->|SQL| db
  dbInit -->|Carga estructura y seed| db
  db -->|Persistencia| storage
  app -->|PDF/QR y artefactos| storage

  app -->|Autenticacion institucional| entra
  app -->|Consulta academica con token OAuth2| oati
  app -->|Consulta academica legacy| oasLegacy
  app -->|Validacion anti-bot| recaptcha
  app -->|Correo transaccional| smtp
```
