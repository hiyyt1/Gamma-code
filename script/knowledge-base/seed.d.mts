export function seedKnowledge(): Promise<{
  status: "created" | "exists"
  spaceID: string
  materials: number
  nodes?: number
  relations?: number
  files?: number
}>
