import { Locator, Page, expect } from '@playwright/test'
import { BasePage } from '../../../core/pages/base.page'
import { waitForNetworkIdle } from '../../../core/utils/test-helpers'

/**
 * Page object for the Platform Admin Providers page (/platform/console/admin/providers)
 */
export class PlatformAdminProvidersPage extends BasePage {
  // Provider list sidebar
  readonly providerList: Locator
  readonly addProviderBtn: Locator
  readonly addProviderOptionCustom: Locator
  readonly searchInput: Locator

  // Provider detail area
  readonly providerHeader: Locator
  readonly providerName: Locator
  readonly providerStatus: Locator
  readonly editConfigBtn: Locator
  readonly deleteProviderBtn: Locator

  // Tabs
  readonly keysTab: Locator
  readonly modelsTab: Locator

  // Keys section
  readonly addKeyBtn: Locator
  readonly keysTable: Locator
  readonly keysTableEmptyState: Locator

  // Key form
  readonly keyForm: Locator
  readonly keySaveBtn: Locator
  readonly keyCancelBtn: Locator

  // Custom provider sheet
  readonly customProviderSheet: Locator
  readonly customProviderNameInput: Locator
  readonly baseProviderSelect: Locator
  readonly baseUrlInput: Locator
  readonly customProviderSaveBtn: Locator
  readonly customProviderCancelBtn: Locator

  // Delete confirmation dialog
  readonly deleteDialog: Locator
  readonly deleteDialogConfirmBtn: Locator

  constructor(page: Page) {
    super(page)

    // Provider list sidebar
    this.providerList = page.locator('[data-testid="provider-list"]')
    this.addProviderBtn = page.getByTestId('add-provider-btn')
    this.addProviderOptionCustom = page.getByTestId('add-provider-option-custom')
    this.searchInput = page.getByPlaceholder('Search providers...')

    // Provider header
    this.providerHeader = page.locator('[data-testid="provider-header"]')
    this.providerName = page.locator('[data-testid="provider-name"]')
    this.providerStatus = page.locator('[data-testid="provider-status"]')
    this.editConfigBtn = page.getByRole('button', { name: /Edit Provider Config/i })
    this.deleteProviderBtn = page.getByRole('button', { name: /Delete provider/i })

    // Tabs
    this.keysTab = page.getByRole('tab', { name: /Keys/i })
    this.modelsTab = page.getByRole('tab', { name: /Models/i })

    // Keys section
    this.addKeyBtn = page.getByTestId('add-key-btn')
    this.keysTable = page.getByTestId('keys-table')
    this.keysTableEmptyState = page.getByTestId('keys-table-empty-state')

    // Key form
    this.keyForm = page.getByTestId('key-form')
    this.keySaveBtn = page.getByTestId('key-save-btn')
    this.keyCancelBtn = page.getByTestId('key-cancel-btn')

    // Custom provider sheet
    this.customProviderSheet = page.getByTestId('custom-provider-sheet')
    this.customProviderNameInput = page.getByTestId('custom-provider-name')
    this.baseProviderSelect = page.getByTestId('base-provider-select')
    this.baseUrlInput = page.getByTestId('base-url-input')
    this.customProviderSaveBtn = page.getByTestId('custom-provider-save-btn')
    this.customProviderCancelBtn = page.getByTestId('custom-provider-cancel-btn')

    // Delete dialog
    this.deleteDialog = page.locator('[role="alertdialog"]')
    this.deleteDialogConfirmBtn = this.deleteDialog.getByRole('button', { name: /Delete/i })
  }

  /**
   * Navigate to the platform admin providers page
   */
  async goto(): Promise<void> {
    await this.page.goto('/platform/console/admin/providers')
    await waitForNetworkIdle(this.page)
  }

  /**
   * Navigate to the platform login page
   */
  async gotoLogin(): Promise<void> {
    await this.page.goto('/platform/login')
    await waitForNetworkIdle(this.page)
  }

  /**
   * Login to the platform
   */
  async login(email: string, password: string): Promise<void> {
    await this.gotoLogin()

    // Fill login form
    await this.page.getByLabel('Email').fill(email)
    await this.page.getByLabel('Password').fill(password)

    // Submit
    await this.page.getByRole('button', { name: /Sign In/i }).click()

    // Wait for navigation after login
    await waitForNetworkIdle(this.page)
  }

