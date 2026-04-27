# C4 - Contenedores

## Proposito

Vista de contenedores principales y dependencias.

## Diagrama (Mermaid)

```mermaid
flowchart LR
  browser[Cliente web\nNavegador]
  app[MiLab App\nNode.js + Express + EJS]
  db[(PostgreSQL)]
  storage[Almacen local\n(directorio privado de generacion)]
  oas[Servicios OAS\nUD Distrital]
  entra[Microsoft Entra ID\nOAuth2]
  recaptcha[Google reCAPTCHA]
  smtp[SMTP Outlook]

  browser -->|HTTPS| app
  app -->|SQL| db
  app -->|PDF/QR| storage
  app -->|HTTP| oas
  app -->|OAuth2| entra
  app -->|HTTP| recaptcha
  app -->|SMTP| smtp
```
