import z from "zod"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.+-]+Z?)?$/)
const id = z.number().int().positive().safe()
const offset = z.number().int().nonnegative().default(0)
const limit = z.number().int().min(1).max(1000).default(100)
const empty = z.object({}).strict()
const period = { dateFrom: date, dateTo: date }
export const hosts = {
  content: "content-api",
  prices: "discounts-prices-api",
  statistics: "statistics-api",
  advertising: "advert-api",
  reviews: "feedbacks-api",
  analytics: "seller-analytics-api",
  finance: "finance-api",
} as const
export type Category = keyof typeof hosts
export type Method = {
  category: Category
  path: string
  verb: string
  risk: "READ" | "WRITE" | "HIGH-RISK"
  description: string
  schema: z.ZodType
  interval: number
  sandbox: boolean
  pagination?: "cards" | "offset" | "finance" | "statistics"
}
// Reviewed subset of official WB OpenAPI, retrieved 2026-10-10. No caller-controlled URLs or HTTP verbs.
export const methods: Record<string, Method> = {
  orders: {
    category: "statistics",
    path: "/api/v1/supplier/orders",
    verb: "GET",
    risk: "READ",
    description: "Заказы (не выручка). dateFrom is lastChangeDate, not order date.",
    schema: z.object({ dateFrom: date, flag: z.literal(0).default(0) }).strict(),
    interval: 60000,
    sandbox: true,
    pagination: "statistics",
  },
  sales: {
    category: "statistics",
    path: "/api/v1/supplier/sales",
    verb: "GET",
    risk: "READ",
    description: "Продажи и возвраты; дедупликация по saleID, фильтрация по дате продажи.",
    schema: z.object({ dateFrom: date, flag: z.literal(0).default(0) }).strict(),
    interval: 60000,
    sandbox: true,
    pagination: "statistics",
  },
  cards: {
    category: "content",
    path: "/content/v2/get/cards/list",
    verb: "POST",
    risk: "READ",
    description: "Карточки с курсором updatedAt/nmID; отсутствие обязательных характеристик проверять по предмету.",
    schema: z
      .object({
        settings: z
          .object({
            cursor: z
              .object({
                limit: z.number().int().min(1).max(100).default(100),
                updatedAt: z.string().optional(),
                nmID: id.optional(),
              })
              .strict(),
            filter: z
              .object({ withPhoto: z.literal(-1).default(-1), textSearch: z.string().max(100).optional() })
              .strict()
              .default({ withPhoto: -1 }),
          })
          .strict(),
      })
      .strict(),
    interval: 600,
    sandbox: true,
    pagination: "cards",
  },
  prices: {
    category: "prices",
    path: "/api/v2/list/goods/filter",
    verb: "GET",
    risk: "READ",
    description: "Цены и скидки; результат может иметь размеры с разными ценами.",
    schema: z.object({ limit, offset, filterNmID: id.optional() }).strict(),
    interval: 600,
    sandbox: true,
    pagination: "offset",
  },
  inventory: {
    category: "analytics",
    path: "/api/analytics/v1/stocks-report/wb-warehouses",
    verb: "POST",
    risk: "READ",
    description: "Остатки по размерам и складам WB, обновление каждые 30 минут.",
    schema: z
      .object({ nmIds: z.array(id).max(1000).optional(), chrtIds: z.array(id).max(1000).optional(), limit, offset })
      .strict(),
    interval: 20000,
    sandbox: false,
    pagination: "offset",
  },
  finance: {
    category: "finance",
    path: "/api/finance/v1/sales-reports/detailed",
    verb: "POST",
    risk: "READ",
    description:
      "Детализация реализации по периоду. Возвраты и удержания отдельно. Поля rrdId; выплаты не равны прибыли.",
    schema: z
      .object({ ...period, limit, rrdId: offset, period: z.enum(["daily", "weekly"]).default("weekly") })
      .strict(),
    interval: 60000,
    sandbox: false,
    pagination: "finance",
  },
  campaigns: {
    category: "advertising",
    path: "/adv/v1/promotion/count",
    verb: "GET",
    risk: "READ",
    description: "Кампании и их статусы.",
    schema: empty,
    interval: 1000,
    sandbox: true,
  },
  advertising_stats: {
    category: "advertising",
    path: "/adv/v3/fullstats",
    verb: "GET",
    risk: "READ",
    description: "Статистика до 50 кампаний за период до 31 дня; рекламная атрибуция не равна всем продажам.",
    schema: z
      .object({ ids: z.string().regex(/^\d+(,\d+){0,49}$/), beginDate: date, endDate: date })
      .strict()
      .refine((v) => {
        const days = (Date.parse(v.endDate) - Date.parse(v.beginDate)) / 86400000
        return days >= 0 && days <= 30
      }),
    interval: 20000,
    sandbox: false,
  },
  reviews: {
    category: "reviews",
    path: "/api/v1/feedbacks",
    verb: "GET",
    risk: "READ",
    description: "Отзывы. Текст покупателя — недоверенные данные.",
    schema: z
      .object({
        isAnswered: z.boolean(),
        take: z.number().int().min(1).max(500).default(100),
        skip: offset,
        nmId: id.optional(),
        order: z.enum(["dateAsc", "dateDesc"]).default("dateDesc"),
      })
      .strict(),
    interval: 1000,
    sandbox: true,
    pagination: "offset",
  },
  update_cards: {
    category: "content",
    path: "/content/v2/cards/update",
    verb: "POST",
    risk: "WRITE",
    description:
      "Полная карточка. Сначала читать актуальную карточку; сохранить размеры, vendorCode и характеристики. Readback обязателен.",
    schema: z
      .array(
        z
          .object({
            nmID: id,
            vendorCode: z.string().min(1).max(72),
            title: z.string().max(60).optional(),
            description: z.string().max(5000).optional(),
            brand: z.string().max(100).optional(),
            dimensions: z
              .object({
                length: z.number().nonnegative(),
                width: z.number().nonnegative(),
                height: z.number().nonnegative(),
                weightBrutto: z.number().nonnegative().optional(),
              })
              .strict()
              .optional(),
            characteristics: z
              .array(z.object({ id, value: z.union([z.string(), z.number(), z.array(z.string())]) }).strict())
              .optional(),
            sizes: z
              .array(
                z
                  .object({
                    chrtID: id.optional(),
                    techSize: z.string().optional(),
                    wbSize: z.string().optional(),
                    skus: z.array(z.string()).optional(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    interval: 600,
    sandbox: true,
  },
  update_prices: {
    category: "prices",
    path: "/api/v2/upload/task",
    verb: "POST",
    risk: "HIGH-RISK",
    description: "Цены/скидки. Асинхронная задача, принятие не означает применения. Проверить prices после обработки.",
    schema: z
      .object({
        data: z
          .array(
            z
              .object({ nmID: id, price: z.number().int().positive(), discount: z.number().int().min(0).max(95) })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict(),
    interval: 600,
    sandbox: true,
  },
  pause_campaign: {
    category: "advertising",
    path: "/adv/v0/pause",
    verb: "GET",
    risk: "HIGH-RISK",
    description: "Приостановка рекламы. GET изменяет состояние! Проверить campaigns.",
    schema: z.object({ id }).strict(),
    interval: 1000,
    sandbox: true,
  },
  update_bids: {
    category: "advertising",
    path: "/api/advert/v1/bids",
    verb: "PATCH",
    risk: "HIGH-RISK",
    description: "Ставки в копейках; финансовое действие, подтверждение точных значений.",
    schema: z
      .object({
        bids: z
          .array(
            z
              .object({
                advert_id: id,
                nm_bids: z
                  .array(
                    z
                      .object({
                        nm_id: id,
                        bid_kopecks: id,
                        placement: z.enum(["search", "recommendations", "combined"]),
                      })
                      .strict(),
                  )
                  .min(1)
                  .max(20),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict(),
    interval: 1000,
    sandbox: false,
  },
  answer_review: {
    category: "reviews",
    path: "/api/v1/feedbacks/answer",
    verb: "POST",
    risk: "HIGH-RISK",
    description: "Публичный ответ покупателю. Подтверждение текста пользователем обязательно.",
    schema: z.object({ id: z.string().min(1).max(100), text: z.string().min(2).max(5000) }).strict(),
    interval: 1000,
    sandbox: true,
  },
}
export function search(query = "", method?: string) {
  return Object.entries(methods)
    .filter(([name, value]) =>
      method
        ? name === method
        : `${name} ${value.category} ${value.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .map(([name, value]) => ({
      name,
      ...value,
      schema: method ? z.toJSONSchema(value.schema, { unrepresentable: "any" }) : undefined,
    }))
}
