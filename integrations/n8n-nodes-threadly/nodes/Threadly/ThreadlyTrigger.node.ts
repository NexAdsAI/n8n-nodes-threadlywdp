import { createHmac, timingSafeEqual } from "node:crypto";
import { NodeConnectionTypes } from "n8n-workflow";
import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";

/**
 * Disparador de Threadly: recibe los webhooks salientes del tenant.
 *
 * No hay registro automatico del webhook. La administracion de webhooks de
 * Threadly vive en el panel (Conexiones > Integraciones > Webhooks) y va con
 * sesion de usuario, no con API key: la clave plcc_ no puede crear un webhook,
 * asi que el alta es manual y este nodo solo escucha.
 *
 * Todo lo que llega se verifica antes de ejecutar el flujo. Sin firma valida no
 * se emite nada: la URL de un webhook de n8n es publica, y sin verificar
 * cualquiera que la descubra podria inventar un "TICKET_RESUELTO" y disparar lo
 * que el flujo haga despues (facturar, avisar al cliente, cerrar en el ERP).
 */

/** Prefijo de cada firma dentro de X-PLCC-Signature. */
const PREFIJO_FIRMA = "sha256=";

/**
 * Cuerpo EXACTO sobre el que se calculo la firma.
 *
 * Se usa el cuerpo crudo (`req.rawBody`, que n8n deja en la request) y no el
 * JSON reserializado: el HMAC es sobre bytes, y volver a serializar puede
 * cambiar espacios, escapes unicode u orden de claves y tumbar una firma buena.
 * El respaldo reconstruye el cuerpo canonico del emisor —claves en el orden
 * event, deliveryId, timestamp, data— para las instalaciones de n8n donde
 * rawBody no llegue.
 */
function cuerpoFirmado(req: unknown, parseado: IDataObject): string {
  const raw = (req as { rawBody?: Buffer | string }).rawBody;
  if (Buffer.isBuffer(raw) && raw.length > 0) return raw.toString("utf8");
  if (typeof raw === "string" && raw.length > 0) return raw;

  return JSON.stringify({
    event: parseado.event,
    deliveryId: parseado.deliveryId,
    timestamp: parseado.timestamp,
    data: parseado.data ?? null,
  });
}

/**
 * Compara el HMAC propio contra la cabecera.
 *
 * La cabecera puede traer DOS firmas separadas por coma mientras el tenant rota
 * el secreto (la nueva y la anterior, dentro de su ventana de gracia). Vale con
 * que una coincida; si solo se mirara la primera, cada rotacion tumbaria el
 * flujo por unas horas. La comparacion es de tiempo constante para no filtrar
 * el secreto byte a byte con la duracion de la respuesta.
 */
function firmaValida(secreto: string, cuerpo: string, cabecera: string): boolean {
  const esperado = createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
  const esperadoBuf = Buffer.from(esperado, "utf8");

  for (const parte of cabecera.split(",")) {
    const valor = parte.trim();
    const hex = valor.startsWith(PREFIJO_FIRMA) ? valor.slice(PREFIJO_FIRMA.length) : valor;
    if (hex.length !== esperado.length) continue;
    if (timingSafeEqual(esperadoBuf, Buffer.from(hex, "utf8"))) return true;
  }
  return false;
}

