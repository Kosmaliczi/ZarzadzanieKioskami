/**
 * Example Implementation of Enterprise API Layer
 * Shows best practices and common patterns
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAsync, useMutation, useApi, useKiosks, useFtp, useReservations, useUsers } from './hooks'
import { handleApiError } from './utils/apiHelpers'

/**
 * Example 1: Kiosk List Component
 */
export function KioskListExample() {
  const kiosks = useKiosks()

  // Fetch kiosks on component mount
  const { data: kioskList, loading, error, refetch } = useAsync(
    () => kiosks.getKiosks(),
    {
      onSuccess: (data) => {
        console.log('Kiosks loaded:', data)
      },
      onError: (error) => {
        console.error('Failed to load kiosks:', error)
      },
    }
  )

  // Delete mutation with optimistic update
  const { execute: deleteKiosk, loading: isDeleting } = useMutation(
    (id) => kiosks.deleteKiosk(id as number),
    {
      onSuccess: () => {
        console.log('Kiosk deleted successfully')
        refetch() // Refresh list
      },
    }
  )

  if (loading) return <div>Loading kiosks...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <div>
      <h2>Kiosks List</h2>
      <button onClick={() => refetch()}>Refresh</button>

      <ul>
        {kioskList?.map((kiosk) => (
          <li key={kiosk.id}>
            <strong>{kiosk.name}</strong>
            <span style={{ color: kiosk.status === 'online' ? 'green' : 'red' }}>
              {kiosk.status}
            </span>
            <button
              onClick={() => deleteKiosk(kiosk.id)}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Example 2: Create Kiosk Form
 */
export function CreateKioskExample() {
  const kiosks = useKiosks()
  const [formData, setFormData] = useState({
    name: '',
    mac_address: '',
    serial_number: '',
    ftp_username: '',
    ftp_password: '',
  })

  // Create mutation with error handling
  const { execute: createKiosk, loading: isCreating, error } = useMutation(
    () => kiosks.createKiosk(formData),
    {
      onSuccess: (newKiosk) => {
        console.log('Created kiosk:', newKiosk)
        setFormData({
          name: '',
          mac_address: '',
          serial_number: '',
          ftp_username: '',
          ftp_password: '',
        })
      },
    }
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    try {
      const errorCheck = new FormData()
      // Validate form...
      if (!formData.name) {
        throw new Error('Name is required')
      }

      await createKiosk()
    } catch (err) {
      const { message } = handleApiError(err)
      alert(`Error: ${message}`)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Create Kiosk</h2>

      {error && <div style={{ color: 'red' }}>Error: {error.message}</div>}

      <input
        type="text"
        placeholder="Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        required
      />

      <input
        type="text"
        placeholder="MAC Address"
        value={formData.mac_address}
        onChange={(e) => setFormData({ ...formData, mac_address: e.target.value })}
        required
      />

      <input
        type="text"
        placeholder="Serial Number"
        value={formData.serial_number}
        onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
        required
      />

      <input
        type="text"
        placeholder="FTP Username"
        value={formData.ftp_username}
        onChange={(e) => setFormData({ ...formData, ftp_username: e.target.value })}
        required
      />

      <input
        type="password"
        placeholder="FTP Password"
        value={formData.ftp_password}
        onChange={(e) => setFormData({ ...formData, ftp_password: e.target.value })}
        required
      />

      <button type="submit" disabled={isCreating}>
        {isCreating ? 'Creating...' : 'Create Kiosk'}
      </button>
    </form>
  )
}

/**
 * Example 3: FTP File Management
 */
export function FtpManagerExample() {
  const ftp = useFtp()
  const [connectionInfo, setConnectionInfo] = useState({
    hostname: '192.168.1.100',
    username: 'root',
    password: '',
    port: 22,
  })
  const [currentPath, setCurrentPath] = useState('/storage/videos')

  // List files
  const { data: fileList, loading: isLoadingFiles, refetch: refetchFiles } = useAsync(
    () =>
      ftp.listFiles({
        ...connectionInfo,
        path: currentPath,
      }),
    {
      skipInitialLoad: true,
    }
  )

  // Delete file mutation
  const { execute: deleteFile, loading: isDeleting } = useMutation(
    (path) =>
      ftp.deleteFile({
        ...connectionInfo,
        path: path as string,
        isDirectory: false,
      }),
    {
      onSuccess: () => {
        console.log('File deleted')
        refetchFiles() // Refresh file list
      },
    }
  )

  const handleConnect = async () => {
    try {
      const result = await ftp.testConnection(connectionInfo)
      console.log('Connected:', result)
      refetchFiles() // Load files on successful connection
    } catch (error) {
      const { message } = handleApiError(error)
      alert(`Connection failed: ${message}`)
    }
  }

  return (
    <div>
      <h2>FTP Manager</h2>

      <div>
        <h3>Connection</h3>
        <input
          type="text"
          placeholder="Hostname"
          value={connectionInfo.hostname}
          onChange={(e) =>
            setConnectionInfo({ ...connectionInfo, hostname: e.target.value })
          }
        />
        <input
          type="text"
          placeholder="Username"
          value={connectionInfo.username}
          onChange={(e) =>
            setConnectionInfo({ ...connectionInfo, username: e.target.value })
          }
        />
        <input
          type="password"
          placeholder="Password"
          value={connectionInfo.password}
          onChange={(e) =>
            setConnectionInfo({ ...connectionInfo, password: e.target.value })
          }
        />
        <input
          type="number"
          placeholder="Port"
          value={connectionInfo.port}
          onChange={(e) =>
            setConnectionInfo({ ...connectionInfo, port: parseInt(e.target.value) })
          }
        />
        <button onClick={handleConnect}>Connect</button>
      </div>

      {isLoadingFiles && <p>Loading files...</p>}

      {fileList && (
        <div>
          <h3>Files in {currentPath}</h3>
          <ul>
            {ftp.sortFiles(fileList.files).map((file) => (
              <li key={file.path}>
                <span>{file.type === 'directory' ? '📁' : '📄'} {file.name}</span>
                {file.type === 'file' && (
                  <button
                    onClick={() => deleteFile(file.path)}
                    disabled={isDeleting}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Example 4: Reservation Management
 */
export function ReservationExample() {
  const reservations = useReservations()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [name, setName] = useState('Rezerwacja')

  // Check availability
  const { execute: checkAvailability, loading: isChecking } = useMutation(() =>
    reservations.checkAvailability({
      date,
      start_time: startTime,
      end_time: endTime,
      name,
    })
  )

  // Create reservation
  const { execute: createReservation, loading: isCreating } = useMutation(
    () =>
      reservations.createReservation({
        date,
        start_time: startTime,
        end_time: endTime,
        name,
      }),
    {
      onSuccess: (response) => {
        const created = response as { reservation: unknown }
        console.log('Reservation created:', created.reservation)
        setStartTime('')
        setEndTime('')
      },
    }
  )

  const handleCheck = async () => {
    try {
      const result = await checkAvailability()
      if (result.available) {
        console.log('Slot is available!')
      } else {
        console.log('Slot is not available. Conflicts:')
        console.log(result.conflicts)
      }
    } catch (error) {
      const { message } = handleApiError(error)
      alert(`Error: ${message}`)
    }
  }

  const handleCreate = async () => {
    try {
      await createReservation()
    } catch (error) {
      const { message } = handleApiError(error)
      alert(`Error: ${message}`)
    }
  }

  return (
    <div>
      <h2>Make Reservation</h2>

      <input
        type="datetime-local"
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
      />

      <input
        type="datetime-local"
        value={endTime}
        onChange={(e) => setEndTime(e.target.value)}
      />

      <button onClick={handleCheck} disabled={isChecking || !startTime || !endTime}>
        {isChecking ? 'Checking...' : 'Check Availability'}
      </button>

      <button onClick={handleCreate} disabled={isCreating || !startTime || !endTime}>
        {isCreating ? 'Creating...' : 'Create Reservation'}
      </button>
    </div>
  )
}

/**
 * Example 5: User Management (Admin)
 */
export function UserManagementExample() {
  const users = useUsers()
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')

  // Fetch users
  const { data: userList, loading, refetch } = useAsync(
    () => users.getUsers(),
    {
      onSuccess: (data) => console.log('Users loaded:', data),
    }
  )

  // Create user
  const { execute: createUser, loading: isCreating } = useMutation(
    () =>
      users.createUser({
        username: newUsername,
        password: newPassword,
        role: 'user',
      }),
    {
      onSuccess: () => {
        setNewUsername('')
        setNewPassword('')
        refetch()
      },
    }
  )

  // Delete user
  const { execute: deleteUser } = useMutation(
    (userId) => users.deleteUser(userId as number),
    {
      onSuccess: () => refetch(),
    }
  )

  // Validate before create
  const handleCreate = async () => {
    const validation = users.validateUsername(newUsername)
    if (!validation.valid) {
      alert(validation.error)
      return
    }

    const pwValidation = users.validatePassword(newPassword)
    if (!pwValidation.valid) {
      alert(pwValidation.error)
      return
    }

    await createUser()
  }

  if (loading) return <div>Loading users...</div>

  return (
    <div>
      <h2>User Management</h2>

      <div>
        <h3>Create User</h3>
        <input
          type="text"
          placeholder="Username"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button onClick={handleCreate} disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create User'}
        </button>
      </div>

      <div>
        <h3>Users</h3>
        <ul>
          {userList?.map((user) => (
            <li key={user.id}>
              <strong>{user.username}</strong> - {users.getRoleLabel(user.role)}
              <button onClick={() => deleteUser(user.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default KioskListExample
