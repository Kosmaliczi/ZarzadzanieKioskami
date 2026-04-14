import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useFtp, useKiosks } from '../hooks'

export default function TextEditor() {
  const kioskService = useKiosks()
  const ftpService = useFtp()

  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [filePath, setFilePath] = useState('napis.txt')
  const [content, setContent] = useState('')
  const [connection, setConnection] = useState({ hostname: '', username: '', password: '', port: 21 })

  const { data: kiosks } = useAsync(() => kioskService.getKiosks())

  const connectMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const credentials = await kioskService.getFtpCredentials(kioskId)
    const next = {
      hostname: credentials.ip_address || '',
      username: credentials.ftp_username || 'root',
      password: credentials.ftp_password || '',
      port: 21,
    }
    setConnection(next)
    return next
  })

  const loadMutation = useMutation(async () => {
    const text = await ftpService.getFileContent({
      ...connection,
      path: filePath,
    })
    setContent(text)
    return text
  })

  const saveMutation = useMutation(async () => {
    await ftpService.putFileContent({
      ...connection,
      path: filePath,
      content,
    })
  })

  return (
    <section id="text-editor" className={ui.section}>
      <h2 className={ui.sectionTitle}>Edytor pliku tekstowego (.txt)</h2>

      <div className={`${ui.card} space-y-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${ui.select} max-w-xs`} value={selectedKioskId} onChange={(event) => setSelectedKioskId(event.target.value)}>
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
      </div>
    </section>
  )
}
