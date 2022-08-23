const core = require('@actions/core');
const github = require('@actions/github');

const github_token = core.getInput("action-token", { required: true });
const admin = core.getInput("user", { required: true });

const oc = github.getOctokit(github_token);

const support = ["rerun"];
// const prNum = github.context.payload?.pull_request?.number;
const prNum = github.context.issue.number;

async function run() {
    try {
        if (prNum === undefined) {
            core.info("This is not pull request action");
            return;
        } else {
            core.info(prNum);
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

        //get commands from comment.body
        const commands = parseArray(comment.body);

        //check wether commands[0] is equal to @admin
        if (commands == null || commands.length == 0 || commands[0] != "@" + admin) {
            core.info("This comment is not " + commands[0] + ", so skip this command");
            return;
        }
        core.info(commands);

        //get users of organizations
        const users_org = await getOrgMembersForAuthenticatedUser();

        core.info(JSON.stringify(users_org));

        //get the auther of this pr
        const auther = await getAuth();


        if (!checkPermission(comment, auther, users_org)) {
            await failedRerun(comment);
        }
        await successRerun(comment, commands);


    } catch (error) {
        core.setFailed(error.message);
    }
}

async function getLastCommitRuns() {
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
            ans.push(workflow);
        }
    }
    return ans;
}

async function rerunFailedJobs(comment) {
    const runs = await getLastCommitRuns();
    for (const run of runs) {
        core.info("rerun: " + run.name);
        await oc.rest.actions.reRunWorkflowFailedJobs(
            {
                ...github.context.repo,
                run_id: run.id,
            }
        )
    }
    let message = ">" + comment.body + "\n\n" + "All failed jobs are rerun ----- @" + admin;
    await setMessageAndEmoji(comment.id, message, "laugh");
}

async function rerun(comment, commands) {
    switch (commands[2]) {
        case "failed":
            await rerunFailedJobs(comment);
            break;

        default:
            break;
    }
}

async function successRerun(comment, commands) {
    let message = "";
    switch (commands[1]) {
        case "rerun":
            await rerun(comment, commands);
            break;
        default:
            message = ">" + comment.body + "\n\n" + "This command is not support! Support: " + support + " ------@" + admin;
            await setMessageAndEmoji(comment.id, message, "confused");
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
        core.info(user.login);
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

async function getAuth() {
    const { data: pr } = await oc.rest.pulls.get(
        {
            ...github.context.repo,
            pull_number: prNum
        }
    )
    return pr.user;
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