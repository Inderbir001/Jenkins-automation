const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.urlencoded({ extended: true }));

// ✅ Use ENV variables (Render friendly)
const JENKINS_URL = process.env.JENKINS_URL;
const USERNAME = process.env.JENKINS_USER;
const API_TOKEN = process.env.JENKINS_TOKEN;

// 🔍 Health check route (optional but useful)
app.get("/", (req, res) => {
  res.send("🚀 Slack → Jenkins Trigger is running");
});

app.post("/slack-trigger", async (req, res) => {
  const rawJobName = req.body.text || "MCSL Pipeline";
  const jobName = encodeURIComponent(rawJobName);

  try {
    // 🔐 Step 1: Get CSRF crumb
    const crumbRes = await axios.get(`${JENKINS_URL}/crumbIssuer/api/json`, {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    });

    const crumb = crumbRes.data.crumb;
    const crumbField = crumbRes.data.crumbRequestField;

    // 🚀 Step 2: Trigger Jenkins job
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
      },
    );

    return res.send(`✅ Jenkins job triggered: ${rawJobName}`);
  } catch (err) {
    console.error("FULL ERROR:", err.response?.data || err.message);
    return res.status(500).send("❌ Failed to trigger Jenkins");
  }
});

// ✅ Use dynamic port (REQUIRED for Render)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
