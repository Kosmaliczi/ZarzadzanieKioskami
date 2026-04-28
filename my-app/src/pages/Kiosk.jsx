import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useKiosks } from '../hooks'

const initialForm = {
  name: '',
  mac_address: '',
  serial_number: '',
  ftp_username: '',
  ftp_password: '',
}

export default function Kiosk() {
  const kioskService = useKiosks()
  const [form, setForm] = useState(initialForm)
  const [localConflictError, setLocalConflictError] = useState('')
  const [actionInfo, setActionInfo] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(initialForm)
  const [sshPasswordDialog, setSshPasswordDialog] = useState(false)
  const [sshPasswordInput, setSshPasswordInput] = useState('')
  const [pendingRestartKiosk, setPendingRestartKiosk] = useState(null)
  const [pathSettingsDialog, setPathSettingsDialog] = useState(false)
  const [pathSettingsKiosk, setPathSettingsKiosk] = useState(null)
  const [scrollingTextHiddenByKiosk, setScrollingTextHiddenByKiosk] = useState({})
  const [pathSettingsForm, setPathSettingsForm] = useState({
    media_path: '',
    text_file_path: '',
    playlist_target_file: '',
  })
  const [vncModalOpen, setVncModalOpen] = useState(false)
  const [vncKiosk, setVncKiosk] = useState(null)

  const { data: kiosks, loading, error, refetch } = useAsync(() => kioskService.getKiosks())

  const createMutation = useMutation((payload) => kioskService.createKiosk(payload || form), {
    onSuccess: async () => {
      setForm(initialForm)
      await refetch()
    },
  })

  const deleteMutation = useMutation((id) => kioskService.deleteKiosk(id), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const updateMutation = useMutation(({ id, payload }) => kioskService.updateKiosk(id, payload), {
    onSuccess: async () => {
      setEditingId(null)
      await refetch()
    },
  })

  const rotateMutation = useMutation(({ id, orientation }) => kioskService.rotateDisplay(id, orientation), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const scrollingTextMutation = useMutation(({ id, hidden, text }) => kioskService.setScrollingTextVisibility(id, hidden, text), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const restartMutation = useMutation(({ id, username, port, password }) => kioskService.restartService(id, { username, port, password }), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const handleCreate = async (event) => {
    event.preventDefault()

    const normalizedForm = {
      ...form,
      name: form.name.trim(),
      mac_address: form.mac_address.trim().toUpperCase(),
      serial_number: form.serial_number.trim().toUpperCase(),
      ftp_username: form.ftp_username.trim(),
      ftp_password: form.ftp_password.trim(),
    }

    setLocalConflictError('')

    const duplicate = rows.find(
      (kiosk) =>
        kiosk.mac_address?.trim().toUpperCase() === normalizedForm.mac_address ||
        kiosk.serial_number?.trim().toUpperCase() === normalizedForm.serial_number
    )

    if (duplicate) {
      setLocalConflictError(
        `Kiosk już istnieje (ID: ${duplicate.id}, MAC: ${duplicate.mac_address}, S/N: ${duplicate.serial_number}).`
      )
      return
    }

    try {
      await createMutation.execute(normalizedForm)
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : ''

      if (code === 'HTTP_409') {
        await refetch()
      }
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Usunąć kiosk?')) {
      return
    }
    try {
      await deleteMutation.execute(id)
    } catch {
      // error is handled by deleteMutation.error state
    }
  }

  const handleEditStart = (kiosk) => {
    setEditingId(kiosk.id)
    setEditForm({
      name: kiosk.name || '',
      mac_address: kiosk.mac_address || '',
      serial_number: kiosk.serial_number || '',
      ftp_username: kiosk.ftp_username || '',
      ftp_password: '',
    })
    setActionInfo('')
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditForm(initialForm)
  }

  const handleEditSave = async (kioskId) => {
    const payload = {
      name: editForm.name.trim(),
      mac_address: editForm.mac_address.trim().toUpperCase(),
      serial_number: editForm.serial_number.trim().toUpperCase(),
      ftp_username: editForm.ftp_username.trim(),
    }

    if (editForm.ftp_password.trim()) {
      payload.ftp_password = editForm.ftp_password.trim()
    }

    try {
      await updateMutation.execute({ id: kioskId, payload })
      setActionInfo(`Kiosk #${kioskId} został zaktualizowany`)
    } catch {
      // handled by updateMutation.error
    }
  }

  const handleRestart = async (kiosk) => {
    if (!kiosk.ip_address) {
      setActionInfo('Brak IP kiosku - restart przez SSH niemożliwy')
      return
    }

    setPendingRestartKiosk(kiosk)
    setSshPasswordInput('')
    setSshPasswordDialog(true)
  }

  const handleConfirmSshPassword = async () => {
    if (!sshPasswordInput.trim() || !pendingRestartKiosk) {
      setActionInfo('Hasło SSH nie może być puste')
      return
    }

    setSshPasswordDialog(false)

    try {
      await restartMutation.execute({
        id: pendingRestartKiosk.id,
        username: pendingRestartKiosk.ftp_username || 'root',
        port: 22,
        password: sshPasswordInput.trim(),
      })
      setActionInfo(`Wysłano restart usługi dla kiosku #${pendingRestartKiosk.id}`)
    } catch {
      // handled by restartMutation.error
    } finally {
      setSshPasswordInput('')
      setPendingRestartKiosk(null)
    }
  }

  const handleCancelSshPassword = () => {
    setSshPasswordDialog(false)
    setSshPasswordInput('')
    setPendingRestartKiosk(null)
  }

  const handleOpenSsh = (kiosk) => {
    if (!kiosk.ip_address) {
      setActionInfo('Brak IP kiosku - nie można otworzyć SSH')
      return
    }

    // Log SSH access attempt
    const logSshAccess = async () => {
      try {
        await kioskService.logSshAccess(kiosk.id)
      } catch (err) {
        console.error('Błąd logowania dostępu SSH:', err)
      }
    }
    logSshAccess()

    const username = kiosk.ftp_username || 'root'
    window.open(`ssh://${username}@${kiosk.ip_address}`, '_blank', 'noopener,noreferrer')
  }

  const handleOpenVnc = (kiosk) => {
    if (!kiosk.ip_address) {
      setActionInfo('Brak IP kiosku - nie można otworzyć VNC')
      return
    }

    // Log VNC access attempt
    const logVncAccess = async () => {
      try {
        await kioskService.logVncAccess(kiosk.id)
      } catch (err) {
        console.error('Błąd logowania dostępu VNC:', err)
      }
    }
    logVncAccess()

    setVncKiosk(kiosk)
    setVncModalOpen(true)
  }

  const handleRotate = async (kiosk) => {
    const currentOrientation = String(kiosk.orientation || 'normal').trim().toLowerCase()
    const nextOrientation = currentOrientation === 'right' ? 'normal' : 'right'

    try {
      await rotateMutation.execute({ id: kiosk.id, orientation: nextOrientation })
      setActionInfo(`Wysłano obrót ekranu na ${nextOrientation} dla kiosku #${kiosk.id}`)
    } catch {
      // handled by rotateMutation.error / service error state
    }
  }

  const handleToggleScrollingText = async (kiosk) => {
    const currentlyHidden = Boolean(scrollingTextHiddenByKiosk[kiosk.id])
    const nextHidden = !currentlyHidden

    try {
      await scrollingTextMutation.execute({
        id: kiosk.id,
        hidden: nextHidden,
      })

      setScrollingTextHiddenByKiosk((prev) => ({
        ...prev,
        [kiosk.id]: nextHidden,
      }))

      setActionInfo(
        nextHidden
          ? `Ukryto scrolling text dla kiosku #${kiosk.id}`
          : `Przywrócono scrolling text dla kiosku #${kiosk.id}`
      )
    } catch {
      // handled by scrollingTextMutation.error
    }
  }

  const handleOpenPathSettings = (kiosk) => {
    setPathSettingsKiosk(kiosk)
    setPathSettingsForm({
      media_path: kiosk.media_path || '',
      text_file_path: kiosk.text_file_path || '',
      playlist_target_file: kiosk.playlist_target_file || '',
    })
    setPathSettingsDialog(true)
  }

  const handleClosePathSettings = () => {
    setPathSettingsDialog(false)
    setPathSettingsKiosk(null)
    setPathSettingsForm({ media_path: '', text_file_path: '', playlist_target_file: '' })
  }

  const handleSavePathSettings = async () => {
    if (!pathSettingsKiosk?.id) {
      return
    }

    try {
      await updateMutation.execute({
        id: pathSettingsKiosk.id,
        payload: {
          media_path: pathSettingsForm.media_path.trim(),
          text_file_path: pathSettingsForm.text_file_path.trim(),
          playlist_target_file: pathSettingsForm.playlist_target_file.trim(),
        },
      })
      setActionInfo(`Zapisano ustawienia ścieżek dla kiosku #${pathSettingsKiosk.id}`)
      handleClosePathSettings()
    } catch {
      // handled by updateMutation.error
    }
  }

  const rows = kiosks || []

  return (
    <section id="kiosks" className={ui.section}>
      <div className={ui.headerRow}>
        <h2 className={ui.sectionTitle}>Zarządzanie kioskami</h2>
      </div>

      <form onSubmit={handleCreate} className={`${ui.card} grid gap-3 md:grid-cols-5`}>
        <input className={ui.input} placeholder="Nazwa" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input className={ui.input} placeholder="MAC" value={form.mac_address} onChange={(event) => setForm({ ...form, mac_address: event.target.value })} required />
        <input className={ui.input} placeholder="Serial" value={form.serial_number} onChange={(event) => setForm({ ...form, serial_number: event.target.value })} required />
        <input className={ui.input} placeholder="FTP user" value={form.ftp_username} onChange={(event) => setForm({ ...form, ftp_username: event.target.value })} />
        <input className={ui.input} type="password" placeholder="FTP hasło" value={form.ftp_password} onChange={(event) => setForm({ ...form, ftp_password: event.target.value })} />
        <div className="md:col-span-5">
          <button type="submit" className={ui.btnPrimary} disabled={createMutation.loading}>
            {createMutation.loading ? 'Dodawanie...' : 'Dodaj kiosk'}
          </button>
        </div>
      </form>

      {loading ? <p className={ui.muted}>Ładowanie kiosków...</p> : null}
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
      {localConflictError ? <p className="text-sm text-red-600">{localConflictError}</p> : null}
      {createMutation.error ? <p className="text-sm text-red-600">{createMutation.error.message}</p> : null}
      {updateMutation.error ? <p className="text-sm text-red-600">{updateMutation.error.message}</p> : null}
      {restartMutation.error ? <p className="text-sm text-red-600">{restartMutation.error.message}</p> : null}
      {rotateMutation.error ? <p className="text-sm text-red-600">{rotateMutation.error.message}</p> : null}
      {scrollingTextMutation.error ? <p className="text-sm text-red-600">{scrollingTextMutation.error.message}</p> : null}
      {deleteMutation.error ? <p className="text-sm text-red-600">{deleteMutation.error.message}</p> : null}
      {actionInfo ? <p className="text-sm text-blue-700">{actionInfo}</p> : null}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>ID</th>
              <th className={ui.th}>Nazwa</th>
              <th className={ui.th}>MAC</th>
              <th className={ui.th}>S/N</th>
              <th className={ui.th}>IP</th>
              <th className={ui.th}>Status</th>
              <th className={ui.th}>Obrót</th>
              <th className={ui.th}>Ostatnie połączenie</th>
              <th className={ui.th}>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((kiosk) => (
              <tr key={kiosk.id}>
                <td className={ui.td}>{kiosk.id}</td>
                <td className={ui.td}>
                  {editingId === kiosk.id ? (
                    <input
                      className={ui.input}
                      value={editForm.name}
                      onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                    />
                  ) : (
                    kiosk.name || '-'
                  )}
                </td>
                <td className={ui.td}>
                  {editingId === kiosk.id ? (
                    <input
                      className={ui.input}
                      value={editForm.mac_address}
                      onChange={(event) => setEditForm({ ...editForm, mac_address: event.target.value })}
                    />
                  ) : (
                    kiosk.mac_address
                  )}
                </td>
                <td className={ui.td}>
                  {editingId === kiosk.id ? (
                    <input
                      className={ui.input}
                      value={editForm.serial_number}
                      onChange={(event) => setEditForm({ ...editForm, serial_number: event.target.value })}
                    />
                  ) : (
                    kiosk.serial_number
                  )}
                </td>
                <td className={ui.td}>{kiosk.ip_address || '-'}</td>
                <td className={ui.td}>
                  <span className={kiosk.status === 'online' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
                    {kiosk.status}
                  </span>
                </td>
                <td className={ui.td}>{kiosk.orientation || 'normal'}</td>
                <td className={ui.td}>{kiosk.last_connection || '-'}</td>
                <td className={ui.td}>
                  <div className="flex flex-wrap gap-2">
                    {editingId === kiosk.id ? (
                      <>
                        <button className={ui.btnPrimary} onClick={() => handleEditSave(kiosk.id)} disabled={updateMutation.loading}>
                          Zapisz
                        </button>
                        <button className={ui.btnSecondary} onClick={handleEditCancel}>
                          Anuluj
                        </button>
                      </>
                    ) : (
                      <>
                        <button className={ui.btnSecondary} onClick={() => handleEditStart(kiosk)}>
                          Edytuj
                        </button>
                        <button className={ui.btn} onClick={() => handleRestart(kiosk)} disabled={restartMutation.loading}>
                          Restart
                        </button>
                        <button className={ui.btn} onClick={() => handleOpenSsh(kiosk)}>
                          SSH
                        </button>
                        <button className={ui.btn} onClick={() => handleOpenVnc(kiosk)}>
                          VNC
                        </button>
                        <button className={ui.btn} onClick={() => handleRotate(kiosk)} disabled={rotateMutation.loading}>
                          Obróć
                        </button>
                        <button
                          className={ui.btn}
                          onClick={() => handleToggleScrollingText(kiosk)}
                          disabled={scrollingTextMutation.loading}
                        >
                          {scrollingTextMutation.loading
                            ? 'Zapisywanie...'
                            : (scrollingTextHiddenByKiosk[kiosk.id] ? 'Pokaż napis' : 'Schowaj napis')}
                        </button>
                        <button className={ui.btn} onClick={() => handleOpenPathSettings(kiosk)}>
                          Ścieżki
                        </button>
                        <button className={ui.btnDanger} onClick={() => handleDelete(kiosk.id)} disabled={deleteMutation.loading}>
                          Usuń
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={9}>Brak kiosków</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {sshPasswordDialog ? (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Hasło SSH dla kiosku</h3>
            <p className="text-sm text-gray-600 mb-4">
              Wprowadź hasło SSH dla kiosku <strong>{pendingRestartKiosk?.name || `#${pendingRestartKiosk?.id}`}</strong>
            </p>
            <input
              type="password"
              className={ui.input}
              placeholder="Hasło SSH"
              value={sshPasswordInput}
              onChange={(event) => setSshPasswordInput(event.target.value)}
              onKeyPress={(event) => {
                if (event.key === 'Enter') {
                  handleConfirmSshPassword()
                }
              }}
              autoFocus
            />
            <div className="flex gap-3 mt-6">
              <button className={ui.btnPrimary} onClick={handleConfirmSshPassword} disabled={!sshPasswordInput.trim()}>
                Potwierdź
              </button>
              <button className={ui.btnSecondary} onClick={handleCancelSshPassword}>
                Anuluj
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pathSettingsDialog ? (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold">Ustawienia ścieżek kiosku</h3>
            <p className="text-sm text-gray-600">
              Kiosk <strong>{pathSettingsKiosk?.name || `#${pathSettingsKiosk?.id}`}</strong>
            </p>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Folder multimediów</label>
              <input
                className={ui.input}
                placeholder="np. /storage/videos"
                value={pathSettingsForm.media_path}
                onChange={(event) => setPathSettingsForm((prev) => ({ ...prev, media_path: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Plik tekstowy</label>
              <input
                className={ui.input}
                placeholder="np. /storage/napis.txt"
                value={pathSettingsForm.text_file_path}
                onChange={(event) => setPathSettingsForm((prev) => ({ ...prev, text_file_path: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Plik docelowy playlisty</label>
              <input
                className={ui.input}
                placeholder="np. /storage/videos/kiosk_playlist.m3u"
                value={pathSettingsForm.playlist_target_file}
                onChange={(event) => setPathSettingsForm((prev) => ({ ...prev, playlist_target_file: event.target.value }))}
              />
            </div>

            <p className="text-xs text-gray-500">
              Puste pole oznacza użycie domyślnej ścieżki zależnej od protokołu (FTP/SFTP).
            </p>

            <div className="flex gap-3 pt-2">
              <button className={ui.btnPrimary} onClick={handleSavePathSettings} disabled={updateMutation.loading}>
                {updateMutation.loading ? 'Zapisywanie...' : 'Zapisz ustawienia'}
              </button>
              <button className={ui.btnSecondary} onClick={handleClosePathSettings}>
                Anuluj
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {vncModalOpen ? (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-6 flex flex-col h-[80vh]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">VNC - {vncKiosk?.name || `Kiosk #${vncKiosk?.id}`}</h3>
              <button
                onClick={() => setVncModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 bg-gray-100 rounded border border-gray-300 overflow-hidden">
              <iframe
                src={`http://${vncKiosk?.ip_address}:6080/vnc.html`}
                title="VNC"
                className="w-full h-full border-none"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button className={ui.btnSecondary} onClick={() => setVncModalOpen(false)}>
                Zamknij
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
