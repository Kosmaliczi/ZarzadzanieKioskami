/**
 * FTP Service
 * Handles all FTP/SFTP operations (file operations, directory management)
 */

import { HttpClient } from '../core/HttpClient'
import type {
  FtpConnectionRequest,
  FtpConnectionResponse,
  FtpFile,
  FtpListRequest,
  FtpListResponse,
  FtpUploadRequest,
  FtpUploadResponse,
  FtpDeleteRequest,
  FtpDeleteMultipleRequest,
  FtpGetFileContentRequest,
  FtpPutFileContentRequest,
  FtpMkdirRequest,
} from '../types/api'
import { buildQueryString } from '../utils/apiHelpers'

export class FtpService {
  private httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  /**
   * Test FTP connection
   */
  async testConnection(request: FtpConnectionRequest): Promise<FtpConnectionResponse> {
    try {
      const response = await this.httpClient.post<FtpConnectionResponse>(
        '/api/ftp/connect',
        request,
        { timeout: 15000 }
      )

      if (!response) {
        throw new Error('Connection test failed')
      }

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd testowania połączenia FTP'
      throw new Error(message)
    }
  }

  /**
   * List files in directory
   */
  async listFiles(request: FtpListRequest): Promise<FtpListResponse> {
    try {
      const response = await this.httpClient.post<FtpListResponse>(
        '/api/ftp/files',
        request,
        { timeout: 20000 }
      )

      if (!response) {
        throw new Error('Failed to list files')
      }

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania listy plików'
      throw new Error(message)
    }
  }

  /**
   * Upload files
   */
  async uploadFiles(request: FtpUploadRequest): Promise<FtpUploadResponse> {
    try {
      const formData = new FormData()

      // Add connection details
      formData.append('hostname', request.hostname)
      formData.append('username', request.username)
      formData.append('password', request.password)
      formData.append('path', request.path)

      if (request.port) {
        formData.append('port', String(request.port))
      }

      // Add files
      request.files.forEach((file) => {
        formData.append('files', file)
      })

      // Use custom fetch since we need to send FormData
      const token = this.getAuthToken()
      const headers: Record<string, string> = {}

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch(`${this.httpClient.getBaseUrl()}/api/ftp/upload`, {
        method: 'POST',
        body: formData,
        headers,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'Upload failed')
      }

      const data = (await response.json()) as FtpUploadResponse

      if (!data) {
        throw new Error('Invalid response from server')
      }

      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd przesyłania plików'
      throw new Error(message)
    }
  }

  /**
   * Delete file or directory
   */
  async deleteFile(request: FtpDeleteRequest): Promise<void> {
    try {
      await this.httpClient.post(
        '/api/ftp/delete',
        request,
        { timeout: 20000 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd usuwania pliku'
      throw new Error(message)
    }
  }

  /**
   * Delete multiple files
   */
  async deleteMultipleFiles(request: FtpDeleteMultipleRequest): Promise<void> {
    try {
      await this.httpClient.post(
        '/api/ftp/delete-multiple',
        request,
        { timeout: 30000 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd usuwania plików'
      throw new Error(message)
    }
  }

  /**
   * Get file content (text files)
   */
  async getFileContent(request: FtpGetFileContentRequest): Promise<string> {
    try {
      const response = await this.httpClient.post(
        '/api/ftp/get-file-content',
        request,
        { timeout: 20000 }
      )

      if (!response || typeof response !== 'object' || !('content' in response)) {
        throw new Error('Expected string content')
      }

      return String((response as { content: string }).content)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania zawartości pliku'
      throw new Error(message)
    }
  }

  /**
   * Put file content (write text files)
   */
  async putFileContent(request: FtpPutFileContentRequest): Promise<void> {
    try {
      await this.httpClient.post(
        '/api/ftp/put-file-content',
        request,
        { timeout: 20000 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd zapisywania pliku'
      throw new Error(message)
    }
  }

  /**
   * Create directory
   */
  async createDirectory(request: FtpMkdirRequest): Promise<void> {
    try {
      await this.httpClient.post(
        '/api/ftp/mkdir',
        { ...request, folder_name: request.folder_name },
        { timeout: 15000 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd tworzenia katalogu'
      throw new Error(message)
    }
  }

  /**
   * Download file
   */
  async downloadFile(
    hostname: string,
    username: string,
    password: string,
    path: string,
    port?: number
  ): Promise<Blob> {
    try {
      const params = {
        hostname,
        username,
        password,
        path,
        ...(port && { port: String(port) }),
      }

      const queryString = buildQueryString(params)

      const token = this.getAuthToken()
      const headers: Record<string, string> = {}

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch(`${this.httpClient.getBaseUrl()}/api/ftp/download${queryString}`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'Download failed')
      }

      return await response.blob()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania pliku'
      throw new Error(message)
    }
  }

  /**
   * Get file extension
   */
  getFileExtension(filename: string): string {
    const parts = filename.split('.')
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
  }

  /**
   * Check if file is text-based
   */
  isTextFile(filename: string): boolean {
    const ext = this.getFileExtension(filename)
    const textExtensions = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'php', 'py', 'sh', 'conf', 'config', 'properties', 'yaml', 'yml', 'log', 'csv']
    return textExtensions.includes(ext)
  }

  /**
   * Check if file is media
   */
  isMediaFile(filename: string): boolean {
    const ext = this.getFileExtension(filename)
    const mediaExtensions = ['jpg', 'jpeg', 'png', 'gif', 'mp3', 'mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'wav', 'flac']
    return mediaExtensions.includes(ext)
  }

  /**
   * Sort files (directories first, then by name)
   */
  sortFiles(files: FtpFile[]): FtpFile[] {
    return [...files].sort((a, b) => {
      // Directories first
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }

      // Then alphabetically
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Get parent directory path
   */
  getParentPath(currentPath: string): string {
    const parts = currentPath.split('/').filter((p) => p !== '')

    if (parts.length <= 1) {
      return '/'
    }

    return '/' + parts.slice(0, -1).join('/')
  }

  /**
   * Get auth token from storage
   */
  private getAuthToken(): string | null {
    try {
      const stored = localStorage.getItem('authToken')
      if (!stored) return null

      const { value } = JSON.parse(stored)
      return value || null
    } catch {
      return null
    }
  }
}
