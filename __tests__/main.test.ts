import * as core from '@actions/core'
import { run } from '../src/main'

// Mock @actions/core
jest.mock('@actions/core')

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch

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
      'poll-interval': '1'
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
    // ApiConfig call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com' })
    })
    // Token call
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

    // POST /Request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Pending' })
    })

    // GET /Request?id=100 (polling - completed)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 100, Status: 'Completed' })
    })

    // GET /ResultStatuses
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { ComponentName: 'Comp1', Status: 'Completed', Log: 'OK' }
      ]
    })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('request-id', '100')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('status', 'Completed')
    expect(mockedCore.setFailed).not.toHaveBeenCalled()
  })

  it('fails on a failed deployment', async () => {
    setupInputs()
    mockTokenEndpoint()

    // POST /Request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 200, Status: 'Pending' })
    })

    // GET /Request?id=200 (polling - errored)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Id: 200, Status: 'Errored' })
    })

    // GET /ResultStatuses
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
})
