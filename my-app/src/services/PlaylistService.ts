/**
 * Playlist Service
 * Persists kiosk playlists in backend database
 */

import { HttpClient } from '../core/HttpClient'
import type {
  GetPlaylistResponse,
  SavePlaylistRequest,
  SavePlaylistResponse,
} from '../types/api'

export class PlaylistService {
  private httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  async getKioskPlaylist(kioskId: number, name: string = 'Default'): Promise<GetPlaylistResponse> {
    try {
      const query = encodeURIComponent(name)
      const response = await this.httpClient.get<GetPlaylistResponse>(
        `/api/kiosks/${kioskId}/playlist?name=${query}`,
        { timeout: 15000 }
      )

      if (!response || !response.playlist || !Array.isArray(response.items)) {
        throw new Error('Nieprawidłowa odpowiedź playlisty')
      }

      return response
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd pobierania playlisty')
    }
  }

  async saveKioskPlaylist(kioskId: number, payload: SavePlaylistRequest): Promise<SavePlaylistResponse> {
    try {
      const response = await this.httpClient.put<SavePlaylistResponse>(
        `/api/kiosks/${kioskId}/playlist`,
        payload,
        { timeout: 20000 }
      )

      if (!response || typeof response.playlistId !== 'number') {
        throw new Error('Nie udało się zapisać playlisty')
      }

      return response
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd zapisu playlisty')
    }
  }
}

export default PlaylistService
