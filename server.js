const express = require("express");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const app = express();
app.use(express.urlencoded({ extended: true }));

const JENKINS_URL = process.env.JENKINS_URL;
const USERNAME = process.env.JENKINS_USER;
const API_TOKEN = process.env.JENKINS_TOKEN;

// 🔥 REQUIRED for file upload
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

// Summary
function extractSummary(logText) {
  const passed = logText.match(/(\d+)\s+passed/)?.[1] || 0;
  const failed = logText.match(/(\d+)\s+failed/)?.[1] || 0;
  const skipped = logText.match(/(\d+)\s+skipped/)?.[1] || 0;
  return { passed, failed, skipped };
}

// Steps
function extractTestSteps(logText) {
  const lines = logText.split("\n");
  const steps = [];
  let index = 1;

  for (let line of lines) {
    if (
      line.includes("✓") ||
      line.includes("✔") ||
      line.includes("❌") ||
      line.includes("✖")
    ) {
      steps.push(`${index}. ${line.trim()}`);
      index++;
    }
  }

  return steps;
}

// Logs
async function getConsoleOutput(jobName, buildNumber) {
  const res = await axios.get(
    `${JENKINS_URL}/job/${jobName}/${buildNumber}/consoleText`,
    {
      auth: { username: USERNAME, password: API_TOKEN },
    },
  );
  return res.data;
}

// Build number
async function getBuildNumber(queueUrl) {
  let buildNumber = null;

  while (!buildNumber) {
    await new Promise((r) => setTimeout(r, 3000));

    const res = await axios.get(`${queueUrl}api/json`, {
      auth: { username: USERNAME, password: API_TOKEN },
    });

    if (res.data.executable) {
      buildNumber = res.data.executable.number;
    }
  }

  return buildNumber;
}

// Wait build
async function waitForBuild(jobName, buildNumber) {
  let building = true;
  let data;

  while (building) {
    await new Promise((r) => setTimeout(r, 5000));

    const res = await axios.get(
      `${JENKINS_URL}/job/${jobName}/${buildNumber}/api/json`,
      {
        auth: { username: USERNAME, password: API_TOKEN },
      },
    );

    data = res.data;
    building = data.building;
  }

  return data;
}

// 🔥 Upload logs to Slack
async function uploadLogsToSlack(logText, buildNumber) {
  fs.writeFileSync("build.log", logText);

  const form = new FormData();
  form.append("file", fs.createReadStream("build.log"));
  form.append("channels", SLACK_CHANNEL);
  form.append(
    "initial_comment",
    `📎 Full Jenkins Logs (Build #${buildNumber})`,
  );

  await axios.post("https://slack.com/api/files.upload", form, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      ...form.getHeaders(),
    },
  });
}

// MAIN
app.post("/slack-trigger", async (req, res) => {
  const rawJobName = req.body.text || "MCSL Pipeline";
  const jobName = encodeURIComponent(rawJobName);
  const responseUrl = req.body.response_url;

  try {
    res.send(`🚀 Triggering Jenkins job: ${rawJobName}...`);

    // crumb
    const crumbRes = await axios.get(`${JENKINS_URL}/crumbIssuer/api/json`, {
      auth: { username: USERNAME, password: API_TOKEN },
    });

    const crumb = crumbRes.data.crumb;
    const crumbField = crumbRes.data.crumbRequestField;

    // trigger
    const triggerRes = await axios.post(
      `${JENKINS_URL}/job/${jobName}/build`,
      {},
      {
        auth: { username: USERNAME, password: API_TOKEN },
        headers: { [crumbField]: crumb },
        maxRedirects: 0,
        validateStatus: (status) => status === 201,
      },
    );

    const queueUrl = triggerRes.headers.location;
    const buildNumber = await getBuildNumber(queueUrl);
    const result = await waitForBuild(jobName, buildNumber);

    const consoleText = await getConsoleOutput(jobName, buildNumber);

    const summary = extractSummary(consoleText);
    const steps = extractTestSteps(consoleText);

    const total =
      Number(summary.passed) + Number(summary.failed) + Number(summary.skipped);

    const buildUrl = `${JENKINS_URL}/job/${jobName}/${buildNumber}`;

    // 🔥 MESSAGE
    let message = `@here  Automation Test Report :bananadance_colors:

SUMMARY :
:white_check_mark: ${summary.passed} passed | :x: ${summary.failed} failed | :warning: ${summary.skipped} skipped | Total: ${total}

App URL : ${process.env.APPURL || "N/A"}
CARRIER : ${process.env.CARRIER || "N/A"}
Triggered BY : ${req.body.user_name || "Slack User"}
`;

    steps.forEach((step) => {
      message += `${step}\n`;
    });

    message += `\n🔗 ${buildUrl}`;

    // Send message
    await axios.post(responseUrl, { text: message });

    // 🔥 Upload FULL logs separately
    await uploadLogsToSlack(consoleText, buildNumber);
  } catch (err) {
    console.error(err.response?.data || err.message);

    if (req.body.response_url) {
      await axios.post(req.body.response_url, {
        text: "❌ Jenkins trigger failed",
      });
    }
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
