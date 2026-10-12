import { expect, test } from "bun:test"
import { nodeMaterial } from "./knowledge-node-material"

test("material variants share a bounded, transmission-free rendering path", () => {
  for (const dense of [false, true]) {
    const materials = ["glow", "outline", "glass"].map((style) =>
      nodeMaterial("#b69af0", false, dense, style as "glow" | "outline" | "glass"),
    )
    expect(new Set(materials.map((material) => material.customProgramCacheKey())).size).toBe(3)
    materials.forEach((material) => {
      expect(material.transmission).toBe(0)
      expect(material.color.getHexString()).toBe("b69af0")
      expect(material.opacity).toBeGreaterThan(0)
      material.dispose()
    })
    expect(materials[1].transparent).toBe(true)
    expect(materials[2].depthWrite).toBe(false)
  }
})
