import * as core from '@actions/core'
import { resolveTokenUrl, validateHttpUrl } from './auth'
import { DorcClient, DeployRequest } from './dorc-client'

export async function run(): Promise<void> {
  try {
    const baseUrl = core
      .getInput('base-url', { required: true })
      .replace(/\/+$/, '')
    const clientSecret = core.getInput('dorc-ids-secret', { required: true })
    core.setSecret(clientSecret)

    try {
      validateHttpUrl(baseUrl, 'base-url')
    } catch (e) {
      core.setFailed(e instanceof Error ? e.message : String(e))
      return
    }

    const project = core.getInput('project', { required: true })
    const environment = core.getInput('environment', { required: true })
    const components = core.getInput('components', { required: true })
    const buildText = core.getInput('build-text') || null
    const buildNum = core.getInput('build-num') || null
    const pinned = core.getBooleanInput('pinned')
    const buildUri = core.getInput('build-uri') || null

    const pollInterval = parseInt(core.getInput('poll-interval') || '5', 10)
    if (isNaN(pollInterval) || pollInterval < 5) {
      core.setFailed('poll-interval must be a positive integer (minimum 5)')
      return
    }

    const timeout = parseInt(core.getInput('timeout') || '60', 10)
    if (isNaN(timeout) || timeout < 1) {
      core.setFailed('timeout must be a positive integer (minimum 1)')
      return
    }

    const componentList = components
      .split(';')
      .map(c => c.trim())
      .filter(c => c)
    if (componentList.length === 0) {
      core.setFailed(
        'components must contain at least one non-empty component name'
      )
      return
    }

    core.info(`DOrc API URL: ${baseUrl}`)

    // Resolve the Identity Server token URL
    const tokenUrl = await resolveTokenUrl(baseUrl)
    core.info(`IDS token URL: ${tokenUrl}`)

    const client = new DorcClient(baseUrl, { tokenUrl, clientSecret })

    // Build the request — null fields are serialized as JSON null,
    // matching the PowerShell extension's $null behaviour
    const request: DeployRequest = {
      Project: project,
      Environment: environment,
      BuildUrl: buildUri,
      BuildText: buildText,
      BuildNum: buildNum,
      Pinned: pinned,
      Components: componentList
    }

    // Create the deployment request
    const result = await client.createRequest(request)

    if (!result.Id || result.Id <= 0) {
      core.setFailed('DOrc API returned an invalid request ID')
      return
    }

    core.info(`Request ${result.Id} created`)
    core.setOutput('request-id', result.Id.toString())

    // Set a fallback so downstream steps always see a status output
    core.setOutput('status', 'Unknown')

    // Poll until completion
    const finalStatus = await client.pollUntilComplete(
      result.Id,
      pollInterval,
      timeout
    )
    core.setOutput('status', finalStatus)

    // Log component results — wrapped so a failure here doesn't mask the
    // deployment status that has already been determined
    try {
      core.info('Collecting deploy results...')
      await client.logComponentResults(result.Id)
    } catch (logError) {
      core.warning(
        `Failed to fetch component results: ${logError instanceof Error ? logError.message : logError}`
      )
    }

    if (DorcClient.isSuccessStatus(finalStatus)) {
      core.info(`Deployment completed successfully: ${finalStatus}`)
    } else {
      core.setFailed(`Deployment finished with status: ${finalStatus}`)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}
