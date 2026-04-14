# Enterprise API Layer for Kiosk Manager

> Professional-grade API client with TypeScript support, error handling, caching, retry logic, and React hooks.

## Architecture

```
├── core/
│   └── HttpClient.ts          # HTTP client with retry, caching, interceptors
├── services/
│   ├── ApiManager.ts          # Central API manager (Factory pattern)
│   ├── AuthService.ts         # Authentication & account management
│   ├── KioskService.ts        # Kiosk CRUD & device management
│   ├── FtpService.ts          # FTP/SFTP file operations
│   ├── ReservationService.ts  # Reservation management
│   ├── UserService.ts         # User management (admin)
│   └── SettingsService.ts     # Application settings
├── hooks/
│   ├── useApi.ts              # Generic hooks (useAsync, useMutation, etc.)
│   └── useApiManager.ts       # Service-specific hooks & Context
├── types/
│   └── api.ts                 # TypeScript types for all API responses
└── utils/
    └── apiHelpers.ts          # Utility functions & error handling
```

## Features

✅ **Type-Safe** - Full TypeScript support with auto-complete  
✅ **Error Handling** - Normalized error responses with Polish messages  
✅ **Retry Logic** - Automatic retries with exponential backoff  
✅ **Caching** - Smart caching for GET requests  
✅ **Interceptors** - Request/response/error interceptors  
✅ **React Integration** - Custom hooks for async operations  
✅ **Timeout Management** - Configurable request timeouts  
✅ **Token Management** - Automatic auth token handling  

## Usage

### Setup in main.jsx

```jsx
import { ApiProvider } from './hooks'
import App from './App'

ReactDOM.render(
  <ApiProvider baseUrl="http://localhost:5000">
    <App />
  </ApiProvider>,
  document.getElementById('root')
)
```

### Using in Components

```jsx
import { useAsync, useMutation, useApi } from './hooks'

function MyComponent() {
  // Access services
  const api = useApi()
  
  // Fetch kiosks
  const { data: kiosks, loading, error } = useAsync(
    () => api.kiosks.getKiosks()
  )

  // Create kiosk
  const { execute: createKiosk, loading: isCreating } = useMutation(
    (data) => api.kiosks.createKiosk(data),
    {
      onSuccess: () => {
        console.log('Kiosk created!')
      },
      onError: (error) => {
        console.error('Failed to create:', error.message)
      },
    }
  )

  return (
    <div>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      {kiosks?.map(k => <div key={k.id}>{k.name}</div>)}
      
      <button onClick={() => createKiosk({ name: 'New Kiosk' })}>
        {isCreating ? 'Creating...' : 'Create Kiosk'}
      </button>
    </div>
  )
}
```

### Service-Specific Hooks

```jsx
import { 
  useAuth, 
  useKiosks, 
  useFtp, 
  useReservations, 
  useUsers, 
  useSettings 
} from './hooks'

function LoginComponent() {
  const auth = useAuth()
  const { execute: login, loading } = useMutation(
    (creds) => auth.login(creds)
  )

  return (
    <button onClick={() => login({ username: 'admin', password: '...' })}>
      {loading ? 'Logging in...' : 'Login'}
    </button>
  )
}
```

### Advanced Hooks

```jsx
// useAsync - For GET requests
const { data, loading, error, refetch, retry } = useAsync(
  () => api.kiosks.getKiosks(),
  {
    onSuccess: (data) => console.log('Loaded:', data),
    onError: (error) => console.error('Error:', error),
    skipInitialLoad: false,
    deps: [someVar] // Re-run on dependency change
  }
)

// useMutation - For POST, PUT, DELETE
const { execute, loading, error, data, reset } = useMutation(
  (newData) => api.kiosks.updateKiosk(id, newData),
  { onSuccess: () => refetch() }
)

// usePagination - For paginated lists
const { items, currentPage, loading, nextPage, previousPage } = usePagination(
  (page, size) => api.users.getUsers(page, size),
  10 // page size
)

// usePolling - For real-time data
const { data: kiosks } = usePolling(
  () => api.kiosks.getKiosks(),
  5000, // interval ms
  true  // enabled
)

// useDebounceSearch - For search inputs
const { query, results, loading, search } = useDebounceSearch(
  (q) => api.users.searchUsers(q),
  300,  // debounce ms
  2     // min chars
)
```

