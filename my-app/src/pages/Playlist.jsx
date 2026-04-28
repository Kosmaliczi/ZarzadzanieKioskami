import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useFtp, useKiosks, usePlaylists } from '../hooks'

export default function Playlist() {
  const kioskService = useKiosks()
  const ftpService = useFtp()
  const playlistService = usePlaylists()
  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [availableFiles, setAvailableFiles] = useState([])
  const [playlistItems, setPlaylistItems] = useState([])
  const [playlistName, setPlaylistName] = useState('Default')
  const [orderMode, setOrderMode] = useState('manual')
  const [targetFile, setTargetFile] = useState('/storage/videos/kiosk_playlist.m3u')
  const [connection, setConnection] = useState({ hostname: '', username: '', password: '', port: 21 })
  const [actionInfo, setActionInfo] = useState('')

  const getDefaultMediaPath = (kiosk, port) => {
    const custom = (kiosk?.media_path || '').trim()
    if (custom) {
      return custom
    }
    return Number(port) === 22 ? '/storage/videos' : '/home/kiosk/MediaPionowe'
  }

  const getDefaultTargetFile = (kiosk, port) => {
    const custom = (kiosk?.playlist_target_file || '').trim()
    if (custom) {
      return custom.startsWith('/') ? custom : `${getDefaultMediaPath(kiosk, port).replace(/\/$/, '')}/${custom.replace(/^\//, '')}`
    }

    const mediaPath = getDefaultMediaPath(kiosk, port).replace(/\/$/, '')
    return `${mediaPath || '/storage/videos'}/kiosk_playlist.m3u`
  }

  const findKioskById = (kioskId) => (kiosks || []).find((kiosk) => kiosk.id === kioskId)

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

    setTargetFile(getDefaultTargetFile(selectedKiosk, Number(connection.port || 21)))
  }

  const { data: kiosks } = useAsync(() => kioskService.getKiosks())

  const loadFilesMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const credentials = await kioskService.getFtpCredentials(kioskId)
    const selectedKiosk = findKioskById(kioskId)

    const baseConnection = {
      hostname: credentials.ip_address || '',
      username: credentials.ftp_username || 'root',
      password: credentials.ftp_password || '',
      port: 21,
      kioskId,
    }

    const testResult = await ftpService.testConnection(baseConnection)
    const resolvedPort = Number(testResult.port || baseConnection.port)
    const nextConnection = { ...baseConnection, port: resolvedPort }
    setConnection(nextConnection)

    setTargetFile((currentTargetFile) => {
      const normalizedCurrent = String(currentTargetFile || '').trim()
      const default21 = getDefaultTargetFile(selectedKiosk, 21)
      const default22 = getDefaultTargetFile(selectedKiosk, 22)

      if (!normalizedCurrent || normalizedCurrent === default21 || normalizedCurrent === default22) {
        return getDefaultTargetFile(selectedKiosk, resolvedPort)
      }

      return currentTargetFile
    })

    const mediaPath = getDefaultMediaPath(selectedKiosk, resolvedPort)

    const result = await ftpService.listFiles({
      ...nextConnection,
      path: mediaPath,
      kioskId,
    })

    const onlyFiles = (result.files || []).filter((file) => file.type !== 'directory')
    setAvailableFiles(onlyFiles)
    setActionInfo(`Załadowano ${onlyFiles.length} plików z kiosku (${mediaPath})`)

    return result
  })

  const loadPlaylistMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const selectedKiosk = findKioskById(kioskId)
    const result = await playlistService.getKioskPlaylist(kioskId, playlistName)
    setPlaylistItems(result.items || [])
    setOrderMode(result.playlist?.order_mode || 'manual')
    setTargetFile(result.playlist?.targetFile || getDefaultTargetFile(selectedKiosk, Number(connection.port || 21)))
    setActionInfo(`Wczytano playlistę "${result.playlist?.name || playlistName}" (${(result.items || []).length} pozycji)`)
    return result
  })

  const savePlaylistMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const selectedKiosk = findKioskById(kioskId)
    const resolvedTargetFile = targetFile.trim() || getDefaultTargetFile(selectedKiosk, Number(connection.port || 21))
    const payload = {
      name: playlistName,
      orderMode,
      targetFile: resolvedTargetFile,
      items: playlistItems.map((item, index) => ({
        path: item.path,
        name: item.name,
        type: item.type || 'file',
        size: item.size || 0,
        position: index + 1,
        displayFrequency: Math.max(1, Number(item.displayFrequency || 1)),
      })),
    }

    const result = await playlistService.saveKioskPlaylist(kioskId, payload)
    if (result.synced) {
      setActionInfo(`Playlista zapisana (${result.itemsCount} pozycji) i zsynchronizowana do ${result.targetFile || targetFile}`)
    } else if (result.syncError) {
      setActionInfo(`Playlista zapisana w bazie, ale synchronizacja pliku nieudana: ${result.syncError}`)
    } else {
      setActionInfo(`Playlista zapisana (${result.itemsCount} pozycji)`)
    }
    return result
  })

  const addToPlaylist = (file) => {
    if (!file?.path) {
      return
    }
    const nextItem = {
      path: file.path,
      name: file.name,
      type: file.type || 'file',
      size: file.size || 0,
      displayFrequency: 1,
    }
    setPlaylistItems((prev) => [...prev, nextItem])
  }

  const updateItemFrequency = (indexToUpdate, frequency) => {
    setPlaylistItems((prev) =>
      prev.map((item, index) => {
        if (index !== indexToUpdate) {
          return item
        }
        const parsed = Number(frequency)
        return {
          ...item,
          displayFrequency: Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1,
        }
      })
    )
  }

  const removeFromPlaylist = (indexToRemove) => {
    setPlaylistItems((prev) => prev.filter((_, index) => index !== indexToRemove))
  }

  const movePlaylistItem = (from, to) => {
    setPlaylistItems((prev) => {
      if (to < 0 || to >= prev.length) {
        return prev
      }
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <section id="playlist" className={ui.section}>
      <div className={ui.headerRow}>
        <h2 className={ui.sectionTitle}>Zarządzanie playlistą</h2>
      </div>

      <div className={`${ui.card} grid gap-3 md:grid-cols-3`}>
        <select className={ui.select} value={selectedKioskId} onChange={(event) => handleSelectedKioskChange(event.target.value)}>
          <option value="">Wybierz kiosk...</option>
          {(kiosks || []).map((kiosk) => (
            <option key={kiosk.id} value={kiosk.id}>{kiosk.name || `Kiosk #${kiosk.id}`}</option>
          ))}
        </select>
        <input
          className={ui.input}
          value={playlistName}
          onChange={(event) => setPlaylistName(event.target.value)}
          placeholder="Nazwa playlisty"
        />
        <button className={ui.btn} onClick={() => loadFilesMutation.execute()} disabled={loadFilesMutation.loading || !selectedKioskId}>
          {loadFilesMutation.loading ? 'Ładowanie plików...' : 'Załaduj pliki kiosku'}
        </button>
        <select className={ui.select} value={orderMode} onChange={(event) => setOrderMode(event.target.value)}>
          <option value="manual">Kolejność ręczna</option>
          <option value="name_asc">Nazwa A-Z</option>
          <option value="name_desc">Nazwa Z-A</option>
          <option value="random">Losowa na cykl</option>
        </select>
        <input
          className={ui.input}
          value={targetFile}
          onChange={(event) => setTargetFile(event.target.value)}
          placeholder="Plik playlisty na kiosku"
        />
        <button className={ui.btn} onClick={() => loadPlaylistMutation.execute()} disabled={loadPlaylistMutation.loading || !selectedKioskId}>
          {loadPlaylistMutation.loading ? 'Wczytywanie...' : 'Wczytaj playlistę'}
        </button>
      </div>

      {loadFilesMutation.error ? <p className="text-sm text-red-600">{loadFilesMutation.error.message}</p> : null}
      {loadPlaylistMutation.error ? <p className="text-sm text-red-600">{loadPlaylistMutation.error.message}</p> : null}
      {savePlaylistMutation.error ? <p className="text-sm text-red-600">{savePlaylistMutation.error.message}</p> : null}
      {actionInfo ? <p className="text-sm text-blue-700">{actionInfo}</p> : null}

      <div className={`${ui.card} flex flex-wrap gap-2`}>
        <button className={ui.btnPrimary} onClick={() => savePlaylistMutation.execute()} disabled={!selectedKioskId || savePlaylistMutation.loading}>
          {savePlaylistMutation.loading ? 'Zapisywanie...' : 'Zapisz playlistę'}
        </button>
        <button className={ui.btnSecondary} onClick={() => setPlaylistItems([])} disabled={playlistItems.length === 0}>
          Wyczyść kolejkę
        </button>
        <span className={ui.muted}>Pozycje w playliście: {playlistItems.length}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Pliki kiosku</th>
                <th className={ui.th}>Rozmiar</th>
                <th className={ui.th}>Akcja</th>
              </tr>
            </thead>
            <tbody>
              {availableFiles.map((file) => (
                <tr key={`source-${file.path}`}>
                  <td className={ui.td}>{file.name}</td>
                  <td className={ui.td}>{file.size || 0}</td>
                  <td className={ui.td}>
                    <button className={ui.btn} onClick={() => addToPlaylist(file)}>Dodaj</button>
                  </td>
                </tr>
              ))}
              {availableFiles.length === 0 ? (
                <tr>
                  <td className={ui.td} colSpan={3}>Brak plików źródłowych</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>#</th>
                <th className={ui.th}>Kolejka playlisty</th>
                <th className={ui.th}>Częstotliwość / cykl</th>
                <th className={ui.th}>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {playlistItems.map((item, index) => (
                <tr key={`playlist-${item.path}-${index}`}>
                  <td className={ui.td}>{index + 1}</td>
                  <td className={ui.td}>{item.name}</td>
                  <td className={ui.td}>
                    <input
                      type="number"
                      min="1"
                      className={ui.input}
                      value={item.displayFrequency || 1}
                      onChange={(event) => updateItemFrequency(index, event.target.value)}
                    />
                  </td>
                  <td className={ui.td}>
                    <div className="flex gap-1">
                      <button className={ui.btn} onClick={() => movePlaylistItem(index, index - 1)} disabled={index === 0}>↑</button>
                      <button className={ui.btn} onClick={() => movePlaylistItem(index, index + 1)} disabled={index === playlistItems.length - 1}>↓</button>
                      <button className={ui.btnDanger} onClick={() => removeFromPlaylist(index)}>Usuń</button>
                    </div>
                  </td>
                </tr>
              ))}
              {playlistItems.length === 0 ? (
                <tr>
                  <td className={ui.td} colSpan={4}>Playlista jest pusta</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
