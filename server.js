const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.urlencoded({ extended: true }));

const JENKINS_URL = "http://localhost:8080";
const USERNAME = process.env.USERNAME;
const API_TOKEN = process.env.API_TOKEN;

app.post("/slack-trigger", async (req, res) => {
  const rawJobName = req.body.text || "MCSL Pipeline";
  const jobName = encodeURIComponent(rawJobName);

  try {
    // 🔐 Step 1: Get crumb
    const crumbRes = await axios.get(`${JENKINS_URL}/crumbIssuer/api/json`, {
      auth: {
        username: USERNAME,
        password: API_TOKEN,
      },
    });

    const crumb = crumbRes.data.crumb;
    const crumbField = crumbRes.data.crumbRequestField;

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

    res.send(`✅ Jenkins job triggered: ${rawJobName}`);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    res.send(`❌ Failed to trigger Jenkins`);
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