  /**
   * Select a provider from the sidebar list
   */
  async selectProvider(name: string): Promise<void> {
    const providerItem = this.page.getByTestId(`provider-item-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`)
    await providerItem.click()
    await waitForNetworkIdle(this.page)
  }

  /**
   * Get provider item locator
   */
  getProviderItem(name: string): Locator {
    return this.page.getByTestId(`provider-item-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`)
  }

  /**
   * Check if a provider exists in the list
   */
  async providerExists(name: string): Promise<boolean> {
    const providerItem = this.getProviderItem(name)
    return await providerItem.isVisible().catch(() => false)
  }

  /**
   * Open the custom provider sheet
   */
  async openCustomProviderSheet(): Promise<void> {
    await this.addProviderBtn.click()
    await this.addProviderOptionCustom.waitFor({ state: 'visible', timeout: 5000 })
    await this.addProviderOptionCustom.click()
    await expect(this.customProviderSheet).toBeVisible({ timeout: 5000 })
  }

  /**
   * Create a custom provider
   */
  async createProvider(config: { name: string; baseProviderType: string; baseUrl?: string }): Promise<void> {
    await this.openCustomProviderSheet()

    await this.customProviderNameInput.fill(config.name)

    // Select base provider type
    const selectTrigger = this.baseProviderSelect.locator('button')
    await selectTrigger.click()
    await this.page.getByRole('option', { name: new RegExp(config.baseProviderType, 'i') }).click()

    if (config.baseUrl) {
      await this.baseUrlInput.fill(config.baseUrl)
    }

    await this.customProviderSaveBtn.click()

    await expect(this.customProviderSheet).not.toBeVisible({ timeout: 10000 })
    await waitForNetworkIdle(this.page)
  }

  /**
   * Delete a provider
   */
  async deleteProvider(name: string): Promise<void> {
    await this.selectProvider(name)

    await this.deleteProviderBtn.click()
    await expect(this.deleteDialog).toBeVisible({ timeout: 5000 })
    await this.deleteDialogConfirmBtn.click()

    await this.waitForSuccessToast()
  }

  /**
   * Add a new key to the currently selected provider
   */
  async addKey(config: { name: string; value: string; weight?: number }): Promise<void> {
    await this.dismissToasts()
    await this.addKeyBtn.click()
    await expect(this.keyForm).toBeVisible()

    await this.page.getByLabel('Name').fill(config.name)
    await this.page.getByLabel('API Key').fill(config.value)

    if (config.weight !== undefined) {
      const weightInput = this.page.getByLabel('Weight')
      if (await weightInput.isVisible()) {
        await weightInput.fill(String(config.weight))
      }
    }

    await this.keySaveBtn.click()
    await this.waitForSuccessToast()
    await expect(this.keyForm).not.toBeVisible({ timeout: 5000 })
    await waitForNetworkIdle(this.page)
  }

  /**
   * Get key row locator
   */
  getKeyRow(name: string): Locator {
    return this.page.getByTestId(`key-row-${name}`).or(
      this.page.locator('tr, [role="row"]').filter({ hasText: name })
    )
  }

  /**
   * Check if a key exists
   */
  async keyExists(name: string, timeout: number = 5000): Promise<boolean> {
    await waitForNetworkIdle(this.page)
    const keyRow = this.getKeyRow(name)
    try {
      await keyRow.waitFor({ state: 'visible', timeout })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the count of keys in the table
   */
  async getKeyCount(): Promise<number> {
    const rows = this.keysTable.locator('tbody tr')
    const count = await rows.count()

    if (count === 0) return 0

    const firstRowText = await rows.first().textContent()
    if (firstRowText?.includes('No keys found')) {
      return 0
    }

    return count
  }

  /**
   * Delete a key
   */
  async deleteKey(keyName: string): Promise<void> {
    await this.dismissToasts()

    const keyRow = this.getKeyRow(keyName)
    await keyRow.scrollIntoViewIfNeeded()

    // Click the dropdown menu button (last button with svg icon in the row)
    const menuBtn = keyRow.locator('button').filter({ has: this.page.locator('svg') }).last()
    await menuBtn.waitFor({ state: 'visible', timeout: 5000 })
    await menuBtn.click()

    await this.page.getByRole('menuitem', { name: /Delete/i }).click()

    const confirmBtn = this.deleteDialog.getByRole('button', { name: /Delete/i })
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 })
    await confirmBtn.click()

    await this.waitForSuccessToast()
  }
}