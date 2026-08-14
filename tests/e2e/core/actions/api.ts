import { APIRequestContext, APIResponse } from '@playwright/test'

/**
 * API helper functions for test setup and cleanup
 */

const API_BASE = '/api'

/**
 * Handle API response with error checking
 */
async function handleResponse<T>(response: APIResponse, operation: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${operation} failed: ${response.status()} ${response.statusText()}`)
  }
  return response.json() as Promise<T>
}

/**
 * Provider API helpers
 */
export const providersApi = {
  /**
   * Get all providers
   */
  async getAll(request: APIRequestContext) {
    const response = await request.get(`${API_BASE}/providers`)
    return handleResponse(response, 'Get all providers')
  },

  /**
   * Get a specific provider
   */
  async get(request: APIRequestContext, name: string) {
    const response = await request.get(`${API_BASE}/providers/${name}`)
    return handleResponse(response, `Get provider ${name}`)
  },

  /**
   * Create a provider
   */
  async create(request: APIRequestContext, data: unknown) {
    const response = await request.post(`${API_BASE}/providers`, {
      data,
    })
    return handleResponse(response, 'Create provider')
  },

  /**
   * Update a provider
   */
  async update(request: APIRequestContext, name: string, data: unknown) {
    const response = await request.put(`${API_BASE}/providers/${name}`, {
      data,
    })
    return handleResponse(response, `Update provider ${name}`)
  },

  /**
   * Delete a provider
   */
  async delete(request: APIRequestContext, name: string) {
    const response = await request.delete(`${API_BASE}/providers/${name}`)
    return response.ok()
  },
}
