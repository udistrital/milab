# C4 - Contexto

## Proposito

Vista de contexto del sistema MiLab y sus actores externos.

## Diagrama (Mermaid)

```mermaid
flowchart LR
  user[Usuarios finales\n(estudiante, docente, laboratorista, coordinador, admin)]
  web[MiLab\nSistema de informacion]
  oas[Servicios OAS\n(UD Distrital)]
  entra[Microsoft Entra ID\nAutenticacion]
  recaptcha[Google reCAPTCHA]
  smtp[Servicio SMTP\n(Outlook)]

  user -->|Navegador| web
  web -->|Consulta estado academico| oas
  web -->|Login OAuth2| entra
  web -->|Validacion anti-bot| recaptcha
  web -->|Envio de correo| smtp
```
