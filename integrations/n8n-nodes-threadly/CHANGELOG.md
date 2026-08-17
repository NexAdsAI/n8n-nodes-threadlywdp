# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El paquete sigue [Versionado Semantico](https://semver.org/lang/es/).

## [No publicado]

## [0.1.1] - 2026-08-17

Primera version publicada **desde CI con procedencia** (npm Trusted Publishing
sobre OIDC de GitHub Actions). Sin cambios de codigo respecto de la 0.1.0: lo que
cambia es COMO se publica.

Por que importa: n8n exige procedencia para verificar un nodo comunitario. La
0.1.0 se publico a mano para poder existir -npm no deja configurar un publicador
de confianza para un paquete que aun no existe-, y esta es la primera que sale
firmada. Con esto se puede pedir la verificacion.

El token de larga vida del arranque queda invalidado: el paquete quedo en modo
"require 2FA and disallow bypass 2fa tokens", asi que publicar solo se puede
desde este workflow, en este repositorio.

## [0.1.0] - 2026-08-17

Primera version publica del nodo community de Threadly para n8n.

### Agregado

- **Nodo Threadly** (declarativo, con `usableAsTool` para agentes de IA), con
  once operaciones sobre la API publica v1:
  - Contacto: Crear, Buscar y Crear o actualizar (por documento, telefono,
    email o codigo).
  - Ticket: Obtener y Listar, con filtros por estado y canal.
  - Mensaje: Enviar sobre un ticket abierto, por el canal real del ticket.
  - Lead: Crear y Cambiar etapa.
  - Evento: Registrar eventos del core con datos libres para las plantillas.
  - Secuencia: Inscribir y Sacar.
- **Nodo Threadly Trigger**: recibe los webhooks salientes del tenant y verifica
  la firma HMAC-SHA256 de `X-PLCC-Signature` sobre el cuerpo crudo antes de
  ejecutar el flujo. Acepta las dos firmas que Threadly emite durante una
  rotacion de secreto, para que la rotacion no tumbe los flujos en produccion.
  Filtra por los dieciseis eventos suscribibles.
- **Credencial Threadly API** unica para ambos nodos (URL del tenant, API key y
  secreto del webhook), con prueba de conexion contra `GET /api/v1/contacts`.
- Paginacion automatica por cursor en Contacto > Buscar y Ticket > Listar.
- Publicacion automatizada en npm con procedencia (GitHub Actions + OIDC), que
  es lo que n8n exige desde el 1 de mayo de 2026 para verificar un nodo.

### Notas

- El paquete no tiene dependencias de ejecucion: solo usa lo que n8n ya trae.
  El workflow de publicacion lo comprueba y falla si alguna se cuela.
- La interfaz de los nodos esta en ingles porque las guias de verificacion de
  n8n lo exigen. Los valores de estado y etapa (`EN_COLA`, `RESUELTO`,
  `CONTACTADO`...) siguen en espanol: son los literales que la API guarda y
  devuelve, no texto de interfaz.
- El alta del webhook es manual en el panel de Threadly. La API key `plcc_` no
  puede crear webhooks, asi que el ciclo de vida del disparador (`checkExists`,
  `create`, `delete`) es deliberadamente inocuo: n8n no intenta crear nada ni
  borra lo que configuro una persona.

[No publicado]: https://github.com/NexAdsAI/n8n-nodes-threadlywdp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NexAdsAI/n8n-nodes-threadlywdp/releases/tag/v0.1.0
