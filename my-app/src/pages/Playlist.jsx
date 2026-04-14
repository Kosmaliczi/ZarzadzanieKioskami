import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useFtp, useKiosks } from '../hooks'

export default function Playlist() {
  const kioskService = useKiosks()
  const ftpService = useFtp()
  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [files, setFiles] = useState([])

  const { data: kiosks } = useAsync(() => kioskService.getKiosks())

  const loadFilesMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const credentials = await kioskService.getFtpCredentials(kioskId)
    const result = await ftpService.listFiles({
      hostname: credentials.ip_address || '',
      username: credentials.ftp_username || 'root',
      password: credentials.ftp_password || '',
      port: 21,
      path: '/home/kiosk/MediaPionowe',
    })
    setFiles(result.files || [])
    return result
  })

  return (
    <section id="playlist" className={ui.section}>
      <div className={ui.headerRow}>
        <h2 className={ui.sectionTitle}>Zarządzanie playlistą</h2>
      </div>

      <div className={`${ui.card} flex flex-col gap-3 md:flex-row`}>
        <select className={ui.select} value={selectedKioskId} onChange={(event) => setSelectedKioskId(event.target.value)}>
          <option value="">Wybierz kiosk...</option>
          {(kiosks || []).map((kiosk) => (
            <option key={kiosk.id} value={kiosk.id}>{kiosk.name || `Kiosk #${kiosk.id}`}</option>
          ))}
        </select>
        <button className={ui.btnPrimary} onClick={() => loadFilesMutation.execute()} disabled={loadFilesMutation.loading || !selectedKioskId}>
          {loadFilesMutation.loading ? 'Pobieranie...' : 'Pobierz pliki'}
        </button>
      </div>

      {loadFilesMutation.error ? <p className="text-sm text-red-600">{loadFilesMutation.error.message}</p> : null}

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
                <td className={ui.td} colSpan={3}>Brak danych playlisty</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
