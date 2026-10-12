import { createEffect, createRoot, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import type { KnowledgeSource } from "@/utils/knowledge"
import { nodeColor, nodeIconNames, nodeSizes } from "@/utils/knowledge-edit"

export function KnowledgeNodePreview(props: { source: KnowledgeSource }) {
  let host!: HTMLDivElement
  let disposed = false
  let release = () => {}
  const [state, setState] = createStore({ ready: false })
  onMount(() => {
    void Promise.all([import("three"), import("./knowledge-node-material")])
      .then(([three, material]) => {
        if (disposed) return
        const { WebGLRenderer, Scene, PerspectiveCamera, SphereGeometry, Mesh, HemisphereLight, DirectionalLight } =
          three
        const canvas = document.createElement("canvas")
        if (!canvas.getContext("webgl2")) return
        const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
        renderer.setSize(160, 120)
        host.prepend(renderer.domElement)
        const scene = new Scene()
        const camera = new PerspectiveCamera(42, 160 / 120, 0.1, 100)
        camera.position.z = 4.2
        const environment = material.nodeEnvironment(renderer)
        scene.environment = environment.texture
        const light = new DirectionalLight("#ffffff", 2.8)
        light.position.set(-170, 240, 320)
        const rim = new DirectionalLight("#b5a0ff", 0.65)
        rim.position.set(180, -80, -150)
        scene.add(new HemisphereLight("#fdfaff", "#a6bce0", 1.3), light, rim)
        const geometry = new SphereGeometry(1, 40, 28)
        const mesh = new Mesh(geometry, material.nodeMaterial(nodeColor(props.source)))
        scene.add(mesh)
        const disposeEffect = createRoot((dispose) => {
          createEffect(() => {
            mesh.material.dispose()
            mesh.material = material.nodeMaterial(nodeColor(props.source), false, false, props.source.visual?.style)
            mesh.scale.setScalar(nodeSizes[props.source.visual?.size ?? "standard"])
            renderer.render(scene, camera)
            setState("ready", true)
          })
          return dispose
        })
        release = () => {
          disposeEffect()
          mesh.material.dispose()
          geometry.dispose()
          environment.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
          renderer.domElement.remove()
        }
      })
      .catch(() => {
        release()
        if (!disposed) setState("ready", false)
      })
  })
  onCleanup(() => {
    disposed = true
    release()
  })
  return (
    <div
      class="kb-node-preview"
      ref={host}
      data-ready={state.ready}
      data-style={props.source.visual?.style ?? "glow"}
      style={{
        "--node-color": nodeColor(props.source),
        "--node-scale": nodeSizes[props.source.visual?.size ?? "standard"],
      }}
    >
      <span class="kb-node-preview-fallback" />
      <span class="kb-node-preview-icon">
        <Icon name={nodeIconNames[props.source.visual?.icon ?? props.source.type]} />
      </span>
    </div>
  )
}