export class ThreadlyTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Threadly Trigger",
    name: "threadlyTrigger",
    icon: "file:threadly.svg",
    group: ["trigger"],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: "Starts the workflow on a Threadly event (signed webhook)",
    defaults: { name: "Threadly Trigger" },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "threadlyApi", required: true }],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "webhook",
      },
    ],
    properties: [
      {
        displayName:
          "Copy the production URL above and paste it into Threadly, under Connections > Integrations > Webhooks. The secret is shown there too: put it in the Webhook Secret field of the credential. Without that secret this node rejects every delivery with 401.",
        name: "setupNotice",
        type: "notice",
        default: "",
      },
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        required: true,
        default: ["MENSAJE_NUEVO"],
        description:
          "Events allowed through to the workflow. This is an extra filter on top of the panel: Threadly only sends the events the webhook is subscribed to there. Leave empty to allow all of them.",
        options: [
          { name: "Agent Assigned", value: "AGENTE_ASIGNADO" },
          { name: "Call Ended", value: "LLAMADA_FINALIZADA" },
          { name: "Contact Created", value: "CONTACTO_CREADO" },
          { name: "Contact Merged", value: "CONTACTO_FUSIONADO" },
          { name: "CSAT Received", value: "CSAT_RECIBIDO" },
          { name: "CSAT Sent", value: "CSAT_ENVIADO" },
          { name: "New Message", value: "MENSAJE_NUEVO" },
          { name: "Sequence Exited By Event", value: "SECUENCIA_SALIO_EVENTO" },
          { name: "Sequence Finished", value: "SECUENCIA_FINALIZADA" },
          { name: "Sequence Started", value: "SECUENCIA_INICIADA" },
          { name: "Stage Changed", value: "ETAPA_CAMBIADA" },
          { name: "Ticket Closed", value: "TICKET_CERRADO" },
          { name: "Ticket Created", value: "TICKET_CREADO" },
          { name: "Ticket Reopened", value: "TICKET_REABIERTO" },
          { name: "Ticket Resolved", value: "TICKET_RESUELTO" },
          { name: "Ticket Transferred", value: "TICKET_TRANSFERIDO" },
        ],
      },
    ],
  };

  /**
   * Ciclo de vida del webhook: los tres metodos son NO-OP a proposito.
   *
   * La API publica v1 no administra webhooks; el alta vive en /api/integraciones
   * y va con sesion de usuario, no con la API key plcc_. Es decir: este nodo NO
   * PUEDE registrar ni borrar nada del lado de Threadly, el alta es manual en el
   * panel (por eso el aviso de arriba).
   *
   * `checkExists` devuelve true para que n8n de por registrado el webhook y no
   * llame a `create`; si devolviera false, n8n intentaria crear, `create`
   * devolveria false y el flujo no arrancaria nunca. `delete` devuelve true
   * porque no hay nada que limpiar: borrar aca el webhook que configuro una
   * persona en el panel seria destruir configuracion que el nodo no creo.
   */
  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const res = this.getResponseObject();
    const cabeceras = this.getHeaderData() as IDataObject;
    const cuerpo = (this.getBodyData() ?? {}) as IDataObject;

    const credenciales = await this.getCredentials("threadlyApi");
    const secreto = String(credenciales.webhookSecret ?? "").trim();
    if (!secreto) {
      // 401 y no 500: para Threadly el destino no acepta la entrega, y su worker
      // la reintenta con backoff mientras alguien completa el secreto.
      res.status(401).json({
        error:
          "The webhook secret is missing from the Threadly credential (Webhook Secret field).",
      });
      return { noWebhookResponse: true };
    }

    const cabeceraFirma = String(cabeceras["x-plcc-signature"] ?? "").trim();
    if (!cabeceraFirma) {
      res.status(401).json({ error: "Missing X-PLCC-Signature header." });
      return { noWebhookResponse: true };
    }

    if (!firmaValida(secreto, cuerpoFirmado(req, cuerpo), cabeceraFirma)) {
      res.status(401).json({ error: "Invalid X-PLCC-Signature signature." });
      return { noWebhookResponse: true };
    }

    // Filtro por evento: se responde 200 igual. Un evento que este nodo no
    // escucha no es un fallo de entrega, y con 4xx Threadly lo reintentaria
    // cinco veces antes de rendirse.
    const evento = String(cuerpo.event ?? "");
    const seleccionados = (this.getNodeParameter("events", []) as string[]) ?? [];
    if (seleccionados.length > 0 && !seleccionados.includes(evento)) {
      return { webhookResponse: { ignored: evento } };
    }

    // Se emite el cuerpo tal cual lo manda Threadly: { event, deliveryId,
    // timestamp, data }. deliveryId es la clave para deduplicar, porque el
    // cuerpo firmado es identico en cada reintento de la misma entrega.
    return { workflowData: [this.helpers.returnJsonArray([cuerpo])] };
  }
}
