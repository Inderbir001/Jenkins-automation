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

// ⏳ Get build number from queue
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

// ⏳ Wait for specific build
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
      }
    );

    data = res.data;
    building = data.building;
  }

  return data;
}

// 🚀 Slack trigger route
app.post("/slack-trigger", async (req, res) => {
  const rawJobName = req.body.text || "MCSL Pipeline";
  const jobName = encodeURIComponent(rawJobName);
  const responseUrl = req.body.response_url;

  try {
    // ✅ Immediate response
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

    // 🚀 Trigger job
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
      }
    );

    // 📌 Get queue URL
    const queueUrl = triggerRes.headers.location;

    // ⏳ Get actual build number
    const buildNumber = await getBuildNumber(queueUrl);

    // ⏳ Wait for build result
    const result = await waitForBuild(jobName, buildNumber);

    // 📊 Format message
    const durationSec = (result.duration / 1000).toFixed(2);
    const buildUrl = `${JENKINS_URL}/job/${jobName}/${buildNumber}`;

    let message = "";

    if (result.result === "SUCCESS") {
      message = `✅ *Build Success*\nJob: ${rawJobName}\nBuild: #${buildNumber}\nDuration: ${durationSec}s\n🔗 ${buildUrl}`;
    } else {
      message = `❌ *Build Failed*\nJob: ${rawJobName}\nBuild: #${buildNumber}\n🔗 ${buildUrl}`;
    }

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