import type {
  IAuthenticateGeneric,
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/**
 * Credencial unica de Threadly: sirve al nodo de acciones y al disparador.
 *
 * Se piden tres cosas porque cada una resuelve un problema distinto:
 *  - `baseUrl`: la API es multi-tenant por SUBDOMINIO, no por parametro. La clave
 *    solo vale contra el host de su propio tenant.
 *  - `apiKey`: viaja como `Authorization: Bearer plcc_...` y ya trae adentro el
 *    tenant y los scopes; por eso ningun nodo pide tenantId.
 *  - `webhookSecret`: lo usa SOLO el disparador para validar la firma HMAC. Va
 *    aqui, y no como parametro del nodo, porque un secreto guardado en el
 *    workflow se exporta en claro con el JSON del flujo.
 */
export class ThreadlyApi implements ICredentialType {
  name = "threadlyApi";

  displayName = "Threadly API";

  documentationUrl = "https://threadlywdp.com";

  // El icono se duplica en credentials/ en vez de apuntar a ../nodes/: n8n
  // resuelve `file:` relativo al .js compilado y las rutas con ".." quedan a
  // merced de la proteccion contra path traversal del cargador.
  icon: Icon = "file:threadly.svg";

  properties: INodeProperties[] = [
    {
      displayName: "Tenant URL",
      name: "baseUrl",
      type: "string",
      default: "https://mycompany.threadlywdp.com",
      required: true,
      placeholder: "https://mycompany.threadlywdp.com",
      description:
        "Your Threadly tenant domain, without a trailing slash. It is the same URL you use to sign in to the app.",
    },
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      placeholder: "plcc_...",
      description:
        "Public API key (starts with plcc_). Create it in Connections > Integrations > API Keys and tick the scopes of the operations you plan to use.",
    },
    {
      displayName: "Webhook Secret",
      name: "webhookSecret",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: false,
      description:
        "Only used by the Threadly Trigger node: the outgoing webhook secret (Connections > Integrations > Webhooks). It verifies the X-PLCC-Signature header of every delivery.",
    },
  ];

  /** Inyecta `Authorization: Bearer {apiKey}` en cada request del nodo. */
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  /**
   * Prueba de credencial: el listado de contactos con limit=1 es la llamada mas
   * barata de la API (una fila, sin efectos). OJO: exige el scope contacts:read,
   * asi que una clave valida pero sin ese scope da 403 y la prueba sale roja
   * aunque la clave sirva para escribir. La API no expone ningun endpoint sin
   * scope contra el que probar.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{ $credentials.baseUrl.replace(/\\/+$/, '') }}",
      url: "/api/v1/contacts",
      method: "GET",
      qs: { limit: 1 },
    },
    rules: [
      {
        type: "responseCode",
        properties: {
          value: 401,
          message:
            "Invalid or revoked API key. Generate a new one in Connections > Integrations > API Keys.",
        },
      },
      {
        type: "responseCode",
        properties: {
          value: 403,
          message:
            "The key is valid but lacks the contacts:read scope, which is the one this test uses. Add it (even if you do not need it) or ignore this result.",
        },
      },
      {
        type: "responseCode",
        properties: {
          value: 404,
          message:
            "The tenant URL does not serve the v1 API. Check the subdomain: it must be the same one you use to sign in to the app.",
        },
      },
    ],
  };
}
