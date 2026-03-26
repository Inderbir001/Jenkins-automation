const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.urlencoded({ extended: true }));

// ✅ ENV variables
const JENKINS_URL = process.env.JENKINS_URL;
const USERNAME = process.env.JENKINS_USER;
const API_TOKEN = process.env.JENKINS_TOKEN;

// 🔍 Health check
app.get("/", (req, res) => {
  res.send("🚀 Slack → Jenkins Trigger is running");
});

// 🧠 Extract summary
function extractSummary(logText) {
  const passed = logText.match(/(\d+)\s+passed/)?.[1] || 0;
  const failed = logText.match(/(\d+)\s+failed/)?.[1] || 0;
  const skipped = logText.match(/(\d+)\s+skipped/)?.[1] || 0;

  return { passed, failed, skipped };
}

// ❌ Extract failed test names (top 10)
function extractFailedTests(logText) {
  const failedTests = [];

  const lines = logText.split("\n");

  for (let line of lines) {
    if (line.includes("❌") || line.includes("failed")) {
      failedTests.push(line.trim());
    }
  }

  return failedTests.slice(0, 10); // limit
}

// 📜 Get console logs
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

// ⏳ Get build number
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

// ⏳ Wait for build completion
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
    // ⚡ Immediate response
    res.send(`🚀 Triggering Jenkins job: ${rawJobName}...`);

    // 🔐 Get crumb
    const crumbRes = await axios.get(`${JENKINS_URL}/crumbIssuer/api/json`, {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    });

    const crumb = crumbRes.data.crumb;
    const crumbField = crumbRes.data.crumbRequestField;

    // 🚀 Trigger build
    const triggerRes = await axios.post(
      `${JENKINS_URL}/job/${jobName}/build`,
      {},
      {
        auth: {
          username: USERNAME,
          password: API_TOKEN,
        },
        headers: {
          [crumbField]: crumb,
        },
        maxRedirects: 0,
        validateStatus: (status) => status === 201,
      },
    );

    // 📌 Queue URL
    const queueUrl = triggerRes.headers.location;

    // 🔢 Build number
    const buildNumber = await getBuildNumber(queueUrl);

    // ⏳ Wait for completion
    const result = await waitForBuild(jobName, buildNumber);

    // 📜 Logs
    const consoleText = await getConsoleOutput(jobName, buildNumber);

    // 📊 Summary
    const summary = extractSummary(consoleText);

    // ❌ Failed tests
    const failedTests = extractFailedTests(consoleText);

    const durationSec = (result.duration / 1000).toFixed(2);
    const buildUrl = `${JENKINS_URL}/job/${jobName}/${buildNumber}`;

    // 🎯 Build message
    let message = `
${result.result === "SUCCESS" ? "✅" : "❌"} *Build ${result.result}*
*Job:* ${rawJobName}
*Build:* #${buildNumber}
*Duration:* ${durationSec}s

📊 *Test Summary*
✔ Passed: ${summary.passed}
❌ Failed: ${summary.failed}
⚠ Skipped: ${summary.skipped}
`;

    // 🔥 Add failed tests (if any)
    if (failedTests.length > 0) {
      message += `\n❌ *Failed Tests (Top ${failedTests.length})*\n`;
      failedTests.forEach((t, i) => {
        message += `${i + 1}. ${t}\n`;
      });
    }

    // 🔗 Add links
    message += `\n🔗 ${buildUrl}`;

    // 📤 Send to Slack
    await axios.post(responseUrl, {
      text: message,
    });
  } catch (err) {
    console.error("FULL ERROR:", err.response?.data || err.message);

    if (req.body.response_url) {
      await axios.post(req.body.response_url, {
        text: "❌ Jenkins trigger failed",
      });
    }
  }
});

// ✅ Dynamic port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
