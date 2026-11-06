import { z } from "zod";

export const INFORMATION_RECORD_MAX_BYTES = 1024 * 1024;
export const INFORMATION_RECORD_MAX_DEPTH = 64;
export const InformationOwnerSchema = z.enum(["fitness", "cashos", "pricetrace", "healthtrace"]);
export type InformationOwner = z.infer<typeof InformationOwnerSchema>;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const nonblank = (max: number) => z.string().max(max).refine(value => value.trim().length > 0, "빈 값은 사용할 수 없습니다.");

export function isInformationDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isInformationDateTime(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return !!match && isInformationDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60
    && Number(match[4]) < 60 && (!match[6] || Number(match[6]) < 24 && Number(match[7]) < 60)
    && Number.isFinite(Date.parse(value));
}

const dateTime = z.string().refine(isInformationDateTime, "시간대가 포함된 올바른 날짜·시각을 입력하세요.");
const webUri = z.string().max(2048).refine(value => {
  try { const url = new URL(value); return /^https?:\/\//i.test(value) && !/\s/.test(value) && /^https?:$/.test(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, "인증정보가 없는 HTTP 또는 HTTPS 주소만 사용할 수 있습니다.");

const SourceSchema = z.object({
  source_id: nonblank(128), kind: z.enum(["manual", "text", "file", "url", "device"]),
  text: z.string().max(100000).optional(), uri: webUri.optional(), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  name: nonblank(255).optional(), media_type: nonblank(127).optional(),
}).strict().superRefine((source, ctx) => {
  if (source.kind === "text" && !source.text?.trim()) ctx.addIssue({ code: "custom", message: "텍스트 출처에는 원문이 필요합니다." });
  if (source.kind === "url" && !source.uri) ctx.addIssue({ code: "custom", message: "URL 출처에는 주소가 필요합니다." });
  if (source.kind === "file" && (!source.sha256 || !source.name)) ctx.addIssue({ code: "custom", message: "파일 출처에는 이름과 SHA-256이 필요합니다." });
});

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
const JsonSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.string(), z.number(), z.boolean(), z.array(JsonSchema), z.record(JsonSchema),
]));
const FieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
  value_type: z.enum(["text", "decimal", "boolean", "date", "datetime", "json"]), value: JsonSchema,
  label: nonblank(120).optional(), unit: nonblank(64).optional(), confidence: z.number().min(0).max(1).optional(),
  source_ids: z.array(nonblank(128)).max(32).optional(),
}).strict().superRefine((field, ctx) => {
  const { value, value_type: type } = field;
  const valid = type === "json" || type === "text" && typeof value === "string" && value.length <= 100000
    || type === "decimal" && typeof value === "string" && value.length <= 128 && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
    || type === "boolean" && typeof value === "boolean"
    || type === "date" && typeof value === "string" && isInformationDate(value)
    || type === "datetime" && typeof value === "string" && isInformationDateTime(value);
  if (!valid) ctx.addIssue({ code: "custom", path: ["value"], message: "선택한 자료형과 값이 일치하지 않습니다." });
  if (field.unit !== undefined && type !== "decimal") ctx.addIssue({ code: "custom", path: ["unit"], message: "단위는 소수 값에만 지정할 수 있습니다." });
  if (field.source_ids && new Set(field.source_ids).size !== field.source_ids.length) ctx.addIssue({ code: "custom", path: ["source_ids"], message: "출처 ID가 중복되었습니다." });
});

export const InformationRecordSchema = z.object({
  schema_version: z.literal("information-record.v1"), record_id: uuid, owner_app: InformationOwnerSchema,
  record_type: z.string().max(100).regex(/^(fitness|cashos|pricetrace|healthtrace)\.[a-z][a-z0-9_.-]*$/),
  title: nonblank(200), captured_at: dateTime, occurred_at: dateTime.optional(), supersedes_record_id: uuid.optional(),
  sources: z.array(SourceSchema).min(1).max(32), fields: z.array(FieldSchema).min(1).max(128),
  references: z.array(z.object({
    owner_app: InformationOwnerSchema, record_id: nonblank(200), relation: nonblank(80),
    record_type: nonblank(100).optional(), project: nonblank(200).optional(), uri: webUri.optional(),
  }).strict()).max(64),
}).strict().superRefine((record, ctx) => {
  if (!record.record_type.startsWith(`${record.owner_app}.`)) ctx.addIssue({ code: "custom", path: ["record_type"], message: "기록 종류와 소유 앱이 다릅니다." });
  if (record.supersedes_record_id === record.record_id) ctx.addIssue({ code: "custom", path: ["supersedes_record_id"], message: "자기 자신을 수정 이력으로 연결할 수 없습니다." });
  const sources = new Set(record.sources.map(source => source.source_id));
  if (sources.size !== record.sources.length) ctx.addIssue({ code: "custom", path: ["sources"], message: "출처 ID가 중복되었습니다." });
  if (new Set(record.fields.map(field => field.key)).size !== record.fields.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "항목 키가 중복되었습니다." });
  record.fields.forEach((field, index) => {
    const namespace = field.key.split(".")[0];
    if (InformationOwnerSchema.options.includes(namespace as InformationOwner) && namespace !== record.owner_app) ctx.addIssue({ code: "custom", path: ["fields", index, "key"], message: "다른 앱의 정보는 참조로 연결하세요." });
    if (field.source_ids?.some(id => !sources.has(id))) ctx.addIssue({ code: "custom", path: ["fields", index, "source_ids"], message: "기록에 없는 출처입니다." });
  });
});

export type InformationRecord = z.infer<typeof InformationRecordSchema>;
export type InformationField = InformationRecord["fields"][number];
export type InformationInboxState = "pending" | "reviewed" | "archived";

function checkJsonStructure(text: string) {
  const containers: Array<Set<string> | null> = [];
  let inString = false; let escaped = false; let stringStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        inString = false;
        let next = index + 1;
        while (next < text.length && /[\t\n\r ]/.test(text[next])) next += 1;
        const keys = containers.at(-1);
        if (text[next] === ":" && keys) {
          // Compare decoded names so "a" and "\u0061" cannot hide different values.
          const key: string = JSON.parse(text.slice(stringStart, index + 1));
          if (keys.has(key)) throw new Error("같은 JSON 객체에 중복된 키가 있습니다.");
          keys.add(key);
        }
      }
    } else if (character === '"') { inString = true; stringStart = index; }
    else if (character === "{" || character === "[") {
      containers.push(character === "{" ? new Set() : null);
      if (containers.length > INFORMATION_RECORD_MAX_DEPTH) throw new Error("JSON 중첩은 64단계 이하여야 합니다.");
    } else if (character === "}" || character === "]") containers.pop();
  }
}

export function parseInformationRecord(input: unknown, expectedOwner: InformationOwner): InformationRecord {
  checkJsonStructure(JSON.stringify(input));
  const record = InformationRecordSchema.parse(input);
  if (record.owner_app !== expectedOwner) throw new Error(`${expectedOwner} 소유 정보만 가져올 수 있습니다.`);
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > INFORMATION_RECORD_MAX_BYTES) throw new Error("정보 파일은 1 MiB 이하여야 합니다.");
  return record;
}

export function parseInformationRecordText(text: string, expectedOwner: InformationOwner): InformationRecord {
  if (new TextEncoder().encode(text).byteLength > INFORMATION_RECORD_MAX_BYTES) throw new Error("정보 파일은 1 MiB 이하여야 합니다.");
  checkJsonStructure(text);
  return parseInformationRecord(JSON.parse(text), expectedOwner);
}

export function canonicalInformationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInformationJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalInformationJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
