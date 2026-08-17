# n8n-nodes-threadlywdp

Community nodes for [n8n](https://n8n.io) that talk to [Threadly](https://threadlywdp.com), the AI omnichannel contact center platform by Work Data Place.

The package ships two nodes:

| Node | What it does |
| --- | --- |
| **Threadly** | Runs actions against the public v1 API: contacts, tickets, messages, leads, core events and sequences. |
| **Threadly Trigger** | Starts a workflow when Threadly emits a webhook (new message, ticket resolved, stage changed...), verifying the HMAC signature before letting it through. |

Both share a single credential.

---

## Requirements

- n8n 1.60 or newer (self-hosted, or n8n Cloud with community nodes enabled).
- Node.js 20.15 or newer.
- A Threadly tenant and access to **Connections > Integrations**.

The package has no runtime dependencies: it only uses what n8n already ships.

---

## Installation

### From the n8n UI (recommended)

1. **Settings > Community nodes > Install a community node**.
2. Package name: `n8n-nodes-threadlywdp`.
3. Accept the risks and install. n8n restarts on its own.

### From the command line

```bash
cd ~/.n8n
npm install n8n-nodes-threadlywdp
```

Restart n8n after installing.

### With Docker

```bash
docker run -it --rm \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -e N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true \
  docker.n8n.io/n8nio/n8n
```

Then install from the UI. The environment variable above is only needed if you plan to use the Threadly node as a tool for an AI agent.

---

## Credentials

A single credential, **Threadly API**, with three fields:

| Field | Where to get it | Required |
| --- | --- | --- |
| **Tenant URL** | The same domain you use to sign in to the app: `https://mycompany.threadlywdp.com`. No trailing slash. | Yes |
| **API Key** | **Connections > Integrations > API Keys**. Starts with `plcc_` and is shown only once. | Yes |
| **Webhook Secret** | **Connections > Integrations > Webhooks**, when you create the webhook. Only the trigger node uses it. | Trigger only |

### API key scopes

The key carries its own tenant and permissions. Tick only the ones you need:

| Scope | Enables |
| --- | --- |
| `contacts:read` | Contact > Search |
| `contacts:write` | Contact > Create, Contact > Create or Update |
| `tickets:read` | Ticket > Get, Ticket > List |
| `messages:write` | Message > Send |
| `leads:write` | Lead > Create, Lead > Change Stage |
| `events:write` | Event > Register, **Sequence > Exit** |
| `sequences:write` | Sequence > Enroll |

Watch the second to last one: **taking somebody out of their sequences requires `events:write`, not `sequences:write`**. It is modelled as "the core system reports that the customer paid", not as a sequence operation. A key that only holds `sequences:write` can enroll but cannot exit.

### About the "Test" button

The credential test issues `GET /api/v1/contacts?limit=1`, which requires `contacts:read`. A valid key without that scope turns red with a message explaining it: the key still works for everything else. The API exposes no scope-free, side-effect-free endpoint to test against.

---

## Threadly node

Every operation is declarative (routing), so n8n handles retries, pagination and errors on its own.

| Resource | Operation | Endpoint | Returns |
| --- | --- | --- | --- |
| Contact | Create | `POST /api/v1/contacts` | The created contact |
| Contact | Search | `GET /api/v1/contacts` | List of contacts (paginated) |
| Contact | Create or Update | `POST /api/v1/contacts/upsert` | `{ data, created }` — `created` tells whether it was new |
| Ticket | Get | `GET /api/v1/tickets/{id}` | Ticket + contact + message thread |
| Ticket | List | `GET /api/v1/tickets` | List of tickets (paginated) |
| Message | Send | `POST /api/v1/messages` | The sent message |
| Lead | Create | `POST /api/v1/leads` | `{ ticketId, ticketNumber, contactId, contactCreated }` |
| Lead | Change Stage | `PATCH /api/v1/leads/{id}/stage` | `{ id, status, disposition }` |
| Event | Register | `POST /api/v1/events` | `{ enrolled, contactId, sequenceId }` |
| Sequence | Enroll | `POST /api/v1/sequences/{id}/enroll` | `{ runId }` |
| Sequence | Exit | `POST /api/v1/sequences/exit` | `{ matchedContacts, stoppedRuns }` |

Contact fields returned by the API: `id`, `code`, `firstName`, `lastName`, `phone`, `email`, `company`, `documentType`, `documentNumber`, `birthDate` (yyyy-mm-dd) and `createdAt`.

Ticket fields: `id`, `number`, `status`, `priority`, `channelType`, `subject`, `contactId`, `queueId`, `assignedToId`, `typifGroup`, `typifResult`, `csatScore`, `createdAt`, `lastMessageAt` and `resolvedAt`.

Status and stage values stay in Spanish (`EN_COLA`, `RESUELTO`, `CONTACTADO`...) because they are the literal values the API stores and returns. The node labels them in English in the UI but sends the original value.

### Details that save you an afternoon of debugging

- **Create or Update** only touches the fields you add under *Fields to Update*. A field added and left empty **clears** the stored value; a field you do not add is left intact.
- The upsert match key never matches a merge tombstone. If that key only exists on an already merged contact, a new one is created.
- **Message > Send** goes out through the real channel of the ticket, as if an agent had written it. On a resolved ticket it returns `409`: reopen it first.
- **Lead > Create** requires phone **or** email. With neither there is no way to identify the lead and it returns `400`.
- **Event > Register** fails with `422` if the tenant has no rule configured for that event type; the error lists the ones that are configured. They are set up under **Flows > Sequences > Core events**.
- **Sequence > Enroll** does not duplicate: if the contact already has an active run of that same sequence, it returns `409` instead of sending anything twice.
- The API key carries its own per-minute rate limit. Once exceeded, the API answers `429` with `Retry-After`.

---

## Threadly Trigger node

### Setup (manual on purpose)

Threadly webhook administration runs on a user session, not on an API key: a `plcc_` key cannot create a webhook. That is why registration is manual and this node only listens.

1. Drop the **Threadly Trigger** node into the workflow and copy its **production URL**.
2. In Threadly: **Connections > Integrations > Webhooks > New webhook**.
3. Paste the URL, tick the events and save.
4. Copy the **secret** Threadly shows and paste it into the *Webhook Secret* field of the credential.
5. Activate the workflow in n8n.

Because the node cannot register or delete anything on the Threadly side, its webhook lifecycle methods are deliberate no-ops: n8n never tries to create the webhook, and deactivating the workflow never deletes the one a human configured in the panel.

### Subscribable events

`TICKET_CREADO` · `TICKET_RESUELTO` · `TICKET_CERRADO` · `TICKET_REABIERTO` · `TICKET_TRANSFERIDO` · `AGENTE_ASIGNADO` · `MENSAJE_NUEVO` · `CONTACTO_CREADO` · `CONTACTO_FUSIONADO` · `LLAMADA_FINALIZADA` · `CSAT_ENVIADO` · `CSAT_RECIBIDO` · `ETAPA_CAMBIADA` · `SECUENCIA_INICIADA` · `SECUENCIA_FINALIZADA` · `SECUENCIA_SALIO_EVENTO`

The list inside the node is an **extra** filter: Threadly only sends what the webhook is subscribed to in the panel. Leaving the list empty lets everything through.

### Payload shape

```json
{
  "event": "MENSAJE_NUEVO",
  "deliveryId": "cl9x...",
  "timestamp": "2026-08-17T15:04:05.000Z",
  "data": {
    "ticketId": "ckt_...",
    "ticketNumber": 1042,
    "channelType": "WHATSAPP",
    "message": { "id": "msg_...", "direction": "INBOUND", "content": "..." }
  }
}
```

The node emits that object as is. `data` changes per event.

### Signature verification

Every delivery is signed with HMAC-SHA256 in the `X-PLCC-Signature` header, formatted as `sha256=<hex>`. The node:

1. Computes the HMAC over the **raw body** (the bytes, not the reserialized JSON) using the credential secret.
2. Compares in constant time against every signature in the header. During a secret rotation Threadly sends two (`sha256=new,sha256=previous`) and one match is enough, so the rotation does not break the workflow.
3. If it does not validate, answers **401** and **does not run the workflow**. Same if the credential secret or the header is missing.

This is not optional: an n8n webhook URL is public, and without verification anyone who discovers it could forge a `TICKET_RESUELTO` and fire whatever comes next (invoice, notify the customer, close in the ERP).

### Three reasons "nothing arrives"

- **Delivery switched off server-side.** Threadly records deliveries but only dispatches them with `WEBHOOKS_ENABLED=true` in the instance environment. Without it they sit as PENDING and no request goes out.
- **n8n on a private network.** Threadly sends webhooks with SSRF protection: it rejects URLs resolving to private, loopback or metadata IPs. Your n8n has to sit on a publicly reachable host.
- **Retries.** A failed delivery is retried with backoff up to 5 times within the following 24 hours. The signed body is **identical** on every retry, `timestamp` included. Deduplicate on `deliveryId`, not on the timestamp.

---

## Example workflow: answer a WhatsApp after hours

A customer writes in the middle of the night, gets an immediate AI answer, and the case stays queued with context for the agent who comes in next morning.

```
Threadly Trigger              Switch                 Basic LLM Chain            Threadly
(MENSAJE_NUEVO)  ──────▶  is it INBOUND and  ──────▶  drafts the reply   ──────▶  Message > Send
                          outside opening             from the customer          ticketId = {{ $('Threadly Trigger').item.json.data.ticketId }}
                          hours?                      message                    content  = {{ $json.text }}
```

1. **Threadly Trigger** — event `MENSAJE_NUEVO`.
2. **Switch** — only lets it through if `{{ $json.data.message.direction }}` is `INBOUND` (otherwise the workflow answers itself in a loop) and the time is outside opening hours.
3. **Basic LLM Chain** (or whichever model you use) — builds the reply from `{{ $json.data.message.content }}`.
4. **Threadly** — *Message > Send*, with:
   - **Ticket ID**: `{{ $('Threadly Trigger').item.json.data.ticketId }}`
   - **Message**: the model output.

It goes out through the same WhatsApp of the ticket and lands in the thread the agent sees.

### Another example: the core system reports a disbursement

```
Core webhook  ──▶  Threadly: Event > Register
                   Event Type: DESEMBOLSO
                   Contact: documentNumber = {{ $json.member.dni }}
                   Data: amount = {{ $json.amount }}, product = {{ $json.product }}
```

Threadly resolves or creates the contact, merges that data into its attributes and starts the sequence the tenant configured for `DESEMBOLSO`. The template can say "your loan of {{ amount }} has been disbursed". If the core system retries the notice, the member does not get the message twice.

---

## Development

```bash
npm install          # development dependencies only
npm run lint         # tsc --noEmit
npm run build        # compiles to dist/ and copies icons and codex files
```

To try it against a local n8n:

```bash
npm run build
npm link
cd ~/.n8n/nodes && npm link n8n-nodes-threadlywdp
```

Then restart n8n.

Before publishing, run the official community package scan:

```bash
npx @n8n/scan-community-package n8n-nodes-threadlywdp
```

## Publishing

`.github/workflows/publicar-nodo-n8n.yml` publishes to npm with **provenance** when a `vX.Y.Z` tag is pushed. n8n requires provenance to verify a community node, and provenance requires a **public** repository plus the `id-token: write` permission.

See [PUBLICAR.md](PUBLICAR.md) for the step-by-step release procedure.

## License

[MIT](LICENSE). It covers this package only, which is a client of the public API; the Threadly platform itself is proprietary software of Work Data Place S.A.C.
