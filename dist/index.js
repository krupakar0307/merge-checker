/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 431:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 715:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 506:
/***/ ((module) => {

module.exports = eval("require")("@octokit/rest");


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(431);
const github = __nccwpck_require__(715);
const { Octokit } = __nccwpck_require__(506);

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
                    const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
                        owner,
                        repo,
                        branch: pr.head.ref
                    });

                    if (runs.total_count === 0) {
                        colorLog(`No workflows found for PR #${pr.number}`, Colors.YELLOW);
                        continue;
                    }

                    const response = await octokit.actions.reRunWorkflowRun({
                        owner,
                        repo,
                        run_id: runs.workflow_runs[0].id
                    });

                    if (response.status === 201) {
                        rerunCount++;
                        colorLog(`✓ Triggered rerun for PR #${pr.number}`, Colors.GREEN);
                    } else {
                        colorLog(`✗ Failed to trigger PR #${pr.number}`, Colors.RED);
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
module.exports = __webpack_exports__;
/******/ })()
;