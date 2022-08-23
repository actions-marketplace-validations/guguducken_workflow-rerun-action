const core = require('@actions/core');
const github = require('@actions/github');

const github_token = core.getInput("action-token", { required: true });
const admin = core.getInput("user", { required: true });

const oc = github.getOctokit(github_token);

const support = ["rerun"];
const prNum = github.context.payload?.pull_request?.number;

async function run() {
    try {
        if (prNum === undefined) {
            core.info("This is not pull request action");
            return;
        }

        //check wether user name which defined in yml equal to user which corresponding to token
        if (!checkCorrespoding()) {
            throw new Error("The user which defined in yml is not equal to user which corresponding to token");
        }

        //get the last comment
        const comment = getLastComment();

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

        //get commands from comment.body
        const commands = parseArray(comment.body);

        //check wether commands[0] is equal to @admin
        if (commands == null || commands.length == 0 || commands[0] != admin) {
            core.info("This comment is not " + commands[0] + ", so skip this command");
            return;
        }

        //get users of organizations
        const users_org = getOrgMembersForAuthenticatedUser();

        //get the auther of this pr
        const auther = getAuth();


        if (!checkPermission(comment, auther, users_org)) {
            failedRerun(comment);
        }
        successRerun(comment, commands);


    } catch (error) {
        core.setFailed(error.message);
    }
}

function getJobs() {
    const { data: { workflows } } = await oc.rest.actions.listRepoWorkflows(
        {
            ...github.context.repo
        }
    )
    let jobs = new Array();
}

function getLastCommitRuns() {
    //get pr for head sha
    const { data: pr } = await oc.rest.pulls.get(
        {
            ...github.context.repo,
            pull_number: prNum
        }
    )
    const sha = pr.head.sha;

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
    let ans = new Array();
    for (const workflow of workflow_runs) {
        if (workflow.head_sha == sha && !s.has(workflow.name)) {
            s.add(workflow.name);
            ans.push(
                {
                    ...github.context.repo,
                    run_id: workflow.run_number,
                }
            );
        }
    }
    return ans;
}

function rerunFailedJobs(comment) {
    const runs = getLastCommitRuns();
    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        await oc.rest.actions.reRunWorkflowFailedJobs(
            ...run
        )
    }
    let message = ">" + comment.body + "\n\n" + "All failed jobs are rerun ----- @" + admin;
    setMessageAndEmoji(comment.id, message, "laugh");
}

function rerun(comment, commands) {
    switch (commands[2]) {
        case "failed":
            rerunFailedJobs(comment);
            break;

        default:
            break;
    }
}

function successRerun(comment, commands) {
    let message = "";
    switch (commands[1]) {
        case "rerun":
            rerun(comment, commands);
            break;
        default:
            message = ">" + comment.body + "\n\n" + "This command is not support! Support: " + support + " ------@" + admin;
            setMessageAndEmoji(comment.id, message, "confused");
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

function setMessageAndEmoji(id, message, emoji) {
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

function failedRerun(comment) {
    let message = ">" + comment.body + "\n\n" + "@" + comment.user.login + " You can't run this command ------ @" + admin;
    setMessageAndEmoji(comment.id, message, "confused");

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

function getLastComment() {
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

function getAuth() {
    const { data: pr } = await oc.rest.pulls.get(
        {
            ...github.context.repo,
            pull_number: prNum
        }
    )
    return pr.user;
}

function checkCorrespoding() {
    const { data: admin_token } = await oc.rest.users.getAuthenticated();
    return admin == admin_token.login;
}


function getOrgMembersForAuthenticatedUser() {
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