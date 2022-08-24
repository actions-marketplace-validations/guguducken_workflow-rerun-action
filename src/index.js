const core = require('@actions/core');
const github = require('@actions/github');
const http_client = require('@actions/http-client');

const github_token = core.getInput("action-token", { required: true });
const admin = core.getInput("user", { required: true });
const workflow_this = core.getInput("workflow-this", { required: true });

const http = new http_client.HttpClient(
    {
        userAgent: "guguducken/workflow-rerun-action"
    }
);

const oc = github.getOctokit(github_token);

const support = ["all", "failed"];
const prNum = github.context.issue.number;

async function run() {
    try {
        if (prNum === undefined) {
            core.info("This is not pull request action");
            return;
        }

        //check wether user name which defined in yml equal to user which corresponding to token
        if (!await checkCorrespoding()) {
            throw new Error("The user which defined in yml is not equal to user which corresponding to token");
        }

        //get the last comment
        const comment = await getLastComment();

        if (comment === null) {
            core.info("There is no any comments");
            return;
        }

        //check wether this comment is from bot or assistant
        const re_bot = /\[bot\]/igm;
        const re_assitant = /assistant/igm;
        if (re_bot.test(comment.user.login) || re_assitant.test(comment.user.login)) {
            core.info("This comment is from bot or assistant");
            return;
        }

        core.info(JSON.stringify(comment));

        //get commands from comment.body
        const commands = parseArray(comment.body);

        //check wether commands[0] is equal to @admin
        if (commands == null || commands.length == 0 || commands[0] != "@" + admin) {
            core.info("This comment is not " + commands[0] + ", so skip this command");
            return;
        }

        //get users of organizations
        const users_org = await getOrgMembersForAuthenticatedUser();

        //get the auther of this pr
        const PR = await getPR();

        if (PR === null) {
            core.info("This workflow is not corresponding to a PR");
            return;
        }

        core.info(JSON.stringify(PR));

        if (!checkPermission(comment, PR.user, users_org)) {
            await failedRerun(comment);
        } else {
            await successRerun(comment, commands, PR);
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

async function getLastCommitRunsAndJobs(PR) {
    core.info("start getLastCommitRunsAndJobs");
    //get pr for head sha
    const sha = PR.head.sha;

    //list workflows for this repository
    const { data: { workflow_runs } } = await oc.rest.actions.listWorkflowRunsForRepo(
        {
            ...github.context.repo,
            per_page: 100,
            page: 1
        }
    )

    //find workflow which corresponding to this pr
    let s = new Set();
    let runs = new Array();
    let jobs = new Array();
    for (const workflow of workflow_runs) {
        if (workflow.head_sha == sha && !s.has(workflow.name) && workflow.name != workflow_this) {
            s.add(workflow.name);
            runs.push(
                {
                    name: workflow.name,
                    run_id: workflow.id,
                    status: workflow.status,
                    conclusion: workflow.conclusion
                }
            );
            let t = JSON.parse(await (await http.get(workflow.jobs_url)).readBody());
            for (const job of t.jobs) {
                jobs.push(
                    {
                        name: job.name,
                        id: job.id,
                        status: job.status,
                        conclusion: job.conclusion,
                        name_workflow: workflow.name,
                        status_workflow: workflow.status
                    }
                );
            }
        }
    }
    return { jobs: jobs, runs: runs };
}

async function rerunFailedJobs(comment, runs) {
    let flag = true;
    for (const run of runs) {
        if (run.status != "completed") {
            core.info("The workflow " + run.name + " is running, try again later");
            flag = false;
            continue;
        }
        if (run.conclusion == "failure" || run.conclusion == "cancelled") {
            core.info("Rerun workflow: " + run.name);
            await oc.rest.actions.reRunWorkflowFailedJobs({
                ...github.context.repo,
                run_id: run.run_id
            });
        }
    }
    let message = ">" + comment.body + "\n\n";
    if (flag) {
        message += "All failed jobs are rerun ----- @" + admin;
        await setMessageAndEmoji(comment.id, message, "laugh");
    } else {
        message += "Some workflows were running before that, detail for this: [action detail](https://github.com/" + github.context.repo.owner + "/" + github.context.repo.repo + "/actions/runs/" + github.context.runId + ")  ----- @" + admin;
        await setMessageAndEmoji(comment.id, message, "confused");
    }
}

async function rerunAllJobs(comment, runs) {
    let flag = true;
    for (const run of runs) {
        if (run.status != "completed") {
            flag = false;
            core.info("The workflow " + run.name + " is running, try again later");
            continue;
        }
        core.info("Rerun workflow: " + run.name);
        await oc.rest.actions.reRunWorkflow({
            ...github.context.repo,
            run_id: run.run_id
        });
    }

    let message = ">" + comment.body + "\n\n"
    if (flag) {
        message += "All jobs are rerun ----- @" + admin;
        await setMessageAndEmoji(comment.id, message, "laugh");
    } else {
        message += "Some workflows were running before that, detail for this: [action detail](https://github.com/" + github.context.repo.owner + "/" + github.context.repo.repo + "/actions/runs/" + github.context.runId + ")  ----- @" + admin;
        await setMessageAndEmoji(comment.id, message, "confused");
    }
}

async function rerun(comment, commands) {
    if (commands.length <= 2) {
        return;
    }
    const { jobs, runs } = await getLastCommitRunsAndJobs(PR);
    switch (commands[2]) {
        case "all":
            await rerunAllJobs(comment, runs);
            break;
        case "failed":
            await rerunFailedJobs(comment, runs);
            break;
        default:
            let message = ">" + comment.body + "\n\n" + "This command is not support! Support: " + support + " ------@" + admin;
            await setMessageAndEmoji(comment.id, message, "confused");
            break;
    }
}

async function successRerun(comment, commands, PR) {
    core.info("rerun start");
    switch (commands[1]) {
        case "rerun":
            await rerun(comment, commands, PR);
            break;
        default:
            core.info("This is not special command, action finished");
            break;
    }
}

function parseArray(str) {
    if (str == null || str.length == 0) {
        return null;
    }
    let t = "";
    let ans = new Array();
    for (let i = 0; i < str.length; i++) {
        const e = str[i];
        if ('a' <= e && e <= 'z' || e == '@') {
            t += e;
        } else {
            if (t.length != 0) {
                ans.push(t);
                t = "";
            }
        }
    }
    if (t.length != 0) {
        ans.push(t);
    }
    return ans;
}

async function setMessageAndEmoji(id, message, emoji) {
    await oc.rest.issues.updateComment(
        {
            ...github.context.repo,
            comment_id: id,
            body: message
        }
    )

    await oc.rest.reactions.createForIssueComment(
        {
            ...github.context.repo,
            comment_id: id,
            content: emoji
        }
    )
}

async function failedRerun(comment) {
    let message = ">" + comment.body + "\n\n" + "@" + comment.user.login + " You can't run this command ------ @" + admin;
    await setMessageAndEmoji(comment.id, message, "confused");

}

function checkPermission(comment, auther, users_org) {
    if (comment.user.login == auther.login) {
        return true;
    }
    for (const user of users_org) {
        if (comment.user.login == user.login) {
            return true;
        }
    }
    return false;
}

async function getLastComment() {
    const { data: comments } = await oc.rest.issues.listComments(
        {
            ...github.context.repo,
            issue_number: prNum
        }
    )
    if (comments.length == 0) {
        return null;
    }
    return comments[comments.length - 1];
}

async function getPR() {
    core.info("start to get pr");
    const { data: PR } = await oc.rest.pulls.get(
        {
            ...github.context.repo,
            pull_number: prNum
        }
    )
    core.info("finish get pr");
    return PR;
}

async function checkCorrespoding() {
    const { data: admin_token } = await oc.rest.users.getAuthenticated();
    return admin == admin_token.login;
}


async function getOrgMembersForAuthenticatedUser() {
    //get organizations
    const { data: orgs } = await oc.rest.orgs.listForAuthenticatedUser();

    //get users of organizations
    let users_org = new Array();
    for (const org of orgs) {
        let { data: users } = await oc.rest.orgs.listMembers(
            {
                org: org.login,
            }
        )
        users_org.push(...users);
    }
    return users_org;
}

run();