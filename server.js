const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.urlencoded({ extended: true }));

// ENV
const JENKINS_URL = process.env.JENKINS_URL;
const USERNAME = process.env.JENKINS_USER;
const API_TOKEN = process.env.JENKINS_TOKEN;

// Health
app.get("/", (req, res) => {
  res.send("🚀 Slack → Jenkins Trigger is running");
});

// 📊 Summary extraction
function extractSummary(logText) {
  const passed = logText.match(/(\d+)\s+passed/)?.[1] || 0;
  const failed = logText.match(/(\d+)\s+failed/)?.[1] || 0;
  const skipped = logText.match(/(\d+)\s+skipped/)?.[1] || 0;

  return { passed, failed, skipped };
}

// ❌ Failed tests (optional)
function extractFailedTests(logText) {
  const failedTests = [];
  const lines = logText.split("\n");

  for (let line of lines) {
    if (line.includes("❌") || line.includes("failed")) {
      failedTests.push(line.trim());
    }
  }

  return failedTests.slice(0, 10);
}

// 🔥 Extract Playwright-style steps
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

// 📜 Get logs
async function getConsoleOutput(jobName, buildNumber) {
  const res = await axios.get(
    `${JENKINS_URL}/job/${jobName}/${buildNumber}/consoleText`,
    {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    },
  );
  return res.data;
}

// 🔢 Get build number
async function getBuildNumber(queueUrl) {
  let buildNumber = null;

  while (!buildNumber) {
    await new Promise((r) => setTimeout(r, 3000));

    const res = await axios.get(`${queueUrl}api/json`, {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    });

    if (res.data.executable) {
      buildNumber = res.data.executable.number;
    }
  }

  return buildNumber;
}

// ⏳ Wait for build
async function waitForBuild(jobName, buildNumber) {
  let building = true;
  let data;

  while (building) {
    await new Promise((r) => setTimeout(r, 5000));

    const res = await axios.get(
      `${JENKINS_URL}/job/${jobName}/${buildNumber}/api/json`,
      {
        auth: {
          username: USERNAME,
          password: API_TOKEN,
        },
      },
    );

    data = res.data;
    building = data.building;
  }

  return data;
}

// 🚀 MAIN ROUTE
app.post("/slack-trigger", async (req, res) => {
  const rawJobName = req.body.text || "MCSL Pipeline";
  const jobName = encodeURIComponent(rawJobName);
  const responseUrl = req.body.response_url;

  try {
    res.send(`🚀 Triggering Jenkins job: ${rawJobName}...`);

    // 🔐 Crumb
    const crumbRes = await axios.get(`${JENKINS_URL}/crumbIssuer/api/json`, {
      auth: { username: USERNAME, password: API_TOKEN },
    });

    const crumb = crumbRes.data.crumb;
    const crumbField = crumbRes.data.crumbRequestField;

    // 🚀 Trigger build
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

    // 🔢 Build number
    const buildNumber = await getBuildNumber(queueUrl);

    // ⏳ Wait
    const result = await waitForBuild(jobName, buildNumber);

    // 📜 Logs
    const consoleText = await getConsoleOutput(jobName, buildNumber);

    const summary = extractSummary(consoleText);
    const steps = extractTestSteps(consoleText);

    const total =
      Number(summary.passed) + Number(summary.failed) + Number(summary.skipped);

    const buildUrl = `${JENKINS_URL}/job/${jobName}/${buildNumber}`;

    // 🎯 FINAL SLACK MESSAGE (YOUR FORMAT)
    let message = `@here  Automation Test Report :bananadance_colors:

SUMMARY :
:white_check_mark: ${summary.passed} passed | :x: ${summary.failed} failed | :warning: ${summary.skipped} skipped | Total: ${total}

App URL : ${process.env.APPURL || "N/A"}
CARRIER : ${process.env.CARRIER || "N/A"}
Triggered BY : ${req.body.user_name || "Slack User"}
`;

    // 🔥 Steps
    steps.forEach((step) => {
      message += `${step}\n`;
    });

    // 🔗 Jenkins link
    message += `\n🔗 ${buildUrl}`;

    // 📤 Send
    await axios.post(responseUrl, { text: message });
  } catch (err) {
    console.error(err.response?.data || err.message);

    if (req.body.response_url) {
      await axios.post(req.body.response_url, {
        text: "❌ Jenkins trigger failed",
      });
    }
  }
});

// PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
