import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import WAVES from '../vanta.waves.js'

export default function VantaWaves() {
  const vantaRef = useRef(null)
  const effectRef = useRef(null)

  useEffect(() => {
    if (!effectRef.current && vantaRef.current) {
      effectRef.current = WAVES({
        el: vantaRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        backgroundAlpha: 1,
        minHeight: 200,
        minWidth: 200,
        scale: 3,
        scaleMobile: 1,
        color: 0x005588,
        shininess: 105,
        waveHeight: 20,
        waveSpeed: 1,
        zoom: 1,
      })
    }

    return () => {
      if (effectRef.current) {
        effectRef.current.destroy()
        effectRef.current = null
      }
    }
  }, [])

  return <div ref={vantaRef} className="vanta-bg" aria-hidden="true" />
}
