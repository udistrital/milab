# C4 - Contexto

## Proposito

Vista de contexto del sistema MILab, sus usuarios y servicios externos institucionales/terceros.

## Diagrama (Mermaid)

```mermaid
flowchart LR
  users[Usuarios MiLab\n(estudiante, docente, laboratorista, coordinador, admin)]
  guest[Invitado\n(consulta publica)]
  milab[MILab\nSistema de informacion]

  entra[Microsoft Entra ID\nOAuth2 login]
  oati[Bus OATI UD\nOAuth2 client credentials]
  oasLegacy[Servicios academicos OAS/WSO2\nconsultas legacy]
  recaptcha[Google reCAPTCHA]
  smtp[SMTP Outlook / Office 365]

  users -->|Navegador web| milab
  guest -->|Consulta publica| milab

  milab -->|Autenticacion institucional| entra
  milab -->|Consulta datos academicos (token OAuth2)| oati
  milab -->|Consulta datos academicos legacy| oasLegacy
  milab -->|Validacion anti-bot en formularios publicos| recaptcha
  milab -->|Envio de correos transaccionales| smtp
```