## API Services

### AuthService

```jsx
const auth = useAuth()

// Login
const loginResp = await auth.login({ username: 'admin', password: 'pass' })

// Check authentication
if (auth.isAuthenticated()) {
  console.log('User is logged in')
}

// Check token expiration
if (auth.isTokenExpired()) {
  console.log('Token expired')
}

// Get token time remaining
const msRemaining = auth.getTokenTimeRemaining()

// Change password
await auth.changePassword('newPassword123')

// Logout
await auth.logout()
```

### KioskService

```jsx
const kiosks = useKiosks()

// List all kiosks
const allKiosks = await kiosks.getKiosks()

// Get single kiosk
const kiosk = await kiosks.getKiosk(1)

// Create kiosk
const newKiosk = await kiosks.createKiosk({
  name: 'Kiosk #1',
  mac_address: '00:11:22:33:44:55',
  serial_number: 'ABC123',
  ftp_username: 'root',
  ftp_password: 'pass123'
})

// Update kiosk
const updated = await kiosks.updateKiosk(1, {
  name: 'Updated Name'
})

// Delete kiosk
await kiosks.deleteKiosk(1)

// Get FTP credentials
const creds = await kiosks.getFtpCredentials(1)

// Restart service
await kiosks.restartService(1)

// Rotate display
const result = await kiosks.rotateDisplay(1, 'right')

// Helper methods
const status = kiosks.getKioskStatus(kiosk) // 'online' | 'offline'
const isOnline = kiosks.isKioskOnline(kiosk) // true/false
const timeSince = kiosks.getTimeSinceLastConnection(kiosk) // "5 minut temu"
```

### FtpService

```jsx
const ftp = useFtp()

// Test connection
const result = await ftp.testConnection({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  port: 22
})

// List files
const { files, currentPath } = await ftp.listFiles({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  path: '/storage/videos'
})

// Upload files
const uploadResult = await ftp.uploadFiles({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  path: '/storage/videos',
  files: [file1, file2] // File objects from input
})

// Delete file
await ftp.deleteFile({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  path: '/storage/videos/file.mp4',
  isDirectory: false
})

// Delete multiple files
await ftp.deleteMultipleFiles({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  files: [
    { path: '/file1.mp4', isDirectory: false },
    { path: '/folder', isDirectory: true }
  ]
})

// Get file content (text files)
const content = await ftp.getFileContent({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  path: '/storage/config.txt'
})

// Put file content (write text files)
await ftp.putFileContent({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  path: '/storage/config.txt',
  content: 'New content here'
})

// Create directory
await ftp.createDirectory({
  hostname: '192.168.1.100',
  username: 'root',
  password: 'pass123',
  path: '/storage',
  folderName: 'newFolder'
})

// Download file
const blob = await ftp.downloadFile(
  '192.168.1.100',
  'root',
  'pass123',
  '/storage/file.mp4'
)

// Helper methods
const ext = ftp.getFileExtension('file.mp4') // 'mp4'
const isText = ftp.isTextFile('config.txt') // true
const isMedia = ftp.isMediaFile('video.mp4') // true
const sorted = ftp.sortFiles(files) // Dirs first, then alphabetical
const parent = ftp.getParentPath('/storage/videos') // '/storage'
```

### ReservationService

