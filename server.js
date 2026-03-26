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

// 🔁 Get latest build status
async function getBuildStatus(jobName) {
  const res = await axios.get(
    `${JENKINS_URL}/job/${jobName}/lastBuild/api/json`,
    {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    }
  );
  return res.data;
}

// ⏳ Wait until build completes
async function waitForBuild(jobName) {
  let building = true;
  let data;

  while (building) {
    await new Promise((r) => setTimeout(r, 5000)); // wait 5 sec
    data = await getBuildStatus(jobName);
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
    // ✅ Respond immediately to Slack (VERY IMPORTANT)
    res.send(`🚀 Triggering Jenkins job: ${rawJobName}...`);

    // 🔐 Step 1: Get CSRF crumb
    const crumbRes = await axios.get(`${JENKINS_URL}/crumbIssuer/api/json`, {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    });

    const crumb = crumbRes.data.crumb;
    const crumbField = crumbRes.data.crumbRequestField;

    // 🚀 Step 2: Trigger job
    await axios.post(
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
      }
    );

    // ⏳ Step 3: Wait for build result
    const result = await waitForBuild(jobName);

    // 📊 Format message
    const durationSec = (result.duration / 1000).toFixed(2);
    const buildUrl = `${JENKINS_URL}/job/${jobName}/${result.number}`;

    let message = "";

    if (result.result === "SUCCESS") {
      message = `✅ *Build Success*\nJob: ${rawJobName}\nDuration: ${durationSec}s\n🔗 ${buildUrl}`;
    } else {
      message = `❌ *Build Failed*\nJob: ${rawJobName}\n🔗 ${buildUrl}`;
    }

    // 📤 Step 4: Send result back to Slack
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

// ✅ Dynamic port (Render)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});