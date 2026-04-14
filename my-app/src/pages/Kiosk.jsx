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

  const restartMutation = useMutation(({ id, username, port }) => kioskService.restartService(id, { username, port }), {
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

    try {
      await restartMutation.execute({
        id: kiosk.id,
        username: kiosk.ftp_username || 'root',
        port: 22,
      })
      setActionInfo(`Wysłano restart usługi dla kiosku #${kiosk.id}`)
    } catch {
      // handled by restartMutation.error
    }
  }

  const handleOpenSsh = (kiosk) => {
    if (!kiosk.ip_address) {
      setActionInfo('Brak IP kiosku - nie można otworzyć SSH')
      return
    }

    const username = kiosk.ftp_username || 'root'
    window.open(`ssh://${username}@${kiosk.ip_address}`, '_blank', 'noopener,noreferrer')
  }

  const handleOpenVnc = (kiosk) => {
    if (!kiosk.ip_address) {
      setActionInfo('Brak IP kiosku - nie można otworzyć VNC')
      return
    }

    window.open(`http://${kiosk.ip_address}:6080`, '_blank', 'noopener,noreferrer')
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
                <td className={ui.td} colSpan={8}>Brak kiosków</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
