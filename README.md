# DOrc GitHub Action

A GitHub Action to trigger [DOrc](https://github.com/sefe/dorc) deployment requests from GitHub Actions workflows.

This is the GitHub Actions equivalent of the [DOrc Azure DevOps Extension](https://github.com/sefe/dorc-azure-devops-extension).

## Usage

```yaml
- name: Deploy via DOrc
  uses: sefe/dorc-github-action@v1
  with:
    base-url: 'https://deploymentportal:8443/'
    dorc-ids-secret: ${{ secrets.DORC_IDS_SECRET }}
    project: 'MyProject'
    environment: 'DEV'
    components: 'Component1;Component2'
    build-num: 'latest'
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `base-url` | Yes | | DOrc API base URL (e.g. `https://dorc:8443/`) |
| `dorc-ids-secret` | Yes | | Identity Server client secret for DOrc API |
| `project` | Yes | | Project name as configured in DOrc |
| `environment` | Yes | | Target environment name as configured in DOrc |
| `components` | Yes | | Semicolon-delimited list of DOrc components to deploy |
| `build-text` | No | `''` | Name of the build |
| `build-num` | No | `''` | Version of the build, or `"latest"` |
| `pinned` | No | `false` | Use only pinned builds |
| `build-uri` | No | `''` | Artifact location URI (e.g. drop folder or GitHub artifact URL) |
| `poll-interval` | No | `5` | Seconds between status polls (minimum 1) |
| `timeout` | No | `60` | Maximum minutes to wait for deployment to complete |

## Outputs

| Output | Description |
|---|---|
| `request-id` | The DOrc request ID that was created |
| `status` | Final status of the deployment (e.g. `Completed`, `Errored`, `Failed`) |

## Full Example

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - DEV
          - UAT
          - PROD

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via DOrc
        id: dorc
        uses: sefe/dorc-github-action@v1
        with:
          base-url: ${{ vars.DORC_API_URL }}
          dorc-ids-secret: ${{ secrets.DORC_IDS_SECRET }}
          project: 'MyProject'
          environment: ${{ inputs.environment }}
          components: 'WebApp;Database;API'
          build-num: 'latest'
          timeout: '120'

      - name: Report result
        if: always()
        run: |
          echo "DOrc Request ID: ${{ steps.dorc.outputs.request-id }}"
          echo "Status: ${{ steps.dorc.outputs.status }}"
```

## Using with GitHub Artifacts

To deploy from a GitHub artifact location, use the `build-uri` input:

```yaml
- name: Deploy via DOrc
  uses: sefe/dorc-github-action@v1
  with:
    base-url: ${{ vars.DORC_API_URL }}
    dorc-ids-secret: ${{ secrets.DORC_IDS_SECRET }}
    project: 'MyProject'
    environment: 'DEV'
    components: 'WebApp'
    build-uri: ${{ steps.upload.outputs.artifact-url }}
```

## Error Handling

The action includes:

- **Automatic token refresh** — OAuth tokens are refreshed proactively before expiry and on 401 responses.
- **Transient error retry** — HTTP 502/503/504 and network errors are retried up to 3 times with exponential backoff.
- **Deployment timeout** — Configurable via the `timeout` input (default: 60 minutes). Prevents runaway jobs.
- **Request timeouts** — Individual HTTP requests time out after 30-60 seconds to prevent hanging on unresponsive servers.

## Development

```bash
# Install dependencies
npm install

# Run all checks (format, lint, test, bundle)
npm run all

# Or individually:
npm run format    # Format code with Prettier
npm run lint      # Lint with ESLint
npm test          # Run Jest tests
npm run bundle    # Bundle with ncc into dist/
```

After making changes, always run `npm run bundle` and commit the `dist/` folder.

## Releasing

1. Run all checks: `npm run all`
2. Commit the updated `dist/` folder
3. Create a tag: `git tag -a v1.x.x -m "Release v1.x.x"`
4. Push the tag: `git push origin v1.x.x`
5. Update the major version tag: `git tag -fa v1 -m "Update v1 tag" && git push origin v1 --force`
