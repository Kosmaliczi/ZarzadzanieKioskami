import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useFtp, useKiosks } from '../hooks'
import { formatFileSize } from '../utils/apiHelpers'

export default function Ftp() {
  const kioskService = useKiosks()
  const ftpService = useFtp()
  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [connection, setConnection] = useState({ hostname: '', username: '', password: '', port: 21 })
  const [path, setPath] = useState('/')
  const [files, setFiles] = useState([])
  const [connectionInfo, setConnectionInfo] = useState('')
  const [selectedFiles, setSelectedFiles] = useState(new Set())
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')

  const getDefaultMediaPath = (kiosk, port) => {
    const custom = (kiosk?.media_path || '').trim()
    if (custom) {
      return custom
    }
    return Number(port) === 22 ? '/storage/videos' : '/home/kiosk/MediaPionowe'
  }

  const { data: kiosks } = useAsync(() => kioskService.getKiosks())

  const connectMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const credentials = await kioskService.getFtpCredentials(kioskId)
    const selectedKiosk = (kiosks || []).find((kiosk) => kiosk.id === kioskId)
    const draft = {
      hostname: credentials.ip_address || '',
      username: credentials.ftp_username || 'root',
      password: credentials.ftp_password || '',
      port: 22, // Spróbuj SFTP (port 22) - backend robi fallback na 21 (FTP) jeśli sie nie uda
      kioskId,
    }
    console.log(`Attempting connection to ${draft.hostname}:${draft.port}`)
    const connectionResult = await ftpService.testConnection(draft)
    const resolvedPort = Number(connectionResult.port || draft.port || 22)
    const next = {
      ...draft,
      port: resolvedPort,
    }
    console.log(`Connection successful, resolved port: ${resolvedPort}, protocol: ${connectionResult.protocol}`)
    setConnection(next)

    if (connectionResult.fallback) {
      setConnectionInfo(`Automatycznie przełączono na ${String(connectionResult.protocol).toUpperCase()}:${resolvedPort}`)
      if (path === '/') {
        setPath(getDefaultMediaPath(selectedKiosk, resolvedPort))
      }
    } else {
      setConnectionInfo(`Połączono przez ${String(connectionResult.protocol || 'sftp').toUpperCase()}:${resolvedPort}`)
      if (path === '/' || !path.trim()) {
        setPath(getDefaultMediaPath(selectedKiosk, resolvedPort))
      }
    }

    return next
  })

  const listMutation = useMutation((request) => ftpService.listFiles(request), {
    onSuccess: (result) => {
      setFiles(result.files || [])
    },
  })

  const deleteMutation = useMutation(async (filesToDelete) => {
    if (filesToDelete.length === 1) {
      const file = filesToDelete[0]
      await ftpService.deleteFile({
        hostname: connection.hostname,
        username: connection.username,
        password: connection.password,
        port: connection.port,
        path: file.path,
        isDirectory: file.type === 'directory'
      })
    } else {
      await ftpService.deleteMultipleFiles({
        hostname: connection.hostname,
        username: connection.username,
        password: connection.password,
        port: connection.port,
        files: filesToDelete.map(file => ({
          path: file.path,
          isDirectory: file.type === 'directory'
        }))
      })
    }
    // Odśwież listę plików po usunięciu
    await listMutation.execute({ ...connection, path, kioskId: Number(selectedKioskId) || undefined })
    setSelectedFiles(new Set())
  })

  const uploadMutation = useMutation(async (filesToUpload) => {
    // Użyj aktualnego state, nie closure
    if (!connection.hostname) {
      throw new Error('Najpierw połącz się z kioskiem')
    }
    
    // Oblicz poprawny path na podstawie aktualnego portu
    // Jeśli port się zmienił (np. fallback z 22 na 21), użyj odpowiedniego default path
    let uploadPath = path
    if (!path.trim()) {
      const selectedKiosk = (kiosks || []).find((kiosk) => kiosk.id === Number(selectedKioskId))
      uploadPath = getDefaultMediaPath(selectedKiosk, connection.port)
    }
    
    console.log(`Upload mutation: hostname=${connection.hostname}, port=${connection.port}, path=${uploadPath}`)
    
    setUploadProgress(`Przesyłanie ${filesToUpload.length} plik(ów)...`)
    
    await ftpService.uploadFiles({
      hostname: connection.hostname,
      username: connection.username,
      password: connection.password,
      port: connection.port,
      path: uploadPath,
      files: filesToUpload,
    })
    
    setUploadProgress('Upload ukończony!')
    setTimeout(() => setUploadProgress(''), 2000)
    
    // Odśwież listę plików po uploadzie
    await listMutation.execute({ ...connection, path: uploadPath, kioskId: Number(selectedKioskId) || undefined })
  })

  const handleConnect = async () => {
    const next = await connectMutation.execute()
    const kioskId = Number(selectedKioskId)
    const selectedKiosk = (kiosks || []).find((kiosk) => kiosk.id === kioskId)
    const effectivePath = path.trim() || getDefaultMediaPath(selectedKiosk, next.port)
    if (!path.trim()) {
      setPath(effectivePath)
    }
    await listMutation.execute({ ...next, path: effectivePath, kioskId })
  }

  const handleList = async () => {
    await listMutation.execute({ ...connection, path, kioskId: Number(selectedKioskId) || undefined })
  }

  const toggleFileSelection = (filePath) => {
    const newSelected = new Set(selectedFiles)
    if (newSelected.has(filePath)) {
      newSelected.delete(filePath)
    } else {
      newSelected.add(filePath)
    }
    setSelectedFiles(newSelected)
  }

  const toggleAllFiles = () => {
    if (selectedFiles.size === files.length && files.length > 0) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(files.map(f => f.path)))
    }
  }

  const handleDeleteSelected = async () => {
    const filesToDelete = files.filter(f => selectedFiles.has(f.path))
    if (filesToDelete.length === 0) return

    const fileNames = filesToDelete.map(f => f.name).join(', ')
    const confirmMessage = `Czy na pewno chcesz usunąć ${filesToDelete.length === 1 ? 'plik' : 'pliki'}: ${fileNames}?`
    if (!window.confirm(confirmMessage)) return

    await deleteMutation.execute(filesToDelete)
  }

  const handleDeleteFile = async (file) => {
    if (!window.confirm(`Czy na pewno chcesz usunąć: ${file.name}?`)) return
    await deleteMutation.execute([file])
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!connection.hostname) {
      alert('Najpierw połącz się z kioskiem')
      return
    }

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    await uploadMutation.execute(droppedFiles)
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
          {selectedFiles.size > 0 && (
            <button 
              className={`${ui.btn} bg-red-600 hover:bg-red-700 text-white`} 
              onClick={handleDeleteSelected} 
              disabled={deleteMutation.loading}
            >
              {deleteMutation.loading ? 'Usuwanie...' : `Usuń (${selectedFiles.size})`}
            </button>
          )}
        </div>
      </div>

      {connectMutation.error ? <p className="text-sm text-red-600">{connectMutation.error.message}</p> : null}
      {connectionInfo ? <p className="text-sm text-blue-700">{connectionInfo}</p> : null}
      {listMutation.error ? <p className="text-sm text-red-600">{listMutation.error.message}</p> : null}
      {deleteMutation.error ? <p className="text-sm text-red-600">{deleteMutation.error.message}</p> : null}
      {uploadMutation.error ? <p className="text-sm text-red-600">{uploadMutation.error.message}</p> : null}
      {uploadProgress ? <p className="text-sm text-blue-700">{uploadProgress}</p> : null}

      {connection.hostname && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragOver
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
          }`}
        >
          <p className="text-gray-600 mb-2">Przeciągnij pliki tutaj, aby je przesłać</p>
          <p className="text-xs text-gray-500">lub</p>
          <label className="inline-block mt-2 cursor-pointer">
            <span className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm">
              Wybierz pliki
            </span>
            <input
              type="file"
              multiple
              onChange={(e) => {
                const selectedFileList = e.currentTarget.files
                if (selectedFileList) {
                  uploadMutation.execute(Array.from(selectedFileList))
                }
              }}
              className="hidden"
            />
          </label>
        </div>
      )}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th} style={{ width: '40px' }}>
                <input 
                  type="checkbox" 
                  checked={selectedFiles.size === files.length && files.length > 0}
                  onChange={toggleAllFiles}
                  disabled={files.length === 0}
                />
              </th>
              <th className={ui.th}>Nazwa</th>
              <th className={ui.th}>Typ</th>
              <th className={ui.th}>Rozmiar</th>
              <th className={ui.th} style={{ width: '100px' }}>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path}>
                <td className={ui.td}>
                  <input 
                    type="checkbox" 
                    checked={selectedFiles.has(file.path)}
                    onChange={() => toggleFileSelection(file.path)}
                  />
                </td>
                <td className={ui.td}>{file.name}</td>
                <td className={ui.td}>{file.type}</td>
                <td className={ui.td}>{formatFileSize(file.size || 0)}</td>
                <td className={ui.td}>
                  <button
                    className="text-xs px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
                    onClick={() => handleDeleteFile(file)} 
                    disabled={deleteMutation.loading}
                  >
                    Usuń
                  </button>
                </td>
              </tr>
            ))}
            {files.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={5}>Brak plików</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
