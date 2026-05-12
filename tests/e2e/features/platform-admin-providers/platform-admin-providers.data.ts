/**
 * Test data factories for Platform Admin Providers
 */

export interface CustomProviderConfig {
  name: string
  baseProviderType: string
  baseUrl?: string
}

export interface ProviderKeyConfig {
  name: string
  value: string
  weight?: number
}

/**
 * Create custom provider test data with unique name
 */
export function createCustomProviderData(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  const timestamp = Date.now()
  return {
    name: `test-provider-${timestamp}`,
    baseProviderType: 'openai',
    baseUrl: 'https://api.test-provider.com/v1',
    ...overrides,
  }
}

/**
 * Create provider key test data with unique name
 */
export function createProviderKeyData(overrides: Partial<ProviderKeyConfig> = {}): ProviderKeyConfig {
  const timestamp = Date.now()
  return {
    name: `test-key-${timestamp}`,
    value: `sk-test-${timestamp}`,
    weight: 1.0,
    ...overrides,
  }
}