# n8n-nodes-threadly

Nodo comunitario de [n8n](https://n8n.io) para **[Threadly](https://threadlywdp.com)**,
la plataforma de contact center omnicanal con IA de Work Data Place.

El paquete vive en [`integrations/n8n-nodes-threadly/`](integrations/n8n-nodes-threadly/) —
ahí está el README con la instalación, la lista de operaciones y ejemplos de flujo.

## Qué trae

- **Threadly** — acciones sobre contactos, tickets, mensajes, leads, eventos y secuencias.
- **Threadly Trigger** — dispara un flujo con los webhooks de Threadly y **verifica la
  firma HMAC-SHA256** antes de emitir nada. Una firma que no valida no entra.

## Por qué este repositorio está separado

El producto vive en un repositorio privado. Este es público a propósito: publicar en npm
con *provenance* firma una atestación contra `GITHUB_REPOSITORY` y la escribe en el
registro público de Sigstore, así que el repositorio de origen tiene que ser público y
coincidir con el campo `repository` del `package.json`.

## Licencia

MIT. Es requisito de n8n para verificar un nodo comunitario, y aplica solo a este paquete.
