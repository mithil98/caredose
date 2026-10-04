/**
 * Decorative 3D scene: glossy two-tone medicine capsules and a soft particle field.
 * Lazy-loaded (Three.js stays out of the main bundle). Pauses when off-screen or the tab is hidden,
 * renders a single still frame under reduced motion, and disposes everything on unmount.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type SceneVariant = 'hero' | 'loader' | 'badge'

interface Props {
  variant?: SceneVariant
  /** 0..1, only used by the loader (spins the orbit up as loading completes) */
  progress?: number
  className?: string
}

// [cap, body] from the palette: harbor blue / deep navy / mist halves on warm-white bodies
const TONES: [string, string][] = [
  ['#3f72af', '#f9f7f7'],
  ['#112d4e', '#dbe2ef'],
  ['#dbe2ef', '#3f72af'],
  ['#5d86bf', '#f9f7f7'],
  ['#112d4e', '#f9f7f7'],
  ['#3f72af', '#dbe2ef'],
]

function twoToneCapsule(a: string, b: string) {
  const geo = new THREE.CapsuleGeometry(0.42, 1.05, 12, 36)
  const top = new THREE.Color(a)
  const bottom = new THREE.Color(b)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) >= 0 ? top : bottom
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

interface Pill {
  mesh: THREE.Mesh
  base: THREE.Vector3
  phase: number
  speed: number
  spin: THREE.Vector3
}

export default function CapsuleScene({ variant = 'hero', progress = 0, className }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const progressRef = useRef(progress)
  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      return // no WebGL: the CSS gradient behind stays visible
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envMap

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
    camera.position.set(0, 0, variant === 'badge' ? 7 : 10)
    const key = new THREE.DirectionalLight('#f9f7f7', 1.5)
    key.position.set(4, 5, 6)
    const rim = new THREE.DirectionalLight('#9db6dc', 1.0)
    rim.position.set(-6, -2, 3)
    scene.add(key, rim, new THREE.AmbientLight('#ffffff', 0.35))

    const world = new THREE.Group()
    scene.add(world)
    const disposables: { dispose: () => void }[] = [envMap, pmrem]
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      sheen: 0.4,
    })
    disposables.push(material)

    const layout: [number, number, number, number][] =
      variant === 'badge'
        ? [
            [-0.9, 0.5, 0, 0.9],
            [0.9, -0.3, -0.6, 0.8],
            [0.1, -0.9, 0.8, 0.6],
          ]
        : variant === 'loader'
          ? Array.from({ length: 7 }, (_, i) => {
              const a = (i / 7) * Math.PI * 2
              return [Math.cos(a) * 2.4, Math.sin(a) * 2.4, Math.sin(a * 2) * 0.6, 0.62] as [number, number, number, number]
            })
          : // hero: x/y are viewport-normalised (-1..1) so copy on the left/bottom stays clear
            [
              [0.1, 0.8, -1, 1.0],
              [0.72, 0.62, -2.2, 0.95],
              [0.95, 0.02, -0.4, 1.1],
              [0.68, -0.72, 0.2, 1.05],
              [-0.42, 0.74, -2.8, 0.7],
              [0.62, -0.18, -4.5, 0.6],
              [0.62, -0.95, -3.5, 0.55],
            ]

    const pills: Pill[] = layout.map(([x, y, z, s], i) => {
      const [a, b] = TONES[i % TONES.length]
      const geo = twoToneCapsule(a, b)
      disposables.push(geo)
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.set(x, y, z)
      mesh.scale.setScalar(s)
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      world.add(mesh)
      return {
        mesh,
        base: mesh.position.clone(),
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.5,
        spin: new THREE.Vector3(0.15 + Math.random() * 0.25, 0.2 + Math.random() * 0.3, 0.05),
      }
    })

    // Particle field ("molecules"), coloured along the brand gradient.
    const count = variant === 'badge' ? 60 : 260
    const pts = new Float32Array(count * 3)
    const cols = new Float32Array(count * 3)
    const g = [new THREE.Color('#dbe2ef'), new THREE.Color('#9db6dc'), new THREE.Color('#f9f7f7')]
    for (let i = 0; i < count; i++) {
      pts.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, -2 - Math.random() * 6], i * 3)
      const c = g[i % 3]
      cols.set([c.r, c.g, c.b], i * 3)
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    pGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const pMat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false })
    const particles = new THREE.Points(pGeo, pMat)
    scene.add(particles)
    disposables.push(pGeo, pMat)

    // Pointer parallax target (whole window, so it reacts even over overlaid text).
    const target = new THREE.Vector2()
    const onPointer = (e: PointerEvent) => target.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5)
    window.addEventListener('pointermove', onPointer)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      if (variant === 'hero') {
        // map normalised layout to the visible frustum at each capsule's depth
        const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        layout.forEach(([nx, ny, z], i) => {
          const halfH = tan * (camera.position.z - z)
          pills[i].base.set(nx * halfH * camera.aspect, ny * halfH, z)
          pills[i].mesh.position.copy(pills[i].base)
        })
        world.scale.setScalar(Math.min(1, Math.max(0.65, camera.aspect)))
      }
      if (reduce) renderer.render(scene, camera) // still frame, re-drawn on resize
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    const clock = new THREE.Clock()
    let frame = 0
    let visible = true
    const render = () => {
      const t = clock.getElapsedTime()
      const boost = variant === 'loader' ? 0.35 + progressRef.current * 1.6 : 1
      for (const p of pills) {
        p.mesh.position.y = p.base.y + Math.sin(t * p.speed + p.phase) * 0.18
        p.mesh.rotation.x += 0.004 * p.spin.x * 4 * boost
        p.mesh.rotation.y += 0.004 * p.spin.y * 4 * boost
      }
      if (variant === 'loader') world.rotation.z -= 0.004 * boost
      world.rotation.y += (target.x * 0.5 - world.rotation.y) * 0.04
      world.rotation.x += (target.y * 0.35 - world.rotation.x) * 0.04
      particles.rotation.y = t * 0.02
      renderer.render(scene, camera)
    }
    const loop = () => {
      frame = requestAnimationFrame(loop)
      if (visible && !document.hidden) render()
    }
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(el)
    if (!reduce) loop()

    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [variant])

  return <div ref={host} className={className} aria-hidden />
}
