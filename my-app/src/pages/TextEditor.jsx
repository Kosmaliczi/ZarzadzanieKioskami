import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useFtp, useKiosks } from '../hooks'

export default function TextEditor() {
  const kioskService = useKiosks()
  const ftpService = useFtp()

  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [filePath, setFilePath] = useState('/home/kiosk/napis.txt')
  const [content, setContent] = useState('')
  const [connection, setConnection] = useState({ hostname: '', username: '', password: '', port: 22 })
  const [actionInfo, setActionInfo] = useState('')

  const { data: kiosks } = useAsync(() => kioskService.getKiosks())

  const findKioskById = (kioskId) => (kiosks || []).find((kiosk) => kiosk.id === kioskId)

  const getDefaultTextPath = (kiosk, port) => {
    const custom = (kiosk?.text_file_path || '').trim()
    if (custom) {
      return custom
    }
    return Number(port) === 22 ? '/home/kiosk/napis.txt' : 'napis.txt'
  }

  const handleSelectedKioskChange = (nextIdRaw) => {
    setSelectedKioskId(nextIdRaw)

    const kioskId = Number(nextIdRaw)
    if (!kioskId) {
      return
    }

    const selectedKiosk = findKioskById(kioskId)
    if (!selectedKiosk) {
      return
    }

    setFilePath(getDefaultTextPath(selectedKiosk, Number(connection.port || 22)))
  }

  const connectMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const credentials = await kioskService.getFtpCredentials(kioskId)
    const selectedKiosk = findKioskById(kioskId)
    const base = {
      hostname: credentials.ip_address || '',
      username: credentials.ftp_username || 'root',
      password: credentials.ftp_password || '',
      port: 22,
      kioskId,
    }

    const result = await ftpService.testConnection(base)
    const resolvedPort = Number(result.port || 22)
    const next = { ...base, port: resolvedPort }
    setConnection(next)

    setFilePath((currentPath) => {
      const normalized = String(currentPath || '').trim()
      if (!normalized || normalized === 'napis.txt' || normalized === '/home/kiosk/MediaPionowe/napis.txt') {
        return getDefaultTextPath(selectedKiosk, resolvedPort)
      }
      return currentPath
    })

    setActionInfo(`Połączono przez ${String(result.protocol || 'ftp').toUpperCase()}:${resolvedPort}`)
    return next
  })

  const loadMutation = useMutation(async () => {
    const text = await ftpService.getFileContent({
      ...connection,
      path: filePath,
      kioskId: Number(selectedKioskId),
    })
    setContent(text)
    return text
  })

  const saveMutation = useMutation(async () => {
    await ftpService.putFileContent({
      ...connection,
      path: filePath,
      content,
      kioskId: Number(selectedKioskId),
    })
  })

  return (
    <section id="text-editor" className={ui.section}>
      <h2 className={ui.sectionTitle}>Edytor pliku tekstowego (.txt)</h2>

      <div className={`${ui.card} space-y-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${ui.select} max-w-xs`} value={selectedKioskId} onChange={(event) => handleSelectedKioskChange(event.target.value)}>
            <option value="">Wybierz kiosk...</option>
            {(kiosks || []).map((kiosk) => (
              <option key={kiosk.id} value={kiosk.id}>{kiosk.name || `Kiosk #${kiosk.id}`}</option>
            ))}
          </select>
          <button className={ui.btnPrimary} onClick={() => connectMutation.execute()} disabled={!selectedKioskId || connectMutation.loading}>
            {connectMutation.loading ? 'Łączenie...' : 'Połącz'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input className={`${ui.input} min-w-60 flex-1`} value={filePath} onChange={(event) => setFilePath(event.target.value)} />
          <button className={ui.btn} onClick={() => loadMutation.execute()} disabled={!connection.hostname || loadMutation.loading}>
            {loadMutation.loading ? 'Wczytywanie...' : 'Wczytaj'}
          </button>
          <button className={ui.btnPrimary} onClick={() => saveMutation.execute()} disabled={!connection.hostname || saveMutation.loading}>
            {saveMutation.loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>

        <textarea className={`${ui.textarea} min-h-56 w-full`} value={content} onChange={(event) => setContent(event.target.value)} />

        {connectMutation.error ? <p className="text-sm text-red-600">{connectMutation.error.message}</p> : null}
        {loadMutation.error ? <p className="text-sm text-red-600">{loadMutation.error.message}</p> : null}
        {saveMutation.error ? <p className="text-sm text-red-600">{saveMutation.error.message}</p> : null}
        {actionInfo ? <p className="text-sm text-blue-700">{actionInfo}</p> : null}
      </div>
    </section>
  )
}
