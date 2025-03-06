const core = require('@actions/core');
const github = require('@actions/github');
const { Octokit } = require('@octokit/rest');

// ANSI color codes
const Colors = {
    HEADER: '\u001b[95m',
    BLUE: '\u001b[94m',
    GREEN: '\u001b[92m',
    YELLOW: '\u001b[93m',
    RED: '\u001b[91m',
    RESET: '\u001b[0m',
    BOLD: '\u001b[1m'
};

function colorLog(message, color, isBold = false) {
    console.log(`${isBold ? Colors.BOLD : ''}${color}${message}${Colors.RESET}`);
}

async function getWorkflowStatus(octokit, owner, repo, branch) {
    try {
        const response = await octokit.actions.listWorkflowRunsForRepo({
            owner,
            repo,
            branch
        });

        if (response.data.total_count === 0) {
            colorLog(`No workflows found for branch ${branch}`, Colors.YELLOW);
            return null;
        }

        return response.data.workflow_runs[0].conclusion;
    } catch (error) {
        colorLog(`Error checking workflow status: ${error.message}`, Colors.RED);
        return null;
    }
}

async function checkBaseBranchStatus(octokit, owner, repo, prNumber) {
    try {
        const { data: prData } = await octokit.pulls.get({
            owner,
            repo,
            pull_number: prNumber
        });

        const baseBranch = prData.base.ref;
        const prTitle = prData.title;

        colorLog(`PR #${prNumber}: ${prTitle}`, Colors.BLUE, true);
        colorLog(`Base Branch: ${baseBranch}`, Colors.GREEN);

        const status = await getWorkflowStatus(octokit, owner, repo, baseBranch);
        if (status !== 'success') {
            colorLog(`Base branch '${baseBranch}' checks are not passing (status: ${status})`, Colors.RED, true);
            return false;
        }
        
        colorLog(`✓ Base branch '${baseBranch}' is green and ready to accept your PR #${prNumber}`, Colors.GREEN, true);
        return true;

    } catch (error) {
        colorLog(`Error checking base branch: ${error.message}`, Colors.RED);
        return false;
    }
}

async function run() {
    try {
        // Get inputs and context
        const skipChecks = core.getInput('silent').toLowerCase() === 'true';
        const token = process.env.GITHUB_TOKEN;
        const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
        const octokit = new Octokit({ auth: token });

        // Check if silent mode is enabled
        if (skipChecks) {
            colorLog('\n⚠️ WARNING: Checks are disabled!', Colors.YELLOW, true);
            colorLog('This action is running in silent mode. No checks will be performed.', Colors.YELLOW);
            colorLog('This may lead to merge issues if the base branch is failing.', Colors.YELLOW);
            core.setOutput('check-status', 'skipped');
            return;
        }

        const eventName = github.context.eventName;

        if (eventName === 'pull_request') {
            // Handle PR event
            const prNumber = github.context.payload.pull_request.number;
            const prTitle = github.context.payload.pull_request.title;
            const baseBranch = github.context.payload.pull_request.base.ref;

            colorLog('\n=== Pull Request Event ===', Colors.HEADER, true);
            colorLog(`Checking PR #${prNumber}`, Colors.BLUE, true);
            colorLog(`Title: ${prTitle}`, Colors.BLUE);
            colorLog(`Base Branch: ${baseBranch}`, Colors.GREEN);

            const isBaseValid = await checkBaseBranchStatus(octokit, owner, repo, prNumber);
            core.setOutput('check-status', isBaseValid ? 'success' : 'failure');
            
            if (!isBaseValid) {
                core.setFailed('Base branch checks are not passing');
            }
        } else {
            // Handle push event
            const currentBranch = github.context.ref.split('/').pop();
            colorLog(`\n=== Push Event on Branch: ${currentBranch} ===`, Colors.HEADER, true);

            // Get all open PRs targeting this branch
            const { data: prs } = await octokit.pulls.list({
                owner,
                repo,
                state: 'open',
                base: currentBranch
            });

            if (prs.length === 0) {
                colorLog(`No open PRs found targeting ${currentBranch}`, Colors.YELLOW);
                core.setOutput('rerun-status', 'success');
                return;
            }

            colorLog(`Found ${prs.length} open PRs targeting ${currentBranch}`, Colors.GREEN, true);
            let rerunCount = 0;

            for (const pr of prs) {
                colorLog(`\nProcessing PR #${pr.number}: ${pr.title}`, Colors.BLUE);
                colorLog(`Branch: ${pr.head.ref}`, Colors.GREEN);

                try {
                    // Rerun the PR workflow
                    const rerunUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${pr.head.sha}/rerun`;
                    const response = await fetch(rerunUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (response.status === 201) {
                        rerunCount++;
                        colorLog(`✓ Triggered rerun for PR #${pr.number}`, Colors.GREEN);
                    } else {
                        const errorData = await response.text();
                        colorLog(`✗ Failed to rerun PR #${pr.number}. Status: ${response.status}. Error: ${errorData}`, Colors.RED);
                    }
                } catch (error) {
                    colorLog(`Error processing PR #${pr.number}: ${error.message}`, Colors.RED);
                }
            }

            colorLog(`\nSummary: Triggered ${rerunCount} PR workflow reruns`, Colors.BLUE, true);
            core.setOutput('rerun-count', rerunCount.toString());
            core.setOutput('rerun-status', 'success');
        }
    } catch (error) {
        colorLog(`Action failed with error: ${error.message}`, Colors.RED);
        core.setFailed(error.message);
    }
}

run(); 