```jsx
const reservations = useReservations()

// Check availability
const available = await reservations.checkAvailability({
  kiosk_id: 1,
  start_time: '2024-12-25T10:00:00',
  end_time: '2024-12-25T12:00:00'
})

// Create reservation
const { reservation } = await reservations.createReservation({
  kiosk_id: 1,
  start_time: '2024-12-25T10:00:00',
  end_time: '2024-12-25T12:00:00'
})

// Get user's reservations
const myReservations = await reservations.getReservations({
  status: 'active',
  limit: 10
})

// Cancel reservation
await reservations.cancelReservation(1)

// Helper methods
const slot = reservations.formatTimeSlot(start, end)
const minutes = reservations.getDurationMinutes(start, end)
const durationText = reservations.getDurationFormatted(start, end)
const isUpcoming = reservations.isUpcoming(reservation)
const isNow = reservations.isActiveNow(reservation)
const isPast = reservations.isPast(reservation)
const color = reservations.getStatusColor(reservation)
const label = reservations.getStatusLabel(reservation)
```

### UserService

```jsx
const users = useUsers()

// Get all users (admin only)
const allUsers = await users.getUsers()

// Create user
const newUser = await users.createUser({
  username: 'john_doe',
  password: 'SecurePass123!',
  role: 'user'
})

// Delete user
await users.deleteUser(5)

// Update user role
await users.updateUserRole(5, 'admin')

// Change own password
await users.changePassword('NewPassword123!')

// Admin: Change user password
await users.changeUserPassword(5, 'TempPassword123!')

// Validation
const validation = users.validateUsername('john_doe')
const passwordCheck = users.validatePassword('MyPassword123!')

// Helper methods
const label = users.getRoleLabel('admin') // 'Administrator'
const description = users.getRoleDescription('admin')
const isAdmin = users.isAdmin(user)
```

### SettingsService

```jsx
const settings = useSettings()

// Get all settings
const allSettings = await settings.getSettings()

// Get single setting
const sshPort = await settings.getSetting('defaultSshPort')

// Update single setting
await settings.updateSetting('defaultSshPort', 2222)

// Update multiple settings
await settings.updateSettings({
  defaultSshPort: 2222,
  defaultSshUsername: 'admin'
})

// Common settings shortcuts
const username = await settings.getDefaultSshUsername()
const port = await settings.getDefaultSshPort()

await settings.setDefaultSshUsername('newuser')
await settings.setDefaultSshPort(2222)
```

## Error Handling

All services throw errors with normalized structure:

```jsx
try {
  await api.kiosks.getKiosks()
} catch (error) {
  console.error(error.message)     // User-friendly Polish message
  console.error(error.code)        // Error code (e.g., 'NOT_FOUND')
  console.error(error.details)     // Additional details
  console.error(error.status)      // HTTP status code
}
```

## Best Practices

1. **Use React Provider** - Wrap app with `ApiProvider` for context access
2. **Prefer Hooks** - Use `useAsync`, `useMutation` instead of direct service calls
3. **Handle Errors** - Always use `error` state and display user-friendly messages
4. **Cache Effectively** - Let services handle caching, don't duplicate
5. **Debounce Searches** - Use `useDebounceSearch` for search inputs
6. **Invalidate Cache** - Call `api.clearCache()` after mutations
7. **Type Everything** - Use TypeScript types for complete IDE support
8. **Monitor Loading** - Show loading states in UI while data is fetching

## Configuration

### Customize HTTP Client

```jsx
const api = getApiManager('http://your-api.com:5000')

// Add custom interceptors
const httpClient = api.getHttpClient()

httpClient.addRequestInterceptor((config) => {
  // Modify request
  return config
})

httpClient.addResponseInterceptor((response) => {
  // Transform response
  return response
})

httpClient.addErrorInterceptor((error) => {
  // Handle error
  return error
})
```

## Troubleshooting

### Tokens Not Being Sent

Check that `AuthProvider` is wrapping your app and token is stored in localStorage as `authToken`.

### CORS Errors

Ensure backend has CORS enabled for your frontend URL.

### Type Errors

Import types from `src/types/api.ts`:

```tsx
import type { Kiosk, Reservation } from './types/api'
```

## License

Private - Kiosk Manager Project
