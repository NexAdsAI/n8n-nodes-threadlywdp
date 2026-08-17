import { NodeConnectionTypes } from "n8n-workflow";
import type {
  IDataObject,
  IExecuteSingleFunctions,
  IHttpRequestOptions,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

/**
 * Nodo Threadly: acciones contra la API publica v1.
 *
 * Esta escrito en estilo DECLARATIVO (routing por propiedad, sin metodo
 * execute): la API es REST plana y con el declarativo n8n se encarga solo del
 * reintento, la paginacion y el manejo de errores. Los tres `preSend` de abajo
 * existen unicamente para los cuerpos que no se pueden expresar como
 * "un parametro = un campo del body".
 *
 * Mapa recurso -> endpoint -> scope que exige la API key:
 *   Contacto  Crear            POST  /api/v1/contacts                  contacts:write
 *   Contacto  Buscar           GET   /api/v1/contacts                  contacts:read
 *   Contacto  Crear o act.     POST  /api/v1/contacts/upsert           contacts:write
 *   Ticket    Obtener          GET   /api/v1/tickets/{id}              tickets:read
 *   Ticket    Listar           GET   /api/v1/tickets                   tickets:read
 *   Mensaje   Enviar           POST  /api/v1/messages                  messages:write
 *   Lead      Crear            POST  /api/v1/leads                     leads:write
 *   Lead      Cambiar etapa    PATCH /api/v1/leads/{id}/stage          leads:write
 *   Evento    Registrar        POST  /api/v1/events                    events:write
 *   Secuencia Inscribir        POST  /api/v1/sequences/{id}/enroll     sequences:write
 *   Secuencia Sacar            POST  /api/v1/sequences/exit            events:write
 *
 * El ultimo NO es un error de tipeo: sacar a alguien de sus secuencias se
 * modela como "el core avisa que pago / agendo / se dio de baja", por eso el
 * endpoint pide events:write y no sequences:write. Una clave que solo tenga
 * sequences:write puede inscribir pero no sacar.
 */

/**
 * Upsert de contacto: el servidor espera la clave natural anidada en
 * `match: { <campo>: <valor> }` y elige UNA sola por prioridad
 * (documento > telefono > email > codigo). Se arma aca porque el nombre del
 * campo es un parametro del usuario y el routing declarativo solo sabe escribir
 * en rutas fijas del body.
 */
async function construirMatchDeContacto(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const campo = this.getNodeParameter("matchField") as string;
  const valor = String(this.getNodeParameter("matchValue") ?? "").trim();
  const body = (requestOptions.body ?? {}) as IDataObject;
  body.match = { [campo]: valor };
  requestOptions.body = body;
  return requestOptions;
}

/**
 * Secuencias (inscribir / sacar): las claves de contacto van SUELTAS en la raiz
 * del body (`contactId` | `documentNumber` | `phone` | `email` | `code`), no
 * dentro de un `match`. Mismo motivo que arriba: el campo lo elige el usuario.
 */
async function aplicarClaveDeContacto(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const campo = this.getNodeParameter("contactMatchField") as string;
  const valor = String(this.getNodeParameter("contactMatchValue") ?? "").trim();
  const body = (requestOptions.body ?? {}) as IDataObject;
  body[campo] = valor;
  requestOptions.body = body;
  return requestOptions;
}

/**
 * Eventos del core: `data` es un diccionario libre que la plantilla de la
 * secuencia interpola ({{monto}}, {{producto}}...). En la UI se captura como
 * lista de pares y aca se convierte al objeto que espera la API. Los valores
 * "true"/"false" y los numericos se convierten a su tipo real: el servidor
 * sanea a string|number|boolean y un "1200" de texto en la plantilla se lee
 * igual, pero un booleano de texto rompe cualquier condicion posterior.
 */
async function aplicarDatosDelEvento(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const crudo = (this.getNodeParameter("eventData", {}) ?? {}) as IDataObject;
  const pares = (crudo.pares as IDataObject[] | undefined) ?? [];
  if (pares.length === 0) return requestOptions;

  const data: IDataObject = {};
  for (const par of pares) {
    const clave = String(par.clave ?? "").trim();
    if (!clave) continue;
    const valor = String(par.valor ?? "");
    if (valor === "true" || valor === "false") {
      data[clave] = valor === "true";
    } else if (valor !== "" && Number.isFinite(Number(valor))) {
      data[clave] = Number(valor);
    } else {
      data[clave] = valor;
    }
  }

  const body = (requestOptions.body ?? {}) as IDataObject;
  body.data = data;
  requestOptions.body = body;
  return requestOptions;
}

export class Threadly implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Threadly",
    name: "threadly",
    icon: "file:threadly.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Manage contacts, tickets, messages, leads, events and sequences in Threadly",
    defaults: { name: "Threadly" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "threadlyApi", required: true }],
    requestDefaults: {
      // La API es multi-tenant por subdominio: la base sale de la credencial y
      // se le quita la barra final para no terminar con "//api/v1/...".
      baseURL: "={{ $credentials.baseUrl.replace(/\\/+$/, '') }}",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    properties: [
      // =====================================================================
      // Recurso
      // =====================================================================
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "Contact", value: "contact" },
          { name: "Event", value: "event" },
          { name: "Lead", value: "lead" },
          { name: "Message", value: "message" },
          { name: "Sequence", value: "sequence" },
          { name: "Ticket", value: "ticket" },
        ],
        default: "contact",
      },

      // =====================================================================
      // Operaciones: Contacto
      // =====================================================================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["contact"] } },
        options: [
          {
            name: "Create",
            value: "create",
            action: "Create a contact",
            description: 'Create a new contact (fires the CONTACTO_CREADO webhook)',
            routing: {
              request: { method: "POST", url: "/api/v1/contacts" },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
          {
            name: "Create or Update",
            value: "upsert",
            action: "Create or update a contact",
            description: 'Create a new record, or update the current one if it already exists (upsert)',
            routing: {
              request: { method: "POST", url: "/api/v1/contacts/upsert" },
              send: { preSend: [construirMatchDeContacto] },
            },
          },
          {
            name: "Search",
            value: "search",
            action: "Search contacts",
            description: 'List the tenant contacts, with free-text search',
            routing: {
              request: { method: "GET", url: "/api/v1/contacts" },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
        ],
        default: "upsert",
      },

      // =====================================================================
      // Operaciones: Ticket
      // =====================================================================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["ticket"] } },
        options: [
          {
            name: "Get",
            value: "get",
            action: "Get a ticket",
            description: 'Fetch a ticket with its contact and the full thread (internal team notes excluded)',
            routing: {
              request: { method: "GET", url: '=/api/v1/tickets/{{$parameter["ticketId"]}}' },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
          {
            name: "List",
            value: "list",
            action: "List tickets",
            description: 'List the tenant tickets, filterable by status and channel',
            routing: {
              request: { method: "GET", url: "/api/v1/tickets" },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
        ],
        default: "get",
      },

      // =====================================================================
      // Operaciones: Mensaje
      // =====================================================================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["message"] } },
        options: [
          {
            name: "Send",
            value: "send",
            action: "Send a message",
            description:
              "Reply to the customer on an open ticket. It goes out through the real channel of the ticket (WhatsApp, email, webchat) as if an agent had written it.",
            routing: {
              request: { method: "POST", url: "/api/v1/messages" },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
        ],
        default: "send",
      },

      // =====================================================================
      // Operaciones: Lead
      // =====================================================================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["lead"] } },
        options: [
          {
            name: "Change Stage",
            value: "stage",
            action: "Change the stage of a lead",
            description: 'Move an outbound campaign lead to another stage (fires the ETAPA_CAMBIADA webhook)',
            routing: {
              request: {
                method: "PATCH",
                url: '=/api/v1/leads/{{$parameter["leadId"]}}/stage',
              },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
          {
            name: "Create",
            value: "create",
            action: "Create a lead",
            description: 'Turn a lead captured elsewhere (web form, ads, website chatbot) into a contact plus a queued ticket, skipping the bot',
            routing: {
              request: { method: "POST", url: "/api/v1/leads" },
            },
          },
        ],
        default: "create",
      },

      // =====================================================================
      // Operaciones: Evento
      // =====================================================================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["event"] } },
        options: [
          {
            name: "Register",
            value: "register",
            action: "Register a core event",
            description: 'Report that something happened in the customer core system (disbursement, sign-up, renewal) and trigger the sequence the tenant configured for that event',
            routing: {
              request: { method: "POST", url: "/api/v1/events" },
              send: { preSend: [aplicarDatosDelEvento] },
            },
          },
        ],
        default: "register",
      },

      // =====================================================================
      // Operaciones: Secuencia
      // =====================================================================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["sequence"] } },
        options: [
          {
            name: "Enroll",
            value: "enroll",
            action: "Enroll a contact into a sequence",
            description:
              "Enroll a contact into a sequence. If the contact already has an active run of the same sequence, the API answers 409 instead of duplicating it.",
            routing: {
              request: {
                method: "POST",
                url: '=/api/v1/sequences/{{$parameter["sequenceId"]}}/enroll',
              },
              send: { preSend: [aplicarClaveDeContacto] },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
          {
            name: "Exit",
            value: "exit",
            action: "Take a contact out of its sequences",
            description:
              "Stop every active sequence of the contact at once (payment, appointment, opt-out). Requires the events:write scope, not sequences:write.",
            routing: {
              request: { method: "POST", url: "/api/v1/sequences/exit" },
              send: { preSend: [aplicarClaveDeContacto] },
              output: {
                postReceive: [{ type: "rootProperty", properties: { property: "data" } }],
              },
            },
          },
        ],
        default: "enroll",
      },

      // =====================================================================
      // Campos: Contacto > Crear
      // =====================================================================
      {
        displayName: "First Name",
        name: "firstName",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["contact"], operation: ["create"] } },
        description: "First name of the contact (firstName). Maximum 60 characters.",
        routing: { send: { type: "body", property: "firstName", value: "={{$value}}" } },
      },
      {
        displayName: "Additional Fields",
        name: "additionalFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["contact"], operation: ["create"] } },
        options: [
          {
            displayName: "Code",
            name: "code",
            type: "string",
            default: "",
            description: 'Code of the contact in the customer own system (code)',
            routing: { send: { type: "body", property: "code", value: "={{$value}}" } },
          },
          {
            displayName: "Company",
            name: "company",
            type: "string",
            default: "",
            description: 'Company of the contact (company)',
            routing: { send: { type: "body", property: "company", value: "={{$value}}" } },
          },
          {
            displayName: "Document Number",
            name: "documentNumber",
            type: "string",
            default: "",
            description: 'DNI, RUC or CE of the contact (documentNumber)',
            routing: {
              send: { type: "body", property: "documentNumber", value: "={{$value}}" },
            },
          },
          {
            displayName: "Email",
            name: "email",
            type: "string",
            placeholder: "name@company.com",
            default: "",
            description: "Email of the contact. The server stores it lowercased.",
            routing: { send: { type: "body", property: "email", value: "={{$value}}" } },
          },
          {
            displayName: "Last Name",
            name: "lastName",
            type: "string",
            default: "",
            description: 'Last name of the contact (lastName)',
            routing: { send: { type: "body", property: "lastName", value: "={{$value}}" } },
          },
          {
            displayName: "Phone",
            name: "phone",
            type: "string",
            placeholder: "+51987654321",
            default: "",
            description:
              "Phone of the contact. Accepted with or without a leading +, between 6 and 24 characters.",
            routing: { send: { type: "body", property: "phone", value: "={{$value}}" } },
          },
        ],
      },

      // =====================================================================
      // Campos: Contacto > Crear o actualizar
      // =====================================================================
      {
        displayName: "Match By",
        name: "matchField",
        type: "options",
        required: true,
        default: "phone",
        displayOptions: { show: { resource: ["contact"], operation: ["upsert"] } },
        options: [
          { name: "Code", value: "code" },
          { name: "Document Number", value: "documentNumber" },
          { name: "Email", value: "email" },
          { name: "Phone", value: "phone" },
        ],
        description:
          "Natural key used to identify the contact. It never matches a merge tombstone: if the key only exists on a merged contact, a new contact is created.",
      },
      {
        displayName: "Match Value",
        name: "matchValue",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["contact"], operation: ["upsert"] } },
        description: 'Value of the key, for example the phone number',
      },
      {
        displayName: "First Name",
        name: "firstName",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["contact"], operation: ["upsert"] } },
        description:
          "First name of the contact. Only required when the contact does not exist yet: if it already exists and you leave this empty, the current name is left untouched.",
        routing: { send: { type: "body", property: "firstName", value: "={{$value}}" } },
      },
      {
        displayName: "Fields to Update",
        name: "upsertFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["contact"], operation: ["upsert"] } },
        description:
          "Only the fields you add here are touched. A field added and left empty CLEARS the stored value.",
        options: [
          {
            displayName: "Birth Date",
            name: "birthDate",
            type: "string",
            placeholder: "1990-03-25",
            default: "",
            description:
              "Date in yyyy-mm-dd format, without time or timezone. It is the one the automatic birthday greeting uses.",
            routing: { send: { type: "body", property: "birthDate", value: "={{$value}}" } },
          },
          {
            displayName: "Code",
            name: "code",
            type: "string",
            default: "",
            description: 'Code of the contact in the customer own system (code)',
            routing: { send: { type: "body", property: "code", value: "={{$value}}" } },
          },
          {
            displayName: "Company",
            name: "company",
            type: "string",
            default: "",
            description: 'Company of the contact (company)',
            routing: { send: { type: "body", property: "company", value: "={{$value}}" } },
          },
          {
            displayName: "Document Number",
            name: "documentNumber",
            type: "string",
            default: "",
            description: 'DNI, RUC or CE of the contact (documentNumber)',
            routing: {
              send: { type: "body", property: "documentNumber", value: "={{$value}}" },
            },
          },
          {
            displayName: "Email",
            name: "email",
            type: "string",
            placeholder: "name@company.com",
            default: "",
            description: 'Email of the contact',
            routing: { send: { type: "body", property: "email", value: "={{$value}}" } },
          },
          {
            displayName: "Last Name",
            name: "lastName",
            type: "string",
            default: "",
            description: 'Last name of the contact (lastName)',
            routing: { send: { type: "body", property: "lastName", value: "={{$value}}" } },
          },
          {
            displayName: "Phone",
            name: "phone",
            type: "string",
            placeholder: "+51987654321",
            default: "",
            description: 'Phone of the contact',
            routing: { send: { type: "body", property: "phone", value: "={{$value}}" } },
          },
        ],
      },

      // =====================================================================
      // Campos: Contacto > Buscar
      // =====================================================================
      {
        displayName: "Search Term",
        name: "q",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["contact"], operation: ["search"] } },
        description:
          "Free text. Searches across first name, last name, company, email, phone and document number. Empty returns every contact.",
        routing: { send: { type: "query", property: "q", value: "={{$value}}" } },
      },

      // =====================================================================
      // Campos: Ticket > Obtener
      // =====================================================================
      {
        displayName: "Ticket ID",
        name: "ticketId",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["ticket"], operation: ["get"] } },
        description:
          'ID of the ticket. It is the internal ID, not the ticket number shown in the app.',
      },

      // =====================================================================
      // Campos: Ticket > Listar
      // =====================================================================
      {
        displayName: "Filters",
        name: "ticketFilters",
        type: "collection",
        placeholder: "Add Filter",
        default: {},
        displayOptions: { show: { resource: ["ticket"], operation: ["list"] } },
        options: [
          {
            displayName: "Channel",
            name: "channelType",
            type: "options",
            default: "WHATSAPP",
            description: 'Channel the ticket came in through',
            options: [
              { name: "Email", value: "EMAIL" },
              { name: "Instagram", value: "INSTAGRAM" },
              { name: "Messenger", value: "MESSENGER" },
              { name: "SMS", value: "SMS" },
              { name: "Telegram", value: "TELEGRAM" },
              { name: "TikTok", value: "TIKTOK" },
              { name: "Voice", value: "VOICE" },
              { name: "Webchat", value: "WEBCHAT" },
              { name: "WhatsApp", value: "WHATSAPP" },
            ],
            routing: {
              send: { type: "query", property: "channelType", value: "={{$value}}" },
            },
          },
          {
            displayName: "Status",
            name: "status",
            type: "options",
            default: "EN_COLA",
            description:
              "Status of the ticket. EN_COLA means queued, not that somebody is waiting on the line.",
            options: [
              { name: "Assigned", value: "ASIGNADO" },
              { name: "Bot", value: "BOT" },
              { name: "Closed", value: "CERRADO" },
              { name: "Queued", value: "EN_COLA" },
              { name: "Resolved", value: "RESUELTO" },
              { name: "Waiting on Customer", value: "EN_ESPERA_CLIENTE" },
              { name: "Waiting on Third Party", value: "EN_ESPERA_TERCERO" },
            ],
            routing: { send: { type: "query", property: "status", value: "={{$value}}" } },
          },
        ],
      },

      // =====================================================================
      // Paginacion compartida: Contacto > Buscar y Ticket > Listar
      // =====================================================================
      {
        displayName: "Return All",
        name: "returnAll",
        type: "boolean",
        default: false,
        displayOptions: {
          show: { resource: ["contact", "ticket"], operation: ["search", "list"] },
        },
        description: 'Whether to return all results or only up to a given limit',
        routing: {
          send: { paginate: "={{ $value }}" },
          operations: {
            pagination: {
              type: "generic",
              properties: {
                // El fin de la paginacion es nextCursor en null, NO una pagina
                // vacia: la ultima pagina viene llena y con nextCursor null.
                continue:
                  "={{ $response.body.nextCursor !== null && $response.body.nextCursor !== undefined }}",
                request: {
                  qs: {
                    cursor: "={{ $response.body.nextCursor }}",
                    limit: 100,
                  },
                },
              },
            },
          },
        },
      },
      {
        displayName: "Limit",
        name: "limit",
        type: "number",
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 50,
        displayOptions: {
          show: {
            resource: ["contact", "ticket"],
            operation: ["search", "list"],
            returnAll: [false],
          },
        },
        description: 'Max number of results to return',
        routing: { send: { type: "query", property: "limit", value: "={{$value}}" } },
      },

      // =====================================================================
      // Campos: Mensaje > Enviar
      // =====================================================================
      {
        displayName: "Ticket ID",
        name: "ticketId",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
        description:
          "Ticket to reply on. It must be open: on a resolved ticket the API answers 409.",
        routing: { send: { type: "body", property: "ticketId", value: "={{$value}}" } },
      },
      {
        displayName: "Message",
        name: "content",
        type: "string",
        typeOptions: { rows: 4 },
        required: true,
        default: "",
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
        description: "Text to send to the customer. Maximum 4000 characters.",
        routing: { send: { type: "body", property: "content", value: "={{$value}}" } },
      },

      // =====================================================================
      // Campos: Lead > Crear
      // =====================================================================
      {
        displayName: "First Name",
        name: "firstName",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["lead"], operation: ["create"] } },
        description: 'First name of the lead (firstName)',
        routing: { send: { type: "body", property: "firstName", value: "={{$value}}" } },
      },
      {
        displayName: "Phone",
        name: "phone",
        type: "string",
        placeholder: "+51987654321",
        default: "",
        displayOptions: { show: { resource: ["lead"], operation: ["create"] } },
        description:
          "Phone of the lead. Either phone OR email is required: with neither there is no way to identify the lead and the API answers 400.",
        routing: { send: { type: "body", property: "phone", value: "={{$value}}" } },
      },
      {
        displayName: "Email",
        name: "email",
        type: "string",
        placeholder: "name@company.com",
        default: "",
        displayOptions: { show: { resource: ["lead"], operation: ["create"] } },
        description: "Email of the lead. Either phone OR email is required.",
        routing: { send: { type: "body", property: "email", value: "={{$value}}" } },
      },
      {
        displayName: "Additional Fields",
        name: "leadFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["lead"], operation: ["create"] } },
        options: [
          {
            displayName: "Company",
            name: "company",
            type: "string",
            default: "",
            description: 'Company of the lead (company)',
            routing: { send: { type: "body", property: "company", value: "={{$value}}" } },
          },
          {
            displayName: "Conversation",
            name: "conversation",
            type: "string",
            typeOptions: { rows: 4 },
            default: "",
            description:
              "Transcript of what was already discussed elsewhere. It lands in the ticket thread without firing the bot again.",
            routing: {
              send: { type: "body", property: "conversation", value: "={{$value}}" },
            },
          },
          {
            displayName: "Internal Notification Email",
            name: "notifyEmail",
            type: "string",
            placeholder: "alerts@mycompany.com",
            default: "",
            description:
              "HUMAN mailbox to notify that the lead came in. Do not use a mailbox that Threadly ingests as an email channel: the notification would create a second ticket.",
            routing: {
              send: { type: "body", property: "notifyEmail", value: "={{$value}}" },
            },
          },
          {
            displayName: "Last Name",
            name: "lastName",
            type: "string",
            default: "",
            description: 'Last name of the lead (lastName)',
            routing: { send: { type: "body", property: "lastName", value: "={{$value}}" } },
          },
          {
            displayName: "Queue",
            name: "queue",
            type: "string",
            default: "",
            description:
              "Name of the queue the ticket enters. If it does not exist or is omitted, the ticket goes to the default queue.",
            routing: { send: { type: "body", property: "queue", value: "={{$value}}" } },
          },
          {
            displayName: "Source",
            name: "source",
            type: "string",
            placeholder: "Web form",
            default: "",
            description: 'Where the lead came from (source): campaign, web form, ads',
            routing: { send: { type: "body", property: "source", value: "={{$value}}" } },
          },
          {
            displayName: "Summary",
            name: "summary",
            type: "string",
            typeOptions: { rows: 3 },
            default: "",
            description: 'Summary of what the lead wants, so the agent grasps it at a glance',
            routing: { send: { type: "body", property: "summary", value: "={{$value}}" } },
          },
        ],
      },

      // =====================================================================
      // Campos: Lead > Cambiar etapa
      // =====================================================================
      {
        displayName: "Lead ID",
        name: "leadId",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["lead"], operation: ["stage"] } },
        description:
          "ID of the outbound campaign lead (CampaignLead). The API key can only touch leads of campaigns in its own tenant.",
      },
      {
        displayName: "Stage",
        name: "stage",
        type: "options",
        required: true,
        default: "CONTACTADO",
        displayOptions: { show: { resource: ["lead"], operation: ["stage"] } },
        options: [
          { name: "Blocked", value: "BLOQUEADO" },
          { name: "Call Back", value: "RELLAMAR" },
          { name: "Calling", value: "LLAMANDO" },
          { name: "Contacted", value: "CONTACTADO" },
          { name: "No Answer", value: "NO_CONTESTA" },
          { name: "Not Interested", value: "NO_INTERESADO" },
          { name: "Pending", value: "PENDIENTE" },
          { name: "Scheduled", value: "AGENDADO" },
          { name: "Sold", value: "VENDIDO" },
        ],
        description:
          "New stage of the lead. Blocked is a FINAL state: the dialer never picks that lead up again.",
        routing: { send: { type: "body", property: "stage", value: "={{$value}}" } },
      },
      {
        displayName: "Disposition",
        name: "disposition",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["lead"], operation: ["stage"] } },
        description: "Note or disposition for the stage change. Maximum 80 characters.",
        routing: { send: { type: "body", property: "disposition", value: "={{$value}}" } },
      },

      // =====================================================================
      // Campos: Evento > Registrar
      // =====================================================================
      {
        displayName: "Event Type",
        name: "type",
        type: "string",
        required: true,
        default: "",
        placeholder: "DESEMBOLSO",
        displayOptions: { show: { resource: ["event"], operation: ["register"] } },
        description:
          "Name of the event. It is normalized server-side, so Credit disbursement and CREDIT_DISBURSEMENT are the same one. If the tenant has no rule configured for it, the API answers 422 and lists the events that are configured.",
        routing: { send: { type: "body", property: "type", value: "={{$value}}" } },
      },
      {
        displayName: "Contact",
        name: "eventContact",
        type: "collection",
        placeholder: "Add Contact Detail",
        default: {},
        required: true,
        displayOptions: { show: { resource: ["event"], operation: ["register"] } },
        description:
          "How to identify the person. At least phone, email or document number is required; if the contact does not exist, Threadly creates it.",
        options: [
          {
            displayName: "Document Number",
            name: "documentNumber",
            type: "string",
            default: "",
            description: 'DNI, RUC or CE of the person',
            routing: {
              send: { type: "body", property: "contact.documentNumber", value: "={{$value}}" },
            },
          },
          {
            displayName: "Email",
            name: "email",
            type: "string",
            placeholder: "name@company.com",
            default: "",
            description: 'Email of the person',
            routing: { send: { type: "body", property: "contact.email", value: "={{$value}}" } },
          },
          {
            displayName: "Name",
            name: "name",
            type: "string",
            default: "",
            description:
              "Name of the person. Without it, a newly created contact shows its phone or document number as the name.",
            routing: { send: { type: "body", property: "contact.name", value: "={{$value}}" } },
          },
          {
            displayName: "Phone",
            name: "phone",
            type: "string",
            placeholder: "+51987654321",
            default: "",
            description: "Phone of the person. The server normalizes it.",
            routing: { send: { type: "body", property: "contact.phone", value: "={{$value}}" } },
          },
        ],
      },
      {
        displayName: "Event Data",
        name: "eventData",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        placeholder: "Add Data",
        default: {},
        displayOptions: { show: { resource: ["event"], operation: ["register"] } },
        description: 'Merged into the contact attributes, so the sequence template can say your loan of {{amount}}',
        options: [
          {
            displayName: "Data",
            name: "pares",
            values: [
              {
                displayName: "Key",
                name: "clave",
                type: "string",
                default: "",
                placeholder: "amount",
                description: 'Name the template interpolates it with',
              },
              {
                displayName: "Value",
                name: "valor",
                type: "string",
                default: "",
                description:
                  "Value of the data point. Numbers and true/false are sent with their real type, not as text.",
              },
            ],
          },
        ],
      },

      // =====================================================================
      // Campos: Secuencia > Inscribir
      // =====================================================================
      {
        displayName: "Sequence ID",
        name: "sequenceId",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["sequence"], operation: ["enroll"] } },
        description: 'ID of the sequence to enroll the contact into',
      },

      // =====================================================================
      // Campos compartidos: Secuencia > Inscribir y Sacar
      // =====================================================================
      {
        displayName: "Identify Contact By",
        name: "contactMatchField",
        type: "options",
        required: true,
        default: "phone",
        displayOptions: { show: { resource: ["sequence"], operation: ["enroll", "exit"] } },
        options: [
          { name: "Code", value: "code" },
          { name: "Contact ID", value: "contactId" },
          { name: "Document Number", value: "documentNumber" },
          { name: "Email", value: "email" },
          { name: "Phone", value: "phone" },
        ],
        description:
          "Key used to locate the contact. On enroll, if the key resolves to more than one contact the API answers 409: use the contact ID instead.",
      },
      {
        displayName: "Contact Value",
        name: "contactMatchValue",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["sequence"], operation: ["enroll", "exit"] } },
        description: 'Value of the key chosen above',
      },

      // =====================================================================
      // Campos: Secuencia > Sacar
      // =====================================================================
      {
        displayName: "Reason",
        name: "reason",
        type: "string",
        default: "PAGO_CONFIRMADO",
        displayOptions: { show: { resource: ["sequence"], operation: ["exit"] } },
        description:
          "Why the contact leaves the sequence (PAGO_CONFIRMADO, AGENDADO, BAJA). It is stored on the run and travels in the SECUENCIA_SALIO_EVENTO webhook. Maximum 80 characters.",
        routing: { send: { type: "body", property: "reason", value: "={{$value}}" } },
      },
    ],
  };
}
