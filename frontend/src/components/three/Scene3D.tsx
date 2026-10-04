import { lazy, Suspense, useState } from 'react'
import type { SceneVariant } from './CapsuleScene'

const CapsuleScene = lazy(() => import('./CapsuleScene'))

function webglAvailable() {
  if (typeof window === 'undefined' || /jsdom/i.test(navigator.userAgent)) return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Loads Three.js only when WebGL exists; otherwise renders nothing (CSS backdrop shows instead). */
export function Scene3D(props: { variant?: SceneVariant; progress?: number; className?: string }) {
  const [supported] = useState(webglAvailable)
  if (!supported) return null
  return (
    <Suspense fallback={null}>
      <CapsuleScene {...props} />
    </Suspense>
  )
}
