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
        const comment = github.context.payload.comment;

        if (comment === null) {
            core.info("There is no any comments");
            return;
        }

        let html_temp = "https://github.com/" + github.context.repo.owner + "/" + github.context.repo.repo + "/issues/";

        const re_issue = new RegExp(await reParse(html_temp), "igm");
        if (re_issue.test(comment.html_url)) {
            core.info("This workflow is triggered by issue, so skip it.");
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
            core.info("This comment is not @" + admin + ", so skip this command");
            return;
        }

        //get users of organizations
        const users_org = await getOrgMembersForAuthenticatedUser();

        //get the auther of this pr
        const PR = await getPR();

        if (PR === null) {
            core.info("Get information of this pull request failed");
            return;
        }

        if (!checkPermission(comment, PR.user, users_org)) {
            await failed(comment);
        } else {
            await success(comment, commands, PR);
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

async function reParse(str) {
    let ans = "";
    for (let index = 0; index < str.length; index++) {
        const e = str[index];
        if (e == "/" || e == "{" || e == "}" || e == "[" || e == "]" ||
            e == "(" || e == ")" || e == "^" || e == "$" || e == "+" ||
            e == "\\" || e == "." || e == "*" || e == "|" || e == "?") {
            ans += "\\";
        }
        ans += e;
    }
    return ans
}

async function getLastCommitRunsAndJobs(PR) {
    core.info("------------------------------------------------------- Start Find Workflows -------------------------------------------------------");
    //get pr for head sha
    const sha = PR.head.sha;

    let runs = new Array();
    let jobs = new Array();

    const { data: workflows_all } = await oc.rest.actions.listRepoWorkflows(
        {
            ...github.context.repo
        }
    )

    for (const workflow of workflows_all.workflows) {
        if (workflow.state == "active" && workflow.name != workflow_this) {
            core.info("Start finding workflow, name is: " + workflow.name);
            let num_page = 1;
            let num_total_1 = 0;
            let num_total_2 = 0;
            while (true) {
                const { data: { total_count: total_count_1, workflow_runs: workflow_runs_1 } } = await oc.rest.actions.listWorkflowRuns(
                    {
                        ...github.context.repo,
                        workflow_id: workflow.id,
                        per_page: 100,
                        page: num_page,
                        event: "pull_request"
                    }
                );
                const { data: { total_count: total_count_2, workflow_runs: workflow_runs_2 } } = await oc.rest.actions.listWorkflowRuns(
                    {
                        ...github.context.repo,
                        workflow_id: workflow.id,
                        per_page: 100,
                        page: num_page,
                        event: "pull_request_target"
                    }
                );
                if (total_count_1 + total_count_2 == 0) {
                    core.info("This workflow ---- " + workflow.name + " has never been run with this commit of this pr");
                    core.info("------------------------------------------------------------------------------------------------------------------------------------");
                    break;
                }
                num_page++;
                let flag = false;

                if (num_total_1 < total_count_1) {
                    num_total_1 += workflow_runs_1.length;

                    for (const workflow_run of workflow_runs_1) {
                        if (workflow_run.head_sha == sha) {
                            runs.push(
                                {
                                    name: workflow_run.name,
                                    run_id: workflow_run.id,
                                    status: workflow_run.status,
                                    conclusion: workflow_run.conclusion
                                }
                            );
                            core.info("Find the workflow run: " + JSON.stringify(runs[runs.length - 1]));

                            // let t = JSON.parse(await (await http.get(workflow_run.jobs_url)).readBody());
                            // for (const job of t.jobs) {
                            //     jobs.push(
                            //         {
                            //             name: job.name,
                            //             id: job.id,
                            //             status: job.status,
                            //             conclusion: job.conclusion,
                            //             name_workflow: workflow.name,
                            //             status_workflow: workflow.status
                            //         }
                            //     );
                            // }
                            flag = true;
                            break;
                        }
                    }
                }

                if (!flag && num_total_2 < total_count_2) {
                    num_total_2 += workflow_runs_2.length;

                    for (const workflow_run of workflow_runs_2) {
                        if (workflow_run.head_sha == sha) {
                            runs.push(
                                {
                                    name: workflow_run.name,
                                    run_id: workflow_run.id,
                                    status: workflow_run.status,
                                    conclusion: workflow_run.conclusion
                                }
                            );
                            core.info("Find the workflow run: " + JSON.stringify(runs[runs.length - 1]));

                            // let t = JSON.parse(await (await http.get(workflow_run.jobs_url)).readBody());
                            // for (const job of t.jobs) {
                            //     jobs.push(
                            //         {
                            //             name: job.name,
                            //             id: job.id,
                            //             status: job.status,
                            //             conclusion: job.conclusion,
                            //             name_workflow: workflow.name,
                            //             status_workflow: workflow.status
                            //         }
                            //     );
                            // }
                            flag = true;
                            break;
                        }
                    }
                }

                if (flag) {
                    core.info("------------------------------------------------------------------------------------------------------------------------------------");
                    break;
                }
                if (num_total_1 + num_total_2 == total_count_1 + total_count_2) {
                    core.info(workflow.name + " do not have corresponding workflow run with the last commit of this pr");
                    core.info("------------------------------------------------------------------------------------------------------------------------------------");
                    break;
                }
            }
        }
    }

    return { jobs: jobs, runs: runs };
}

async function rerunFailedJobs(comment, runs, commands) {
    let flag = true;
    core.info("--------------------------------------------------- Start Rerun Failed Workflows ---------------------------------------------------");
    let debug = commands[3] == "yes";
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
                run_id: run.run_id,
                enable_debug_logging: debug
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

async function rerunAllJobs(comment, runs, commands) {
    let flag = true;
    core.info("----------------------------------------------------- Start Rerun All Workflows ----------------------------------------------------");
    let debug = commands[3] == "yes";
    for (const run of runs) {
        if (run.status != "completed") {
            flag = false;
            core.info("The workflow " + run.name + " is running, try again later");
            continue;
        }
        core.info("Rerun workflow: " + run.name);
        await oc.rest.actions.reRunWorkflow({
            ...github.context.repo,
            run_id: run.run_id,
            enable_debug_logging: debug
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

async function rerun(comment, commands, PR) {
    if (commands.length <= 2) {
        return;
    }
    const { jobs, runs } = await getLastCommitRunsAndJobs(PR);
    switch (commands[2]) {
        case "all":
            await rerunAllJobs(comment, runs, commands);
            break;
        case "failed":
            await rerunFailedJobs(comment, runs, commands);
            break;
        default:
            let message = ">" + comment.body + "\n\n" + "This command is not support! Support: " + support + " ------@" + admin;
            await setMessageAndEmoji(comment.id, message, "confused");
            break;
    }
}

async function success(comment, commands, PR) {
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
        if (e != " ") {
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

async function failed(comment) {
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

async function getPR() {
    const ans = await oc.rest.pulls.get(
        {
            ...github.context.repo,
            pull_number: prNum
        }
    )

    if (ans.status != 200) {
        return null;
    }
    return ans.data;
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