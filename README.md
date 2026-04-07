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
| `base-url` | Yes | | DOrc API base URL (e.g. `https://deploymentportal:8443/`) |
| `dorc-ids-secret` | Yes | | Identity Server client secret for DOrc API |
| `project` | Yes | | Project name as configured in DOrc |
| `environment` | Yes | | Target environment name as configured in DOrc |
| `components` | Yes | | Semicolon-delimited list of DOrc components to deploy |
| `build-text` | No | `''` | Name of the build |
| `build-num` | No | `''` | Version of the build, or `"latest"` |
| `pinned` | No | `false` | Use only pinned builds |
| `build-uri` | No | `''` | Drop folder URI or artifact location |
| `poll-interval` | No | `5` | Seconds between status polls |

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

      - name: Report result
        if: always()
        run: |
          echo "DOrc Request ID: ${{ steps.dorc.outputs.request-id }}"
          echo "Status: ${{ steps.dorc.outputs.status }}"
```

## Using with GitHub Artifacts

To deploy from GitHub artifact locations rather than TFS/Azure DevOps builds, use the `build-uri` input:

```yaml
- name: Deploy via DOrc
  uses: sefe/dorc-github-action@v1
  with:
    base-url: ${{ vars.DORC_API_URL }}
    dorc-ids-secret: ${{ secrets.DORC_IDS_SECRET }}
    project: 'MyProject'
    environment: 'DEV'
    components: 'WebApp'
    build-uri: 'https://github.com/sefe/my-repo/actions/runs/12345/artifacts'
```

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

1. Create a tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
2. Push the tag: `git push origin v1.0.0`
3. Update the major version tag: `git tag -fa v1 -m "Update v1 tag" && git push origin v1 --force`
