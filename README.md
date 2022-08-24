# Command to rerun
This action supports re-running CI tests with commands.
## Usage
### First

Create a workflow `reruner.yml` file in your repositories `.github/workflows `directory.

### Inputs

#### action-token

The GitHub Actions token. e.g. `secrets.PATHS_TOKEN`. For more information,See this link: [Creating a personal access token](https://docs.github.com/cn/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)

#### user
The `user` is the `user name` corresponding to the action-token

#### workflow-this
This is the name of this workflow. This is set so that you can skip this workflow during subsequent workflow searches

### Example
~~~yml
name: Command to Rerun Actions
on:
  issue_comment:
    types: [created]
    
jobs:
  Rerun-Actions:
    runs-on: ubuntu-latest
    steps:
      - uses: guguducken/workflow-rerun-action@v0.0.1
        with:
          action-token: ${{ secrets.TOKEN_ACTION }}
          user: guguducken
          workflow-this: Command to Rerun Actions
~~~