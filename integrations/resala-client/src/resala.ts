/** Server-side Resala API client. Never bundle this module with a browser app. */
export const RESALA_BASE_URL = "https://otp.sadeem-factory.com/api/v1";

export type ResalaErrorType = "AccountExpired" | "InsufficientCredit" | "BadRequest"
  | "Unauthorized" | "TokenExpired" | "Forbidden" | "NotFound" | "InputValidation";
export type FieldErrors = Record<string, string[]>;

export class ResalaApiError extends Error {
  readonly type: ResalaErrorType | "UnknownResponse";
  readonly status: number;
  readonly requestId?: string;
  readonly errors?: FieldErrors;
  readonly localizedMessage?: string;
  constructor(
    type: ResalaErrorType | "UnknownResponse",
    status: number,
    requestId?: string,
    errors?: FieldErrors,
    localizedMessage?: string,
  ) {
    super(`Resala ${type} (HTTP ${status})${requestId ? `, request ${requestId}` : ""}`);
    this.name = "ResalaApiError";
    this.type = type;
    this.status = status;
    this.requestId = requestId;
    this.errors = errors;
    this.localizedMessage = localizedMessage;
  }
}

export class ResalaTransportError extends Error {
  constructor(cause: unknown) {
    super("Resala request failed; the send outcome is unknown. Check message history before sending again.", { cause });
    this.name = "ResalaTransportError";
  }
}

export interface PinOptions {
  serviceName?: string;
  test?: boolean;
  length?: 4 | 5 | 6;
  autofill?: string;
  sender?: string;
}

/** The supplied production example and the public reference show different 201 shapes. */
export interface PinResponse {
  id: string;
  sender_name: string;
  phone?: string;
  status?: MessageStatus;
  pin?: string;
  code?: string;
  region?: string;
  number?: string;
  content?: string;
  hit_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface TemplateRecord {
  phone: string;
  scheduled_at?: string;
  [variable: `$${number}`]: string;
}
export interface MessageOptions {
  test?: boolean;
  sender?: string;
  scheduledAt?: string;
}
export interface MessageResponse {
  id: string;
  code: string;
  region: string;
  number: string;
  content: string;
  env: string;
  price: number;
  pages: number;
  status: MessageStatus;
  created_at: string;
  sender_name: string;
}
export interface TemplateOptions {
  test?: boolean;
  sender?: string;
  scheduledAt?: string;
}
export interface TemplateResponse {
  is_prod: boolean;
  total_messages: number;
  total_free_messages: number;
  total_sent_free_messages: number;
  total_cost: number;
  succeeded: number;
  failed: number;
  failed_numbers: string[];
  invalid_numbers: string[];
  sender_names: Partial<Record<"libyana" | "almadar" | "international", string>>;
  sms_template_version: { id: string; version_number: number; body: string; status: string };
  batch_id?: string;
  queued?: boolean;
  scheduled_at?: string;
}

export type MessageStatus = "accepted" | "sent" | "delivered" | "undelivered" | "pending" | "failed";
export interface SentMessage {
  id: string;
  code: string;
  region: string;
  number: string;
  content: string;
  source: "message" | "pin";
  status: MessageStatus;
  pages: number;
  env: string;
  created_at: string;
  updated_at: string;
  sender_name?: string;
}
export interface SentViewOptions {
  filters?: "source:message" | "source:pin" | "source:message|pin";
  q?: string;
  sorts?: string;
  page?: number;
  paginate?: number;
}
export interface SentViewResponse {
  data: SentMessage[];
  meta: { total: number; per_page: number; current_page: number; last_page: number; [key: string]: unknown };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseFieldErrors(value: unknown): FieldErrors | undefined {
  if (!isObject(value)) return undefined;
  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(value)) {
    if (Array.isArray(messages)) result[field] = messages.filter((message): message is string => typeof message === "string");
    else if (typeof messages === "string") result[field] = [messages];
  }
  return result;
}
const errorTypes = new Set<ResalaErrorType>([
  "AccountExpired", "InsufficientCredit", "BadRequest", "Unauthorized",
  "TokenExpired", "Forbidden", "NotFound", "InputValidation",
]);
function apiError(status: number, body: unknown): ResalaApiError {
  const data = isObject(body) ? body : {};
  const type = typeof data.type === "string" && errorTypes.has(data.type as ResalaErrorType)
    ? data.type as ResalaErrorType : "UnknownResponse";
  return new ResalaApiError(
    type, status,
    typeof data.request_id === "string" ? data.request_id : undefined,
    type === "InputValidation" ? parseFieldErrors(data.errors) : undefined,
    typeof data.message === "string" ? data.message : undefined,
  );
}
function query(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) result.set(key, String(value));
  return result;
}

export function createResalaClient(options: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {}) {
  const apiKey = options.apiKey ?? process.env.RESALA_API_KEY;
  if (!apiKey) throw new Error("RESALA_API_KEY is required");
  const baseUrl = (options.baseUrl ?? RESALA_BASE_URL).replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;

  async function request<T>(method: "GET" | "POST", path: string, params: URLSearchParams, body?: unknown): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    url.search = params.toString();
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new ResalaTransportError(cause);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw apiError(response.status, payload);
    if (!isObject(payload)) throw new ResalaApiError("UnknownResponse", response.status);
    return payload as T;
  }

  return {
    /** POST /pins. Store and verify a returned PIN server-side, if provided. */
    createPin(phone: string, options: PinOptions = {}): Promise<PinResponse> {
      return request("POST", "/pins", query({
        service_name: options.serviceName, test: options.test, len: options.length,
        autofill: options.autofill, sender: options.sender,
      }), { phone });
    },
    /** POST /messages. Free-text sending requires account permission; never retry automatically. */
    sendMessage(phone: string, content: string, options: MessageOptions = {}): Promise<MessageResponse> {
      return request("POST", "/messages", query({
        test: options.test, sender: options.sender, scheduled_at: options.scheduledAt,
      }), { phone, content });
    },
    /** POST /messages/send-template. Inspect invalid_numbers and failed_numbers. */
    sendTemplate(templateId: string, records: TemplateRecord[], options: TemplateOptions = {}): Promise<TemplateResponse> {
      return request("POST", "/messages/send-template", query({
        sms_template_id: templateId, test: options.test, sender: options.sender,
        scheduled_at: options.scheduledAt,
      }), { records });
    },
    /** GET /sent-view. Delivery status can change after a send. */
    getSentView(options: SentViewOptions = {}): Promise<SentViewResponse> {
      return request("GET", "/sent-view", query({
        filters: options.filters, q: options.q, sorts: options.sorts,
        page: options.page, paginate: options.paginate,
      }));
    },
  };
}
