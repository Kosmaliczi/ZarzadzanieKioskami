import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useFtp, useKiosks } from '../hooks'

export default function Ftp() {
  const kioskService = useKiosks()
  const ftpService = useFtp()
  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [connection, setConnection] = useState({ hostname: '', username: '', password: '', port: 21 })
  const [path, setPath] = useState('/')
  const [files, setFiles] = useState([])

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
    await ftpService.testConnection(next)
    return next
  })

  const listMutation = useMutation((request) => ftpService.listFiles(request), {
    onSuccess: (result) => {
      setFiles(result.files || [])
    },
  })

  const handleConnect = async () => {
    const next = await connectMutation.execute()
    await listMutation.execute({ ...next, path })
  }

  const handleList = async () => {
    await listMutation.execute({ ...connection, path })
  }

  return (
    <section id="ftp" className={ui.section}>
      <h2 className={ui.sectionTitle}>FTP</h2>

      <div className={`${ui.card} grid gap-3 md:grid-cols-3`}>
        <select className={ui.select} value={selectedKioskId} onChange={(event) => setSelectedKioskId(event.target.value)}>
          <option value="">Wybierz kiosk...</option>
          {(kiosks || []).map((kiosk) => (
            <option key={kiosk.id} value={kiosk.id}>{kiosk.name || `Kiosk #${kiosk.id}`}</option>
          ))}
        </select>
        <input className={ui.input} value={path} onChange={(event) => setPath(event.target.value)} placeholder="Ścieżka" />
        <div className="flex gap-2">
          <button className={ui.btnPrimary} onClick={handleConnect} disabled={connectMutation.loading || !selectedKioskId}>
            {connectMutation.loading ? 'Łączenie...' : 'Połącz'}
          </button>
          <button className={ui.btn} onClick={handleList} disabled={listMutation.loading || !connection.hostname}>
            {listMutation.loading ? 'Pobieranie...' : 'Odśwież'}
          </button>
        </div>
      </div>

      {connectMutation.error ? <p className="text-sm text-red-600">{connectMutation.error.message}</p> : null}
      {listMutation.error ? <p className="text-sm text-red-600">{listMutation.error.message}</p> : null}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Nazwa</th>
              <th className={ui.th}>Typ</th>
              <th className={ui.th}>Rozmiar</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path}>
                <td className={ui.td}>{file.name}</td>
                <td className={ui.td}>{file.type}</td>
                <td className={ui.td}>{file.size || 0}</td>
              </tr>
            ))}
            {files.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={3}>Brak plików</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
