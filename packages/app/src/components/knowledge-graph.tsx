import { createEffect, createRoot, onCleanup, onMount, untrack } from "solid-js"
import type { ForceGraph3DInstance, NodeObject } from "3d-force-graph"
import type { Group, Mesh, MeshPhysicalMaterial, Sprite } from "three"
import { type KnowledgeSource, type Relation } from "@/utils/knowledge"
import { nodeColor, nodeSizes, nodeIconNames } from "@/utils/knowledge-edit"
import { iconSVG } from "@opencode-ai/ui/icon"
import { knowledgeLayout } from "@/utils/knowledge-layout"

const cameras = new Map<
  string,
  { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }
>()
export const knowledgeColors = {
  document: "#9471df",
  note: "#7598df",
  link: "#9294ca",
  entity: "#a38cca",
  project: "#7455f6",
}
type GraphNode = NodeObject & KnowledgeSource
type Visual = {
  group: Group
  body: Mesh
  glow: Sprite
  icon: Sprite
  label: Sprite
  radius: number
  degree: number
  signature: string
}

export function KnowledgeGraph(props: {
  nodes: KnowledgeSource[]
  relations: Relation[]
  selected: string
  visibleIds: Set<string>
  relatedRootId: string
  highlightedRelatedIds: Set<string>
  highlightedSearchIds?: Set<string>
  space: string
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onUnavailable: () => void
  controls: (value: {
    reset: () => void
    zoom: (factor: number) => void
    hold: () => void
    focus: (id: string) => void
  }) => void
}) {
  let host!: HTMLDivElement
  let graph: ForceGraph3DInstance<GraphNode> | undefined
  let disposed = false
  let pendingStyle = false
  let observer: ResizeObserver | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let key = props.space
  let cleanupEffects = () => {}
  let removeEvents = () => {}
  const resources: { dispose: () => void }[] = []
  const nodeResources = new Map<string, { dispose: () => void }[]>()
  const visuals = new Map<string, Visual>()
  const layouts = new Map<string, Map<string, Pick<GraphNode, "x" | "y" | "z" | "fx" | "fy" | "fz">>>()
  const saveCamera = () => {
    if (!graph) return
    const position = graph.cameraPosition()
    const controls = graph.controls() as { target: { x: number; y: number; z: number } }
    cameras.set(key, {
      position: { x: position.x, y: position.y, z: position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    })
  }
  onMount(() => {
    void Promise.all([import("3d-force-graph"), import("three"), import("./knowledge-node-material")])
      .then(([module, three, { nodeMaterial, nodeEnvironment }]) => {
        if (disposed) return
        const { default: ForceGraph3D } = module
        const {
          CanvasTexture,
          Sprite,
          SpriteMaterial,
          Group,
          SRGBColorSpace,
          Mesh,
          SphereGeometry,
          MeshBasicMaterial,
          HemisphereLight,
          DirectionalLight,
          PerspectiveCamera,
          Vector3,
          Fog,
        } = three
        let clickedNodeId = ""
        // The library constructor erases its node generic; graphData below owns it.
        graph = (new ForceGraph3D(host, { controlType: "orbit" }) as unknown as ForceGraph3DInstance<GraphNode>)
          .backgroundColor("#ffffff00")
          .showNavInfo(false)
          .showPointerCursor((object) => !!object)
          .nodeLabel(() => "")
          .width(host.clientWidth)
          .height(host.clientHeight)
          .linkWidth(0.3)
          .linkResolution(4)
          .linkCurvature(0.15)
          .linkDirectionalArrowLength((link) =>
            "type" in link && link.type !== "RELATED_TO" && link.type !== "demo" ? 3 : 0,
          )
          .linkDirectionalArrowRelPos(0.72)
          .linkCurveRotation((link) => (String(link.source).length % 2 ? 0.45 : -0.45))
          .cooldownTicks(0)
          .onEngineStop(() => {
            if (pendingStyle) {
              pendingStyle = false
              untrack(styleSelection)
            }
            host.setAttribute("aria-busy", "false")
          })
          .enableNodeDrag(true)
          .onNodeClick((node) => {
            clickedNodeId = node.id
            props.onSelect(props.selected === node.id ? "" : node.id)
          })
          .onBackgroundClick(() => props.onSelect(""))
          .onNodeDragEnd((node) => {
            node.fx = node.x
            node.fy = node.y
            node.fz = node.z
          })
        const releasePointerRepair = repairDragPointer(graph.renderer().domElement)
        removeEvents = releasePointerRepair
        const camera = graph.camera()
        if (!(camera instanceof PerspectiveCamera)) throw new Error("perspective camera required")
        camera.fov = 42
        camera.updateProjectionMatrix()
        graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
        const environment = nodeEnvironment(graph.renderer())
        graph.scene().environment = environment.texture
        resources.push(environment)
        const light = new DirectionalLight("#ffffff", 2.8)
        light.position.set(-170, 240, 320)
        const rim = new DirectionalLight("#b5a0ff", 0.65)
        rim.position.set(180, -80, -150)
        graph.lights([new HemisphereLight("#fdfaff", "#a6bce0", 1.3), light, rim])
        const fog = new Fog("#faf9ff", 500, 1000)
        graph.scene().fog = fog
        const geometry = new SphereGeometry(1, 40, 28)
        const lowGeometry = new SphereGeometry(1, 12, 8)
        resources.push(geometry, lowGeometry)
        const materials = new Map<string, MeshPhysicalMaterial>()
        const bodyMaterial = (
          color: string,
          muted = false,
          style: NonNullable<KnowledgeSource["visual"]>["style"] = "glow",
        ) => {
          const dense = props.nodes.length > 80
          const key = `${color}:${muted}:${dense}:${style}`
          if (!materials.has(key)) {
            const material = nodeMaterial(color, muted, dense, style)
            materials.set(key, material)
            resources.push(material)
          }
          return materials.get(key)!
        }
        const normalLink = new MeshBasicMaterial({
          color: "#a79bc3",
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        })
        const activeLink = new MeshBasicMaterial({
          color: "#9a7cdd",
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        })
        const mutedLink = new MeshBasicMaterial({
          color: "#a79bc3",
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        })
        resources.push(normalLink, activeLink, mutedLink)
        const glowCanvas = document.createElement("canvas")
        glowCanvas.width = glowCanvas.height = 128
        const glowContext = glowCanvas.getContext("2d")!
        const gradient = glowContext.createRadialGradient(64, 64, 18, 64, 64, 64)
        gradient.addColorStop(0, "#a98cff90")
        gradient.addColorStop(0.48, "#a8baff38")
        gradient.addColorStop(1, "#cfc1ff00")
        glowContext.fillStyle = gradient
        glowContext.fillRect(0, 0, 128, 128)
        const glowTexture = new CanvasTexture(glowCanvas)
        glowTexture.colorSpace = SRGBColorSpace
        resources.push(glowTexture)
        const createSprite = (node: GraphNode, label: boolean) => {
          const canvas = document.createElement("canvas")
          canvas.width = label ? 384 : 128
          canvas.height = label ? 96 : 128
          const ctx = canvas.getContext("2d")!
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillStyle = label ? "#39324f" : "#ffffff"
          ctx.font = label ? "500 28px sans-serif" : "500 58px sans-serif"
          const words = node.name.split(" ")
          const lines =
            label && node.name.length > 21
              ? [
                  words.slice(0, Math.ceil(words.length / 2)).join(" "),
                  words.slice(Math.ceil(words.length / 2)).join(" "),
                ]
              : [node.name]
          if (label)
            lines.forEach((line, index) =>
              ctx.fillText(
                line.length > 25 ? `${line.slice(0, 24)}…` : line,
                192,
                lines.length > 1 ? 29 + index * 34 : 43,
              ),
            )
          const texture = new CanvasTexture(canvas)
          texture.colorSpace = SRGBColorSpace
          if (!label) {
            const image = new Image()
            image.onload = () => {
              if (disposed || !nodeResources.get(node.id)?.includes(texture)) return
              ctx.drawImage(image, 24, 24, 80, 80)
              texture.needsUpdate = true
              image.onload = null
            }
            image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSVG(nodeIconNames[node.visual?.icon ?? node.type] ?? "code-lines"))}`
          }
          const material = new SpriteMaterial({ map: texture, depthWrite: false, depthTest: false, toneMapped: false })
          nodeResources.get(node.id)!.push(texture, material)
          const sprite = new Sprite(material)
          sprite.renderOrder = label ? 4 : 3
          sprite.raycast = () => {}
          return sprite
        }
        const fitCamera = () => {
          const nodes = graph!.graphData().nodes
          // Fit both axes with space for labels/halos. Width is no longer tied to a
          // fixed camera distance, so ultrawide and mobile get the same composition.
          const halfWidth = Math.max(120, ...nodes.map((node) => Math.abs(node.x ?? 0) + 42))
          const halfHeight = Math.max(95, ...nodes.map((node) => Math.abs(node.y ?? 0) + 43))
          const depth = Math.max(0, ...nodes.map((node) => node.z ?? 0))
          const tangent = Math.tan((camera.fov * Math.PI) / 360)
          const distance =
            Math.max(
              halfHeight / tangent,
              halfWidth / ((tangent * host.clientWidth) / Math.max(1, host.clientHeight)),
            ) + depth
          return { x: 0, y: 0, z: distance }
        }
        const updateLabels = () => {
          if (!graph) return
          const occupied: { x: number; y: number; w: number; h: number }[] = []
          const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
          const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
          const width = host.clientWidth
          const height = host.clientHeight
          const bodies = graph
            .graphData()
            .nodes.filter((node) => props.visibleIds.has(node.id))
            .map((node) => {
              const center = new Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0)
              const radius =
                ((visuals.get(node.id)?.radius ?? 0) * height) /
                (2 * camera.position.distanceTo(center) * Math.tan((camera.fov * Math.PI) / 360))
              const point = center.project(camera)
              return {
                id: node.id,
                x: ((point.x + 1) * width) / 2 - radius,
                y: ((1 - point.y) * height) / 2 - radius,
                w: radius * 2,
                h: radius * 2,
              }
            })
          const ordered = graph
            .graphData()
            .nodes.toSorted(
              (a, b) =>
                (b.id === props.selected ? 1000 : 0) +
                (visuals.get(b.id)?.degree ?? 0) -
                (a.id === props.selected ? 1000 : 0) -
                (visuals.get(a.id)?.degree ?? 0),
            )
          // Screen-space boxes prevent labels from colliding at any orbit angle.
          ordered.forEach((node) => {
            const visual = visuals.get(node.id)
            if (!visual) return
            visual.label.visible = false
            if (!props.visibleIds.has(node.id)) return
            const center = new Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0)
            const distance = camera.position.distanceTo(center)
            const worldPerPixel = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(height, 1)
            const px = node.id === props.selected ? 13.5 : 12
            visual.label.scale.set(((384 * px) / 28) * worldPerPixel, ((96 * px) / 28) * worldPerPixel, 1)
            const key =
              node.id === props.selected ||
              props.highlightedRelatedIds.has(node.id) ||
              props.highlightedSearchIds?.has(node.id) ||
              visual.degree >= 3
            visual.label.visible = false
            if (occupied.length >= 22 || (!key && visual.radius / worldPerPixel <= 10)) return
            const obstacles = [...occupied, ...bodies.filter((body) => body.id !== node.id)]
            const positions = [up.clone().multiplyScalar(-(visual.radius + 18 * worldPerPixel))]
            if (key)
              positions.push(
                right.clone().multiplyScalar(visual.radius + 78 * worldPerPixel),
                right.clone().multiplyScalar(-(visual.radius + 78 * worldPerPixel)),
                up.clone().multiplyScalar(visual.radius + 20 * worldPerPixel),
              )
            const placement = positions
              .map((offset) => {
                const point = center.clone().add(offset).project(camera)
                return {
                  offset,
                  point,
                  box: { x: ((point.x + 1) * width) / 2 - 70, y: ((1 - point.y) * height) / 2 - 17, w: 140, h: 34 },
                }
              })
              .find(
                (item) =>
                  item.point.z < 1 &&
                  item.point.z > -1 &&
                  item.box.x > 0 &&
                  item.box.x + item.box.w < width &&
                  item.box.y > 44 &&
                  item.box.y + item.box.h < height - 35 &&
                  !obstacles.some(
                    (other) =>
                      item.box.x < other.x + other.w &&
                      item.box.x + item.box.w > other.x &&
                      item.box.y < other.y + other.h &&
                      item.box.y + item.box.h > other.y,
                  ),
              )
            if (!placement) return
            visual.label.visible = true
            visual.label.position.copy(placement.offset)
            occupied.push(placement.box)
          })
          const controls = graph.controls() as { target: { x: number; y: number; z: number } }
          const distance = camera.position.distanceTo(
            new Vector3(controls.target.x, controls.target.y, controls.target.z),
          )
          fog.near = distance + 25
          fog.far = distance + 520
        }
        const styleSelection = () => {
          if (!graph) return
          const visibleIds = props.visibleIds
          graph.nodeVisibility((node) => visibleIds.has(node.id))
          graph.linkVisibility(
            (link) =>
              visibleIds.has(typeof link.source === "object" ? String(link.source.id) : String(link.source)) &&
              visibleIds.has(typeof link.target === "object" ? String(link.target.id) : String(link.target)),
          )
          const highlighting = !!props.relatedRootId || props.highlightedSearchIds !== undefined
          const highlighted = new Set([
            props.relatedRootId,
            ...props.highlightedRelatedIds,
            ...(props.highlightedSearchIds ?? []),
          ])
          const neighbors = new Set(
            props.relations
              .filter((r) => r.source === props.selected || r.target === props.selected)
              .flatMap((r) => [r.source, r.target]),
          )
          graph.graphData().nodes.forEach((node) => {
            const visual = visuals.get(node.id)
            if (!visual) return
            const dense = props.nodes.length > 80
            const selected = node.id === props.selected
            const highlightedNode = highlighted.has(node.id)
            const muted = highlighting
              ? !highlightedNode && !selected
              : !!props.selected && !neighbors.has(node.id) && !selected
            visual.radius = node.type === "project" ? 20 : 14 + Math.min(5, Math.sqrt(visual.degree) * 1.6)
            visual.radius *= nodeSizes[node.visual?.size ?? "standard"] ?? 1
            if (dense) visual.radius *= 0.65
            if (selected) visual.radius *= 1.45
            visual.body.geometry = dense ? lowGeometry : geometry
            visual.body.scale.setScalar(visual.radius)
            visual.body.material = bodyMaterial(
              node.visual?.color ?? (selected ? "#aa83ee" : nodeColor(node)),
              muted,
              node.visual?.style,
            )
            visual.glow.visible =
              node.visual?.style !== "outline" && (!dense || selected || highlightedNode || neighbors.has(node.id))
            visual.glow.scale.setScalar(visual.radius * (selected ? 3.8 : 3.1))
            visual.glow.material.opacity = selected ? 0.7 : highlighting ? (highlightedNode ? 0.65 : 0.16) : 0.4
            visual.icon.scale.setScalar(visual.radius * 0.98)
            visual.icon.material.opacity = selected ? 0.95 : highlighting && muted ? 0.45 : 0.78
            visual.icon.material.color.set(selected ? "#ffffff" : "#7653b5")
          })
          graph.linkMaterial((link) => {
            const source = typeof link.source === "object" ? link.source.id : link.source
            const target = typeof link.target === "object" ? link.target.id : link.target
            if (highlighting)
              return highlighted.has(String(source)) && highlighted.has(String(target)) ? activeLink : mutedLink
            return source === props.selected || target === props.selected ? activeLink : normalLink
          })
          updateLabels()
        }
        graph.nodeThreeObject((node) => {
          if (visuals.has(node.id)) return visuals.get(node.id)!.group
          nodeResources.set(node.id, [])
          const group = new Group()
          const body = new Mesh(geometry, bodyMaterial("#b69af0"))
          const glowMaterial = new SpriteMaterial({ map: glowTexture, depthWrite: false, toneMapped: false })
          nodeResources.get(node.id)!.push(glowMaterial)
          const glow = new Sprite(glowMaterial)
          glow.raycast = () => {}
          const icon = createSprite(node, false)
          const label = createSprite(node, true)
          const degree = props.relations.filter((r) => r.source === node.id || r.target === node.id).length
          visuals.set(node.id, {
            group,
            body,
            glow,
            icon,
            label,
            radius: 11.5,
            degree,
            signature: JSON.stringify([node.name, node.visual?.icon ?? node.type]),
          })
          group.add(glow, body, icon, label)
          return group
        })
        const update = () => {
          if (!graph) return
          const changedSpace = key !== props.space
          const initial = graph.graphData().nodes.length === 0
          if (changedSpace) {
            saveCamera()
            // Return from demo to the same arrangement, including dragged nodes
            // and positions retained when newly uploaded materials were added.
            layouts.set(
              key,
              new Map(
                graph.graphData().nodes.map((node) => [
                  node.id,
                  {
                    x: node.x,
                    y: node.y,
                    z: node.z,
                    fx: node.fx,
                    fy: node.fy,
                    fz: node.fz,
                  },
                ]),
              ),
            )
            key = props.space
          }
          const old = new Map((changedSpace ? [] : graph.graphData().nodes).map((node) => [node.id, node]))
          const positions = knowledgeLayout(props.nodes.slice(0, 250), props.relations)
          const nodes = props.nodes.slice(0, 250).map((node) => {
            const position = positions.get(node.id)!
            const saved = layouts.get(key)?.get(node.id)
            // three-forcegraph binds meshes to object identity, not just ID.
            // Keep existing node objects so a data edit does not detach their meshes.
            return Object.assign(old.get(node.id) ?? {}, node, {
              x: old.get(node.id)?.x ?? saved?.x ?? position.x,
              y: old.get(node.id)?.y ?? saved?.y ?? position.y,
              z: old.get(node.id)?.z ?? saved?.z ?? position.z,
              fx: old.get(node.id)?.fx ?? saved?.fx,
              fy: old.get(node.id)?.fy ?? saved?.fy,
              fz: old.get(node.id)?.fz ?? saved?.fz,
            })
          })
          const ids = new Set(nodes.map((node) => node.id))
          visuals.forEach((visual, id) => {
            const node = nodes.find((item) => item.id === id)
            if (node) {
              const signature = JSON.stringify([node.name, node.visual?.icon ?? node.type])
              if (visual.signature !== signature) {
                visual.group.remove(visual.icon, visual.label)
                nodeResources
                  .get(id)
                  ?.filter((resource) => resource !== visual.glow.material)
                  .forEach((resource) => resource.dispose())
                nodeResources.set(id, [visual.glow.material])
                visual.icon = createSprite(node, false)
                visual.label = createSprite(node, true)
                visual.group.add(visual.icon, visual.label)
                visual.signature = signature
              }
              visual.degree = props.relations.filter((edge) => edge.source === id || edge.target === id).length
              return
            }
            visual.group.removeFromParent()
            nodeResources.get(id)?.forEach((r) => r.dispose())
            nodeResources.delete(id)
            visuals.delete(id)
          })
          graph.linkWidth(nodes.length > 80 ? 0 : 0.3)
          pendingStyle = true
          graph.graphData({
            nodes,
            links: props.relations.filter((r) => ids.has(r.source) && ids.has(r.target)).map((r) => ({ ...r })),
          })
          if (initial || changedSpace) {
            const saved = cameras.get(key)
            graph.cameraPosition(saved?.position ?? fitCamera(), saved?.target ?? { x: 0, y: 0, z: 0 })
          }
          untrack(styleSelection)
        }
        cleanupEffects = createRoot((dispose) => {
          createEffect(update)
          createEffect(styleSelection)
          return dispose
        })
        const focus = (id: string) => {
          const node = graph?.graphData().nodes.find((node) => node.id === id)
          if (!node) return
          props.onFocus(id)
          graph?.cameraPosition(
            { x: node.x ?? 0, y: node.y ?? 0, z: (node.z ?? 0) + 230 },
            { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
            600,
          )
        }
        // Pointer clicks are filtered by the graph's clickAfterDrag(false).
        // Keep their target even when the second click toggles selection off.
        const clearClick = () => {
          clickedNodeId = ""
        }
        const doubleClick = () => {
          // The graph dispatches its accepted pointerup click on the next frame.
          requestAnimationFrame(() => {
            if (disposed || !clickedNodeId) return
            props.onSelect(clickedNodeId)
            focus(clickedNodeId)
          })
        }
        const contextLost = (event: Event) => {
          event.preventDefault()
          props.onUnavailable()
        }
        host.addEventListener("pointerdown", clearClick, true)
        host.addEventListener("dblclick", doubleClick)
        graph.renderer().domElement.addEventListener("webglcontextlost", contextLost)
        removeEvents = () => {
          releasePointerRepair()
          host.removeEventListener("pointerdown", clearClick, true)
          host.removeEventListener("dblclick", doubleClick)
          graph?.renderer().domElement.removeEventListener("webglcontextlost", contextLost)
        }
        props.controls({
          hold: () => {
            if (!graph) return
            // Cancel an unfinished focus tween at its current pose, not its destination.
            const position = graph.cameraPosition()
            const target = (graph.controls() as { target: { x: number; y: number; z: number } }).target
            graph.cameraPosition(position, { x: target.x, y: target.y, z: target.z })
          },
          reset: () => graph?.cameraPosition(fitCamera(), { x: 0, y: 0, z: 0 }, 500),
          zoom: (factor) => {
            if (!graph) return
            const p = graph.cameraPosition()
            const target = (graph.controls() as { target: { x: number; y: number; z: number } }).target
            graph.cameraPosition(
              {
                x: target.x + (p.x - target.x) * factor,
                y: target.y + (p.y - target.y) * factor,
                z: target.z + (p.z - target.z) * factor,
              },
              undefined,
              200,
            )
          },
          focus,
        })
        let fittedDistance = fitCamera().z
        observer = new ResizeObserver(() => {
          if (!graph) return
          const nextFit = fitCamera().z
          const factor = nextFit / fittedDistance
          fittedDistance = nextFit
          const p = graph.cameraPosition()
          const target = (graph.controls() as { target: { x: number; y: number; z: number } }).target
          graph.width(host.clientWidth).height(host.clientHeight)
          // Preserve the user's relative zoom and orbit when the canvas changes
          // aspect ratio (sidebar, fullscreen, or a mobile viewport).
          if (Math.abs(factor - 1) > 0.001)
            graph.cameraPosition({
              x: target.x + (p.x - target.x) * factor,
              y: target.y + (p.y - target.y) * factor,
              z: target.z + (p.z - target.z) * factor,
            })
          updateLabels()
        })
        observer.observe(host)
        timer = setInterval(() => {
          saveCamera()
          updateLabels()
        }, 120)
      })
      .catch(() => {
        if (!disposed) props.onUnavailable()
      })
  })
  onCleanup(() => {
    disposed = true
    saveCamera()
    cleanupEffects()
    removeEvents()
    observer?.disconnect()
    clearInterval(timer)
    const renderer = graph?.renderer()
    const scene = graph?.scene()
    graph?.pauseAnimation()
    if (scene) scene.environment = null
    // Dispose our textures/targets while the renderer's disposal listeners and
    // property tables still exist; its destructor clears those tables first.
    nodeResources.forEach((items) => items.forEach((item) => item.dispose()))
    resources.splice(0).forEach((item) => item.dispose())
    graph?._destructor()
    renderer?.forceContextLoss()
    // three-render-objects publishes a debug reference, even in production.
    if (scene && Reflect.get(window, "scene") === scene) Reflect.deleteProperty(window, "scene")
    graph = undefined
    visuals.clear()
    nodeResources.clear()
  })
  return <div ref={host} class="kb-webgl" aria-busy="true" />
}

// 3d-force-graph 1.80 synthesizes a touch pointerup with ID 0 after a node
// drag. OrbitControls tracks the real ID and otherwise mistakes the remaining
// mouse pointer for a touch. Correct only that synthetic event for this canvas;
// trusted mouse/touch events and events from other controls are unchanged.
function repairDragPointer(canvas: HTMLCanvasElement) {
  let pointer: PointerEvent | undefined
  const record = (event: PointerEvent) => {
    pointer = event
  }
  const release = (event: PointerEvent) => {
    if (
      !pointer ||
      event.isTrusted ||
      event.target !== canvas.ownerDocument ||
      event.pointerId !== 0 ||
      event.pointerType !== "touch"
    )
      return
    const actual = pointer
    pointer = undefined
    event.stopImmediatePropagation()
    canvas.ownerDocument.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: actual.pointerId,
        pointerType: actual.pointerType,
        clientX: actual.clientX,
        clientY: actual.clientY,
      }),
    )
  }
  const clear = (event: PointerEvent) => {
    if (event.pointerId === pointer?.pointerId) pointer = undefined
  }
  canvas.addEventListener("pointerdown", record, true)
  canvas.addEventListener("pointerup", record, true)
  canvas.addEventListener("pointercancel", record, true)
  canvas.ownerDocument.addEventListener("pointerup", release, true)
  canvas.ownerDocument.addEventListener("pointerup", clear)
  return () => {
    canvas.removeEventListener("pointerdown", record, true)
    canvas.removeEventListener("pointerup", record, true)
    canvas.removeEventListener("pointercancel", record, true)
    canvas.ownerDocument.removeEventListener("pointerup", release, true)
    canvas.ownerDocument.removeEventListener("pointerup", clear)
  }
}
