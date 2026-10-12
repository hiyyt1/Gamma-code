import {
  MeshPhysicalMaterial,
  CanvasTexture,
  SRGBColorSpace,
  EquirectangularReflectionMapping,
  PMREMGenerator,
} from "three"
import type { WebGLRenderer } from "three"
import type { KnowledgeSource } from "@/utils/knowledge"

// Shared by the map and the on-demand preview. No transmission render pass.
export function nodeMaterial(
  color: string,
  muted = false,
  dense = false,
  style: NonNullable<KnowledgeSource["visual"]>["style"] = "glow",
) {
  const material = new MeshPhysicalMaterial({
    color,
    metalness: 0.03,
    roughness: style === "outline" ? 0.8 : style === "glass" ? 0.05 : dense ? 0.3 : 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    transmission: 0,
    thickness: 12,
    ior: 1.38,
    attenuationColor: color,
    attenuationDistance: 65,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.4,
    transparent: style !== "glow" || !dense,
    opacity: dense ? 1 : muted ? 0.86 : 0.96,
    depthWrite: style === "glow" && dense,
  })
  // Pearl rim and a softly lit translucent centre retain volume even
  // at overview scale; studio highlights still respond to the camera.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
                float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
                float pearlRim = pow(1.0 - facing, 3.0);
                vec3 pearl = mix(vec3(0.79, 0.85, 1.0), vec3(1.0, 0.90, 1.0), normal.y * 0.5 + 0.5);
                vec3 surface = normalize(normal);
                float softbox = pow(max(dot(surface, normalize(vec3(-0.45, 0.6, 0.9))), 0.0), 34.0);
                float glint = pow(max(dot(surface, normalize(vec3(-0.46, 0.62, 0.85))), 0.0), 150.0);
                float meniscus = exp(-pow((facing - 0.36) * 20.0, 2.0));
                float lowerLight = meniscus * smoothstep(0.1, 0.65, -surface.y);
                outgoingLight *= 0.77 + 0.23 * smoothstep(-0.7, 0.65, surface.y);
                outgoingLight = mix(outgoingLight, pearl, pearlRim * 0.84);
                outgoingLight = mix(outgoingLight, vec3(0.77, 0.91, 1.0), lowerLight * 0.63);
                outgoingLight = mix(outgoingLight, vec3(1.0), softbox * 0.78);
                outgoingLight += vec3(glint * 0.48);
                ${style === "outline" ? "outgoingLight = diffuse; diffuseColor.a = mix(0.06, 0.85, smoothstep(0.55, 0.9, 1.0 - facing));" : style === "glass" ? "diffuseColor.a *= mix(0.28, 0.88, pearlRim);" : ""}
                #include <opaque_fragment>
              `,
    )
  }

  material.customProgramCacheKey = () => style
  return material
}

export function nodeEnvironment(renderer: WebGLRenderer) {
  const studio = document.createElement("canvas")
  studio.width = 1024
  studio.height = 512
  const studioContext = studio.getContext("2d")!
  const sky = studioContext.createLinearGradient(0, 0, 0, 512)
  sky.addColorStop(0, "#fcfaff")
  sky.addColorStop(0.45, "#cabce9")
  sky.addColorStop(1, "#9c88c5")
  studioContext.fillStyle = sky
  studioContext.fillRect(0, 0, 1024, 512)
  ;[
    [160, 100, 55, 150],
    [660, 140, 160, 38],
    [850, 350, 50, 100],
  ].forEach(([x, y, rx, ry]) => {
    studioContext.save()
    studioContext.shadowColor = "#ffffff"
    studioContext.shadowBlur = 35
    studioContext.fillStyle = "#ffffff"
    studioContext.beginPath()
    studioContext.ellipse(x, y, rx, ry, -0.4, 0, Math.PI * 2)
    studioContext.fill()
    studioContext.restore()
  })
  const studioTexture = new CanvasTexture(studio)
  studioTexture.colorSpace = SRGBColorSpace
  studioTexture.mapping = EquirectangularReflectionMapping
  const generator = new PMREMGenerator(renderer)
  const environment = generator.fromEquirectangular(studioTexture)
  studioTexture.dispose()
  generator.dispose()

  return environment
}
