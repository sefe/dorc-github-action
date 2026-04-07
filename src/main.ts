import * as core from '@actions/core'
import { resolveTokenUrl } from './auth'
import { DorcClient, DeployRequest } from './dorc-client'

export async function run(): Promise<void> {
  try {
    const baseUrl = core.getInput('base-url', { required: true }).replace(/\/+$/, '')
    const clientSecret = core.getInput('dorc-ids-secret', { required: true })
    const project = core.getInput('project', { required: true })
    const environment = core.getInput('environment', { required: true })
    const components = core.getInput('components', { required: true })
    const buildText = core.getInput('build-text')
    const buildNum = core.getInput('build-num')
    const pinned = core.getBooleanInput('pinned')
    const buildUri = core.getInput('build-uri')
    const pollInterval = parseInt(core.getInput('poll-interval') || '5', 10)

    // Mask the secret from logs
    core.setSecret(clientSecret)

    core.info(`DOrc API URL: ${baseUrl}`)

    // Resolve the Identity Server token URL
    const tokenUrl = await resolveTokenUrl(baseUrl)
    core.info(`IDS token URL: ${tokenUrl}`)

    const client = new DorcClient(baseUrl, { tokenUrl, clientSecret })

    // Build the request
    const request: DeployRequest = {
      Project: project,
      Environment: environment,
      BuildUrl: buildUri,
      BuildText: buildText,
      BuildNum: buildNum,
      Pinned: pinned,
      Components: components.split(';').map(c => c.trim()).filter(c => c)
    }

    // Create the deployment request
    const result = await client.createRequest(request)

    if (!result.Id || result.Id <= 0) {
      core.setFailed('DOrc API returned an invalid request ID')
      return
    }

    core.info(`Request ${result.Id} created`)
    core.setOutput('request-id', result.Id.toString())

    // Poll until completion
    const finalStatus = await client.pollUntilComplete(result.Id, pollInterval)
    core.setOutput('status', finalStatus)

    // Log component results
    core.info('Collecting deploy results...')
    await client.logComponentResults(result.Id)

    if (client.isSuccessStatus(finalStatus)) {
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

