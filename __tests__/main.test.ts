import * as core from '@actions/core'
import { run } from '../src/main'

jest.mock('@actions/core')

const originalFetch = global.fetch
const mockFetch = jest.fn()

beforeAll(() => {
  global.fetch = mockFetch
})
afterAll(() => {
  global.fetch = originalFetch
})

const mockedCore = jest.mocked(core)

describe('main', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    jest.clearAllMocks()
  })

  function setupInputs(overrides: Record<string, string> = {}): void {
    const defaults: Record<string, string> = {
      'base-url': 'https://dorc.example.com',
      'dorc-ids-secret': 'test-secret',
      project: 'TestProject',
      environment: 'DEV',
      components: 'Comp1;Comp2',
      'build-text': '',
      'build-num': 'latest',
      pinned: 'false',
      'build-uri': '',
      'poll-interval': '5',
      timeout: '60'
    }
    const inputs = { ...defaults, ...overrides }

    mockedCore.getInput.mockImplementation((name: string) => {
      return inputs[name] ?? ''
    })
    mockedCore.getBooleanInput.mockImplementation((name: string) => {
      return inputs[name] === 'true'
    })
  }

  function mockTokenEndpoint(): void {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com' })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-token',
        expires_in: 3600
      })
    })
  }

  it('runs a successful deployment end-to-end', async () => {
    setupInputs()
    mockTokenEndpoint()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Pending' })
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Completed' })
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { ComponentName: 'Comp1', Status: 'Completed', Log: 'OK' }
      ]
    })

    await run()

    expect(mockedCore.setSecret).toHaveBeenCalledWith('test-secret')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('request-id', '100')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('status', 'Completed')
    expect(mockedCore.setFailed).not.toHaveBeenCalled()
  })

  it('sends null for empty optional fields', async () => {
    setupInputs({ 'build-text': '', 'build-num': '', 'build-uri': '' })
    mockTokenEndpoint()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Pending' })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Completed' })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    })

    await run()

    // Find the POST to /Request (not the token endpoint POST)
    const requestCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('/Request')
    )
    expect(requestCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse((requestCalls[0][1] as Record<string, string>).body)
    expect(body.BuildText).toBeNull()
    expect(body.BuildNum).toBeNull()
    expect(body.BuildUrl).toBeNull()
  })

  it('sets status output to Unknown before polling', async () => {
    setupInputs()
    mockTokenEndpoint()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Pending' })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Completed' })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    })

    await run()

    const statusCalls = mockedCore.setOutput.mock.calls.filter(
      (c: unknown[]) => c[0] === 'status'
    )
    expect(statusCalls[0][1]).toBe('Unknown')
    expect(statusCalls[1][1]).toBe('Completed')
  })

  it('sets status to Unknown even when resolveTokenUrl fails', async () => {
    setupInputs()
    // ApiConfig returns 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('status', 'Unknown')
    expect(mockedCore.setFailed).toHaveBeenCalled()
  })

  it('fails on a failed deployment', async () => {
    setupInputs()
    mockTokenEndpoint()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 200, Status: 'Pending' })
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 200, Status: 'Errored' })
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { ComponentName: 'Comp1', Status: 'Errored', Log: 'Something broke' }
      ]
    })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'Deployment finished with status: Errored'
    )
  })

  it('fails with non-http base-url', async () => {
    setupInputs({ 'base-url': 'ftp://example.com' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('must use http or https')
    )
  })

  it('fails with invalid base-url', async () => {
    setupInputs({ 'base-url': 'not-a-url' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('not a valid URL')
    )
  })

  it('fails with invalid poll-interval', async () => {
    setupInputs({ 'poll-interval': 'abc' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'poll-interval must be a positive integer (minimum 5)'
    )
  })

  it('fails with poll-interval below minimum', async () => {
    setupInputs({ 'poll-interval': '2' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'poll-interval must be a positive integer (minimum 5)'
    )
  })

  it('rejects poll-interval with trailing garbage', async () => {
    setupInputs({ 'poll-interval': '5sec' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'poll-interval must be a positive integer (minimum 5)'
    )
  })

  it('rejects timeout with trailing garbage', async () => {
    setupInputs({ timeout: '60min' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'timeout must be a positive integer (minimum 1)'
    )
  })

  it('fails with invalid timeout', async () => {
    setupInputs({ timeout: '-5' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'timeout must be a positive integer (minimum 1)'
    )
  })

  it('fails with empty components', async () => {
    setupInputs({ components: ';;;' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'components must contain at least one non-empty component name'
    )
  })

  it('fails on invalid request ID', async () => {
    setupInputs()
    mockTokenEndpoint()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 0, Status: 'Invalid' })
    })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'DOrc API returned an invalid request ID'
    )
  })

  it('still reports deployment failure when logComponentResults throws', async () => {
    setupInputs()
    mockTokenEndpoint()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 300, Status: 'Pending' })
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 300, Status: 'Failed' })
    })

    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await run()

    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch component results')
    )
    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'Deployment finished with status: Failed'
    )
  })
})
